const {randomUUID,createHash}=require('node:crypto');
const {validateMonth,normalizeOrg,koreanMonth,expiresAt}=require('./workerNotes');
const {requestId,clock,hex}=require('./scheduleReviewWorkflow');
const preparation=require('./nextMonthPreparation');
const MAX_BYTES=1500000;
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const fail=(message,code='INVALID_REVIEW')=>{throw Object.assign(Error(message),{code});};
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const addMonth=(m,n)=>{validateMonth(m);const [y,mm]=m.split('-').map(Number);return new Date(Date.UTC(y,mm-1+n,1)).toISOString().slice(0,7);};
function text(v,label,max=100,blank=false){if(typeof v!=='string'||v.length>max||(!blank&&!v.trim()))fail(label+' 형식 오류');return v;}
function date(v,month){if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v||month&&!v.startsWith(month+'-'))fail('일정 날짜 형식 오류');return v;}
function validateSnapshot(data,orgName,now=Date.now()){
 const v2=preparation.isPreparation(data);
 if(!data||data.schemaVersion!==1&&!v2||normalizeOrg(data.orgName)!==normalizeOrg(orgName))fail('자료 기관과 로그인 기관이 다릅니다','ORG_MISMATCH');
 // 새 준비본(v2)은 준비 근거의 출처와 LT 실행 검증을 따로 받는다. v1에 준비 근거를 섞는 것은 거절한다.
 const top=v2?preparation.validateTop(data):(preparation.rejectMixed(data),null);
 const month=validateMonth(data.month),current=koreanMonth(now),base=addMonth(month,-1),c=data.completeness;
 if(data.base!==base||month<current||month>addMonth(current,3))fail('입력월과 직전 기준월을 확인해 주세요');
 if(!Array.isArray(data.people)||data.people.length>6000||c?.complete!==true||c.expectedPeople!==data.people.length||c.readPeople!==c.expectedPeople||!Array.isArray(c.failedPeople)||c.failedPeople.length)fail('전체 인원의 완전한 입력안이 필요합니다');
 if(!hex(data.sourceHash)||typeof data.collectedAt!=='string'||!Number.isFinite(Date.parse(data.collectedAt))||Date.parse(data.collectedAt)>now+300000)fail('원자료 시각·근거가 필요합니다');
 const lt=v2||data.sourceMode==='lt-only';
 if(!v2&&(data.sourceMode!==undefined&&!lt||lt&&(data.identityVersion!==2||!hex(data.completenessHash))))fail('LT 출처·명부 검증 버전을 확인해 주세요');
 const ids=new Set(),recipients=new Set();
 const people=data.people.map(p=>{
  if(!p||!/^[-\w]{1,80}$/.test(p.id)||ids.has(p.id)||!hex(p.recipientKey)||recipients.has(p.recipientKey)||!['ready','hold','exclude'].includes(p.kind))fail('중복·잘못된 수급자 원천 식별');ids.add(p.id);recipients.add(p.recipientKey);
  const cognitive=p.cognitive===true||String(p.grade)==='5';
  if(!Array.isArray(p.contracts)||p.contracts.length>20||!Array.isArray(p.entries)||p.entries.length>150||!Array.isArray(p.issues)||p.issues.length>100)fail('계약·일정·확인사항 형식 오류');
  const contracts=p.contracts.map(v=>{if(!hex(v.key))fail('계약 식별 필요');const from=date(v.from),to=date(v.to);if(from>to)fail('계약기간 역전');return {key:v.key,from,to};}).sort((a,b)=>a.key.localeCompare(b.key));
  if(new Set(contracts.map(v=>v.key)).size!==contracts.length)fail('중복 계약 식별');
  const entries=p.entries.map(e=>{
   const d=date(e.date,month),a=clock(e.start),b=clock(e.end),contract=contracts.find(v=>v.key===e.contractKey);
   if(a===null||b===null||a>=b||b-a>480||!hex(e.workerKey)||!['0','1'].includes(e.fam)||!contract||d<contract.from||d>contract.to)fail('입력 일정·담당자·계약 범위를 확인해 주세요');
   if(cognitive&&p.kind==='ready'&&(!hex(e.programKey)||!e.managerName))fail('5등급 프로그램 관리자 배정이 필요합니다');
   const out={date:d,start:e.start,end:e.end,workerName:text(e.workerName,'요양보호사',80),workerKey:e.workerKey,contractKey:e.contractKey,fam:e.fam};
   if(cognitive&&e.programKey){if(!hex(e.programKey))fail('관리자 근거 형식 오류');Object.assign(out,{programKey:e.programKey,managerName:text(e.managerName,'프로그램관리자',80)});}return out;
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.workerKey.localeCompare(b.workerKey));
  if(p.kind==='ready'&&(!/^[1-5]$/.test(String(p.grade))||!entries.length))fail('입력 대상 등급·일정을 확인해 주세요');
  if(new Set(entries.map(canonical)).size!==entries.length)fail('중복 입력 일정');
  const amount=v=>Number.isFinite(v)&&v>=0?v:null;
  let validation;
  if(lt){const v=p.validation;if(!v||!['verified','unverified','exceeded'].includes(v.status)||v.evidenceHash!==null&&!hex(v.evidenceHash))fail('LT 금액 검증 상태가 필요합니다');validation={status:v.status,evidenceHash:v.evidenceHash,limitUsed:amount(v.limitUsed)};if(p.kind==='ready'&&(v.status!=='verified'||!hex(v.evidenceHash)||!(amount(p.limit)>0)||amount(p.estimatedAmount)===null||validation.limitUsed===null||validation.limitUsed>p.limit))fail('LT 금액·한도 미확인 대상은 확인 필요로 분류해야 합니다');}
  return {id:p.id,recipientKey:p.recipientKey,name:text(p.name,'수급자',80),grade:String(p.grade||''),cognitive,kind:p.kind,note:text(p.note||'','확인사항',2000,true),issues:p.issues.map(v=>text(v,'확인사항',1000)),contracts,entries,limit:amount(p.limit),estimatedAmount:amount(p.estimatedAmount),...(lt?{validation}:{}),...(lt&&p.amounts&&typeof p.amounts==='object'?{amounts:{visit:amount(p.amounts.visit),other:amount(p.amounts.other)}}:{}),...(v2?{prep:preparation.validatePersonPrep(p,entries,{month,base,contracts})}:{})};
 }).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
 const clean={schemaVersion:v2?2:1,orgName:text(orgName,'기관명',120),month,base,collectedAt:data.collectedAt,sourceHash:data.sourceHash,completeness:{complete:true,expectedPeople:people.length,readPeople:people.length,failedPeople:[]},people};
 if(v2)Object.assign(clean,top);else if(lt)Object.assign(clean,{sourceMode:'lt-only',identityVersion:2,completenessHash:data.completenessHash});
 if(Buffer.byteLength(JSON.stringify(clean))>MAX_BYTES)fail('자료가 너무 큽니다','TOO_LARGE');return clean;
}
// amounts는 화면 표시용 금액 분해라 사용자 확인(확정) 해시에 넣지 않는다.
const personHash=p=>{const {amounts,...rest}=p;return hash(rest);};


module.exports={MAX_BYTES,canonical,hash,personHash,addMonth,validateSnapshot};
