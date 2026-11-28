'use strict';
// 기관·월별 특이사항(RFID 특정내역) 원문 로컬 보관소.
// - 스냅샷은 내용 해시 이름의 불변 JSON(덮어쓰기·삭제 없음), index.json은 범위·원천ID 해시·원래 수집시각·해시·완전성을 담는다.
// - 과거월은 청구의뢰/입력 마감 확인 뒤 시작한 월 전체 읽기가 성공해야 확정(final)한다. 확정월은 재조회하지 않고 재사용한다.
// - 실패·부분 수집은 빈 기록이 아니다. 시도 이력으로만 남기고 확정 자료로 쓰지 않는다.
// - 원천 필드(목록 행·상세 팝업 행)만 받는다. 가상 작성 예시·의견 등 원천 밖 필드가 섞이면 거절한다.
// - 동시 쓰기 보호(2026-11-17 2차): 변경은 월 수집 잠금 안에서, index 쓰기는 짧은 인덱스 잠금 트랜잭션으로만 한다(worker-notes-lock.cjs).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Lock=require('./worker-notes-lock.cjs');
const LIST_KEYS=['FNM','LTC_MGMT_NO','RECU_SFF_NM','LTCP_CLSFC_CD','LTCP_FR_DT','LTCP_OFFR_YYYYMM','RFID_ADM_NO','TAG_ID','READER_NO','LTCP_FR_DTHMS','LTCP_TO_DTHMS','SVC_TRANS_TYPE_CD','SVC_CONTN_SAVE_YN','LTCP_CONTN_SAVE_YN','USE_YN','DEL_YN','STED_TM','WORK_PROC_NM','PCT_ACTION_YN','LTC_RCGT_GRADE_CD'];
const DETAIL_KEYS=['LTC_MGMT_NO','LTC_MGMT_NO_SEQ','ORI_LTC_ADMIN_SYM','LTCP_CLSFC_CD','LTCP_FR_DT','LTCP_OFFR_YYYYMM','RFID_ADM_NO','TAG_ID','READER_NO','LTCP_FR_DTHMS','LTCP_TO_DTHMS','PCLR_COMT_CONTN','BDY_FUNC_ALTR_STAT_CD','EAT_FUNC_ALTR_STAT_CD','PCT_FUNC_ALTR_STAT_CD','DUN_MSK_FREQ','URI_MSK_FREQ','FMLY_YN','FMLY_REL_YN','SVC_TRANS_TYPE_CD','DEL_YN',...Array.from({length:8},(_,i)=>'LTCP_ITEM_OFFR_TM'+(i+1))];
const FIELDS_VERSION=1,BATCH_FORMAT='lt-spec-batch/2',KIND='longterm-worker-notes-month';
const RECORD_KEYS=new Set(['i','prs','worker','ltc','fr','to','fmly','cls','note','save','header','detail']);
const STORED_KEYS=new Set(['i','sourceId','header','detail']);
const CLOSING_KINDS=new Set(['claim-request','input-closed']);
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
function validateMonth(month){if(typeof month!=='string'||!MONTH.test(month))fail('MONTH_INVALID');return month;}
function koreanMonth(now){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(now);}
function monthRange(month){const [y,m]=month.split('-').map(Number),last=String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');return{ym:month.replace('-',''),from:month+'-01',to:month+'-'+last};}
const compact=d=>d.replaceAll('-','');
const validDay=v=>/^\d{8}$/.test(v)&&new Date(Date.UTC(+v.slice(0,4),+v.slice(4,6)-1,+v.slice(6))).toISOString().slice(0,10).replaceAll('-','')===v;
const isoTime=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
function fieldsComplete(snapshot){return snapshot?.fieldsVersion===FIELDS_VERSION&&Array.isArray(snapshot.records)&&snapshot.records.every(r=>LIST_KEYS.every(k=>typeof r?.header?.[k]==='string')&&DETAIL_KEYS.every(k=>typeof r?.detail?.[k]==='string'));}
// 마감 확인은 해당 월·기관의 것이어야 하고, 그 월이 끝난 뒤(한국 시각 다음 달 1일 0시 이후) 확인한 것이어야 한다.
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return Date.parse((m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0'))+'-01T00:00:00+09:00');};
function validateClosing(closing,now,month,orgId){
 if(!closing||!CLOSING_KINDS.has(closing.kind)||closing.month!==month||closing.organizationId!==orgId||!isoTime(closing.confirmedAt)||Date.parse(closing.confirmedAt)>now+300000||Date.parse(closing.confirmedAt)<monthEnd(month)||typeof closing.evidence!=='string'||!closing.evidence.trim()||closing.evidence.length>500)fail('CLOSING_CONFIRMATION_INVALID');
 return{kind:closing.kind,month,organizationId:orgId,confirmedAt:closing.confirmedAt,evidence:closing.evidence};
}

// lt-spec-batch 결과 묶음을 검증해 한 달 전체 스냅샷 입력으로 합친다. 문제가 하나라도 있으면 complete=false.
function assemble(batches,{organization,month,now=Date.now()}){
 validateMonth(month);const {ym,from,to}=monthRange(month),problems=new Set(),add=c=>problems.add(c);
 const records=[],covered=new Map(),ranges=[],started=[],finished=[],sourceIds=new Set();let total=null,screenTotal=null,otherService=0;
 if(!Array.isArray(batches)||!batches.length)add('NO_BATCHES');
 for(const b of Array.isArray(batches)?batches:[]){
  if(!b||b.ok!==true||!b.out||b.out.error){add('BATCH_FAILED');continue;}
  const o=b.out;
  if(o.format!==BATCH_FORMAT)add('LEGACY_COMPACT_RECORDS');
  if(!o.org||!o.org.id)add('SOURCE_ORGANIZATION_UNCONFIRMED');else if(o.org.id!==organization.id||o.org.type!=='20A')add('SOURCE_ORGANIZATION_MISMATCH');
  if(o.from!==compact(from)||o.to!==compact(to))add('PERIOD_NOT_FULL_MONTH');
  const f=o.filters;
  if(!f)add('LIST_FILTER_UNCONFIRMED');else if(f.SEARCH_VALUE!==''||!['','001'].includes(f.LTCP_CLSFC_CD)||f.SVC_TRANS_TYPE_CD!==''||f.SVC_CONTN_SAVE_YN!==''||f.SVC_PROC!==''||!['',organization.id].includes(f.LTC_ADMIN_SYM))add('LIST_FILTER_NOT_EMPTY');
  if(total===null)total=o.total;else if(total!==o.total)add('LIST_TOTAL_CHANGED');
  if(o.screenTotal!=null){if(screenTotal!==null&&screenTotal!==o.screenTotal)add('LIST_TOTAL_CHANGED');screenTotal=o.screenTotal;}
  if(Number.isInteger(o.offset)&&Number.isInteger(o.end)&&o.offset<=o.end)ranges.push([o.offset,o.end]);else add('LIST_RANGE_INCOMPLETE');
  if((o.errors||[]).length||o.mismatches||o.blocked||o.popupsLeft)add('BATCH_ERRORS');
  if(isoTime(o.startedAt)&&isoTime(o.finishedAt)&&Date.parse(o.finishedAt)>=Date.parse(o.startedAt)){started.push(o.startedAt);finished.push(o.finishedAt);if(Date.parse(o.finishedAt)>now+300000)add('READ_TIME_IN_FUTURE');}else add('READ_TIME_UNCONFIRMED');
  const skippedRows=Array.isArray(o.skippedRows)?o.skippedRows:[];
  if((o.skipped||0)!==skippedRows.length)add('SKIPPED_ROWS_UNEXPLAINED');
  for(const s of skippedRows){if(s?.reason==='other-service')otherService++;else if(s?.reason==='unused')add('UNUSED_ROWS_WITHOUT_DETAIL');else add('SKIPPED_ROWS_UNEXPLAINED');if(covered.has(s?.i))add('DUPLICATE_LIST_ROW');covered.set(s?.i,true);}
  for(const r of Array.isArray(o.records)?o.records:[]){
   if(!r||typeof r!=='object'){add('LEGACY_COMPACT_RECORDS');continue;}
   if(Object.keys(r).some(k=>!RECORD_KEYS.has(k)))add('NON_SOURCE_FIELDS');
   if(covered.has(r.i))add('DUPLICATE_LIST_ROW');covered.set(r.i,true);
   if(!r.header||!r.detail){add('LEGACY_COMPACT_RECORDS');continue;}
   if(LIST_KEYS.some(k=>typeof r.header[k]!=='string')||DETAIL_KEYS.some(k=>typeof r.detail[k]!=='string'))add('SOURCE_FIELDS_MISSING');
   if(Object.keys(r.header).some(k=>!LIST_KEYS.includes(k))||Object.keys(r.detail).some(k=>!DETAIL_KEYS.includes(k)))add('NON_SOURCE_FIELDS');
   const h=Object.fromEntries(LIST_KEYS.map(k=>[k,String(r.header[k]??'')])),d=Object.fromEntries(DETAIL_KEYS.map(k=>[k,String(r.detail[k]??'')]));
   for(const k of ['RFID_ADM_NO','TAG_ID','LTC_MGMT_NO','LTCP_FR_DT','LTCP_OFFR_YYYYMM'])if(h[k]!==d[k])add('DETAIL_IDENTITY_MISMATCH');
   if(h.LTCP_CLSFC_CD!=='001')add('OTHER_SERVICE_RECORD');
   if(h.LTCP_OFFR_YYYYMM!==ym||!validDay(h.LTCP_FR_DT)||!h.LTCP_FR_DT.startsWith(ym))add('RECORD_OUTSIDE_MONTH');
   if(d.ORI_LTC_ADMIN_SYM&&d.ORI_LTC_ADMIN_SYM!==organization.id)add('SOURCE_ORGANIZATION_MISMATCH');
   if(r.note!==d.PCLR_COMT_CONTN)add('NOTE_DIFFERS_FROM_DETAIL');
   if(!h.RFID_ADM_NO||!h.TAG_ID)add('RFID_RECORD_ID_MISSING');
   const sourceId=[ym,h.RFID_ADM_NO,h.TAG_ID,h.READER_NO].join('|');if(sourceIds.has(sourceId))add('DUPLICATE_RFID_RECORD');sourceIds.add(sourceId);
   records.push({i:r.i,sourceId,header:h,detail:d});
  }
 }
 // 목록 0..total-1의 모든 행이 정확히 한 번(상세 읽음 또는 다른 급여 제외) 처리돼야 한다.
 ranges.sort((a,b)=>a[0]-b[0]);let next=0;for(const [a,b]of ranges){if(a!==next){add('LIST_RANGE_INCOMPLETE');break;}next=b;}
 if(!Number.isInteger(total)||next!==total)add('LIST_RANGE_INCOMPLETE');
 else for(let i=0;i<total;i++)if(!covered.has(i)){add('LIST_RANGE_INCOMPLETE');break;}
 if(Number.isInteger(total)&&covered.size!==total)add('LIST_RANGE_INCOMPLETE');
 if(screenTotal!==null&&Number.isInteger(total)&&total>screenTotal)add('LIST_TOTAL_MISMATCH');
 records.sort((a,b)=>a.i-b.i);
 return{complete:!problems.size,problems:[...problems],input:{month,from,to,collectedAt:started.sort()[0]||null,completedAt:finished.sort().at(-1)||null,listTotal:{rows:total,screenTotal},excludedOtherService:otherService,records}};
}

function openStore({root,organization,workspaceLease}){
 if(typeof root!=='string'||!organization||typeof organization.id!=='string'||!organization.id||typeof organization.name!=='string')fail('WORKER_NOTES_STORE_CONFIGURATION_INVALID');
 if(workspaceLease!=null&&typeof workspaceLease.assertOwned!=='function')fail('WORKER_NOTES_STORE_CONFIGURATION_INVALID');
 const org={id:organization.id,name:organization.name},indexFile=path.join(root,'index.json');
 function readIndex(){
  if(!fs.existsSync(indexFile))return{schemaVersion:1,organization:org,months:{}};
  const index=JSON.parse(fs.readFileSync(indexFile,'utf8'));if(index?.schemaVersion!==1||!index.months)fail('WORKER_NOTES_INDEX_INVALID');
  if(index.organization?.id!==org.id)fail('WORKER_NOTES_ORGANIZATION_MISMATCH');return index;
 }
 // 변경 작업 단위: 공용 작업 점유 확인 → 월 수집 잠금 → 그 월 항목 해시 관찰. 끝나면(성공·실패 모두) 월 잠금을 해제한다.
 // fn이 Promise를 돌려주면 끝날 때까지 월 잠금을 유지한다(수집 동안 인덱스 잠금은 들지 않는다).
 function run(month,fn){
  workspaceLease?.assertOwned();
  const op={lease:Lock.acquireMonthLease({storeRoot:root,month}),hash:null};
  const end=error=>{try{op.lease.release();}catch(e){if(!error)throw e;}if(error)throw error;};
  let result;try{op.hash=Lock.monthEntryHash(readIndex().months[month]??null);result=fn(op);}catch(e){end(e);}
  if(result&&typeof result.then==='function')return result.then(v=>{end();return v;},e=>end(e));
  end();return result;
 }
 const check=op=>{workspaceLease?.assertOwned();op.lease.assertOwned();};
 // 모든 index 쓰기: 작업 시작 때 본 그 월 항목과 같을 때만 그 월만 바꾼다. 바꾼 뒤의 해시가 다음 쓰기의 기대값이다.
 function write(op,month,change){
  check(op);const entry=Lock.withIndexTransaction({storeRoot:root,month,expectedMonthHash:op.hash,organization:org,change});
  op.hash=Lock.monthEntryHash(entry);return structuredClone(entry);
 }
 readIndex();
 const status=month=>{validateMonth(month);const e=readIndex().months[month];return e?structuredClone(e):null;};
 function load(month){
  const e=status(month);if(!e?.snapshot)fail('SNAPSHOT_REQUIRED');
  if(!/^months\/20\d{2}-\d{2}\/[0-9a-f]{64}\.json$/.test(e.snapshot.file)||!e.snapshot.file.startsWith('months/'+month+'/'))fail('WORKER_NOTES_SNAPSHOT_INTEGRITY');
  let bytes;try{bytes=fs.readFileSync(path.join(root,...e.snapshot.file.split('/')));}catch{fail('WORKER_NOTES_SNAPSHOT_INTEGRITY');}
  if(sha(bytes)!==e.snapshot.sha256)fail('WORKER_NOTES_SNAPSHOT_INTEGRITY');
  const snapshot=JSON.parse(bytes.toString('utf8'));
  if(snapshot.kind!==KIND||snapshot.month!==month||snapshot.organization?.id!==org.id||!Array.isArray(snapshot.records)||sha(JSON.stringify(snapshot.records))!==snapshot.recordsHash||snapshot.recordsHash!==e.snapshot.recordsHash)fail('WORKER_NOTES_SNAPSHOT_INTEGRITY');
  // 저장 뒤에 원천 밖 필드가 들어간 스냅샷은 해시가 맞아도 쓰지 않는다.
  if(snapshot.records.some(r=>!r||typeof r.header!=='object'||!r.header||typeof r.detail!=='object'||!r.detail||Object.keys(r).some(k=>!STORED_KEYS.has(k))||Object.keys(r.header).some(k=>!LIST_KEYS.includes(k))||Object.keys(r.detail).some(k=>!DETAIL_KEYS.includes(k))))fail('WORKER_NOTES_SNAPSHOT_INTEGRITY');
  return{entry:e,snapshot,sha256:e.snapshot.sha256};
 }
 function plan(month,{now=Date.now(),refresh=false,exception=null,closing=null}={}){
  validateMonth(month);const current=koreanMonth(now);if(month>current)fail('FUTURE_MONTH');const isCurrent=month===current;
  if(closing){if(isCurrent)fail('CURRENT_MONTH_CANNOT_BE_FINAL');validateClosing(closing,now,month,org.id);}
  const e=status(month),out=(action,purpose)=>({action,purpose,month});
  if(exception){if(typeof exception.reason!=='string'||!exception.reason.trim())fail('EXCEPTION_REASON_REQUIRED');if(e?.state!=='final')fail('EXCEPTION_ONLY_FOR_FINAL_MONTH');return out('collect','user-exception');}
  if(!e?.snapshot)return out('collect',e?.attempts?.length?'retry-failed':'initial');
  if(!fieldsComplete(load(month).snapshot))return out('collect','field-backfill');
  if(e.state==='final')return out('reuse','final-reuse');
  if(isCurrent)return refresh?out('collect','current-refresh'):out('reuse','current-reuse');
  if(closing)return Date.parse(e.snapshot.collectedAt)>=Date.parse(closing.confirmedAt)?out('finalize','finalize-only'):out('collect','final-read');
  return out('collect','unconfirmed-refresh');
 }
 function recordAttemptIn(op,month,{purpose,status:result,reason,now=Date.now(),exception=null}){
  return write(op,month,e=>{const entry=e||{month,state:'missing',complete:false,attempts:[],history:[]};entry.attempts=[...(entry.attempts||[]),{at:new Date(now).toISOString(),purpose,status:result,reason:String(reason||'').slice(0,500),...(exception?{exception:{reason:exception.reason}}:{})}];return entry;});
 }
 function finalizeIn(op,month,{closing,now=Date.now()}){
  if(month>=koreanMonth(now))fail('CURRENT_MONTH_CANNOT_BE_FINAL');const c=validateClosing(closing,now,month,org.id);
  const {entry,snapshot}=load(month);if(!fieldsComplete(snapshot))fail('SNAPSHOT_FIELDS_INCOMPLETE');
  if(entry.state==='final')return entry;
  if(Date.parse(snapshot.collectedAt)<Date.parse(c.confirmedAt))fail('FINAL_READ_AFTER_CLOSING_REQUIRED');
  return write(op,month,e=>({...e,state:'final',closing:c,finalizedAt:new Date(now).toISOString()}));
 }
 function saveIn(op,month,batches,{purpose,now=Date.now(),exception=null}){
  const prior=status(month);
  if(prior?.state==='final'&&!['user-exception','field-backfill'].includes(purpose))fail('MONTH_FINAL_REUSE_REQUIRED');
  const a=assemble(batches,{organization:org,month,now});
  if(!a.complete){recordAttemptIn(op,month,{purpose,status:'incomplete',reason:a.problems.join(','),now,exception});fail('WORKER_NOTES_INCOMPLETE:'+a.problems.join(','));}
  check(op);
  const x=a.input,recordsHash=sha(JSON.stringify(x.records));
  const body={schemaVersion:1,kind:KIND,fieldsVersion:FIELDS_VERSION,organization:org,month,scope:{from:x.from,to:x.to,serviceCode:'001'},source:{service:'ltRfid',screen:'np00000000097',collector:BATCH_FORMAT,listTotal:x.listTotal,excludedOtherService:x.excludedOtherService},purpose,collectedAt:x.collectedAt,completedAt:x.completedAt,recordsHash,records:x.records};
  const bytes=Buffer.from(JSON.stringify(body,null,1)+'\n','utf8'),hash=sha(bytes),rel='months/'+month+'/'+hash+'.json',file=path.join(root,'months',month,hash+'.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(bytes))fail('WORKER_NOTES_SNAPSHOT_INTEGRITY');}else{fs.writeFileSync(file,bytes,{flag:'wx'});fs.chmodSync(file,0o444);}
  const at=new Date(now).toISOString(),ref={file:rel,sha256:hash,recordsHash,sourceIdsHash:sha(JSON.stringify(x.records.map(r=>r.sourceId))),collectedAt:x.collectedAt,completedAt:x.completedAt,count:x.records.length,noteCount:x.records.filter(r=>r.detail.PCLR_COMT_CONTN.trim()).length};
  // 스냅샷 쓰기 뒤 index 교체 전에 실패하면 고아 스냅샷이 남지만 index가 가리키지 않으므로 월 완료로 인정되지 않는다.
  write(op,month,e=>{
   const history=[...(e?.history||[])];if(e?.snapshot&&e.snapshot.sha256!==hash)history.push({...e.snapshot,state:e.state,replacedAt:at,replacedBy:purpose});
   const entry={month,state:'collected',complete:true,scope:body.scope,snapshot:ref,attempts:[...(e?.attempts||[]),{at,purpose,status:'saved',snapshotSha256:hash,...(exception?{exception:{reason:exception.reason}}:{})}],history};
   // 확정월의 예외 재수집·필드 보완은 같은 마감 확인 뒤 읽은 경우에만 확정 상태를 이어 간다.
   if(e?.closing){entry.closing=e.closing;if(e.state==='final'&&Date.parse(x.collectedAt)>=Date.parse(e.closing.confirmedAt)){entry.state='final';entry.finalizedAt=at;}}
   return entry;
  });
  return status(month);
 }
 // 공개 변경 진입은 각자 월 잠금을 잡는다. 같은 월이 잡혀 있으면 기다리지 않고 WORKER_NOTES_MONTH_BUSY.
 function recordAttempt(month,options){validateMonth(month);return run(month,op=>recordAttemptIn(op,month,options));}
 function finalize(month,options){validateMonth(month);return run(month,op=>finalizeIn(op,month,options));}
 function save(month,batches,options){validateMonth(month);return run(month,op=>saveIn(op,month,batches,options));}
 // plan 전에 월 잠금을 잡고 collect→save→finalize→load 끝까지 유지한다. 잠겨 있으면 collect 0회·시도 기록 없이 BUSY로 끝난다.
 async function ensureMonth(month,{collect,now=Date.now(),refresh=false,exception=null,closing=null}){
  validateMonth(month);
  return run(month,async op=>{
   const p=plan(month,{now,refresh,exception,closing});
   if(p.action==='finalize')finalizeIn(op,month,{closing,now});
   if(p.action==='collect'){
    let batches;try{batches=await collect({month,purpose:p.purpose});}catch(e){recordAttemptIn(op,month,{purpose:p.purpose,status:'failed',reason:e?.message||String(e),now,exception});throw e;}
    const entry=saveIn(op,month,batches,{purpose:p.purpose,now,exception});
    if(closing&&entry.state!=='final')finalizeIn(op,month,{closing,now});
   }
   const {entry,snapshot}=load(month);return{...p,entry,snapshot};
  });
 }
 // 6-1 근거 제공: 확정월만, 해당 수급자·급여·관찰 기간 행을 6-1 읽기와 같은 {header,detail} 모양으로 돌려준다.
 function recipientMonth({context,month,period}){
  if(context?.orgId!==org.id)fail('WORKER_NOTES_STORE_ORGANIZATION_MISMATCH');
  if(typeof month!=='string'||!/^20\d{2}(0[1-9]|1[0-2])$/.test(month))fail('MONTH_INVALID');
  const m=month.slice(0,4)+'-'+month.slice(4),e=status(m);if(e?.state!=='final')return null;
  const {snapshot}=load(m);if(!fieldsComplete(snapshot))return null;
  // 인덱스 상태만으로 믿지 않는다. 그 월·기관의 마감 확인과, 그 뒤에 읽은 자료라는 기록이 함께 있어야 한다.
  const c=e.closing;if(!c||!CLOSING_KINDS.has(c.kind)||c.month!==m||c.organizationId!==org.id||!isoTime(c.confirmedAt)||Date.parse(c.confirmedAt)<monthEnd(m)||!isoTime(e.finalizedAt)||!isoTime(snapshot.collectedAt)||Date.parse(snapshot.collectedAt)<Date.parse(c.confirmedAt))fail('WORKER_NOTES_FINAL_STATE_INVALID');
  const from=[compact(snapshot.scope.from),compact(period.from)].sort().at(-1),to=[compact(snapshot.scope.to),compact(period.to)].sort()[0];
  const rows=snapshot.records.filter(r=>r.header.LTC_MGMT_NO===context.recognitionNo&&r.header.LTCP_CLSFC_CD===context.serviceCode&&r.header.LTCP_FR_DT>=from&&r.header.LTCP_FR_DT<=to);
  for(const r of rows){if(r.detail.ORI_LTC_ADMIN_SYM&&r.detail.ORI_LTC_ADMIN_SYM!==org.id)fail('RFID_SOURCE_INSTITUTION_CHANGED');if(r.detail.LTC_MGMT_NO_SEQ&&r.detail.LTC_MGMT_NO_SEQ!==context.recognitionSeq)fail('RFID_RECOGNITION_SEQUENCE_CHANGED');}
  return{records:rows.map(r=>({header:{...r.header},detail:{...r.detail}})),snapshot:{month:m,sha256:e.snapshot.sha256,collectedAt:snapshot.collectedAt,finalizedAt:e.finalizedAt}};
 }
 return{root,organization:org,status,load,plan,save,finalize,recordAttempt,ensureMonth,recipientMonth};
}
function storeForContext(context,{workspaceLease}={}){const {safeWithin}=require('./context.cjs');return openStore({root:safeWithin(context.stateRoot,'worker-notes'),organization:{id:context.settings.organization.id,name:context.settings.organization.name},workspaceLease});}

// 명령: node worker-notes-store.cjs <plan|save|finalize|status> --workspace <폴더> --month YYYY-MM
//   [--closing <마감확인.json>] [--refresh] [--exception-reason <사유>] [--batches <a.json,b.json>]
// save는 plan이 collect일 때만 저장하고 목적(purpose)은 plan이 정한다.
// 변경 명령(save·finalize)은 공용 작업 점유(state/runtime.lock)를 잡고(control call 자식이면 이어받고) 끝나면 해제한다. 읽기 명령은 잠금 없이 읽는다.
function cli(argv,{now=Date.now()}={}){
 const [command,...rest]=argv,o={};for(let i=0;i<rest.length;i++){const k=rest[i];if(!k.startsWith('--'))fail('ARGUMENT_INVALID');if(k==='--refresh')o.refresh=true;else o[k.slice(2)]=rest[++i];}
 const C=require('./context.cjs'),context=C.loadContext(o.workspace||process.cwd()),month=validateMonth(o.month);
 const closing=o.closing?C.readJson(o.closing):null,exception=o['exception-reason']?{reason:o['exception-reason']}:null,refresh=o.refresh===true;
 if(command==='status')return{ok:true,entry:storeForContext(context).status(month)};
 if(command==='plan')return{ok:true,...storeForContext(context).plan(month,{now,refresh,exception,closing})};
 if(command!=='finalize'&&command!=='save')fail('COMMAND_UNSUPPORTED');
 const lease=C.workspaceLease(context,'worker-notes:'+month);let result,done=false;
 try{
  const store=storeForContext(context,{workspaceLease:lease});
  if(command==='finalize')result={ok:true,entry:store.finalize(month,{closing,now})};
  else{const p=store.plan(month,{now,refresh,exception,closing});if(p.action!=='collect')fail('SAVE_NOT_NEEDED:'+p.purpose);const batches=String(o.batches||'').split(',').filter(Boolean).map(f=>C.readJson(f));let entry=store.save(month,batches,{purpose:p.purpose,now,exception});if(closing&&entry.state!=='final')entry=store.finalize(month,{closing,now});result={ok:true,purpose:p.purpose,entry};}
  done=true;
 }finally{try{lease.release();}catch(e){if(done)throw e;}}
 return result;
}
if(require.main===module){try{console.log(JSON.stringify(cli(process.argv.slice(2))));}catch(e){console.log(JSON.stringify({ok:false,code:e.code||e.message}));process.exitCode=1;}}
module.exports={LIST_KEYS,DETAIL_KEYS,FIELDS_VERSION,BATCH_FORMAT,assemble,openStore,storeForContext,fieldsComplete,koreanMonth,cli};
