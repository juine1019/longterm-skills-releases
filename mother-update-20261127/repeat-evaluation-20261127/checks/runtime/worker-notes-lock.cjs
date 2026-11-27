'use strict';
// 월별 특이사항 보관소 동시 쓰기 보호(2026-11-17 2차).
// - 월 수집 잠금: <보관소>/locks/month-YYYY-MM.lock. 같은 월이 잡혀 있으면 기다리지 않고 WORKER_NOTES_MONTH_BUSY.
// - 짧은 인덱스 잠금: <보관소>/locks/index.lock. 잠깐(2초 안팎)만 재시도하고 넘으면 WORKER_NOTES_INDEX_BUSY.
//   잠금 안에서 최신 index를 읽고, 그 월 항목이 작업 시작 때 본 것과 같을 때만 그 월만 바꿔 임시 파일+fsync 뒤 원자 교체한다.
// - 점유 고정 순서: 공용 작업 점유(runtime.lock) → 월 수집 잠금 → 인덱스 잠금. 네트워크 수집 동안 인덱스 잠금을 들고 있지 않는다.
// - 남의 잠금은 나이·오래됨을 이유로 지우거나 탈취하지 않는다. 손상·읽기 불가 잠금은 미확인으로 보고 그대로 두고 BUSY로 멈춘다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const INDEX_WAIT_MS=2000,INDEX_RETRY_MS=25,RENAME_WAIT_MS=1000,RENAME_RETRY_MS=10;
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function validateMonth(month){if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');return month;}
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;

// 키를 정렬한 JSON의 sha256. 항목이 없으면 null.
function monthEntryHash(entry){
 if(entry==null)return null;
 const text=JSON.stringify(entry,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
 return crypto.createHash('sha256').update(text).digest('hex');
}

// 보관소·locks 폴더가 링크(junction 포함)이거나 보관소 밖 별칭이면 거절한다. 만들지 않는 조회에서 폴더가 없으면 null.
function lockDir(storeRoot,create){
 if(typeof storeRoot!=='string'||!storeRoot)fail('WORKER_NOTES_STORE_CONFIGURATION_INVALID');
 const root=path.resolve(storeRoot),dir=path.join(root,'locks');
 if(create)fs.mkdirSync(root,{recursive:true});else if(!fs.existsSync(root))return null;
 if(fs.lstatSync(root).isSymbolicLink()||!fs.statSync(root).isDirectory())fail('WORKER_NOTES_LOCK_PATH_INVALID');
 if(create){try{fs.mkdirSync(dir);}catch(e){if(e.code!=='EEXIST')throw e;}}
 let st;try{st=fs.lstatSync(dir);}catch(e){if(e.code==='ENOENT'&&!create)return null;throw e;}
 if(st.isSymbolicLink()||!st.isDirectory()||!samePath(fs.realpathSync.native(dir),path.join(fs.realpathSync.native(root),'locks')))fail('WORKER_NOTES_LOCK_PATH_INVALID');
 return dir;
}

// 'wx'로 새로 만들고 쓰기 뒤 fsync. 이미 있으면(또는 Windows에서 지워지는 중이면) false.
function createLock(file,body){
 let fd;try{fd=fs.openSync(file,'wx');}catch(e){if(['EEXIST','EPERM','EACCES'].includes(e.code))return false;throw e;}
 let written=false;
 try{fs.writeSync(fd,JSON.stringify(body)+'\n');fs.fsyncSync(fd);written=true;}finally{fs.closeSync(fd);if(!written)fs.rmSync(file,{force:true});}
 return true;
}
// 파일을 다시 읽어 id·pid가 같을 때만 자기 것으로 본다. 다르거나 읽을 수 없으면 지우지 않고 실패한다.
function owned(file,body){
 const assertOwned=()=>{let current;try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('LEASE_OWNERSHIP_CHANGED');}if(current?.id!==body.id||current.pid!==body.pid)fail('LEASE_OWNERSHIP_CHANGED');};
 return{id:body.id,pid:body.pid,assertOwned,release(){assertOwned();fs.unlinkSync(file);}};
}

function acquireMonthLease({storeRoot,month}={}){
 validateMonth(month);const file=path.join(lockDir(storeRoot,true),'month-'+month+'.lock');
 const body={schemaVersion:1,kind:'month',id:crypto.randomUUID(),pid:process.pid,month,at:new Date().toISOString()};
 if(!createLock(file,body))fail('WORKER_NOTES_MONTH_BUSY');
 return{...owned(file,body),month};
}

function readIndex(indexFile,organization){
 if(!fs.existsSync(indexFile)){if(!organization)fail('WORKER_NOTES_INDEX_MISSING');return{schemaVersion:1,organization:{id:organization.id,name:organization.name},months:{}};}
 let index;try{index=JSON.parse(fs.readFileSync(indexFile,'utf8'));}catch{fail('WORKER_NOTES_INDEX_INVALID');}
 if(index?.schemaVersion!==1||!index.months||typeof index.months!=='object'||Array.isArray(index.months)||typeof index.organization?.id!=='string')fail('WORKER_NOTES_INDEX_INVALID');
 if(organization&&index.organization.id!==organization.id)fail('WORKER_NOTES_ORGANIZATION_MISMATCH');
 return index;
}
// organization(선택, {id,name}): 기관 확인과 index가 아직 없을 때 새로 만드는 데 쓴다.
function withIndexTransaction({storeRoot,month,expectedMonthHash,change,organization}={}){
 validateMonth(month);
 if(expectedMonthHash!==null&&!(typeof expectedMonthHash==='string'&&/^[0-9a-f]{64}$/.test(expectedMonthHash)))fail('WORKER_NOTES_EXPECTED_HASH_REQUIRED');
 if(typeof change!=='function')fail('WORKER_NOTES_CHANGE_REQUIRED');
 const dir=lockDir(storeRoot,true),indexFile=path.join(path.dirname(dir),'index.json'),file=path.join(dir,'index.lock');
 const body={schemaVersion:1,kind:'index',id:crypto.randomUUID(),pid:process.pid,at:new Date().toISOString()};
 const deadline=Date.now()+INDEX_WAIT_MS;
 while(!createLock(file,body)){if(Date.now()>=deadline)fail('WORKER_NOTES_INDEX_BUSY');sleep(INDEX_RETRY_MS);}
 const lock=owned(file,body);let result,done=false;
 try{
  const index=readIndex(indexFile,organization),current=Object.hasOwn(index.months,month)?index.months[month]:null;
  if(monthEntryHash(current)!==expectedMonthHash)fail('WORKER_NOTES_INDEX_CONFLICT');
  const next=change(current==null?null:structuredClone(current));
  if(!next||typeof next!=='object'||Array.isArray(next))fail('WORKER_NOTES_ENTRY_INVALID');
  lock.assertOwned();
  const text=JSON.stringify({...index,months:{...index.months,[month]:next}},null,1)+'\n';
  const temp=indexFile+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(temp,'wx');
  try{
   try{fs.writeSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   // Windows는 다른 프로세스가 index를 읽는 순간 교체를 일시 거절(EPERM·EACCES·EBUSY)한다. 잠금 안에서 짧게만 재시도한다.
   const until=Date.now()+RENAME_WAIT_MS;
   for(;;){lock.assertOwned();try{fs.renameSync(temp,indexFile);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||Date.now()>=until)throw e;sleep(RENAME_RETRY_MS);}}
  }catch(e){fs.rmSync(temp,{force:true});throw e;}
  result=JSON.parse(JSON.stringify(next));done=true;
 }finally{
  // 본 작업이 실패했으면 그 오류를 그대로 돌려준다(잠금 해제 실패로 가리지 않는다).
  try{lock.release();}catch(e){if(done)throw e;}
 }
 return result;
}

function listStoreLocks(storeRoot){
 const dir=lockDir(storeRoot,false);if(!dir)return[];
 return fs.readdirSync(dir).sort().map(name=>{
  const m=/^month-(20\d{2}-(?:0[1-9]|1[0-2]))\.lock$/.exec(name),kind=m?'month':name==='index.lock'?'index':null;
  let b=null;try{b=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch{}
  if(!kind||b?.schemaVersion!==1||b.kind!==kind||typeof b.id!=='string'||!b.id||!Number.isInteger(b.pid)||typeof b.at!=='string'||(m&&b.month!==m[1]))return{kind:'unknown',file:name,unreadable:true};
  return kind==='month'?{kind,month:b.month,id:b.id,pid:b.pid,at:b.at}:{kind,id:b.id,pid:b.pid,at:b.at};
 });
}

module.exports={acquireMonthLease,withIndexTransaction,monthEntryHash,listStoreLocks};
