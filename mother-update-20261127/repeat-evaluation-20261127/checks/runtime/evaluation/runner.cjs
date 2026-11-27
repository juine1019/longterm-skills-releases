'use strict';
const {hash,must,validateSpec,validateInstruction,comparable}=require('./core.cjs');
const {reconcileAttempt}=require('./reconcile.cjs');
const {pendingNativeRead}=require('./journal.cjs'),crypto=require('node:crypto');
function journalKey(spec){return hash({context:spec.context,evaluationDate:spec.evaluationDate,evaluationId:spec.evaluationId||null});}
async function runEvaluation({spec,instruction,bundle,schema,policy,journal,journalAlreadyAcquired=false,keepJournalOnExit=false},adapter){
 const proof=validateSpec(spec,schema,bundle,policy);must(proof.ok,proof.issues.join(';'));validateInstruction(instruction,spec,proof);if(!journalAlreadyAcquired)journal.acquire();let retain=false;
 try{
  const history=journal.read();must(!history.some(e=>e.type==='save-attempt'),'PRIOR_SAVE_ATTEMPT_RECONCILE_ONLY');
  const pendingRead=pendingNativeRead(history);if(pendingRead)throw Object.assign(Error('PRIOR_READ_REQUIRES_CHECK'),{preserveLease:true,readSessionId:pendingRead.readSessionId});
  const readServer=async()=>{const readSessionId=crypto.randomUUID();journal.append({type:'native-read-started',specHash:proof.specHash,readSessionId});let value;try{value=await adapter.readServer(spec,{readSessionId});}catch(e){if(e.readSessionId&&e.readSessionId!==readSessionId)throw Error('NATIVE_READ_SESSION_CHANGED');throw e;}journal.append({type:'native-read-completed',specHash:proof.specHash,readSessionId});return value;};
  const prior=history.findLast(e=>e.type==='filled'&&e.specHash===proof.specHash);await adapter.preflight(spec,schema,{receipt:prior?.receipt});const baseline=await readServer();must(baseline?.status==='complete'&&Array.isArray(baseline.records),'BASELINE_UNCONFIRMED');
  must(spec.operation==='create'?baseline.records.length===0:baseline.records.length===1&&baseline.records[0].evaluationId===spec.evaluationId,'CREATE_UPDATE_OR_DUPLICATE_CONFLICT');
  journal.append({type:'baseline',specHash:proof.specHash,baseline});const receipt=await adapter.fill(spec);must(receipt?.specHash===proof.specHash&&receipt.valuesHash===hash(comparable(spec)),'FILLED_VALUES_MISMATCH');
  journal.append({type:'filled',specHash:proof.specHash,receipt});await adapter.assertOwnedDraft(spec,receipt,schema);
  if(!instruction.saveAllowed)return{ok:true,state:'filled-not-saved',saveClicks:0,receipt};
  // Durable intent is written before the only permitted normal UI save click.
  const attempt={type:'save-attempt',specHash:proof.specHash,receiptHash:hash(receipt),instructionHash:hash(instruction)};journal.append(attempt);retain=true;
  await adapter.clickSaveOnce(spec,receipt,schema);
  const snapshot=await readServer(),result=reconcileAttempt({spec,baseline,attempt},snapshot);journal.append({type:'server-verification',result,snapshot});
  if(result.state!=='verified')return{ok:false,...result,saveClicks:1,reconcileRequired:true};
  const reopened=await adapter.reopenSaved(result.evaluationId,spec);must(reopened?.mode==='UPDATE'&&reopened.evaluationDateEnabled===false&&reopened.valuesHash===hash(comparable(spec)),'REOPEN_VERIFICATION_FAILED');
  journal.append({type:'verified',evaluationId:result.evaluationId,reopened});retain=false;return{ok:true,state:'verified',evaluationId:result.evaluationId,saveClicks:1};
 }catch(e){const history=journal.read(),attempted=history.some(e=>e.type==='save-attempt'),pending=pendingNativeRead(history),readPending=e.preserveLease===true||!!pending,readSessionId=pending?.readSessionId||e.readSessionId||null,readKind=pending?.readKind||e.readKind||null;retain=retain||attempted||readPending;journal.append({type:'interrupted',code:e.message,reconcileRequired:attempted||readPending,readStateUnconfirmed:readPending,readSessionId,readKind});return{ok:false,state:attempted?'unknown':readPending?'blocked-read-unconfirmed':'blocked',code:e.message,reconcileRequired:attempted||readPending,readStateUnconfirmed:readPending,readSessionId,readKind};}finally{if(!retain&&!keepJournalOnExit)journal.release();}
}
module.exports={runEvaluation,journalKey};
