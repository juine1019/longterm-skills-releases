'use strict';
// 6-2 applies the exact reviewed desk revision and reports only a verified save.
const {must,hash,canonical,date}=require('./core.cjs'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {deskKeys,deskContentHash}=require('./desk-bridge.cjs');
function samePlanEvaluations(records,planId){
 must(Array.isArray(records),'EVALUATION_LIST_UNCONFIRMED');
 must(typeof planId==='string'&&planId.trim(),'EVALUATION_PLAN_UNCONFIRMED');
 return records.filter(record=>{const id=record?.content?.basic?.POF_PLNPP_MGMT_NO;must(typeof id==='string'&&id.trim(),'EVALUATION_PLAN_UNCONFIRMED');return id===planId;});
}
function validateReviewedDate(data,today){
 must(data?.operation==='create'&&date(today)&&date(data.evaluationDate)&&date(data.servicePeriod?.from)&&date(data.servicePeriod?.to)&&data.servicePeriod.from<=data.evaluationDate&&data.evaluationDate<=data.servicePeriod.to&&data.evaluationDate<=today,'DESK_EVALUATION_DATE_INVALID');return true;
}
function evaluationReadRequest(spec){
 must(spec?.context&&date(spec.period?.from)&&date(spec.period?.to)&&spec.period.from<=spec.period.to,'EVALUATION_PERIOD');
 return{context:structuredClone(spec.context),period:structuredClone(spec.period),evaluationDate:spec.period.to};
}
function chooseReviewed(records,selectedKey){
 must(Array.isArray(records),'DESK_RECORDS_UNCONFIRMED');
 const candidates=records.filter(record=>record?.status==='reviewed');
 must(candidates.every(r=>typeof r.evaluationKey==='string'&&r.evaluationKey)&&new Set(candidates.map(r=>r.evaluationKey)).size===candidates.length,'REVIEWED_LIST_INVALID');
 if(selectedKey!==undefined){const record=candidates.find(r=>r.evaluationKey===selectedKey);must(record,'REVIEWED_SELECTION_REQUIRED');return{status:'selected',record};}
 if(!candidates.length)return{status:'none'};
 if(candidates.length>1)return{status:'selection-required',candidates};
 return{status:'selected',record:candidates[0]};
}
function nextRound(records,planId,expectedRound){
 must(typeof expectedRound==='string'&&/^[1-9]\d{0,2}$/.test(expectedRound),'EVALUATION_ROUND_UNCONFIRMED');
 const selected=samePlanEvaluations(records,planId),rounds=selected.map(r=>r.content.basic.POF_VLT_CHASU);
 must(rounds.every(r=>typeof r==='string'&&/^[1-9]\d{0,2}$/.test(r)),'EVALUATION_ROUND_UNCONFIRMED');
 const next=Math.max(0,selected.length,...rounds.map(Number))+1;must(next<=999,'EVALUATION_ROUND_UNCONFIRMED');
 return{evaluationRound:String(next),confirmationRequired:String(next)!==expectedRound};
}
function verifyReviewedSource({data,spec,schema,bundle,policy,secret}){
 must(data?.status==='reviewed','NOT_REVIEWED');
 must(data.review?.contentHash===data.contentHash&&deskContentHash(data)===data.contentHash,'DESK_REVIEW_HASH_MISMATCH');
 must(data.operation==='create'&&spec?.operation==='create'&&canonical(data.servicePeriod)===canonical(spec.period),'DESK_WORK_SCOPE_MISMATCH');
 must(typeof schema?.fingerprint==='string'&&data.schemaFingerprint===schema.fingerprint,'DESK_SCHEMA_MISMATCH');
 const keys=deskKeys(secret,spec.context);must(keys.subjectKey===data.subjectKey&&keys.planKey===data.planKey,'DESK_IDENTITY_MISMATCH');
 must(data.bundleHash===hash(bundle),'DESK_BUNDLE_MISMATCH');
 const localWorkKey=crypto.createHash('sha256').update(canonical(['evaluation-work',hash(spec),hash(bundle),hash(schema),hash(policy)])).digest('hex');
 must(data.localWorkKey===localWorkKey,'DESK_LOCAL_WORK_MISMATCH');
 return true;
}
function materializeReviewed({data,spec,bundle,actualRound,freshEvaluations}){
 must(typeof actualRound==='string'&&/^[1-9]\d{0,2}$/.test(actualRound),'EVALUATION_ROUND_UNCONFIRMED');
 for(const field of ['goals','observations'])must(Array.isArray(data[field])&&Array.isArray(spec[field])&&canonical(data[field].map(x=>x.key).sort())===canonical(spec[field].map(x=>x.key).sort()),'DESK_FIELD_SCOPE_CHANGED');
 const sourceIds=new Set(Object.values(bundle.reads).flatMap(read=>read.records.map(record=>record.id)));
 const confirmations=new Map((data.evidence||[]).filter(e=>e.kind==='user-confirmed').map(e=>[e.id,e]));
 const used=new Map(),part=(item,field)=>{
  must(Array.isArray(item.evidenceIds),'EVIDENCE_LINKS_REQUIRED');
  for(const id of item.evidenceIds){
   if(sourceIds.has(id))continue;
   const e=confirmations.get(id),c=e?.content;
   must(e&&id.startsWith('user-confirmed:')&&e.contentHash===hash(c)&&c?.field===field&&c.reviewContentHash===data.contentHash&&(c.text!==undefined?c.text===item.text:c.selected===item.selected),'USER_CONFIRMATION_MISMATCH');
   used.set(id,{id,kind:'user-confirmed',context:spec.context,content:c,contentHash:e.contentHash});
  }
  return{text:item.text,evidenceState:item.evidenceState,evidenceIds:[...item.evidenceIds]};
 };
 const nextSpec={...structuredClone(spec),evaluationDate:data.evaluationDate,evidenceObservedTo:data.evidenceObservedTo,evaluationRound:actualRound,
  goals:data.goals.map(g=>({key:g.key,provided:g.provided,...part(g,'goal:'+g.key)})),
  observations:data.observations.map(o=>({key:o.key,selected:o.selected,...part(o,'observation:'+o.key)})),
  summary:part(data.summary,'summary'),overallComment:part(data.overallComment,'overallComment')};
 const nextBundle=structuredClone(bundle),records=[...used.values()];
 nextBundle.reads.userConfirmations={status:records.length?'complete':'empty',records,collectedAt:data.review.at,query:{context:spec.context,period:spec.period,observationPeriod:{from:spec.period.from,to:data.evidenceObservedTo}}};
 if(freshEvaluations!==undefined){nextSpec.requireFreshEvaluations=true;nextBundle.currentEvaluations=structuredClone(freshEvaluations);}
 return{spec:nextSpec,bundle:nextBundle};
}
async function runRegistration({record,runId,actualRound,ops}){
 must(record?.status==='reviewed'&&/^[a-f0-9]{64}$/.test(record.evaluationKey||'')&&/^[a-f0-9]{64}$/.test(record.contentHash||'')&&Number.isSafeInteger(record.version)&&record.version>0,'DESK_REGISTRATION_INVALID');
 must(typeof runId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(runId)&&typeof actualRound==='string'&&/^[1-9]\d{0,2}$/.test(actualRound),'DESK_REGISTRATION_INVALID');
 for(const name of ['acquire','assertNoPending','recordIntent','claim','recheck','run','report'])must(typeof ops?.[name]==='function','REGISTRATION_DEPENDENCY_REQUIRED');
 const lease=await ops.acquire();must(typeof lease?.release==='function','REGISTRATION_LEASE_REQUIRED');let keep=true,claimed=false,entered=false,claimDispatched=false;
 try{
  await ops.assertNoPending({record});
  await ops.recordIntent({evaluationKey:record.evaluationKey,version:record.version,contentHash:record.contentHash,runId,actualRound});claimDispatched=true;
  await ops.claim({evaluationKey:record.evaluationKey,expectedVersion:record.version,contentHash:record.contentHash,runId});claimed=true;
  await ops.recheck({record,runId,actualRound});entered=true;
  const outcome=await ops.run();
  if(outcome?.state==='verified'){
   must(typeof outcome.evaluationId==='string'&&outcome.evaluationId.trim()&&typeof outcome.verifiedAt==='string'&&Number.isFinite(Date.parse(outcome.verifiedAt)),'VERIFICATION_INCOMPLETE');
   await ops.report({evaluationKey:record.evaluationKey,runId,outcome:'verified',evaluationId:outcome.evaluationId,verifiedAt:outcome.verifiedAt,ltWrittenDate:outcome.ltWrittenDate??null,evaluationRound:actualRound});
   keep=false;return{state:'verified'};
  }
  const uncertain=outcome?.reconcileRequired===true||outcome?.state==='unknown';
  const saveAttempted=outcome?.state==='blocked-read-unconfirmed'?false:uncertain;
  await ops.report({evaluationKey:record.evaluationKey,runId,outcome:'not-verified',failureCode:uncertain?(saveAttempted?'SAVE_UNCONFIRMED':'READ_UNCONFIRMED'):'EXECUTION_BLOCKED',saveAttempted});
  keep=uncertain;return{state:uncertain?'unknown':'blocked',...(outcome?.code?{code:outcome.code}:{}),...(outcome?.readStateUnconfirmed===true?{cause:'READ_STATE_UNCONFIRMED'}:{})};
 }catch(error){
  if(!claimDispatched){keep=false;return{state:'blocked',code:error.message};}
  if(claimed&&!entered&&error.preserveLease===true){try{await ops.report({evaluationKey:record.evaluationKey,runId,outcome:'not-verified',failureCode:'READ_UNCONFIRMED',saveAttempted:false});}catch{}return{state:'unknown',code:'READ_SESSION_RECONCILIATION_REQUIRED'};}
  if(claimed&&!entered){try{await ops.report({evaluationKey:record.evaluationKey,runId,outcome:'not-verified',failureCode:'PRECHECK_BLOCKED',saveAttempted:false});keep=false;return{state:'blocked',code:error.message};}catch{}}
  return{state:'unknown',code:'REGISTRATION_RECONCILIATION_REQUIRED',cause:error.message};
 }finally{if(!keep)await lease.release();}
}
async function readCurrentEvaluations(adapter){
 const snapshot=await adapter.captureScreen();let result,failure;
 try{result=await adapter.readEvaluations();must(['complete','empty'].includes(result?.status)&&Array.isArray(result.records)&&((result.status==='empty')===(result.records.length===0)),'CURRENT_EVALUATIONS_UNCONFIRMED');}catch(e){failure=e;}
 try{await adapter.assertScreenUnchanged(snapshot);}catch(e){if(failure){const combined=Error(failure.message+'; '+e.message);combined.preserveLease=failure.preserveLease===true||e.preserveLease===true;failure=combined;}else failure=e;}
 if(failure){if(failure.preserveLease===true){failure.readSessionId=adapter.sessionId;failure.readKind='evaluation-list';}throw failure;}return result;
}
function assertPlanJournalClear(target,journals){
 must(target?.context&&target.period&&Array.isArray(journals),'JOURNAL_SCOPE_UNCONFIRMED');
 for(const entry of journals){
  must(Array.isArray(entry?.history),'JOURNAL_SCOPE_UNCONFIRMED');const i=entry.history.findLastIndex(e=>e.type==='save-attempt');if(i<0||entry.history.slice(i+1).some(e=>e.type==='verified'))continue;
  must(entry.spec?.context&&entry.spec.period&&entry.history[i].specHash===hash(entry.spec),'JOURNAL_SCOPE_UNCONFIRMED');
  const a=entry.spec.context,b=target.context,same=a.orgId===b.orgId&&a.recipientId===b.recipientId&&a.recognitionNo===b.recognitionNo&&a.recognitionSeq===b.recognitionSeq&&a.planId===b.planId&&canonical(entry.spec.period)===canonical(target.period);
  must(!same,'PRIOR_SAVE_ATTEMPT_RECONCILE_ONLY');
 }
 return true;
}
function loadPlanHistories(stateRoot,journalRoot){
 const {openJournal}=require('./journal.cjs'),{journalKey}=require('./runner.cjs'),root=fs.realpathSync(stateRoot),relative=path.relative(root,path.resolve(journalRoot));
 must(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'JOURNAL_SCOPE_UNCONFIRMED');
 if(!fs.existsSync(journalRoot))return[];
 must(!fs.lstatSync(journalRoot).isSymbolicLink()&&fs.realpathSync(journalRoot).startsWith(root+path.sep),'JOURNAL_SCOPE_UNCONFIRMED');
 const specs=new Map();let scanned=0;
 function walk(folder){for(const d of fs.readdirSync(folder,{withFileTypes:true})){must(++scanned<100000,'JOURNAL_SCOPE_UNCONFIRMED');const p=path.join(folder,d.name);must(!d.isSymbolicLink(),'JOURNAL_SCOPE_UNCONFIRMED');if(d.isDirectory())walk(p);else if(d.isFile()&&d.name==='spec.json'){let value;try{value=JSON.parse(fs.readFileSync(p,'utf8'));}catch{throw Error('JOURNAL_SCOPE_UNCONFIRMED');}if(value?.context&&value.period&&value.evaluationDate)specs.set(hash(value),value);}}}
 walk(root);const result=[];
 for(const name of fs.readdirSync(journalRoot)){if(!name.endsWith('.jsonl'))continue;must(/^[a-f0-9]{64}\.jsonl$/.test(name),'JOURNAL_SCOPE_UNCONFIRMED');const key=name.slice(0,-6),file=path.join(journalRoot,name);must(!fs.lstatSync(file).isSymbolicLink(),'JOURNAL_SCOPE_UNCONFIRMED');const history=openJournal(journalRoot,key).read(),attempt=history.findLast(e=>e.type==='save-attempt'),spec=attempt?specs.get(attempt.specHash)||null:null;if(spec)must(journalKey(spec)===key,'JOURNAL_SCOPE_UNCONFIRMED');result.push({spec,history});}
 return result;
}
async function prepareRegistration({records,selectedKey,work,secret,today,readCurrent,confirmedRound}){
 const selected=chooseReviewed(records,selectedKey);if(selected.status!=='selected')return{state:selected.status,...(selected.candidates?{candidates:selected.candidates}:{})};
 const data=selected.record;validateReviewedDate(data,today);verifyReviewedSource({data,...work,secret});
 must(typeof readCurrent==='function','CURRENT_EVALUATIONS_READER_REQUIRED');const current=await readCurrent(work.spec);
 must(current&&['complete','empty'].includes(current.status)&&Array.isArray(current.records)&&((current.status==='empty')===(current.records.length===0)),'CURRENT_EVALUATIONS_UNCONFIRMED');
 const recordsForPlan=samePlanEvaluations(current.records,work.spec.context.planId),round=nextRound(recordsForPlan,work.spec.context.planId,data.evaluationRound);
 const fresh={...structuredClone(current),records:recordsForPlan,status:recordsForPlan.length?'complete':'empty'};
 const prepared=materializeReviewed({data,spec:work.spec,bundle:work.bundle,actualRound:round.evaluationRound,freshEvaluations:fresh}),proof=require('./core.cjs').validateSpec(prepared.spec,work.schema,prepared.bundle,work.policy);
 must(proof.ok,'REGISTRATION_SPEC_INVALID:'+proof.issues.join(';'));
 if(round.confirmationRequired&&confirmedRound!==round.evaluationRound)return{state:'round-confirmation-required',evaluationRound:round.evaluationRound,expectedRound:data.evaluationRound};
 return{state:'ready',record:data,actualRound:round.evaluationRound,...prepared,proof,remainingReviewed:records.filter(r=>r?.status==='reviewed'&&r.evaluationKey!==data.evaluationKey).length};
}
function verifyPreSave({approved,latest,runId,expectedRead,currentRead}){
 must(latest?.status==='reviewed'&&latest.evaluationKey===approved.evaluationKey&&latest.version===approved.version+1&&latest.lease?.runId===runId&&latest.contentHash===approved.contentHash&&latest.review?.contentHash===approved.contentHash&&deskContentHash(latest)===approved.contentHash,'DESK_REVIEW_CHANGED');
 const stable=({lease,version,updatedAt,updatedBy,...rest})=>rest;must(hash(stable(latest))===hash(stable(approved)),'DESK_REVIEW_CHANGED');
 for(const key of ['localWorkKey','bundleHash','schemaFingerprint','evidenceObservedTo'])must(latest[key]===approved[key],'DESK_REVIEW_CHANGED');
 const comparableRead=r=>({status:r?.status,query:r?.query,historyRange:r?.historyRange,records:[...(r?.records||[])].sort((a,b)=>String(a.id).localeCompare(String(b.id)))});
 must(expectedRead&&currentRead&&['complete','empty'].includes(currentRead.status)&&Array.isArray(currentRead.records)&&((currentRead.status==='empty')===(currentRead.records.length===0))&&hash(comparableRead(expectedRead))===hash(comparableRead(currentRead)),'CURRENT_EVALUATIONS_CHANGED');
 return true;
}
function guardSave(adapter,check){
 must(typeof adapter?.assertOwnedDraft==='function'&&typeof adapter?.clickSaveOnce==='function'&&typeof check==='function','PRE_SAVE_CHECK_REQUIRED');let checked=false;
 return{...adapter,async assertOwnedDraft(...args){checked=false;await adapter.assertOwnedDraft(...args);await check();checked=true;},async clickSaveOnce(...args){must(checked,'PRE_SAVE_CHECK_REQUIRED');checked=false;return adapter.clickSaveOnce(...args);}};
}
function makeRunOperations({approved,runId,expectedRead,acquire,assertNoPending,recordIntent,client,readCurrent,verifyOriginal,runner,adapter}){
 for(const f of [acquire,assertNoPending,recordIntent,readCurrent,verifyOriginal,runner,client?.claim,client?.get,client?.result])must(typeof f==='function','REGISTRATION_DEPENDENCY_REQUIRED');
 const recheck=async()=>{await verifyOriginal();const latest=await client.get(approved.evaluationKey),currentRead=await readCurrent();return verifyPreSave({approved,latest,runId,expectedRead,currentRead});};
 const guarded=guardSave(adapter,recheck);
 return{acquire,assertNoPending,recordIntent,claim:body=>client.claim(body),recheck,adapter:guarded,run:()=>runner(guarded),report:body=>client.result(body)};
}
function validateRegistrationInstruction({prepared,instruction,organizationId,deskOrgId,documentSha256}){
 must(instruction?.action==='evaluation-desk-register'&&instruction.saveAllowed===true&&typeof instruction.message==='string'&&instruction.message.trim()&&instruction.organizationId===organizationId&&instruction.deskOrgId===deskOrgId,'REGISTRATION_INSTRUCTION_MISMATCH');
 for(const key of ['evaluationKey','contentHash','actualRound','originalBundleHash','documentSha256'])must(typeof prepared?.[key]==='string'&&instruction[key]===prepared[key],'REGISTRATION_INSTRUCTION_MISMATCH');
 must(/^[a-f0-9]{64}$/.test(documentSha256||'')&&documentSha256===prepared.documentSha256,'REGISTRATION_DOCUMENT_CHANGED');return true;
}
function verifyPreparedExecution({data,work,prepared,actualRound}){
 must(prepared?.bundle?.currentEvaluations,'FRESH_EVALUATIONS_REQUIRED');
 const rebuilt=materializeReviewed({data,spec:work.spec,bundle:work.bundle,actualRound,freshEvaluations:prepared.bundle.currentEvaluations});
 must(hash(rebuilt.spec)===hash(prepared.spec)&&hash(rebuilt.bundle)===hash(prepared.bundle),'PREPARED_CONTENT_CHANGED');
 const proof=require('./core.cjs').validateSpec(prepared.spec,work.schema,prepared.bundle,work.policy);must(proof.ok,'REGISTRATION_SPEC_INVALID:'+proof.issues.join(';'));return true;
}
async function journaledCurrentRead({adapter,journal,requestHash,bindingHash}){
 must(typeof adapter?.sessionId==='string'&&/^[a-zA-Z0-9-]{10,80}$/.test(adapter.sessionId)&&typeof journal?.append==='function'&&/^[a-f0-9]{64}$/.test(requestHash||'')&&/^[a-f0-9]{64}$/.test(bindingHash||''),'LIST_READ_JOURNAL_REQUIRED');
 journal.append({type:'list-read-started',readSessionId:adapter.sessionId,readKind:'evaluation-list',requestHash,bindingHash});
 try{const result=await readCurrentEvaluations(adapter);journal.append({type:'list-read-completed',readSessionId:adapter.sessionId,requestHash,bindingHash});return result;}
 catch(e){if(adapter.readStateConfirmed?.()!==true){e.preserveLease=true;e.readSessionId=adapter.sessionId;e.readKind='evaluation-list';}else journal.append({type:'list-read-completed',readSessionId:adapter.sessionId,requestHash,bindingHash});throw e;}
}
module.exports={samePlanEvaluations,chooseReviewed,nextRound,verifyReviewedSource,materializeReviewed,runRegistration,readCurrentEvaluations,assertPlanJournalClear,loadPlanHistories,validateReviewedDate,prepareRegistration,evaluationReadRequest,verifyPreSave,guardSave,makeRunOperations,validateRegistrationInstruction,verifyPreparedExecution,journaledCurrentRead};
