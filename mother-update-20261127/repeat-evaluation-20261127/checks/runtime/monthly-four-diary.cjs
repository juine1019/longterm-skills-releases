'use strict';
// 4번 업무수행일지 자동 수집(diary-prepare 정식 어댑터, 2026-11-20 A).
// 기존 절차(monthly-workflow.md 2절)를 그대로 묶는다: probe-lt-diary(ym=M, D월1일~M월말일, contractScope=all) →
// collect-lt-diary(months=D,M, lookbackFrom=D월1일, offset/limit=6)를 nextOffset으로 끝(-1)까지 읽는다. 읽기 전용이다.
// - 결과: 작업폴더(그 달 questions)에 기존 4번이 읽는 diary-1.json({ok,writes:0,people:[{name,ltc,entries}],…})과
//   원 수집 증빙 lt-diary-raw.json(probe·배치 결과 원형)을 새로 만든다(wx). 증빙 이름은 질문 준비가 읽는 diary-*/plans-* 형식을 피한다.
// - 이미 같은 기관·기간·대상·형식으로 만든 diary-1.json이 원 증빙과 맞으면 수집 0회로 재사용한다. 다르면 덮어쓰지 않는다.
// - 대상 일부(recipients)는 읽기는 전체 계약으로 하되 diary-1.json에는 인정번호가 일치하는 사람만 남긴다(이름으로 판정하지 않음).
// - 동의창·화면 변경·화면 없음은 사용자 판단(held), 잘림·불연속은 held DIARY_INCOMPLETE, 조회 실패·기간/기관 불일치·예외는 failed.
//   자동 재시도·다른 창 attach는 하지 않는다. 결과 outputs에는 건수·기간 메타만 넣는다(이름·인정번호·일지 본문 없음).
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');

const DIARY='diary-1.json',RAW='lt-diary-raw.json',LIMIT=6,MAX_BATCHES=500;
const STEPS=['probe-lt-diary','collect-lt-diary'];
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/,HEX=/^[0-9a-f]{64}$/,KEY=/^[A-Za-z0-9-]{1,40}\|[A-Za-z0-9-]{1,20}$/,DATE=/^\d{4}-\d{2}-\d{2}$/,DIARY_NAME=/^diary-.*\.json$/i;
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const normOrg=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
const serialize=v=>JSON.stringify(v,null,1)+'\n';
const result=(status,code,extra={})=>({status,...(code?{code}:{}),...extra});
const sameParams=(a,b)=>{const norm=x=>JSON.stringify(Object.entries(x).map(([k,v])=>[k,String(v)]).sort());return!!a&&!!b&&typeof a==='object'&&typeof b==='object'&&norm(a)===norm(b);};

