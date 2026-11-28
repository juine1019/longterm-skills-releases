const {createHash}=require('node:crypto');
const {validateMonth,normalizeOrg,koreanMonth,expiresAt}=require('./workerNotes');
const MAX_BYTES=1500000,MAX_RECORDS=6000;
const fail=(message,code='INVALID_REVIEW')=>{throw Object.assign(new Error(message),{code});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parsed=v=>typeof v==='string'?JSON.parse(v):v;
const cutoff=now=>{const [y,m]=koreanMonth(now).split('-').map(Number);return new Date(Date.UTC(y,m-12,1)).toISOString().slice(0,7);};
function text(v,label,max=200,blank=false){if(typeof v!=='string'||v.length>max||(!blank&&!v.trim()))fail(label+' 형식이 올바르지 않습니다');return v;}
function date(v,month){if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!v.startsWith(month+'-')||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail('점검 날짜가 올바르지 않습니다');return v;}
function timestamp(v,now){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)>now+300000)fail('점검 시각이 올바르지 않습니다');return v;}
// 급여제공기록지 양식(별지 제12호서식) 출력용 수급자 정보. 점검 목록 조회에는 내보내지 않고 출력 때만 읽는다.
// 같은 이름이 서로 다른 인정번호로 둘 이상이면 어느 쪽인지 알 수 없으므로 두 건 모두 버린다.
function cleanRecipientInfo(list){if(!Array.isArray(list))return [];const out=new Map(),dup=new Set();for(const r of list.slice(0,2000)){if(!r||typeof r.name!=='string')continue;const name=r.name.trim().slice(0,80);if(!name)continue;const item={name,birth:String(r.birth??'').replace(/[^\d]/g,'').slice(0,8),grade:/^[1-5]$/.test(String(r.grade??''))?String(r.grade):'',certNo:String(r.certNo??'').replace(/[^\dL]/g,'').slice(0,20)};if(out.has(name)){if(JSON.stringify(out.get(name))!==JSON.stringify(item))dup.add(name);continue;}out.set(name,item);}return [...out.values()].filter(x=>!dup.has(x.name)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));}
function cleanInstitutionCode(v){const c=String(v??'').replace(/\D/g,'');return c.length>=8&&c.length<=14?c:'';}
function validateImport(input,orgName,now=Date.now()){
  if(!input||![1,2].includes(input.schemaVersion)||!Array.isArray(input.records)||input.records.length>MAX_RECORDS)fail('점검 자료 형식이 올바르지 않습니다');
  const v2=input.schemaVersion===2;
  if(v2&&(input.sourceMode!=='lt-only'||input.completeness?.complete!==true||!Number.isSafeInteger(input.completeness.expectedContracts)||input.completeness.expectedContracts<0||input.completeness.readContracts!==input.completeness.expectedContracts||!Array.isArray(input.completeness.failedContracts)||input.completeness.failedContracts.length))fail('완전한 롱텀 단독 점검이 필요합니다');
  const month=validateMonth(input.month);
  if(month<cutoff(now)||month>koreanMonth(now))fail('최근 12개월 점검 자료만 등록할 수 있습니다');
  if(!normalizeOrg(orgName)||normalizeOrg(input.orgName)!==normalizeOrg(orgName))fail('자료 기관과 로그인 기관이 다릅니다','ORG_MISMATCH');
  const from=date(input.from,month),to=date(input.to,month);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(now);
  if(from>to||to>=today)fail('어제까지의 올바른 조회 기간이 필요합니다');
  const collectedAt=timestamp(input.collectedAt,now),ltSourceAt=timestamp(input.ltSourceAt,now);
  if(Date.parse(ltSourceAt)>Date.parse(collectedAt)+300000)fail('실전송 조회 시각이 점검 시각과 다릅니다');
  if(typeof input.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceHash))fail('점검 원본 해시가 필요합니다');
  const seen=new Set(),nos=new Set();
  const records=input.records.map(r=>{
    if(!r||!Number.isSafeInteger(r.no)||r.no<1||nos.has(r.no)||typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.id)||seen.has(r.id))fail('중복되거나 올바르지 않은 점검번호입니다');
    seen.add(r.id);nos.add(r.no);
    const d=date(r.date,month);if(d<from||d>to)fail('점검 항목이 조회 기간을 벗어났습니다');
    if(typeof r.ltRead!=='boolean'||!Array.isArray(r.tags)||r.tags.length>50)fail('실전송 상태가 올바르지 않습니다');
    const tags=r.tags.map(t=>{if(!t||typeof t!=='object')fail('실전송 항목이 올바르지 않습니다');const time=v=>{if(v===null)return null;if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v))fail('실전송 시각 형식이 올바르지 않습니다');return v;};return {start:time(t.start),end:time(t.end),workerName:text(t.workerName,'태그 요양보호사',80),type:text(t.type||'','태그 구분',100,true)};});
    const proposal=text(r.proposal||'','수정 제안',500,true);
    const kind=r.kind==='proposal'&&proposal&&r.ltRead&&tags.length===1&&tags[0].start&&tags[0].end?'proposal':'confirm';
    return {id:r.id,no:r.no,date:d,recipientName:text(r.recipientName,'수급자 성명',80),workerName:text(r.workerName,'요양보호사 성명',80),plan:text(r.plan,'현재 계획',200),ltRead:r.ltRead,tags,verdict:text(r.verdict,'점검 판정',200),proposal,reason:text(r.reason||'','점검 사유',2000,true),kind,...(v2?require('./scheduleReviewWorkflow').validateV2Record(r):{})};
  }).sort((a,b)=>a.no-b.no);
  const result={schemaVersion:input.schemaVersion,month,orgName:text(orgName,'기관명',120),from,to,collectedAt,ltSourceAt,sourceHash:input.sourceHash,records,...(v2&&cleanRecipientInfo(input.recipientInfo).length?{recipientInfo:cleanRecipientInfo(input.recipientInfo)}:{}),...(v2&&cleanInstitutionCode(input.institutionCode)?{institutionCode:cleanInstitutionCode(input.institutionCode)}:{}),...(v2?{sourceMode:'lt-only',ltTagSourceAt:timestamp(input.ltTagSourceAt,now),ltPlanSourceAt:timestamp(input.ltPlanSourceAt,now),completeness:{complete:true,expectedContracts:input.completeness.expectedContracts,readContracts:input.completeness.readContracts,failedContracts:[]}}:{})};
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_BYTES)fail('자료 파일이 너무 큽니다');return result;
}
function fromCheck(check,{orgName,now=Date.now()}){
  if(check?.schemaVersion===2)return validateImport({...check,ltSourceAt:check.ltTagSourceAt},orgName,now);
  if(!check||check.step!=='check'||!Array.isArray(check.issues)||check.more||check.ltError||check.cmError||check.planError||check.counts?.issues!==check.issues.length)fail('전체 점검을 완료한 조회 결과가 필요합니다');
  const month=String(check.from).slice(0,7),sourceHash=hash(check);
  const records=check.issues.map(q=>({id:'s_'+hash([sourceHash,q.no]).slice(0,32),no:q.no,date:month.slice(0,4)+'-'+q.d,recipientName:q.p,workerName:q.c,plan:q.plan,ltRead:q.ltRead,tags:(q.ltTags||[]).map(t=>({start:t.start??null,end:t.end??null,workerName:t.cg,type:t.type||''})),verdict:q.v,proposal:q.fix||'',reason:q.n||'',kind:q.win==='in'?'proposal':'confirm'}));
  return validateImport({schemaVersion:1,month,orgName,from:check.from,to:check.to,collectedAt:check.capturedAt,ltSourceAt:check.ltSourceAt,sourceHash,records},orgName,now);
}
function digest(s){return hash({schemaVersion:s.schemaVersion,month:s.month,orgName:s.orgName,from:s.from,to:s.to,collectedAt:s.collectedAt,ltSourceAt:s.ltSourceAt,sourceHash:s.sourceHash,records:s.records,...(s.schemaVersion===2?{sourceMode:s.sourceMode,ltTagSourceAt:s.ltTagSourceAt,ltPlanSourceAt:s.ltPlanSourceAt,completeness:s.completeness}:{})});}
function summary(s){return {schemaVersion:s.schemaVersion,sourceMode:s.sourceMode||'legacy',month:s.month,version:s.version||0,from:s.from,to:s.to,collectedAt:s.collectedAt,ltSourceAt:s.ltSourceAt,ltPlanSourceAt:s.ltPlanSourceAt||null,updatedAt:s.updatedAt||null,count:s.records.length,proposalCount:s.records.filter(r=>r.kind==='proposal').length,confirmCount:s.records.filter(r=>r.kind==='confirm').length,recipients:[...new Set(s.records.map(r=>r.recipientName))].sort((a,b)=>a.localeCompare(b,'ko')),contentHash:digest(s)};}


module.exports={cleanRecipientInfo,MAX_BYTES,fromCheck,validateImport,digest,summary};
