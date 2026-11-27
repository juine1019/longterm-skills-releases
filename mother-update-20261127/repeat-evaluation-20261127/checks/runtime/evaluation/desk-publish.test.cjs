'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const bridge=require('./desk-bridge.cjs');
const {publishDraft}=require('./desk-publish.cjs');
function sample(){const data={subjectKey:'a'.repeat(64),planKey:'b'.repeat(64),servicePeriod:{from:'2026-01-01',to:'2026-12-31'},operation:'create',evaluationId:null,revision:1,evaluationDate:null,evaluationKind:'02',goals:[],observations:[],summary:{text:'가상'},overallComment:{text:'가상'},bundleHash:'c'.repeat(64),evidence:[],localWorkKey:'d'.repeat(64)};data.evaluationKey=bridge.evaluationKey(data);return{data,contentHash:bridge.deskContentHash(data)};}
function fake({records=[],changed=false,unknown=false}={}){let writes=0,reads=0,stored;return{get writes(){return writes;},async list(){reads++;return{orgId:'DESK',complete:true,records:changed&&reads===2?[...records,{...sample().data,version:1,status:'draft',contentHash:sample().contentHash}]:records};},async put(body){writes++;if(unknown)throw Error('transport');stored={...body.data,status:'draft',version:1,contentHash:bridge.deskContentHash(body.data)};return{ok:true};},async get(){return stored;}};}
test('same content produces no write',async()=>{const built=sample(),record={...built.data,status:'draft',version:1,contentHash:built.contentHash},client=fake({records:[record]});const r=await publishDraft({built,client,deskOrgId:'DESK',requestId:'request-0001'});assert.equal(r.status,'existing');assert.equal(client.writes,0);});
test('new content is written once and verified through a separate read',async()=>{const built=sample(),client=fake();const r=await publishDraft({built,client,deskOrgId:'DESK',requestId:'request-0001'});assert.equal(r.status,'verified');assert.equal(client.writes,1);});
test('changed snapshot stops before writing',async()=>{const client=fake({changed:true});const r=await publishDraft({built:sample(),client,deskOrgId:'DESK',requestId:'request-0001'});assert.equal(r.status,'not-written');assert.equal(client.writes,0);});
test('uncertain write is never retried',async()=>{const client=fake({unknown:true});const r=await publishDraft({built:sample(),client,deskOrgId:'DESK',requestId:'request-0001'});assert.equal(r.status,'unknown');assert.equal(client.writes,1);});

test('server-incompatible narratives stop before dispatch without silently changing the draft',async()=>{
 for(const text of ['문장\n두 문단','문장\r\n두 문단','문장\t두 칸','문장 😀']){
  const built=sample();built.data.overallComment.text=text;built.contentHash=bridge.deskContentHash(built.data);
  const client=fake();let dispatched=0;
  const result=await publishDraft({built,client,deskOrgId:'DESK',requestId:'request-0001',beforeDispatch:()=>dispatched++});
  assert.equal(result.status,'not-written');assert.match(result.code,/DESK_TEXT_UNSUPPORTED:overallComment/);
  assert.equal(client.writes,0);assert.equal(dispatched,0);assert.equal(built.data.overallComment.text,text);
 }
});
test('safe HTTP diagnostics are preserved while the dispatched outcome remains unknown',async()=>{
 const client=fake();client.put=async()=>{throw Object.assign(Error('DESK_REQUEST_FAILED'),{httpStatus:400,serverCode:'INVALID_REVIEW'});};
 const result=await publishDraft({built:sample(),client,deskOrgId:'DESK',requestId:'request-0001'});
 assert.equal(result.status,'unknown');assert.equal(result.httpStatus,400);assert.equal(result.serverCode,'INVALID_REVIEW');
});
test('a server that drops recipient details cannot be reported as a verified publication',async()=>{
 const built=sample();built.data.recipient={name:'가상',sex:'여자',birthDate:'1940-02-29',grade:'3등급'};
 const client=fake(),original=client.get;client.get=async()=>({...await original(),recipient:{name:'가상'}});
 const result=await publishDraft({built,client,deskOrgId:'DESK',requestId:'request-0001'});
 assert.equal(result.status,'unknown');assert.equal(result.code,'DESK_VERIFY_MISMATCH');assert.equal(client.writes,1);
});
test('an existing record lacking requested recipient details is not silently treated as complete',async()=>{
 const built=sample();built.data.recipient={name:'가상',birthDate:'1940-02-29'};
 const record={...built.data,recipient:{name:'가상'},status:'draft',version:1,contentHash:built.contentHash};
 const client=fake({records:[record]});
 const result=await publishDraft({built,client,deskOrgId:'DESK',requestId:'request-0001'});
 assert.equal(result.status,'not-written');assert.equal(result.code,'DESK_RECIPIENT_PROFILE_MISMATCH');assert.equal(client.writes,0);
});

test('an uncertain write names the draft key it attempted so a later check can look for exactly that record',async()=>{const built=sample(),client=fake({unknown:true});const r=await publishDraft({built,client,deskOrgId:'DESK',requestId:'request-0001'});assert.deepEqual([r.status,r.evaluationKey,r.revision],['unknown',built.data.evaluationKey,1]);const none=await publishDraft({built,client:fake({changed:true}),deskOrgId:'DESK',requestId:'request-0001'});assert.deepEqual([none.status,none.evaluationKey],['not-written',undefined]);});
