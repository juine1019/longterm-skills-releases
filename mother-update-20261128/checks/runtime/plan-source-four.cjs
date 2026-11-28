'use strict';
// 4번 계획서 원문 준비(2026-11-18 U4-01 Task3).
// prepare: 지정 기관20A 탭에서 해당 월에 걸친 계획 목록·대상 상세를 한 번 읽고(목록 재확인 포함) 원문을 기관 보관소에 저장한 뒤,
//          새 작업폴더에 기존 4번 입력 모양(plans-archive.json)과 준비 명세(plan-source-manifest.json)를 만든다.
// replay : 보관된 완전 실행을 원천 조회 0회로 같은 입력으로 다시 만든다. 과거 스냅샷을 현재 원천의 최신본으로 표시하지 않는다.
// 로컬 준비까지만 한다(업무데스크·롱텀 쓰기 0). 부분·불명 수집은 실행 이력으로만 남기고 입력 파일을 만들지 않는다.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const S=require('./plan-source-store.cjs'),C=require('./context.cjs');
const fail=(code,detail)=>{throw Object.assign(Error(detail?code+':'+detail:code),{code});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const ARCHIVE='plans-archive.json',MANIFEST='plan-source-manifest.json';
const DOWNSTREAM=/^(plans-archive\.json|plans-\d+\.json|plan-source-manifest\.json|input-manifest\.json|candidates\.json|writer-.*\.json|put-.*\.json|register-.*\.json|summary\.txt|failures\.json|month-after\.json)$/;
function core(){
 for(const p of [path.resolve(__dirname,'../skills/care-visit-review/scripts/plan-source-core.js'),path.resolve(__dirname,'../../claude-skills/care-visit-review/scripts/plan-source-core.js')])if(fs.existsSync(p))return require(p);
 fail('PLAN_SOURCE_CORE_MISSING');
}
function monthRange(month){const [y,m]=month.split('-').map(Number);return{from:month.replace('-','')+'01',to:month.replace('-','')+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')};}
const keyOf=(ltc,seq)=>String(ltc)+'|'+String(seq);
// 해당 월과 적용기간이 겹치는 방문요양 계획 중 대상 수급자·차수의 것만 고른다(같은 번호·기간 중복 요청은 한 번).
function selectPlans(rows,{month,recipients}){
 const {from,to}=monthRange(month),want=new Set(recipients.map(r=>keyOf(r.recognitionNo,r.recognitionSeq))),seen=new Set(),out=[];
 for(const r of rows||[]){
  const k=String(r.POF_PLNPP_MGMT_NO)+'|'+r.ADPT_FR_DT+'|'+r.ADPT_TO_DT;
  if(!want.has(keyOf(r.LTC_MGMT_NO,r.LTC_MGMT_NO_SEQ))||String(r.LTCP_CLSFC_CD)!=='001'||!(String(r.ADPT_FR_DT)<=to&&String(r.ADPT_TO_DT)>=from)||seen.has(k))continue;
  seen.add(k);out.push(r);
 }
 return out;
}
// 수급자 입력은 실제 명부 원천(registry 바이트) 해시로 확인한다. 파일 이름만으로 출처를 인정하지 않는다.
function checkRecipients(context,recipients,registry){
 const org=context.settings.organization.id;
 if(recipients?.schemaVersion!==1||recipients.organizationId!==org||!/^[0-9a-f]{64}$/.test(recipients.sourceSha256||'')||!Array.isArray(recipients.recipients)||!recipients.recipients.length||recipients.recipients.some(r=>typeof r?.recognitionNo!=='string'||!r.recognitionNo||typeof r.recognitionSeq!=='string'||!r.recognitionSeq))fail('PLAN_SOURCE_RECIPIENTS_INVALID');
 if(!Buffer.isBuffer(registry?.bytes)||sha(registry.bytes)!==recipients.sourceSha256)fail('PLAN_SOURCE_REGISTRY_MISMATCH');
 const keys=recipients.recipients.map(r=>keyOf(r.recognitionNo,r.recognitionSeq));if(new Set(keys).size!==keys.length)fail('PLAN_SOURCE_RECIPIENTS_INVALID','duplicate');
 return{keys,people:mapPeople(registry,recipients.recipients.map(r=>r.recognitionNo))};
}
// 원천 수급자 → 기존 목적지(이름·lpi) 대응: 명부에서 같은 인정번호가 정확히 하나일 때만 쓴다.
function mapPeople(registry,ltcs){
 const list=Array.isArray(registry?.list)?registry.list:[],map=new Map();
 for(const ltc of ltcs){const hit=list.filter(x=>String(x?.ltc)===ltc);if(hit.length!==1||!hit[0].name||hit[0].lpi===undefined)fail('PLAN_SOURCE_RECIPIENT_UNMAPPED',ltc);map.set(ltc,{name:String(hit[0].name),lpi:String(hit[0].lpi)});}
 return map;
}
function checkFolder(dir){
 if(!fs.existsSync(dir))return;
 if(!fs.lstatSync(dir).isDirectory()||fs.readdirSync(dir).some(n=>DOWNSTREAM.test(n)))fail('NEW_WORK_FOLDER');
}
const order=(a,b)=>a.identity.recognitionNo.localeCompare(b.identity.recognitionNo)||a.identity.recognitionSeq.localeCompare(b.identity.recognitionSeq)||a.period.from.localeCompare(b.period.from)||a.identity.planId.localeCompare(b.identity.planId);
function writeOutputs(dir,{sources,keys,people,month,organizationId,storeManifestSha256,registrySha256,sourceMode,coverage}){
 const P=core(),sorted=[...sources].sort(order);
 const results=keys.map(k=>{const [ltc,seq]=k.split('|'),who=people.get(ltc);return{name:who.name,ltc,lpi:who.lpi,ok:true,plans:sorted.filter(s=>s.identity.recognitionNo===ltc&&s.identity.recognitionSeq===seq).map(P.toAnalysisPlan)};});
 const archive=Buffer.from(JSON.stringify({ok:true,results},null,1)+'\n','utf8');
 const manifest={schemaVersion:1,kind:'plan-source-prepare',month,organizationId,storeManifestSha256,registrySha256,plansFile:ARCHIVE,plansFileSha256:sha(archive),sourceMode,coverage,recipients:keys};
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,ARCHIVE),archive,{flag:'wx'});
 fs.writeFileSync(path.join(dir,MANIFEST),JSON.stringify(manifest,null,1)+'\n',{flag:'wx'});
 return{plansFile:path.join(dir,ARCHIVE),manifestFile:path.join(dir,MANIFEST)};
}
async function preparePlanSource({context,month,workDir,recipients,registry,collectPlans,workspaceLease,store}={}){
 if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');
 if(typeof workDir!=='string'||!workDir.trim())fail('WORK_FOLDER_REQUIRED');
 const P=core(),{keys,people}=checkRecipients(context,recipients,registry),dir=path.resolve(workDir);checkFolder(dir);
 if(typeof collectPlans!=='function')fail('COLLECTOR_REQUIRED');
 store=store||S.storeForContext(context,{workspaceLease});
 const startedAt=new Date().toISOString(),r=await collectPlans({month,recipients:recipients.recipients.map(x=>({...x}))});
 // 목록 열이 빠지면 빈 값으로 채운 행이라 대상 0건이 될 수 있다. 오류 목록이 비어 있어도 완전 수집으로 보지 않는다.
 const listBad=x=>x?.ok!==true||!Array.isArray(x.out?.rows)||(x.out.errors||[]).length||(x.out.missingCols||[]).length;
 if(r?.ok!==true||listBad(r.list)||(r.recheck&&(r.recheck.out?.missingCols||[]).length))fail('PLAN_SOURCE_LIST_FAILED');
 const scope={month,recipients:recipients.recipients},wanted=selectPlans(r.list.out.rows,scope);
 // 목록을 다시 읽어 같은지 확인한다. 다르면 서로 다른 시점의 결과를 섞지 않고 아무것도 저장하지 않는다(목록으로 판별할 수 없는 상세 변경은 한계로 남는다).
 if(r.recheck?.ok!==true||!Array.isArray(r.recheck.out?.rows)||(r.recheck.out.errors||[]).length||P.canonical(selectPlans(r.recheck.out.rows,scope))!==P.canonical(wanted))fail('PLAN_SOURCE_CHANGED_DURING_READ');
 const byKey=new Map(),planErrors=new Set(),globalErrors=[],wantedIds=new Set(wanted.map(w=>String(w.POF_PLNPP_MGMT_NO)));
 for(const d of Array.isArray(r.details)?r.details:[]){
  if(d?.ok!==true){globalErrors.push('detail-failed');continue;}
  for(const e of d.out?.errors||[]){const id=/^([^:]+):/.exec(String(e))?.[1];if(id&&wantedIds.has(id))planErrors.add(id);else globalErrors.push(String(e).slice(0,80));}
  for(const s of d.out?.sourcePlans||[])byKey.set(s?.identity?.planId+'|'+s?.period?.from+'|'+s?.period?.to,s);
 }
 const sources=[],failed=new Set(planErrors);
 for(const w of wanted){
  const s=byKey.get(w.POF_PLNPP_MGMT_NO+'|'+w.ADPT_FR_DT+'|'+w.ADPT_TO_DT);
  const ok=s&&P.validateSource(s,{organizationId:context.settings.organization.id,recognitionNo:String(w.LTC_MGMT_NO),recognitionSeq:String(w.LTC_MGMT_NO_SEQ),planId:String(w.POF_PLNPP_MGMT_NO),serviceCode:'001',from:String(w.ADPT_FR_DT),to:String(w.ADPT_TO_DT)}).ok;
  if(ok&&!planErrors.has(String(w.POF_PLNPP_MGMT_NO)))sources.push(s);else failed.add(String(w.POF_PLNPP_MGMT_NO));
 }
 const failedKeys=new Set(wanted.filter(w=>failed.has(String(w.POF_PLNPP_MGMT_NO))).map(w=>keyOf(w.LTC_MGMT_NO,w.LTC_MGMT_NO_SEQ)));
 const read=globalErrors.length?[]:keys.filter(k=>!failedKeys.has(k));
 const failedPlans=[...failed,...globalErrors.map(e=>'run:'+e)];
 // 이달에 걸친 계획 행이 하나도 없는 수급자는 「읽음」과 별도로 계획 없음으로 보고한다(목록에 없다는 뜻이며 미작성 단정은 아님).
 const withPlan=new Set(wanted.map(w=>keyOf(w.LTC_MGMT_NO,w.LTC_MGMT_NO_SEQ))),noPlanRecipients=keys.filter(k=>!withPlan.has(k));
 const coverage={requestedRecipients:keys,readRecipients:read,missingRecipients:keys.filter(k=>!read.includes(k)),noPlanRecipients,failedPlans,complete:read.length===keys.length&&!failedPlans.length};
 const saved=store.saveRun({month,runId:'run-'+crypto.randomUUID(),sources,coverage,registry:{sha256:recipients.sourceSha256,people:Object.fromEntries(people)},startedAt,completedAt:new Date().toISOString()});
 if(!coverage.complete)return{status:'partial',manifestFile:null,manifestSha256:saved.manifestSha256,plansFile:null,coverage,sourceMode:'fresh-read'};
 const out=writeOutputs(dir,{sources,keys,people,month,organizationId:context.settings.organization.id,storeManifestSha256:saved.manifestSha256,registrySha256:recipients.sourceSha256,sourceMode:'fresh-read',coverage});
 return{status:'prepared',manifestFile:out.manifestFile,manifestSha256:saved.manifestSha256,plansFile:out.plansFile,coverage,sourceMode:'fresh-read'};
}
async function replayPlanSource({context,month,workDir,manifestSha256,registry,workspaceLease,store}={}){
 if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');
 if(typeof workDir!=='string'||!workDir.trim())fail('WORK_FOLDER_REQUIRED');
 const dir=path.resolve(workDir);checkFolder(dir);
 if(!Buffer.isBuffer(registry?.bytes))fail('PLAN_SOURCE_REGISTRY_MISMATCH');
 store=store||S.storeForContext(context,{workspaceLease});
 const {manifest,sources}=store.loadRun({month,manifestSha256});
 if(manifest.coverage.complete!==true)fail('PLAN_SOURCE_RUN_INCOMPLETE');
 // 준비 때 결속한 명부와 같은 바이트일 때만 재현한다. 다른 명부로 목적지(이름·lpi)를 자동 재연결하지 않는다.
 const bound=manifest.registry;
 if(!bound||sha(registry.bytes)!==bound.sha256)fail('PLAN_SOURCE_REGISTRY_MISMATCH',bound?'replay':'unbound');
 const keys=manifest.coverage.requestedRecipients,people=new Map(Object.entries(bound.people));
 const out=writeOutputs(dir,{sources,keys,people,month,organizationId:context.settings.organization.id,storeManifestSha256:manifestSha256,registrySha256:bound.sha256,sourceMode:'snapshot-replay',coverage:manifest.coverage});
 return{status:'prepared',manifestFile:out.manifestFile,manifestSha256,plansFile:out.plansFile,coverage:manifest.coverage,sourceMode:'snapshot-replay'};
}
// 설치본(runtime 옆 skills) → 개발본(저장소 claude-skills) 순서. 개발자 절대경로를 가정하지 않는다.
function skillsRoot(base=__dirname){
 for(const dir of [path.resolve(base,'../skills'),path.resolve(base,'../../claude-skills')])if(fs.existsSync(path.join(dir,'care-visit-review','scripts','lt-only','collect-plan-source.ps1')))return dir;
 fail('SKILLS_FOLDER_MISSING');
}
// 기본 수집기: 지정 실행 러너 래퍼(collect-plan-source.ps1)를 셸 없이 부르고 LONGTERM_WORKSPACE로 작업공간 binding을 넘긴다.
// 원문이 든 임시 결과는 자신이 만든 임시 폴더에만 두고 읽은 뒤 지운다.
function defaultCollectPlans({context,spawn=spawnSync,env=process.env,powershell='powershell.exe',root,tempDir}={}){
 return async({month,recipients})=>{
  if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');
  const script=path.join(root||skillsRoot(),'care-visit-review','scripts','lt-only','collect-plan-source.ps1');
  const tmp=fs.mkdtempSync(path.join(tempDir||env.LONGTERM_RUN_TEMP||os.tmpdir(),'plan-src-'));
  try{
   const recFile=path.join(tmp,'recipients.json'),outFile=path.join(tmp,'out.json');fs.writeFileSync(recFile,JSON.stringify({recipients}),{flag:'wx'});
   const r=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Month',month,'-Recipients',recFile,'-Out',outFile],{env:{...env,LONGTERM_WORKSPACE:context.root},encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
   if(r.error||r.status!==0||!fs.existsSync(outFile))fail('PLAN_SOURCE_COLLECTION_FAILED');
   try{return JSON.parse(fs.readFileSync(outFile,'utf8').replace(/^﻿/,''));}catch{fail('PLAN_SOURCE_COLLECTION_RESULT_INVALID');}
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 };
}
function readRegistry(file){const bytes=fs.readFileSync(file);let parsed;try{parsed=JSON.parse(bytes.toString('utf8').replace(/^﻿/,''));}catch{fail('PLAN_SOURCE_REGISTRY_MISMATCH');}return{bytes,list:Array.isArray(parsed?.list)?parsed.list:[]};}
// 명령: node plan-source-four.cjs prepare --workspace <작업공간> --month YYYY-MM --work <새 폴더> --recipients <확인한 수급자.json> --registry <명부 원천.json>
//       node plan-source-four.cjs replay  --workspace <작업공간> --month YYYY-MM --work <새 폴더> --manifest-sha256 <해시> --registry <명부 원천.json>
async function cli(argv,{env=process.env,collectPlans}={}){
 const [command,...rest]=argv,o={};
 if(!['prepare','replay'].includes(command))fail('COMMAND_UNSUPPORTED');
 for(let i=0;i<rest.length;i+=2){const k=rest[i];if(!['--workspace','--month','--work','--recipients','--registry','--manifest-sha256'].includes(k)||o[k.slice(2)]!==undefined||rest[i+1]===undefined)fail('ARGUMENT_INVALID');o[k.slice(2)]=rest[i+1];}
 if(!o.work||!o.registry||(command==='prepare'?!o.recipients||o['manifest-sha256']:!o['manifest-sha256']||o.recipients))fail('ARGUMENT_INVALID');
 const context=C.loadContext(o.workspace||env.LONGTERM_WORKSPACE||process.cwd()),registry=readRegistry(o.registry);
 const lease=C.workspaceLease(context,'care-visit-review:plan-source:'+o.month,{env});
 try{
  const store=S.storeForContext(context,{workspaceLease:lease});
  const r=command==='prepare'
   ?await preparePlanSource({context,month:o.month,workDir:o.work,recipients:C.readJson(o.recipients),registry,collectPlans:collectPlans||defaultCollectPlans({context,env}),store,workspaceLease:lease})
   :await replayPlanSource({context,month:o.month,workDir:o.work,manifestSha256:o['manifest-sha256'],registry,store,workspaceLease:lease});
  return{ok:r.status==='prepared',...r};
 }finally{lease.release();}
}
if(require.main===module){cli(process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}).catch(e=>{console.log(JSON.stringify({ok:false,code:e.code||e.message}));process.exitCode=1;});}
module.exports={preparePlanSource,replayPlanSource,selectPlans,defaultCollectPlans,skillsRoot,cli};
