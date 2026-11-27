'use strict';
const {hash,must}=require('./core.cjs');
const {planPublication,publishBody,deskContentHash,verifyPublished}=require('./desk-bridge.cjs');
function snapshot(value,org){
 must(value?.orgId===org&&value.complete===true&&Array.isArray(value.records),'DESK_LIST_UNCONFIRMED');
 const records=value.records;must(records.every(r=>r&&typeof r.evaluationKey==='string'&&Number.isSafeInteger(r.version))&&new Set(records.map(r=>r.evaluationKey)).size===records.length,'DESK_LIST_INVALID');
 return hash([value.viewerKey||null,[...records].sort((a,b)=>a.evaluationKey<b.evaluationKey?-1:a.evaluationKey>b.evaluationKey?1:0)]);
}
function validatePublicationText(data){
 const allowed=text=>typeof text==='string'&&/^[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}\p{N}\p{P}\p{Zs}₩+%×~−=<>°]*$/u.test(text);
 for(const [name,item] of [['summary',data.summary],['overallComment',data.overallComment],
  ...data.goals.map((g,i)=>['goal:'+i,g]),...data.observations.map((o,i)=>['observation:'+i,o])]){
  must(allowed(item?.text),'DESK_TEXT_UNSUPPORTED:'+name);
  if(item.texts)for(const text of Object.values(item.texts))must(allowed(text),'DESK_TEXT_UNSUPPORTED:'+name);
 }
}
async function publishDraft({built,client,deskOrgId,requestId,beforeDispatch}){
 let dispatched=false,planned=null;
 try{
  must(typeof deskOrgId==='string'&&deskOrgId.trim(),'DESK_ORG_REQUIRED');
  validatePublicationText(built.data);
  const initial=await client.list(),digest=snapshot(initial,deskOrgId);planned=planPublication(built,initial.records);
  if(planned.action==='existing')return{status:'existing',evaluationKey:planned.evaluationKey,revision:planned.revision,writes:0};
  const body=publishBody({data:planned.data,deskOrgId,requestId,expectedVersion:0});
  if(initial.viewerKey)body.expectedViewerKey=initial.viewerKey;
  const again=await client.list();must(snapshot(again,deskOrgId)===digest,'DESK_SNAPSHOT_CHANGED');
  beforeDispatch?.({evaluationKey:planned.data.evaluationKey,revision:planned.data.revision,contentHash:planned.contentHash,requestId,
   requestHash:hash(body),viewerKey:body.expectedViewerKey||null});
  dispatched=true;const result=await client.put(body);must(result?.ok===true,'DESK_WRITE_UNCONFIRMED');
  const record=await client.get(planned.data.evaluationKey);must(record?.orgId===deskOrgId,'DESK_VERIFY_ORG_MISMATCH');must(record?.contentHash===planned.contentHash&&deskContentHash(record)===planned.contentHash,'DESK_VERIFY_HASH_MISMATCH');
  const check=verifyPublished({data:planned.data,contentHash:planned.contentHash},record);must(check.ok,'DESK_VERIFY_MISMATCH');
  return{status:'verified',evaluationKey:planned.data.evaluationKey,revision:planned.data.revision,writes:1};
 }catch(e){return{status:dispatched?'unknown':'not-written',code:e.message,writes:dispatched?1:0,
  ...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(e.serverCode?{serverCode:e.serverCode}:{}),
  ...(dispatched&&planned?.data?{evaluationKey:planned.data.evaluationKey,revision:planned.data.revision}:{})};}
}
module.exports={publishDraft,validatePublicationText};
