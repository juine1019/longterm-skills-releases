// 3-1 단순 준비본(schemaVersion 2)의 서버 검증.
// 준비 근거의 출처(preparation·사람별 prep)와 LT 실행 검증(execution)을 나눠 받는다.
// 서버에는 두 줄 요일·시간, 추천사유 코드, 불투명 근거 해시만 온다. 근거 본문(전월 날짜·횟수·원문)은 받지 않는다.
const REASON_CODES=['plan-registration-match','registration-repeat','mismatch','multiple-patterns','no-pattern','too-many-slots','unavailable','program-plan','no-plan','invalid-slots','no-contract','multiple-contracts','needs-worker','user-edited'];
const PROVIDERS={program:'caremanager',previous:null};
// 3-2 저장본 실행 이력(run.groups[].reason)에 남길 수 있는 문구. 입력기·재검증의 원문은 실행 PC에만 둔다.
const SIMPLE_RUN_REASONS=['사용자 확인 · 롱텀 쓰기 없음','사용자 확인 · 롱텀 저장·전송 확인','시도하지 않음 · 롱텀 로그인·연결 확인 필요','기존 일정과 입력안이 다릅니다','기존 일정의 상세·전송 확인 필요','현재 롱텀 가격·한도·자격이 저장본과 다름','입력 전 오류로 건너뜀 · 롱텀 쓰기 없음','롱텀 저장 거절 · 쓰기 없음 확인','입력 호출 결과 불명','저장 후 개인 일정 조회 실패','저장 결과가 입력안과 다름'];
const TOP_KEYS=['schemaVersion','orgName','month','base','collectedAt','sourceHash','completeness','people','preparation','execution'];
const PERSON_KEYS=['id','recipientKey','name','grade','cognitive','kind','note','issues','contracts','entries','limit','estimatedAmount','validation','amounts','prep'];
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const fail=(message,code='INVALID_REVIEW')=>{throw Object.assign(Error(message),{code});};
// 준비본의 메모·확인사항으로 받는 문구(정확히 일치)와 입력월 날짜 틀. 공통 저장소의 preparation-session.js와 같은 목록이다.
const SAFE_TEXTS=["원천 확인 필요 · 자세한 내용은 실행 PC에서 확인","전월 계획과 등록시간이 일치","반복 등록시간 참고","계획과 등록시간이 다름","반복 시간이 여러 가지 · 확인 후 입력","반복 등록 근거 부족 · 확인 후 입력","세 줄 이상 · 직접 처리","자료 확인 불가","프로그램 급여이용계획","급여이용계획 없음 · 확인 후 입력","요일·시간 확인 필요","입력월 유효 계약 없음","유효 계약이 여러 개 · 확인 후 입력","담당 요양보호사 확인 필요","사용자 수정","등록 명부와 대조 필요","입력월 계약 없음","전월 방문 패턴 없음","수급 상태 확인 필요","사용자·원천 확인에 따른 입력 보류","제공 상태·보류 사유 확인 전 자동 입력 보류","전월 방문 날짜·시간·직원 원천 확인 필요","전월 프로그램관리자 확인 필요","전월 계약 간 방문 중복 확인 필요","같은 방문의 관리자 원천 모호","사용자 직접 지정 근거·대상자·입력월 확인 필요","수정 의견 출처 확인 필요","수정 의견 날짜·시간·직원·관리자 원천 확인 필요","수정 의견의 LT 입력안 재검토 필요","수급자 방문 시간 겹침","LT 금액·한도 검증 필요","현재 수급 상태 확인 필요","요양보호사 시간 겹침","계약 유효기간 밖 일정 제외","입력월 기존 일정이 입력안과 다릅니다","입력할 일정이 없습니다","LT 가격 원천 검증 필요","가격 근거 기관·대상자·월 불일치","적용월 양수 한도 확인 필요","적용 정책·휴일·직원 자격 근거 필요","적용월 타급여 금액 확인 필요","타급여 한도 포함액·제외액 확인 필요","가격 대조할 방문 없음","정책 적용 전 원래 방문 대조 필요","정책 제외 날짜 근거 확인 필요","방문별 금액 전수 대조 필요","수가 적용기간·일자 확인 필요","방문별 LT 계산 금액 미확인","타급여 사용액이 월 한도를 초과합니다","현재 LT 전수 원천과 가격 근거 대조 필요"];
const SAFE_TEMPLATES=["^{M}-\\d{2} 계약 배정 확인 필요$","^정책·월 한도 제외 날짜: {M}-\\d{2}(, {M}-\\d{2})*$","^계약 종료일 {M}-\\d{2} · 이후 새 계약 없음\\(입력월 계약 자료 기준\\) — 기존 계약 마지막 날까지 일정 반영$","^요일 [0-6] 전월 불규칙 패턴 확인 필요$","^요일 [0-6] 전월 반복 근거 부족 \\([01]개 날짜\\) · 자동 요일 확장 금지$","^전월 {B} 입력 일정 없음 · 제공 상태·일정 부재 사유 확인 전 자동 입력 보류$"];
function isSafeText(line,month,base){
 if(SAFE_TEXTS.includes(line))return true;
 if(!SAFE_TEMPLATES.some(t=>new RegExp(t.split('{M}').join(month).split('{B}').join(base)).test(line)))return false;
 // 틀 안의 날짜는 입력월의 실제 날짜여야 한다.
 return (line.match(/\d{4}-\d{2}-\d{2}/g)||[]).every(d=>d.startsWith(month+'-')&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
}
// 실행 이력의 상태별 증빙 항목. 그 밖의 항목(원문 등)은 받지 않는다.
const PROOF_KEYS=['actualEntries','detailsVerified','transmissionVerified','transmissionBasis','untouchedBeforeHash','untouchedAfterHash','reconciled','verification','userConfirmation'];
const RECONCILE_KEYS=['noWritesConfirmed','reconciled','beforeHash','afterHash','userConfirmation'];
// 상태와 이전 상태에 따라 받는 증빙 항목과 값(형식·범위)을 정한다. 대기 중에서 바로 미처리로 갈 때는 증빙이 없다.
function checkRunEvidence(stage,e,{from,uid=null,now=Date.now()}={}){
 const allowed=stage==='held'?(['dispatched','unknown'].includes(from)?RECONCILE_KEYS:[]):['verified','already-goal'].includes(stage)?PROOF_KEYS:['dispatched','unknown'].includes(stage)?[]:null;
 const bad=()=>fail('허용되지 않은 증빙 항목입니다');
 if(!allowed||!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!allowed.includes(k)))bad();
 for(const k of ['noWritesConfirmed','reconciled','detailsVerified','transmissionVerified'])if(e[k]!==undefined&&e[k]!==true)fail('허용되지 않은 증빙 값입니다');
 for(const k of ['beforeHash','afterHash','untouchedBeforeHash','untouchedAfterHash'])if(e[k]!==undefined&&!hex(e[k]))fail('허용되지 않은 증빙 값입니다');
 if(e.actualEntries!==undefined&&(!Array.isArray(e.actualEntries)||e.actualEntries.length>150))fail('허용되지 않은 증빙 값입니다');
 if(e.transmissionBasis!==undefined&&!['dmd-state','save-response','user-confirmed'].includes(e.transmissionBasis))bad();
 if(e.verification!==undefined&&e.verification!=='scoped')bad();
 const u=e.userConfirmation;
 if(u!==undefined&&(!u||typeof u!=='object'||Array.isArray(u)||!hex(u.statementHash)||Object.keys(u).some(k=>!['statementHash','confirmedAt'].includes(k))))fail('사용자 확인 기록 형식이 맞지 않습니다');
 if(e.transmissionBasis==='user-confirmed'&&!u)fail('전송을 사용자 확인으로 인정하려면 사용자 확인 기록이 필요합니다');
 // 사용자 확인의 확인자 계정과 시각은 서버가 기록한다(요청이 보낸 시각은 쓰지 않는다).
 return u?{...e,userConfirmation:{statementHash:u.statementHash,confirmedBy:uid,confirmedAt:new Date(now).toISOString()}}:e;
}
const isTime=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const only=(value,keys,label)=>{for(const k of Object.keys(value))if(!keys.includes(k))fail(label+'에 허용되지 않은 값이 있습니다');};
const slotOk=s=>!!s&&typeof s==='object'&&Array.isArray(s.weekdays)&&s.weekdays.length>0&&new Set(s.weekdays).size===s.weekdays.length
 &&s.weekdays.every(w=>Number.isInteger(w)&&w>=0&&w<=6)&&isTime(s.start)&&isTime(s.end)&&s.start<s.end&&Object.keys(s).every(k=>['weekdays','start','end'].includes(k));
