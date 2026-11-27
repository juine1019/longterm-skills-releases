'use strict';
const {canonical,comparable}=require('./core.cjs');
function timestamp(value){
 if(typeof value!=='string')return NaN;let iso=value;const native=/^(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?$/.exec(value);if(native)iso=`${native[1]}-${native[2]}-${native[3]}T${native[4]}:${native[5]}:${native[6]}.${native[7]||'000'}Z`;
 if(!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(iso))return NaN;if(!iso.includes('.'))iso=iso.replace('Z','.000Z');const result=Date.parse(iso);return Number.isFinite(result)&&new Date(result).toISOString()===iso?result:NaN;
}
function reconcileAttempt({spec,baseline,attempt},snapshot){
 if(!attempt||snapshot?.status!=='complete'||!Array.isArray(snapshot.records))return{state:'unknown',differences:['SERVER_READ_UNCONFIRMED']};
 const rows=snapshot.records;if(!rows.length)return{state:'unknown',differences:['NO_ROW_AFTER_POSSIBLE_SAVE']};if(rows.length!==1)return{state:'conflict',differences:['DUPLICATE_EVALUATIONS']};const row=rows[0],differences=[];
 if(spec.operation==='update'&&(row.evaluationId!==spec.evaluationId||baseline?.records?.length!==1||baseline.records[0].evaluationId!==spec.evaluationId))differences.push('EVALUATION_ID_CHANGED');
 if(spec.operation==='create'&&baseline?.records?.length)differences.push('CREATE_BASELINE_NOT_EMPTY');
 if(!row.evaluationId||canonical(row.values)!==canonical(comparable(spec)))differences.push('SAVED_VALUES_DIFFER');
 if(row.submitted!==false)differences.push('SUBMISSION_STATE');if(typeof row.savedAt!=='string'||!row.savedAt.trim())differences.push('SAVE_TIMESTAMP_MISSING');else if(!Number.isFinite(timestamp(row.savedAt)))differences.push('SAVE_TIMESTAMP_INVALID');
 if(!differences.length&&spec.operation==='update'&&(!Number.isFinite(timestamp(baseline?.records?.[0]?.savedAt))||timestamp(row.savedAt)<=timestamp(baseline.records[0].savedAt)))return{state:'unknown',evaluationId:row.evaluationId,differences:['UPDATE_SAVE_TIMESTAMP_NOT_ADVANCED']};
 return{state:differences.length?'conflict':'verified',evaluationId:row.evaluationId,differences};
}
module.exports={reconcileAttempt,timestamp};
