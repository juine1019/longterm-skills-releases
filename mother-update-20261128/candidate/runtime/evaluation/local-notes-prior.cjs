'use strict';
const {fieldsComplete}=require('../worker-notes-store.cjs');
function localRequest(request,now=new Date()){
 if(request.workerNotesMode!==undefined)return request;
 const ym=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(now),[year,month]=ym.split('-').map(Number);
 const prior=new Date(Date.UTC(year,month-1,0)).toISOString().slice(0,10),end=[prior,request.evaluationDate,request.period.to,request.evidenceObservedTo||prior].sort()[0];
 if(end<request.period.from)throw Error('LOCAL_PRIOR_PERIOD_UNAVAILABLE');
 return {...request,workerNotesMode:'local-prior-month',evidenceObservedTo:end};
}
async function recipientMonth(store,request,month){
 if(!store||!/^20\d{4}$/.test(month))throw Error('LOCAL_MONTH_MISSING_OR_INCOMPLETE');
 const m=month.slice(0,4)+'-'+month.slice(4),entry=store.status(m);
 if(!entry?.complete||!['collected','final'].includes(entry.state))throw Error('LOCAL_MONTH_MISSING_OR_INCOMPLETE');
 const {snapshot,sha256}=store.load(m);if(!fieldsComplete(snapshot))throw Error('LOCAL_MONTH_FIELDS_INCOMPLETE');
 const [y,n]=m.split('-').map(Number),end=new Date(Date.UTC(y,n,0)).toISOString().slice(0,10);
 if(!snapshot.collectedAt||Date.parse(snapshot.collectedAt)<Date.parse(end+'T15:00:00Z'))throw Error('LOCAL_MONTH_SNAPSHOT_TOO_EARLY');
 const from=request.period.from.replaceAll('-',''),to=request.evidenceObservedTo.replaceAll('-','');
 const rows=snapshot.records.filter(r=>r.header.LTC_MGMT_NO===request.context.recognitionNo&&r.header.LTCP_CLSFC_CD===request.context.serviceCode&&r.header.LTCP_FR_DT>=from&&r.header.LTCP_FR_DT<=to);
 for(const r of rows){if(r.detail.ORI_LTC_ADMIN_SYM&&r.detail.ORI_LTC_ADMIN_SYM!==request.context.orgId)throw Error('RFID_SOURCE_INSTITUTION_CHANGED');if(r.detail.LTC_MGMT_NO_SEQ&&r.detail.LTC_MGMT_NO_SEQ!==request.context.recognitionSeq)throw Error('RFID_RECOGNITION_SEQUENCE_CHANGED');}
 return{records:rows.map(({header,detail})=>({header,detail})),snapshot:{sha256,collectedAt:snapshot.collectedAt,state:entry.state}};
}
module.exports={recipientMonth,localRequest};
