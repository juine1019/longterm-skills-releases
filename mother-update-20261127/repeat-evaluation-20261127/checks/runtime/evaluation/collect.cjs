'use strict';
const {canonical,hash,must,identity,sameContext}=require('./core.cjs');
function normalizeRecipientProfile(profile,evaluationDate){
 const raw=String(profile.birthDate||'');
 const birthDate=/^\d{8}$/.test(raw)?raw.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):raw;
 const parsed=new Date(birthDate+'T00:00:00Z');
 const valid=/^(19|20)\d\d-\d\d-\d\d$/.test(birthDate)&&!Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===birthDate&&birthDate<=evaluationDate;
 const age=valid?Number(evaluationDate.slice(0,4))-Number(birthDate.slice(0,4))-(evaluationDate.slice(5)<birthDate.slice(5)?1:0):null;
 const sex=String(profile.sexCode)==='1'?'남자':String(profile.sexCode)==='2'?'여자':null;
 const gradeCode=String(profile.gradeCode||'');
 const grade=/^[1-5]$/.test(gradeCode)?gradeCode+'등급':null;
 return{sex,birthDate:valid?birthDate:null,age,ageAsOf:evaluationDate,grade};
}
async function collectEvidence(request,adapter){
 identity(request.context);const context=await adapter.inspectContext();must(context.role==='20L'&&sameContext(context.context,request.context),'WRONG_ROLE_OR_CONTEXT');const screen=await adapter.captureScreen();
 const reads={};let failure;try{for(const [key,method]of [['evaluations','readEvaluations'],['plans','readPlans'],['visits','readVisits'],['workerNotes','readWorkerNotes']]){
  const result=await adapter[method](request);must(result&&['complete','empty','partial','failed'].includes(result.status)&&Array.isArray(result.records),'READ_RESULT_INVALID');must(result.query&&canonical(result.query.context)===canonical(request.context)&&canonical(result.query.period)===canonical(request.period),'READ_QUERY_SCOPE');
  for(const r of result.records){must(sameContext(r.context,request.context),'READ_RECORD_CONTEXT');must(typeof r.id==='string'&&r.id&&r.contentHash===hash(r.content),'READ_RECORD_PROVENANCE');}reads[key]=result;
 }}catch(e){failure=e;}try{await adapter.assertScreenUnchanged(screen);}catch(e){if(failure){const combined=Error(failure.message+'; cleanup: '+e.message);combined.preserveLease=failure.preserveLease===true||e.preserveLease===true;failure=combined;}else failure=e;}if(failure)throw failure;
 const recipientProfile=context.recipientProfile?normalizeRecipientProfile(context.recipientProfile,request.evaluationDate):null;
 return{schemaVersion:1,context:request.context,period:request.period,collectedAt:new Date().toISOString(),reads,...(recipientProfile?{recipientProfile}:{})};
}
module.exports={collectEvidence,normalizeRecipientProfile};