// 기록월 M과 추천 보조월 D(=M-1). 읽기 기간은 D월1일~M월말일.
function period(month){
 const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7),last=new Date(Date.UTC(y,m,0)).getUTCDate();
 const M=month.replace('-',''),Dm=d.replace('-',''),from=Dm+'01',to=M+String(last).padStart(2,'0');
 return{recordMonth:month,recommendMonth:d,from,to,months:[Dm,M],
  probe:{ym:M,from,to,contractScope:'all'},
  collect:offset=>({months:Dm+','+M,from,to,lookbackFrom:from,contractScope:'all',offset:String(offset),limit:String(LIMIT)})};
}
function normTargets(t){
 if(t?.kind==='all')return{kind:'all'};
 if(t?.kind!=='recipients'||!Array.isArray(t.keys)||!t.keys.length||!t.keys.every(k=>typeof k==='string'&&KEY.test(k))||new Set(t.keys).size!==t.keys.length)return null;
 return{kind:'recipients',keys:[...t.keys].sort()};
}
// 수집 단계 결과 하나의 판정. 문제가 없으면 null.
function checkStep(r){
 if(!r||typeof r!=='object')return result('failed','DIARY_READ_FAILED');
 if(r.writes!==undefined&&r.writes!==0)return result('failed','DIARY_WRITES_OBSERVED');
 if(r.state==='CONSENT_REQUIRED')return result('held','DIARY_CONSENT_REQUIRED');
 if(['UNKNOWN','MENU_UNAVAILABLE','SCREEN_NOT_OPEN'].includes(r.state))return result('held','DIARY_SCREEN_UNAVAILABLE');
 if(r.uiPreserved===false)return result('held','DIARY_SCREEN_CHANGED');
 if(r.ok!==true)return result('failed','DIARY_READ_FAILED');
 if(r.writes!==0)return result('failed','DIARY_WRITES_OBSERVED');
 if(r.uiPreserved!==true)return result('held','DIARY_SCREEN_CHANGED');
 return null;
}
// 읽은 사람·일지가 요청 기간 안인지: 모든 일지는 M월말일 이전, D월1일 이전 일지는 사람마다 가장 최근 1건까지(기존 수집기 규칙).
function peopleInPeriod(people,p){
 for(const x of people){
  if(!x||typeof x.name!=='string'||typeof x.ltc!=='string'||!x.ltc||!Array.isArray(x.entries))return false;
  let early=0;
  for(const e of x.entries){
   if(!e||typeof e.id!=='string'||typeof e.date!=='string'||!DATE.test(e.date))return false;
   const d=e.date.replace(/-/g,'');if(d>p.to)return false;if(d<p.from)early++;
  }
  if(early>1)return false;
 }
 return true;
}
// probe·배치 결과 전체를 판정한다. 새 수집과 재사용 확인이 같은 규칙을 쓴다.
// 끝까지 읽어 맞으면 {ok:true,people,total}, 아직 끝나지 않았으면 {status:'held',code:'DIARY_INCOMPLETE',next:<다음 offset>}.
function judge({probe,batches},p,org){
 const bad=checkStep(probe);if(bad)return bad;
 if(probe.state!=='READY'||!Number.isInteger(probe.peopleRows)||probe.peopleRows<0)return result('failed','DIARY_READ_FAILED');
 if(probe.identity?.code!=='20A'||normOrg(probe.identity.org)!==normOrg(org.name))return result('failed','DIARY_ORG_MISMATCH');
 let offset=0,total=null;const people=[];
 for(const [i,r] of batches.entries()){
  const b=checkStep(r);if(b)return b;
  if(!Array.isArray(r.people)||!Number.isInteger(r.total)||r.total<0||r.offset!==offset||!Number.isInteger(r.processed)||r.processed!==r.people.length||r.processed>LIMIT||total!==null&&r.total!==total)return result('held','DIARY_INCOMPLETE');
  total=r.total;const end=offset+r.processed,next=end>=total?-1:end;
  if(r.nextOffset!==next||r.processed===0&&next!==-1||next===-1&&(end!==total||i!==batches.length-1))return result('held','DIARY_INCOMPLETE');
  if(!peopleInPeriod(r.people,p))return result('failed','DIARY_PERIOD_MISMATCH');
  people.push(...r.people);
  if(next===-1)return total<probe.peopleRows?result('held','DIARY_INCOMPLETE'):{ok:true,people,total};
  offset=end;
 }
 return result('held','DIARY_INCOMPLETE',{next:offset});
}
function buildDiary({org,p,targets,people,rawSha256}){
 const want=targets.kind==='all'?null:new Set(targets.keys.map(k=>k.split('|')[0]));
 return{schemaVersion:1,kind:'lt-diary-collection',ok:true,writes:0,uiPreserved:true,organizationId:org.id,
  recordMonth:p.recordMonth,recommendMonth:p.recommendMonth,from:p.from,to:p.to,months:p.months,contractScope:'all',
  targets,rawFile:RAW,rawSha256,people:want?people.filter(x=>want.has(x.ltc)):people};
}
function outputsOf({p,targets,people,diary,batches,prepare}){
 const has=new Set(people.map(x=>x.ltc));
 return{prepare,recordMonth:p.recordMonth,recommendMonth:p.recommendMonth,from:p.from,to:p.to,contractScope:'all',readScope:'all-contracts',
  batches,totalPeople:people.length,keptPeople:diary.people.length,entries:diary.people.reduce((n,x)=>n+x.entries.length,0),
  targets:targets.kind,...(targets.kind==='recipients'?{matchedBy:'recognitionNo',selectedKeys:targets.keys.length,selectedWithoutDiary:targets.keys.filter(k=>!has.has(k.split('|')[0])).length}:{})};
}
const evidenceOf=dir=>Object.fromEntries([DIARY,RAW].map(n=>[n,sha(fs.readFileSync(path.join(dir,n)))]));

