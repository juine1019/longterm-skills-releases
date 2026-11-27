'use strict';
// 4번(월간 급여제공 내용확인) 원문 준비: 기관·월별 특이사항 보관소(worker-notes-store.cjs)의 정책을 그대로 따라
// 필요한 경우에만 롱텀 기관20A 읽기 수집기로 한 번 읽어 저장하고, 기존 변환기(workerNotesLocalSnapshot)로 작업폴더 파일을 만든다.
// - 확정월·유효한 당월 수집본은 원천 조회 0회. 과거 미확정월 수집본은 다시 읽거나 자동 확정하지 않고 「마감 확인 필요」를 남긴다.
// - 로컬 준비까지만 한다(업무데스크 쓰기·검토완료·롱텀 쓰기 없음). worker-notes-source.json은 질문 등록 승인이 아니다.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const W=require('./worker-notes-store.cjs'),C=require('./context.cjs');
const fail=code=>{throw Object.assign(Error(code),{code});};
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const RFID='rfid.json',IMPORT='worker-notes-import.json',SOURCE='worker-notes-source.json';
// 원천이 다르면 덮어쓰면 안 되는 뒤 단계 산출물(질문 준비·작성·관문·등록).
const DOWNSTREAM=/^(input-manifest\.json|candidates\.json|writer-.*\.json|put-.*\.json|register-.*\.json|summary\.txt|failures\.json|month-after\.json)$/;
const serialize=v=>Buffer.from(JSON.stringify(v,null,1)+'\n','utf8');
const MARKER='WN_MONTH_BATCHES:';

// 작업폴더 상태: empty(없음·비었음·원천 자료만 있음) | prepared(이 도구가 준비한 폴더) | blocked(새 폴더 필요)
function inspectFolder(dir){
 if(!fs.existsSync(dir))return{kind:'empty'};
 if(!fs.lstatSync(dir).isDirectory())fail('NEW_WORK_FOLDER');
 const names=new Set(fs.readdirSync(dir));
 if(names.has(SOURCE)){
  if(!names.has(RFID)||!names.has(IMPORT))return{kind:'blocked'};
  try{return{kind:'prepared',source:JSON.parse(fs.readFileSync(path.join(dir,SOURCE),'utf8'))};}catch{return{kind:'blocked'};}
 }
 if(names.has(RFID)||names.has(IMPORT)||[...names].some(n=>DOWNSTREAM.test(n)))return{kind:'blocked'};
 return{kind:'empty'};
}

async function prepareFourSource({context,month,workDir,refreshCurrent=false,closing=null,collectMonth,toRfid,toImport,store,now=Date.now(),workspaceLease}={}){
 if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');
 if(typeof workDir!=='string'||!workDir.trim())fail('WORK_FOLDER_REQUIRED');
 const lib=(toRfid&&toImport)?null:require('./client/lib/workerNotesLocalSnapshot.js');
 toRfid=toRfid||lib.toRfid;toImport=toImport||lib.toImport;
 // 다른 기관 보관소·손상 인덱스는 여기서 실패한다(새 수집으로 숨기지 않음).
 store=store||W.storeForContext(context,{workspaceLease});
 const dir=path.resolve(workDir),folder=inspectFolder(dir);
 if(folder.kind==='blocked')fail('NEW_WORK_FOLDER');
 const refresh=refreshCurrent===true,p=store.plan(month,{now,refresh,closing});
 let calls=0,purpose=p.purpose;
 if(p.action==='collect'&&p.purpose==='unconfirmed-refresh'){
  // 과거 미확정월: 무단 반복 갱신·자동 확정 없이 저장된 수집본으로 준비한다.
  purpose='unconfirmed-reuse';
 }else if(p.action!=='reuse'){
  // 준비된 폴더는 새 수집본과 같을 수 없으므로 읽기 전에 멈춘다(확정만 하는 경우는 스냅샷이 같아 계속).
  if(p.action==='collect'&&folder.kind==='prepared')fail('NEW_WORK_FOLDER');
  if(p.action==='collect'&&typeof collectMonth!=='function')fail('COLLECTOR_REQUIRED');
  const r=await store.ensureMonth(month,{collect:async a=>{calls++;return collectMonth({...a,context});},now,refresh,closing});
  purpose=r.purpose;
 }
 const {entry,snapshot,sha256}=store.load(month),current=month===W.koreanMonth(now);
 const finality=entry.state==='final'?'final':current?'current-unconfirmed':'collected-unconfirmed',notices=[];
 if(finality==='collected-unconfirmed')notices.push('마감 확인 필요: 이 달은 확정 전 수집본입니다. 청구의뢰 또는 입력 마감을 실제 화면에서 확인한 뒤 --closing으로 다시 준비해야 확정됩니다(자동 확정·반복 갱신 없음).');
 if(finality==='current-unconfirmed')notices.push('당월 자료는 확정 전 수집본입니다. 최신 원문이 필요할 때만 --refresh-current로 다시 읽습니다.');
 // 변환기 결과를 그대로 쓴다(새 매핑 없음). 모두 만든 뒤에만 쓴다.
 const rfidBytes=serialize(toRfid(snapshot)),importBytes=serialize(toImport(snapshot,{orgName:store.organization.name,now}));
 const source={schemaVersion:1,month,organizationId:store.organization.id,snapshotSha256:sha256,recordsHash:snapshot.recordsHash,collectedAt:snapshot.collectedAt,finality,purpose,collectionCalls:calls,convertedBy:'workerNotesLocalSnapshot'};
 const files={rfidFile:path.join(dir,RFID),importFile:path.join(dir,IMPORT),sourceFile:path.join(dir,SOURCE)};
 const result=status=>({status,month,snapshotSha256:sha256,collectedAt:snapshot.collectedAt,finality,...files,collectionCalls:calls,purpose,notices});
 if(folder.kind==='prepared'){
  const s=folder.source;
  if(s?.schemaVersion===1&&s.month===month&&s.organizationId===source.organizationId&&s.snapshotSha256===sha256&&s.recordsHash===source.recordsHash&&fs.readFileSync(files.rfidFile).equals(rfidBytes)&&fs.readFileSync(files.importFile).equals(importBytes)){
   if(s.finality!==finality)notices.push('작업폴더의 원천 기록은 준비 당시 상태('+s.finality+')로 남아 있습니다. 파일은 바꾸지 않았습니다.');
   return result('reused');
  }
  fail('NEW_WORK_FOLDER');
 }
 fs.mkdirSync(dir,{recursive:true});
 // 덮어쓰지 않는다. 원천 기록 파일을 마지막에 써서 완성 표시로 쓴다.
 fs.writeFileSync(files.rfidFile,rfidBytes,{flag:'wx'});fs.writeFileSync(files.importFile,importBytes,{flag:'wx'});fs.writeFileSync(files.sourceFile,serialize(source),{flag:'wx'});
 return result('prepared');
}

