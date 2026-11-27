'use strict';
// 기관별 급여제공계획서 원문 보관소(2026-11-18 4번 U4-01).
// - snapshots/<contentHash>.json: 불변 원문(조회 시각 등 read 제외, 키 정렬 직렬화). 같은 내용이면 바이트를 검증해 재사용한다.
// - months/<YYYY-MM>/<runId>/manifest.json: 이번 조회의 대상 범위(coverage)·원문 참조·파일 해시·조회 시각(read).
// - index.json: 월별 실행 참조. 기존 특이사항 보관소와 같은 잠금 규칙(worker-notes-lock.cjs)을 이 보관소 경로로 재사용한다.
// 고정 순서: 공용 작업 점유 → 계획 보관소 월 잠금 → 짧은 인덱스 잠금. 부분 수집은 실행 이력으로 남기되 완전 준비본으로 승격하지 않는다.
// 미참조 원문·명세(중단)는 자동 삭제·완료 처리하지 않는다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Lock=require('./worker-notes-lock.cjs');
const fail=(code,detail)=>{throw Object.assign(Error(detail?code+':'+detail:code),{code});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/,RUN_ID=/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/,HEX=/^[0-9a-f]{64}$/;
// 원문 계약 모듈: 설치본은 runtime 옆 skills, 개발본은 저장소 claude-skills. 상위 경로를 추측하지 않는다.
function core(){
 for(const p of [path.resolve(__dirname,'../skills/care-visit-review/scripts/plan-source-core.js'),path.resolve(__dirname,'../../claude-skills/care-visit-review/scripts/plan-source-core.js')])if(fs.existsSync(p))return require(p);
 fail('PLAN_SOURCE_CORE_MISSING');
}
const readOnly=f=>{try{fs.chmodSync(f,0o444);}catch{}};
// 임시 파일에 전부 쓰고 동기화한 뒤 최종 이름으로 연결한다(이미 있으면 실패). 도중에 끊기면 최종 이름의 잘린 파일이 남지 않고
// 임시 파일만 남는다(2026-11-20). 기존 최종 파일은 덮어쓰지 않는다.
function writeNew(file,bytes){
 fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))throw Object.assign(Error('EEXIST: '+path.basename(file)),{code:'EEXIST'});
 const temp=file+'.'+crypto.randomUUID()+'.partial',fd=fs.openSync(temp,'wx');
 try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}
 readOnly(file);
}
const mapLock=e=>{if(e?.code==='WORKER_NOTES_MONTH_BUSY')fail('PLAN_SOURCE_MONTH_BUSY');if(e?.code==='WORKER_NOTES_INDEX_BUSY')fail('PLAN_SOURCE_INDEX_BUSY');if(e?.code==='WORKER_NOTES_INDEX_CONFLICT')fail('PLAN_SOURCE_INDEX_CONFLICT');throw e;};
const strings=v=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=200);