// 이미 있는 일지: 원 증빙을 같은 규칙으로 다시 판정해 같은 바이트의 diary-1.json이 나올 때만 재사용한다.
function reuse({workDir,names,p,org,targets}){
 const mismatch=result('conflict','DIARY_EXISTS_MISMATCH');
 if(JSON.stringify(names.filter(n=>DIARY_NAME.test(n)))!==JSON.stringify([DIARY])||!names.includes(RAW))return mismatch;
 let raw,rawBytes,diaryBytes;
 try{rawBytes=fs.readFileSync(path.join(workDir,RAW));diaryBytes=fs.readFileSync(path.join(workDir,DIARY));raw=JSON.parse(rawBytes.toString('utf8'));}catch{return mismatch;}
 if(raw?.schemaVersion!==1||raw.kind!=='lt-diary-raw'||raw.organizationId!==org.id||raw.recordMonth!==p.recordMonth||!Array.isArray(raw.batches)||!Array.isArray(raw.request?.collect)
  ||raw.request.collect.length!==raw.batches.length||!sameParams(raw.request.probe,p.probe)||!raw.request.collect.every((q,i)=>sameParams(q,p.collect(raw.batches[i]?.offset))))return mismatch;
 const j=judge(raw,p,org);if(!j.ok)return mismatch;
 const diary=buildDiary({org,p,targets,people:j.people,rawSha256:sha(rawBytes)});
 if(!Buffer.from(serialize(diary)).equals(diaryBytes))return mismatch;
 return result('succeeded',null,{evidence:evidenceOf(workDir),outputs:outputsOf({p,targets,people:j.people,diary,batches:raw.batches.length,prepare:'reused'})});
}

async function prepareMonthlyDiary({context,month,workDir,targets,adapters={}}={}){
 if(typeof month!=='string'||!MONTH.test(month))return result('failed','MONTH_INVALID');
 const want=normTargets(targets);if(!want)return result('failed','TARGETS_INVALID');
 const org=context?.settings?.organization;if(!org?.id||!org?.name)return result('failed','ORGANIZATION_REQUIRED');
 if(typeof workDir!=='string'||!workDir)return result('failed','WORK_DIR_REQUIRED');
 const p=period(month);
 fs.mkdirSync(workDir,{recursive:true});
 const names=fs.readdirSync(workDir);
 if(names.some(n=>DIARY_NAME.test(n))||names.includes(RAW))return reuse({workDir,names,p,org,targets:want});
 const runStep=adapters.runStep||defaultRunStep({context});
 const raw={schemaVersion:1,kind:'lt-diary-raw',organizationId:org.id,recordMonth:month,collectedAt:null,request:{probe:p.probe,collect:[]},probe:null,batches:[]};
 let j;
 try{
  raw.probe=await runStep('probe-lt-diary',p.probe);
  // 정상 배치가 아직 끝나지 않은 경우(next)만 다음 offset을 읽는다. 다른 판정은 그대로 돌려준다(재시도 없음).
  for(j=judge(raw,p,org);!j.ok&&j.next!==undefined&&raw.batches.length<MAX_BATCHES;j=judge(raw,p,org)){
   const q=p.collect(j.next);raw.request.collect.push(q);raw.batches.push(await runStep('collect-lt-diary',q));
  }
 }catch{return result('failed','DIARY_COLLECTION_FAILED');}
 if(!j.ok){const {next,...r}=j;return r;}
 raw.collectedAt=new Date().toISOString();
 const rawBytes=Buffer.from(serialize(raw)),diary=buildDiary({org,p,targets:want,people:j.people,rawSha256:sha(rawBytes)});
 try{fs.writeFileSync(path.join(workDir,RAW),rawBytes,{flag:'wx'});fs.writeFileSync(path.join(workDir,DIARY),serialize(diary),{flag:'wx'});}
 catch(e){return e.code==='EEXIST'?result('conflict','DIARY_EXISTS_MISMATCH'):result('failed','DIARY_STORE_FAILED');}
 return result('succeeded',null,{evidence:evidenceOf(workDir),outputs:outputsOf({p,targets:want,people:j.people,diary,batches:raw.batches.length,prepare:'collected'})});
}

