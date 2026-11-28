const fail=(message,code='INVALID_REVIEW')=>{throw Object.assign(new Error(message),{code});};
const clock=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?+v.slice(0,2)*60+(+v.slice(3)):null;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function requestId(id){if(typeof id!=='string'||!/^[\w-]{8,100}$/.test(id))fail('요청 식별자가 필요합니다');return id;}
function validateV2Record(r){
 if(!hex(r.sourceKey)||!hex(r.groupKey)||!hex(r.evidenceHash)||!['ready','confirm','manual'].includes(r.eligibility)||!Array.isArray(r.checks)||r.checks.length>30)fail('점검 근거 식별 형식 오류');
 const current=r.current==null?null:{start:r.current.start,end:r.current.end,fam:r.current.fam,pgm:r.current.pgm,...(r.current.programKey?{programKey:r.current.programKey}:{})};
 if(current?.programKey&&!hex(current.programKey))fail('프로그램 관리자 근거 형식 오류');
 if(r.current?.programManagerName!==undefined){const name=r.current.programManagerName;if(current?.pgm!==true||!hex(current.programKey)||typeof name!=='string'||!name.trim()||name.length>80)fail('프로그램 관리자 성명 형식 오류');current.programManagerName=name;}
 if(current&&((current.start!==null&&clock(current.start)===null)||(current.end!==null&&clock(current.end)===null)||!['0','1'].includes(current.fam)||typeof current.pgm!=='boolean'))fail('현재 일정 구조 오류');
 const rec=r.recommendation==null?null:{operation:r.recommendation.operation,start:r.recommendation.start,end:r.recommendation.end};
 if(rec&&(rec.operation!=='retime'||clock(rec.start)===null||clock(rec.end)===null||clock(rec.start)>=clock(rec.end)))fail('추천 시간 구조 오류');
 const roundingOptions=r.roundingOptions==null?null:Object.fromEntries(['lower','upper'].map(k=>{const t=r.roundingOptions[k];if(!t||clock(t.start)===null||clock(t.end)===null||clock(t.start)>=clock(t.end))fail('올림·내림 시간 형식 오류');return [k,{start:t.start,end:t.end}];}));
 const seen=new Set();const checks=r.checks.map(c=>{if(!c||typeof c.code!=='string'||!/^[a-z][a-z0-9-]{0,60}$/.test(c.code)||seen.has(c.code)||typeof c.message!=='string'||c.message.length>1000||typeof c.required!=='boolean'||!['boolean','text','choice'].includes(c.answerType))fail('확인사항 형식 오류');seen.add(c.code);return {code:c.code,message:c.message,required:c.required,answerType:c.answerType};});
 // 계획 없는 태그가 속한 원천 계약·월 그룹. 같은 계약의 기존 계획과 한 번에 처리하기 위한 식별값이며 실행 승인이 아니다.
 if(r.contractGroupKey!==undefined&&(current!==null||!hex(r.contractGroupKey)||r.contractGroupKey===r.groupKey))fail('계획 없는 태그의 계약 그룹 형식 오류');
 return {sourceKey:r.sourceKey,groupKey:r.groupKey,...(r.contractGroupKey!==undefined?{contractGroupKey:r.contractGroupKey}:{}),evidenceHash:r.evidenceHash,current,recommendation:rec,...(roundingOptions?{roundingOptions}:{}),checks,eligibility:r.eligibility};
}
module.exports={clock,hex,requestId,validateV2Record};