function openPlanStore({root,organization,workspaceLease}){
 if(typeof root!=='string'||!root||!organization||typeof organization.id!=='string'||!organization.id||typeof organization.name!=='string')fail('PLAN_SOURCE_STORE_CONFIGURATION_INVALID');
 if(workspaceLease!=null&&typeof workspaceLease.assertOwned!=='function')fail('PLAN_SOURCE_STORE_CONFIGURATION_INVALID');
 root=path.resolve(root);const org={id:organization.id,name:organization.name},C=core();
 function readIndex(){
  const f=path.join(root,'index.json');if(!fs.existsSync(f))return{schemaVersion:1,organization:org,months:{}};
  let index;try{index=JSON.parse(fs.readFileSync(f,'utf8'));}catch{fail('PLAN_SOURCE_INDEX_INVALID');}
  if(index?.schemaVersion!==1||!index.months||typeof index.months!=='object')fail('PLAN_SOURCE_INDEX_INVALID');
  if(index.organization?.id!==org.id)fail('PLAN_SOURCE_ORGANIZATION_MISMATCH');return index;
 }
 const listRuns=month=>{if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');return structuredClone(readIndex().months[month]?.runs||[]);};
 function checkCoverage(c,sources){
  if(!c||!strings(c.requestedRecipients)||!strings(c.readRecipients)||!strings(c.missingRecipients)||!strings(c.failedPlans)||typeof c.complete!=='boolean')fail('PLAN_SOURCE_COVERAGE_INVALID');
  const read=new Set(c.readRecipients),missing=c.requestedRecipients.filter(x=>!read.has(x));
  if(JSON.stringify([...missing].sort())!==JSON.stringify([...c.missingRecipients].sort())||c.readRecipients.some(x=>!c.requestedRecipients.includes(x)))fail('PLAN_SOURCE_COVERAGE_INCONSISTENT','sets');
  // 부분 수집에서도 읽은 원문은 이력으로 남긴다. 단 요청 범위 밖 수급자의 원문은 받지 않는다.
  if(sources.some(s=>!c.requestedRecipients.includes(s.identity.recognitionNo+'|'+s.identity.recognitionSeq)))fail('PLAN_SOURCE_COVERAGE_INCONSISTENT','outside-request');
  if(c.complete&&(missing.length||c.failedPlans.length||!c.requestedRecipients.length))fail('PLAN_SOURCE_COVERAGE_INCONSISTENT','complete');
  // 이달 계획 행이 없는 수급자(계획 없음 보고)는 요청 범위 안에서만 그대로 보존한다.
  const noPlan=c.noPlanRecipients===undefined?[]:c.noPlanRecipients;
  if(!strings(noPlan)||noPlan.some(x=>!c.requestedRecipients.includes(x)))fail('PLAN_SOURCE_COVERAGE_INCONSISTENT','no-plan');
  return{requestedRecipients:[...c.requestedRecipients],readRecipients:[...c.readRecipients],missingRecipients:[...c.missingRecipients],noPlanRecipients:[...noPlan],failedPlans:[...c.failedPlans],complete:c.complete};
 }
 // 준비 때 쓴 명부 결속(명부 바이트 해시와 인정번호→이름·lpi 대응). replay가 다른 명부로 다시 연결하지 않게 실행에 남긴다.
 function checkRegistry(r,cov){
  if(r===undefined)return undefined;
  if(!r||!HEX.test(r.sha256||'')||!r.people||typeof r.people!=='object'||Array.isArray(r.people))fail('PLAN_SOURCE_REGISTRY_INVALID');
  const ltcs=new Set(cov.requestedRecipients.map(k=>k.split('|')[0]));
  if(Object.keys(r.people).length!==ltcs.size||[...ltcs].some(l=>typeof r.people[l]?.name!=='string'||typeof r.people[l]?.lpi!=='string'))fail('PLAN_SOURCE_REGISTRY_INVALID');
  return{sha256:r.sha256,people:Object.fromEntries([...ltcs].sort().map(l=>[l,{name:r.people[l].name,lpi:r.people[l].lpi}]))};
 }
 function saveRun({month,runId,sources,coverage,registry,startedAt,completedAt}={}){
  if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');
  if(typeof runId!=='string'||!RUN_ID.test(runId))fail('PLAN_SOURCE_RUN_ID_INVALID');
  if(!Array.isArray(sources))fail('PLAN_SOURCE_INVALID','sources');
  const keys=new Set(),prepared=[];
  for(const s of sources){
   if(s?.identity?.organizationId!==org.id)fail('PLAN_SOURCE_ORGANIZATION_MISMATCH');
   const v=C.validateSource(s,{organizationId:org.id});if(!v.ok)fail('PLAN_SOURCE_INVALID',v.errors.map(e=>e.code).join(','));
   const key=s.identity.planId+'|'+s.period.from+'|'+s.period.to;if(keys.has(key))fail('PLAN_SOURCE_DUPLICATE');keys.add(key);
   const {read,...rest}=s,contentHash=C.contentHash(s),bytes=Buffer.from(C.canonical({schemaVersion:1,kind:'lt-plan-source-snapshot',contentHash,source:rest})+'\n','utf8');
   prepared.push({contentHash,bytes,identity:structuredClone(s.identity),period:structuredClone(s.period),read:structuredClone(read)});
  }
  const cov=checkCoverage(coverage,sources),reg=checkRegistry(registry,cov);
  for(const t of [startedAt,completedAt])if(typeof t!=='string'||!Number.isFinite(Date.parse(t)))fail('PLAN_SOURCE_TIME_INVALID');
  const check=()=>workspaceLease?.assertOwned();
  check();
  let lease;try{lease=Lock.acquireMonthLease({storeRoot:root,month});}catch(e){mapLock(e);}
  let done=false;
  try{
   const observed=Lock.monthEntryHash(readIndex().months[month]??null);
   const refs=[];
   for(const p of prepared){
    const rel='snapshots/'+p.contentHash+'.json',file=path.join(root,'snapshots',p.contentHash+'.json');
    if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(p.bytes))fail('PLAN_SOURCE_INTEGRITY','snapshot');}else{check();lease.assertOwned();writeNew(file,p.bytes);}
    refs.push({contentHash:p.contentHash,file:rel,fileSha256:sha(p.bytes),identity:p.identity,period:p.period,read:p.read});
   }
   const manifest={schemaVersion:1,kind:'lt-plan-source-run',organization:org,month,runId,startedAt,completedAt,savedAt:new Date().toISOString(),coverage:cov,...(reg?{registry:reg}:{}),sources:refs};
   const bytes=Buffer.from(JSON.stringify(manifest,null,1)+'\n','utf8'),manifestSha256=sha(bytes),rel='months/'+month+'/'+runId+'/manifest.json';
   check();lease.assertOwned();
   writeNew(path.join(root,'months',month,runId,'manifest.json'),bytes);
   check();lease.assertOwned();
   try{Lock.withIndexTransaction({storeRoot:root,month,expectedMonthHash:observed,organization:org,change:e=>({runs:[...(e?.runs||[]),{runId,manifestSha256,file:rel,complete:cov.complete,savedAt:manifest.savedAt}]})});}catch(e){mapLock(e);}
   done=true;
   return{runId,manifestFile:path.join(root,'months',month,runId,'manifest.json'),manifestSha256,snapshotRefs:refs.map(r=>({contentHash:r.contentHash,file:r.file,fileSha256:r.fileSha256}))};
  }finally{try{lease.release();}catch(e){if(done)throw e;}}
 }
 function loadRun({month,manifestSha256}={}){
  if(typeof manifestSha256!=='string'||!HEX.test(manifestSha256))fail('PLAN_SOURCE_RUN_NOT_FOUND');
  const ref=listRuns(month).find(r=>r.manifestSha256===manifestSha256);if(!ref)fail('PLAN_SOURCE_RUN_NOT_FOUND');
  if(!/^months\/20\d{2}-\d{2}\/[A-Za-z0-9-]{8,64}\/manifest\.json$/.test(ref.file)||!ref.file.startsWith('months/'+month+'/'))fail('PLAN_SOURCE_INTEGRITY','manifest-path');
  let bytes;try{bytes=fs.readFileSync(path.join(root,...ref.file.split('/')));}catch{fail('PLAN_SOURCE_INTEGRITY','manifest-missing');}
  if(sha(bytes)!==manifestSha256)fail('PLAN_SOURCE_INTEGRITY','manifest');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schemaVersion!==1||manifest.kind!=='lt-plan-source-run'||manifest.organization?.id!==org.id||manifest.month!==month||manifest.runId!==ref.runId||manifest.coverage?.complete!==ref.complete||!Array.isArray(manifest.sources))fail('PLAN_SOURCE_INTEGRITY','manifest-fields');
  const sources=manifest.sources.map(s=>{
   if(!HEX.test(s?.contentHash||'')||s.file!=='snapshots/'+s.contentHash+'.json')fail('PLAN_SOURCE_INTEGRITY','snapshot-path');
   let b;try{b=fs.readFileSync(path.join(root,'snapshots',s.contentHash+'.json'));}catch{fail('PLAN_SOURCE_INTEGRITY','snapshot-missing');}
   if(sha(b)!==s.fileSha256)fail('PLAN_SOURCE_INTEGRITY','snapshot');
   const snap=JSON.parse(b.toString('utf8')),source={...snap.source,read:s.read};
   if(snap.kind!=='lt-plan-source-snapshot'||snap.contentHash!==s.contentHash||C.contentHash(source)!==s.contentHash)fail('PLAN_SOURCE_INTEGRITY','content');
   const v=C.validateSource(source,{organizationId:org.id});if(!v.ok)fail('PLAN_SOURCE_INTEGRITY','source:'+v.errors.map(e=>e.code).join(','));
   return source;
  });
  return{manifest,sources};
 }
 const latestCompleteRun=month=>{const runs=listRuns(month).filter(r=>r.complete===true);return runs.length?runs[runs.length-1]:null;};
 return{root,organization:org,saveRun,loadRun,listRuns,latestCompleteRun};
}
function storeForContext(context,{workspaceLease}={}){const {safeWithin}=require('./context.cjs');return openPlanStore({root:safeWithin(context.stateRoot,'plan-sources'),organization:{id:context.settings.organization.id,name:context.settings.organization.name},workspaceLease});}
module.exports={openPlanStore,storeForContext};
