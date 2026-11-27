'use strict';
const {must,hash}=require('./core.cjs');
const KEY=/^[a-f0-9]{64}$/;
function createDeskClient({request,expectedOrg,onViewerKey}){
 must(typeof request==='function'&&typeof expectedOrg==='string'&&expectedOrg.trim(),'DESK_CLIENT_SCOPE_REQUIRED');
 async function authorize(){const org=await request('GET','/api/org');must(org?.id===expectedOrg&&['admin','owner'].includes(org.me?.role),'DESK_ORG_OR_ROLE_CHANGED');}
 async function index(){const result=await request('GET','/api/evaluation-results?includeRevisions=1');must(result?.orgId===expectedOrg&&result.includeRevisions===true&&Array.isArray(result.items),'DESK_ALL_REVISIONS_UNCONFIRMED');const viewerKey=result.viewerKey;must(KEY.test(viewerKey||''),'DESK_VIEWER_UNCONFIRMED');onViewerKey?.(viewerKey);const items=result.items;must(items.every(x=>KEY.test(x?.evaluationKey||'')&&Number.isSafeInteger(x.version)&&x.version>0)&&new Set(items.map(x=>x.evaluationKey)).size===items.length,'DESK_INDEX_INVALID');return{viewerKey,items:[...items].sort((a,b)=>a.evaluationKey<b.evaluationKey?-1:a.evaluationKey>b.evaluationKey?1:0)};}
 async function detail(key){must(KEY.test(key||''),'DESK_KEY_INVALID');const data=await request('GET','/api/evaluation-results/'+key);must(data?.orgId===expectedOrg&&data.evaluationKey===key&&Number.isSafeInteger(data.version),'DESK_DETAIL_SCOPE_CHANGED');return data;}
 return{
  async list(){await authorize();const before=await index(),records=[];for(const item of before.items){const record=await detail(item.evaluationKey);must(record.version===item.version,'DESK_DETAIL_VERSION_CHANGED');records.push(record);}const after=await index();must(hash(before)===hash(after),'DESK_INDEX_CHANGED');await authorize();return{orgId:expectedOrg,complete:true,viewerKey:before.viewerKey,records};},
  async get(key){await authorize();return detail(key);},
  async publicationAccepted(key,requestId){
   must(KEY.test(key||'')&&typeof requestId==='string'&&/^[-\w]{8,128}$/.test(requestId),'DESK_PUBLICATION_RECEIPT_INVALID');
   await authorize();
   const result=await request('GET','/api/evaluation-results/'+key+'?publicationRequestId='+requestId);
   return result?.orgId===expectedOrg&&result.evaluationKey===key&&result.publicationAccepted===true;
  },
  async claim({evaluationKey,expectedVersion,contentHash,runId},{beforeDispatch}={}){
   must(KEY.test(evaluationKey||'')&&KEY.test(contentHash||'')&&Number.isSafeInteger(expectedVersion)&&expectedVersion>0&&typeof runId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(runId),'DESK_CLAIM_INVALID');
   await authorize();beforeDispatch?.();const record=await request('POST','/api/evaluation-results/'+evaluationKey+'/register-claim',{expectedVersion,contentHash,runId});
   must(record?.orgId===expectedOrg&&record.evaluationKey===evaluationKey&&record.version===expectedVersion+1&&record.status==='reviewed'&&record.contentHash===contentHash&&record.lease?.runId===runId,'DESK_CLAIM_UNCONFIRMED');return record;
  },
  async result({evaluationKey,runId,outcome,evaluationId,ltWrittenDate,verifiedAt,evaluationRound,failureCode,saveAttempted}){
   must(KEY.test(evaluationKey||'')&&typeof runId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(runId),'DESK_RESULT_INVALID');
   let body={runId,outcome};
   if(outcome==='verified'){
    must(typeof evaluationId==='string'&&evaluationId.trim()&&typeof verifiedAt==='string'&&Number.isFinite(Date.parse(verifiedAt))&&(ltWrittenDate==null||/^\d{4}-\d{2}-\d{2}$/.test(ltWrittenDate))&&(evaluationRound==null||/^[1-9]\d{0,2}$/.test(evaluationRound)),'DESK_RESULT_INVALID');
    body={...body,evaluationId,verifiedAt,ltWrittenDate:ltWrittenDate??null,evaluationRound:evaluationRound??null};
   }else{must(outcome==='not-verified'&&typeof failureCode==='string'&&/^[A-Z][A-Z0-9_-]{0,79}$/.test(failureCode)&&typeof saveAttempted==='boolean','DESK_RESULT_INVALID');body={...body,failureCode,saveAttempted};}
   await authorize();const record=await request('POST','/api/evaluation-results/'+evaluationKey+'/register-result',body);
   const r=record?.registration,a=record?.lastAttempt;
   const verified=outcome==='verified'&&record?.status==='registered'&&r?.runId===runId&&r.evaluationId===evaluationId&&r.verifiedAt===verifiedAt&&(r.ltWrittenDate??null)===(ltWrittenDate??null)&&(r.evaluationRound??null)===(evaluationRound??null);
   const failed=outcome==='not-verified'&&record?.status==='reviewed'&&!record.lease&&a?.runId===runId&&a.code===failureCode&&a.saveAttempted===saveAttempted;
   must(record?.orgId===expectedOrg&&record.evaluationKey===evaluationKey&&(verified||failed),'DESK_RESULT_UNCONFIRMED');return record;
  },
  async put(body){must(body?.expectedOrg===expectedOrg&&body.data?.orgId===expectedOrg&&body.expectedVersion===0,'DESK_PUT_SCOPE_CHANGED');await authorize();await request('PUT','/api/evaluation-results',body);return{ok:true};}
 };
}
module.exports={createDeskClient};
