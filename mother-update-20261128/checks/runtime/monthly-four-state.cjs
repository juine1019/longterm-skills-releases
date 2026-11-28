'use strict';
// 4번 여러 달 실행 상태(2026-11-20 Task A).
// - 위치: <context.stateRoot>/monthly-four-runs/<runId>/
//   request.json: 처음 한 번만 wx로 쓴다(바뀌지 않는 실행 범위).
//   events/000001.json …: append-only 이벤트. 각 이벤트는 seq와 이전 이벤트(첫 이벤트는 request.json) 바이트의 sha256을 가진다.
// - 현재 상태는 이벤트를 처음부터 다시 읽어 계산한다. 사슬이 깨졌거나(seq 공백·이전 해시 불일치·파싱 불가·잘린 파일·낯선 파일)
//   request.json이 손상이면 STATE_TORN으로 거절하고 어떤 파일도 지우거나 고치지 않는다.
// - 실행 점유: <stateRoot>/monthly-four-runs/locks/<runId>.lock (wx·소유 id 확인). 실행 폴더 밖에 두어 증빙 폴더를 건드리지 않는다.
//   남의 점유는 나이·오래됨을 이유로 지우지 않는다. 자기 점유만 해제한다.
// - 이벤트·상태에는 개인정보·원문을 넣지 않는다. outputs는 어댑터가 준 메타(해시·건수·버전)를 그대로 저장한다.
// - 계속 토큰(2026-11-20 Task B): continuation 이벤트에는 토큰의 sha256만 둔다(평문 금지, 낯선 필드는 EVENT_INVALID·STATE_TORN).
//   issued {tokenSha256,issuedAt,expiresAt,requestSha256} / used {tokenSha256,usedAt}.
//   supersede 이벤트(status 'superseded')는 그 단계를 pending으로 되돌린다. 이전 증빙 이벤트는 사슬에 그대로 남는다.
//   예전 실행(이 이벤트가 없는 실행)은 그대로 읽는다. 단 이 이벤트가 있는 실행은 이전 runtime에서 STATE_TORN으로 읽힌다(고치지 않음).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {safeWithin}=require('./context.cjs');
const PHASES=Object.freeze(['notes-prepare','plans-prepare','diary-prepare','manifest','draft','validate','notes-publish','opinions-publish','questions-publish']);
const WRITE_PHASES=Object.freeze(['notes-publish','opinions-publish','questions-publish']);
const STATUS_BY_TYPE={
 phase:['running','succeeded','held','conflict','unknown','failed'],
 reconcile:['succeeded','not-written','unknown'],
 verify:['same','unconfirmed'],
 doctor:['ok','blocked'],
 resume:['requested'],
 continuation:['issued','used'],
 supersede:['superseded'],
};
const RUN_ID=/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/,MONTH=/^\d{4}-(0[1-9]|1[0-2])$/,HEX=/^[0-9a-f]{64}$/,CODE=/^[A-Z][A-Z0-9_]{1,63}$/,EVENT_FILE=/^(\d{6})\.json$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const hex=v=>typeof v==='string'&&HEX.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const safeCode=v=>typeof v==='string'&&CODE.test(v);
const name=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const isEvidence=v=>plain(v)&&Object.entries(v).every(([k,x])=>name(k)&&hex(x));
const isNames=v=>Array.isArray(v)&&v.every(name);
const canonical=v=>JSON.stringify(v,(k,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(key=>[key,x[key]])):x);
const exactKeys=(o,keys)=>Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));