const weekdayOf=date=>new Date(date+'T00:00:00Z').getUTCDay();
const isPreparation=data=>data?.schemaVersion===2;
// v1(LT 단독) 자료에 준비 근거를 섞거나, 새 준비본에 lt-only 표지를 붙이는 것은 모두 거절한다.
function rejectMixed(data){
 if(data.preparation!==undefined||data.execution!==undefined||(Array.isArray(data.people)&&data.people.some(p=>p&&p.prep!==undefined)))fail('LT 단독 자료에 준비 근거 출처를 섞을 수 없습니다');
}
function validateTop(data){
 if('sourceMode' in data||'identityVersion' in data||'completenessHash' in data)fail('준비 근거의 출처에 LT 단독 표지를 붙일 수 없습니다');
 only(data,TOP_KEYS,'준비본');
 const p=data.preparation,e=data.execution;
 if(!p||typeof p!=='object'||p.version!==1)fail('준비 방식 버전을 확인해 주세요');
 only(p,['version'],'준비 방식');
 if(!e||typeof e!=='object'||e.source!=='lt'||e.identityVersion!==2||!hex(e.sourceHash)||!hex(e.completenessHash))fail('LT 실행 검증 근거가 필요합니다');
 only(e,['source','identityVersion','sourceHash','completenessHash'],'LT 실행 검증');
 return {preparation:{version:1},execution:{source:'lt',identityVersion:2,sourceHash:e.sourceHash,completenessHash:e.completenessHash}};
}
function validatePersonPrep(p,entries,{month,base,contracts}={}){
 only(p,PERSON_KEYS,'수급자 자료');
 // 준비 근거 본문은 전월(기준월) 날짜로 이뤄진다. 메모·확인사항에 전월 날짜가 들어가면 근거가 새는 것이므로 받지 않는다.
 // 메모·확인사항은 정해진 문구와 입력월 날짜 틀만 받는다. 원문·근거(전월 날짜 등)는 받지 않는다.
 if(month&&base){const lines=[...String(p.note||'').split('\n').filter(Boolean),...(Array.isArray(p.issues)?p.issues:[])];if(lines.some(t=>!isSafeText(String(t),month,base)))fail('메모·확인사항에는 정해진 문구만 보낼 수 있습니다(전월 날짜·원문 불가)');}
 const x=p.prep;
 if(!x||typeof x!=='object'||Array.isArray(x))fail('준비 방식이 필요합니다');
 only(x,['mode','provider','origin','slots','reasonCode','basisHash','excludedDates'],'준비 근거');
 if(!Object.hasOwn(PROVIDERS,x.mode)||x.provider!==PROVIDERS[x.mode])fail('준비 방식·연동 프로그램을 확인해 주세요');
 if(!['recommended','edited'].includes(x.origin))fail('준비 방식의 추천·수정 구분을 확인해 주세요');
 if(!REASON_CODES.includes(x.reasonCode))fail('추천사유 코드를 확인해 주세요');
 if(!hex(x.basisHash))fail('준비 근거 해시가 필요합니다');
 const bad=()=>fail('요일·시간은 두 줄 이하이고 입력 일정과 같아야 합니다');
 if(!Array.isArray(x.slots)||x.slots.length>2||!x.slots.every(slotOk))bad();
 const slots=x.slots.map(s=>({weekdays:s.weekdays.slice().sort((a,b)=>a-b),start:s.start,end:s.end}));
 if(slots.length===2&&slots[0].weekdays.some(w=>slots[1].weekdays.includes(w))&&slots[0].start<slots[1].end&&slots[1].start<slots[0].end)bad();
 if(p.kind==='ready'&&!slots.length)bad();
 for(const e of entries)if(!slots.some(s=>s.weekdays.includes(weekdayOf(e.date))&&s.start===e.start&&s.end===e.end))bad();
 // 한 사람의 같은 날짜·시간 일정은 담당자가 달라도 하나뿐이어야 한다.
 if(new Set(entries.map(e=>e.date+'|'+e.start+'|'+e.end)).size!==entries.length)fail('같은 날짜·시간 일정이 두 번 있습니다');
 // 반대 방향: 두 줄이 유효 계약 안에서 만드는 날짜는 모두 실제 일정에 있거나, 입력하지 않는 날짜로 밝혀져 있어야 한다.
 const excluded=x.excludedDates===undefined?[]:x.excludedDates;
 if(!Array.isArray(excluded)||excluded.length>31||new Set(excluded).size!==excluded.length||excluded.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||month&&!d.startsWith(month+'-')))bad();
 if(p.kind==='ready'&&month&&Array.isArray(contracts)){
  const have=new Set(entries.map(e=>e.date+'|'+e.start+'|'+e.end)),entryDates=new Set(entries.map(e=>e.date)),expected=new Set();
  const last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).getUTCDate();
  for(let d=1;d<=last;d++){const date=month+'-'+String(d).padStart(2,'0');if(!contracts.some(c=>c.from<=date&&c.to>=date))continue;for(const s of slots)if(s.weekdays.includes(weekdayOf(date))){expected.add(date);if(!excluded.includes(date)&&!have.has(date+'|'+s.start+'|'+s.end))bad();}}
  if(excluded.some(d=>!expected.has(d)||entryDates.has(d)))bad();
 }
 return {mode:x.mode,provider:x.provider,origin:x.origin,slots,reasonCode:x.reasonCode,basisHash:x.basisHash,excludedDates:excluded.slice().sort()};
}
module.exports={REASON_CODES,SIMPLE_RUN_REASONS,SAFE_TEXTS,SAFE_TEMPLATES,isSafeText,checkRunEvidence,isPreparation,rejectMixed,validateTop,validatePersonPrep};