// 설치본(runtime 옆 skills) → 개발본(저장소 claude-skills) 순서. 개발자 절대경로를 가정하지 않는다.
function skillsRoot(base=__dirname){
 for(const dir of [path.resolve(base,'../skills'),path.resolve(base,'../../claude-skills')])
  if(fs.existsSync(path.join(dir,'care-visit-review','scripts','lt-only','collect-month.ps1')))return dir;
 fail('SKILLS_FOLDER_MISSING');
}
// 기본 수집기: 작업공간을 LONGTERM_WORKSPACE로 넘겨 지정 실행 러너(longterm-past-schedule/scripts/run.ps1)로
// lt-spec-search.js → lt-spec-batch.js(includeUnused=1)를 끝까지 읽는다. 결과 배치는 다시 직렬화하지 않고 보관소 검증에 넘긴다.
function defaultCollectMonth({context,spawn=spawnSync,env=process.env,powershell='powershell.exe',root=skillsRoot()}={}){
 const script=path.join(root,'care-visit-review','scripts','lt-only','collect-month.ps1');
 return async({month})=>{
  if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');
  const r=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Month',month],{env:{...env,LONGTERM_WORKSPACE:context.root},encoding:'utf8',maxBuffer:256*1024*1024,windowsHide:true});
  if(r.error||r.status!==0)fail('LT_MONTH_COLLECTION_FAILED');
  const lines=String(r.stdout||'').split(/\r?\n/).filter(l=>l.startsWith(MARKER));
  if(lines.length!==1)fail('LT_MONTH_COLLECTION_RESULT_INVALID');
  let out;try{out=JSON.parse(lines[0].slice(MARKER.length));}catch{fail('LT_MONTH_COLLECTION_RESULT_INVALID');}
  if(out?.ok!==true||!Array.isArray(out.batches))fail('LT_MONTH_COLLECTION_FAILED');
  return out.batches;
 };
}

// 명령: node worker-notes-four.cjs prepare --workspace <작업공간> --month YYYY-MM --work <새 로컬 폴더> [--closing <마감확인.json>] [--refresh-current]
async function cli(argv,{env=process.env,now=Date.now(),collectMonth,storeForContext=W.storeForContext}={}){
 const [command,...rest]=argv,o={};
 if(command!=='prepare')fail('COMMAND_UNSUPPORTED');
 for(let i=0;i<rest.length;i++){const k=rest[i];if(k==='--refresh-current'){o.refreshCurrent=true;continue;}if(!['--workspace','--month','--work','--closing'].includes(k)||o[k.slice(2)]!==undefined||rest[i+1]===undefined)fail('ARGUMENT_INVALID');o[k.slice(2)]=rest[++i];}
 if(typeof o.month!=='string'||!MONTH.test(o.month))fail('MONTH_INVALID');
 if(!o.work)fail('WORK_FOLDER_REQUIRED');
 const context=C.loadContext(o.workspace||env.LONGTERM_WORKSPACE||process.cwd()),closing=o.closing?C.readJson(o.closing):null;
 const lease=C.workspaceLease(context,'care-visit-review:prepare-four:'+o.month,{env});
 try{
  const store=storeForContext(context,{workspaceLease:lease});
  const r=await prepareFourSource({context,month:o.month,workDir:o.work,refreshCurrent:o.refreshCurrent===true,closing,collectMonth:collectMonth||defaultCollectMonth({context,env}),store,now,workspaceLease:lease});
  return{ok:true,...r};
 }finally{lease.release();}
}
if(require.main===module){cli(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({ok:false,code:e.code||e.message}));process.exitCode=1;});}
module.exports={prepareFourSource,defaultCollectMonth,skillsRoot,inspectFolder,cli};