// 설치본(<release>/runtime 옆 skills) → 개발본(저장소 claude-skills) 순서. 개발자 절대경로를 가정하지 않는다.
function skillsRoot(base=__dirname){
 for(const dir of [path.resolve(base,'../skills'),path.resolve(base,'../../claude-skills')])if(fs.existsSync(path.join(dir,'care-visit-review','scripts','lt-only','collect-diary.ps1')))return dir;
 fail('SKILLS_FOLDER_MISSING');
}
// 기본 수집 단계: 지정 실행 러너 래퍼(collect-diary.ps1)를 셸 없이 부르고 LONGTERM_WORKSPACE로 작업공간 binding을 넘긴다.
// 첫 단계에서 러너가 고정한 binding 지문을 뒤 단계에 넘겨, 실행 중 창 지정이 바뀌면 브라우저 호출 전에 멈추게 한다.
// 래퍼가 실제로 넘긴 조회 조건(params)이 요청과 다르면 결과를 쓰지 않는다. 원문이 든 임시 결과는 자신이 만든 임시 폴더에만 두고 지운다.
function defaultRunStep({context,scope,spawn=spawnSync,env=process.env,powershell='powershell.exe',root,tempDir}={}){
 let pinned=scope?require('./environment.cjs').transportFingerprint(scope):null;
 return async(step,params)=>{
  if(pinned&&env.LONGTERM_BINDING_SHA256&&env.LONGTERM_BINDING_SHA256!==pinned)fail('BROWSER_BINDING_CHANGED');
  if(!STEPS.includes(step)||!params||typeof params!=='object')fail('DIARY_STEP_INVALID');
  const collect=step==='collect-lt-diary',ym=String((collect?String(params.months||'').split(',')[1]:params.ym)||'');
  if(!/^\d{6}$/.test(ym))fail('DIARY_STEP_INVALID');
  const month=ym.slice(0,4)+'-'+ym.slice(4);
  const script=path.join(root||skillsRoot(),'care-visit-review','scripts','lt-only','collect-diary.ps1');
  const tmp=fs.mkdtempSync(path.join(tempDir||env.LONGTERM_RUN_TEMP||os.tmpdir(),'four-diary-'));
  try{
   const out=path.join(tmp,'out.json'),childEnv={...env,LONGTERM_WORKSPACE:context.root};if(pinned)childEnv.LONGTERM_BINDING_SHA256=pinned;
   const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Step',step,'-Month',month,...(collect?['-Offset',String(params.offset),'-Limit',String(params.limit)]:[]),'-Out',out];
   const r=spawn(powershell,args,{env:childEnv,encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
   if(!r||r.error||r.status!==0||!fs.existsSync(out))fail('DIARY_COLLECTION_FAILED');
   let o;try{o=JSON.parse(fs.readFileSync(out,'utf8').replace(/^﻿/,''));}catch{fail('DIARY_COLLECTION_RESULT_INVALID');}
   if(o?.ok!==true||o.step!==step||o.month!==month||!sameParams(o.params,params)||!HEX.test(String(o.binding))||pinned&&o.binding!==pinned)fail('DIARY_STEP_MISMATCH');
   pinned=o.binding;return o.result;
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 };
}
module.exports={prepareMonthlyDiary,defaultRunStep,skillsRoot,period,DIARY,RAW};