function validateRequest(r){
 const ok=(()=>{
  if(!plain(r)||!exactKeys(r,['schemaVersion','runId','organizationId','configHash','bindingFingerprint','months','targets','phases','instruction','files']))return false;
  if(r.schemaVersion!==1||typeof r.runId!=='string'||!RUN_ID.test(r.runId)||!name(r.organizationId)||!hex(r.configHash)||!hex(r.bindingFingerprint))return false;
  if(!Array.isArray(r.months)||!r.months.length||!r.months.every((m,i)=>typeof m==='string'&&MONTH.test(m)&&(i===0||r.months[i-1]<m)))return false;
  const t=r.targets;
  if(!plain(t)||!(t.kind==='all'&&exactKeys(t,['kind'])||t.kind==='recipients'&&exactKeys(t,['kind','recipients'])&&isNames(t.recipients)&&t.recipients.length>0&&new Set(t.recipients).size===t.recipients.length))return false;
  if(!Array.isArray(r.phases)||!r.phases.length||!r.phases.every((p,i)=>PHASES.includes(p)&&(i===0||PHASES.indexOf(r.phases[i-1])<PHASES.indexOf(p))))return false;
  const n=r.instruction;
  if(!plain(n)||!exactKeys(n,['message','at','sha256'])||typeof n.message!=='string'||!n.message.trim()||!iso(n.at)||!hex(n.sha256))return false;
  return isEvidence(r.files);
 })();
 if(!ok)fail('REQUEST_INVALID');
 return r;
}
// 이어하기 범위 비교: 지시 문구(instruction)는 범위가 아니다.
const SCOPE_KEYS=['organizationId','configHash','bindingFingerprint','months','targets','phases','files'];
const sameScope=(a,b)=>SCOPE_KEYS.every(k=>canonical(a[k])===canonical(b[k]));

const evidenceDir=runId=>'monthly-four-runs/'+runId;
function runPaths(context,runId){
 if(typeof runId!=='string'||!RUN_ID.test(runId))fail('REQUEST_INVALID');
 const dir=safeWithin(context.stateRoot,'monthly-four-runs',runId);
 return{dir,request:path.join(dir,'request.json'),events:path.join(dir,'events'),lock:safeWithin(context.stateRoot,'monthly-four-runs','locks',runId+'.lock')};
}
// 실행 폴더 밖 임시 파일에 다 쓰고 동기화한 뒤 최종 이름으로 연결한다(이미 있으면 실패). 도중에 끊겨도 증빙 폴더에 잘린 파일이 남지 않는다(2026-11-20 독립 검토 Important 1).
function writeNew(file,bytes){
 fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))throw Object.assign(Error('EEXIST: '+path.basename(file)),{code:'EEXIST'});
 let base=path.dirname(file);while(path.basename(base)!=='monthly-four-runs'&&path.dirname(base)!==base)base=path.dirname(base);
 if(path.basename(base)!=='monthly-four-runs')throw Object.assign(Error('STATE_PATH_UNEXPECTED'),{code:'STATE_PATH_UNEXPECTED'});
 const temp=path.join(base,'tmp',crypto.randomUUID()+'.partial');fs.mkdirSync(path.dirname(temp),{recursive:true});
 const fd=fs.openSync(temp,'wx');try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}
}

function createRun(context,request){
 validateRequest(request);const paths=runPaths(context,request.runId);
 const bytes=Buffer.from(JSON.stringify(request,null,2)+'\n','utf8');
 try{writeNew(paths.request,bytes);}catch(e){if(e.code==='EEXIST')fail('RUN_EXISTS');throw e;}
 const sum=sha(bytes);
 return{runId:request.runId,paths,request:structuredClone(request),requestSha256:sum,events:[],lastSha256:sum};
}

