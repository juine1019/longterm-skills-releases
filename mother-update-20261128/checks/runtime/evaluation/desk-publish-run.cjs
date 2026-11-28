'use strict';
const {must}=require('./core.cjs');
const {deskContentHash,evaluationKey,verifyPublished}=require('./desk-bridge.cjs');
const TERMINAL=new Set(['publish-verified','publish-existing','publish-not-written']);
async function runPublication({journal,identity,publish}){
 journal.acquire();let retain=false;
 try{
  const history=journal.read(),last=history.findLast(e=>e.type==='publish-attempt');
  must(!last||history.slice(history.lastIndexOf(last)+1).some(e=>TERMINAL.has(e.type)),'PRIOR_DESK_PUBLISH_RECONCILE_ONLY');
  const attempt=journal.append({type:'publish-attempt',...(identity?{schemaVersion:2,...identity}:{})});retain=true;
  const beforeDispatch=event=>journal.append({type:'publish-dispatch',attemptIndex:attempt.index,...event});
  let result;try{result=await publish(beforeDispatch);}catch(e){result={status:'unknown',code:e.message};}
  const binding=identity?{attemptIndex:attempt.index}:{};

  if(!['verified','existing','not-written'].includes(result?.status)){journal.append({type:'publish-unknown',code:result?.code||'DESK_RESULT_UNCONFIRMED',evaluationKey:result?.evaluationKey||null,
   ...(Number.isInteger(result?.httpStatus)?{httpStatus:result.httpStatus}:{}),
   ...(typeof result?.serverCode==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(result.serverCode)?{serverCode:result.serverCode}:{})});return{...result,status:'unknown',leaseRetained:true};}
  journal.append({type:'publish-'+result.status,evaluationKey:result.evaluationKey||null,...binding});retain=false;return{...result,leaseRetained:false};
 }finally{if(!retain)journal.release();}
}
function publicationAttempt(history,identity){
 const attempt=history.findLast(e=>e.type==='publish-attempt');
 must(attempt?.schemaVersion===2&&attempt.leaseId===identity.leaseId,'DESK_PUBLICATION_ATTEMPT_UNBOUND');
 must(attempt.scopeHash===identity.scopeHash&&attempt.contentHash===identity.contentHash,'DESK_PUBLICATION_SCOPE_CHANGED');
 const events=history.slice(attempt.index+1).filter(e=>e.attemptIndex===attempt.index);
 const dispatches=events.filter(e=>e.type==='publish-dispatch');
 must(dispatches.length<=1,'DESK_PUBLICATION_DISPATCH_UNCONFIRMED');
 return{attempt,dispatch:dispatches[0],settled:events.findLast(e=>TERMINAL.has(e.type))};
}
async function verifyAttemptedDraft(built,dispatch,client,deskOrgId){
 const {revision,contentHash,requestId}=dispatch;
 const draft={...built.data,revision};draft.evaluationKey=evaluationKey(draft);
 must(Number.isSafeInteger(revision)&&revision>0&&contentHash===built.contentHash&&dispatch.evaluationKey===draft.evaluationKey&&typeof requestId==='string'&&/^[-\w]{8,128}$/.test(requestId),'DESK_PUBLICATION_DISPATCH_UNCONFIRMED');
 const listed=await client.list();
 must(listed?.orgId===deskOrgId&&listed.complete===true&&Array.isArray(listed.records),'DESK_LIST_UNCONFIRMED');
 const matching=listed.records.filter(r=>r?.evaluationKey===draft.evaluationKey);
 if(!matching.length)return false;
 must(matching.length===1,'DESK_PUBLISH_CONFLICT');
 const record=await client.get(draft.evaluationKey);
 const normalized={...record,status:'draft',evaluationDate:null};
 must(record?.orgId===deskOrgId&&record.revision===revision&&['draft','reviewed','registered'].includes(record.status)
  &&record.localWorkKey===draft.localWorkKey&&deskContentHash(record)===record.contentHash
  &&deskContentHash(normalized)===contentHash&&verifyPublished({data:draft,contentHash},normalized).ok,'DESK_PUBLISH_CONFLICT');
 return typeof client.publicationAccepted==='function'&&await client.publicationAccepted(draft.evaluationKey,requestId)===true;
}
module.exports={runPublication,publicationAttempt,verifyAttemptedDraft};