function validEvent(e,request,seq,prev){
 if(!plain(e)||e.schemaVersion!==1||e.kind!=='monthly-four-event'||e.runId!==request.runId||e.seq!==seq||e.prevSha256!==prev)return false;
 const statuses=STATUS_BY_TYPE[e.type];if(!statuses||!statuses.includes(e.status)||!iso(e.at))return false;
 if(['phase','reconcile','verify','supersede'].includes(e.type)){if(!request.months.includes(e.month)||!request.phases.includes(e.phase))return false;}
 else if(e.month!==null||e.phase!==null)return false;
 if(e.code!==null&&!safeCode(e.code))return false;
 if(e.evidence!==null&&!isEvidence(e.evidence))return false;
 if(e.outputs!==null&&!plain(e.outputs))return false;
 if(e.needed!==null&&!isNames(e.needed))return false;
 const base=['schemaVersion','kind','runId','seq','prevSha256','type','month','phase','status','code','evidence','outputs','needed','at'];
 if(!base.every(k=>Object.hasOwn(e,k)))return false;
 const extra=Object.keys(e).filter(k=>!base.includes(k));
 if(e.type==='resume')return extra.length===1&&extra[0]==='instruction'&&plain(e.instruction)&&exactKeys(e.instruction,['at','sha256'])&&iso(e.instruction.at)&&hex(e.instruction.sha256);
 if(e.type==='doctor')return extra.length===1&&extra[0]==='blockingCodes'&&Array.isArray(e.blockingCodes)&&e.blockingCodes.every(safeCode);
 if(e.type==='continuation'){
  const c=e.continuation;if(extra.length!==1||extra[0]!=='continuation'||!plain(c)||!hex(c.tokenSha256)||e.code!==null||e.evidence!==null||e.outputs!==null||e.needed!==null)return false;
  if(e.status==='issued')return exactKeys(c,['tokenSha256','issuedAt','expiresAt','requestSha256'])&&iso(c.issuedAt)&&iso(c.expiresAt)&&Date.parse(c.expiresAt)>Date.parse(c.issuedAt)&&hex(c.requestSha256);
  return exactKeys(c,['tokenSha256','usedAt'])&&iso(c.usedAt);
 }
 return extra.length===0;
}

function openRun(context,runId){
 const paths=runPaths(context,runId);
 if(!fs.existsSync(paths.request)){if(fs.existsSync(paths.dir))fail('STATE_TORN');fail('RUN_NOT_FOUND');}
 const torn=()=>fail('STATE_TORN');
 let bytes,request;
 try{bytes=fs.readFileSync(paths.request);request=JSON.parse(bytes.toString('utf8'));validateRequest(request);}catch{torn();}
 if(request.runId!==runId)torn();
 const requestSha256=sha(bytes);let prev=requestSha256;const events=[];
 if(fs.existsSync(paths.events)){
  let names;try{names=fs.readdirSync(paths.events);}catch{torn();}
  if(names.some(n=>!EVENT_FILE.test(n)))torn();
  names.sort();
  names.forEach((n,i)=>{
   if(Number(EVENT_FILE.exec(n)[1])!==i+1)torn();
   let b,e;try{b=fs.readFileSync(path.join(paths.events,n));e=JSON.parse(b.toString('utf8'));}catch{torn();}
   if(!validEvent(e,request,i+1,prev))torn();
   events.push(e);prev=sha(b);
  });
 }
 return{runId,paths,request,requestSha256,events,lastSha256:prev};
}

// fields: {type,month?,phase?,status,code?,evidence?,outputs?,needed?, instruction?(resume), blockingCodes?(doctor)}
function appendEvent(run,fields,lock){
 lock?.assertOwned();
 const seq=run.events.length+1;
 const e={schemaVersion:1,kind:'monthly-four-event',runId:run.runId,seq,prevSha256:run.lastSha256,type:fields.type,month:fields.month??null,phase:fields.phase??null,status:fields.status,code:fields.code??null,evidence:fields.evidence??null,outputs:fields.outputs??null,needed:fields.needed??null,at:new Date().toISOString()};
 if(fields.type==='resume')e.instruction=fields.instruction;
 if(fields.type==='doctor')e.blockingCodes=fields.blockingCodes??[];
 if(fields.type==='continuation')e.continuation=fields.continuation;
 if(!validEvent(e,run.request,seq,run.lastSha256))fail('EVENT_INVALID');
 const bytes=Buffer.from(JSON.stringify(e,null,2)+'\n','utf8');
 try{writeNew(path.join(run.paths.events,String(seq).padStart(6,'0')+'.json'),bytes);}catch(err){if(err.code==='EEXIST')fail('STATE_CONFLICT');throw err;}
 run.events.push(e);run.lastSha256=sha(bytes);
 return structuredClone(e);
}

// 'YYYY-MM|단계' → {status,code,evidence,outputs,needed}. 이벤트가 없는 단계는 없음(pending으로 본다).
// reconcile: succeeded=반영 확인, not-written=반영 안 됨(pending, 다시 호출 가능), unknown=불명 유지(RECONCILIATION_REQUIRED).
function phaseStates(run){
 const out=new Map();
 for(const e of run.events){
  const key=e.month+'|'+e.phase,cur=out.get(key);
  if(e.type==='phase')out.set(key,{status:e.status,code:e.code,evidence:e.evidence,outputs:e.outputs,needed:e.needed});
  else if(e.type==='reconcile'){
   if(e.status==='succeeded')out.set(key,{status:'succeeded',code:null,evidence:e.evidence??cur?.evidence??null,outputs:e.outputs??null,needed:null});
   else if(e.status==='not-written')out.set(key,{status:'pending',code:'NOT_WRITTEN',evidence:null,outputs:null,needed:null});
   else out.set(key,{status:'unknown',code:'RECONCILIATION_REQUIRED',evidence:cur?.evidence??null,outputs:cur?.outputs??null,needed:null});
  }
  else if(e.type==='supersede')out.set(key,{status:'pending',code:null,evidence:null,outputs:null,needed:null});
 }
 return new Map([...out].map(([k,v])=>[k,structuredClone(v)]));
}

// 계속 토큰 판정: 통과면 null, 아니면 거절 코드. 발급 뒤 다른 실행 시작(doctor 이벤트)이 있었으면 그 토큰은 대체된 것이다.
function continuationCheck(run,tokenSha256,nowMs){
 const cont=run.events.filter(e=>e.type==='continuation'&&e.continuation.tokenSha256===tokenSha256);
 if(cont.some(e=>e.status==='used'))return 'CONTINUATION_USED';
 const issued=cont.filter(e=>e.status==='issued').pop();
 if(!issued||issued.continuation.requestSha256!==run.requestSha256||run.events.some(e=>e.seq>issued.seq&&e.type==='doctor'))return 'CONTINUATION_INVALID';
 if(!(nowMs<Date.parse(issued.continuation.expiresAt)))return 'CONTINUATION_EXPIRED';
 return null;
}

function acquireRunLock(context,runId){
 const file=runPaths(context,runId).lock;fs.mkdirSync(path.dirname(file),{recursive:true});
 const body={schemaVersion:1,kind:'monthly-four-run-lock',id:crypto.randomUUID(),pid:process.pid,runId,workspaceLeaseId:process.env.LONGTERM_RUNTIME_LEASE_ID||null,at:new Date().toISOString()};
 let fd;try{fd=fs.openSync(file,'wx');}catch(e){if(!['EEXIST','EPERM','EACCES'].includes(e.code))throw e;
  // 소유 프로세스가 끝난(강제 종료) 점유만 이어받는다: 지우지 않고 보존 이름으로 옮긴 뒤 새로 잡는다. 살아 있거나 판정 불가면 RUN_BUSY.
  let held=null;try{if(!fs.lstatSync(file).isSymbolicLink())held=JSON.parse(fs.readFileSync(file,'utf8'));}catch{held=null;}
  const dead=held&&held.schemaVersion===1&&held.kind==='monthly-four-run-lock'&&held.runId===runId&&typeof held.id==='string'&&Number.isSafeInteger(held.pid)&&held.pid>0&&(()=>{try{process.kill(held.pid,0);return false;}catch(x){return x.code==='ESRCH';}})();
  if(!dead)fail('RUN_BUSY');
  try{fs.renameSync(file,file+'.stale-'+held.id+'.json');fd=fs.openSync(file,'wx');}catch{fail('RUN_BUSY');}
 }
 let written=false;
 try{fs.writeSync(fd,JSON.stringify(body)+'\n');fs.fsyncSync(fd);written=true;}finally{fs.closeSync(fd);if(!written)fs.rmSync(file,{force:true});}
 const assertOwned=()=>{let cur;try{cur=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('LEASE_OWNERSHIP_CHANGED');}if(cur?.id!==body.id||cur.pid!==body.pid)fail('LEASE_OWNERSHIP_CHANGED');};
 return{id:body.id,assertOwned,release(){assertOwned();fs.unlinkSync(file);}};
}

module.exports={PHASES,WRITE_PHASES,validateRequest,sameScope,evidenceDir,runPaths,createRun,openRun,appendEvent,phaseStates,continuationCheck,acquireRunLock};
