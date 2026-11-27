'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {makeDeskRequest}=require('./desk-transport.cjs');
const scope={targets:[{service:'desk',targetId:'desk-tab'}]};
test('only the approved desk routes use the exact bound tab and write flag',async()=>{
 const calls=[],bridge=async(source,options)=>{calls.push({source,options});return{ok:true,data:{example:1}};},request=makeDeskRequest({scope,bridge});
 assert.deepEqual(await request('GET','/api/org'),{example:1});assert.equal(calls[0].options.writeAttempted,false);assert.match(calls[0].source,/desk-tab/);
 await request('PUT','/api/evaluation-results',{expectedVersion:0});assert.equal(calls[1].options.writeAttempted,true);
 await assert.rejects(request('POST','/api/evaluation-results/other/review'),/DESK_ROUTE_UNSUPPORTED/);assert.equal(calls.length,2);
});
test('unconfirmed responses and failed requests do not look successful',async()=>{const request=makeDeskRequest({scope,bridge:async()=>({ok:false,status:500})});await assert.rejects(request('GET','/api/org'),/DESK_REQUEST_FAILED/);});

test('HTTP diagnostics survive while uncertain writes remain unknown',async()=>{
 const request=makeDeskRequest({scope,bridge:async()=>({ok:false,status:400,serverCode:'INVALID_REVIEW',error:'private text'})});
 await assert.rejects(request('PUT','/api/evaluation-results',{}),e=>e.httpStatus===400&&e.serverCode==='INVALID_REVIEW'&&e.outcome==='unknown'&&!JSON.stringify(e).includes('private text'));
});
test('the client-only update cannot call the proposed server resolution routes',async()=>{
 const request=makeDeskRequest({scope,bridge:async()=>{throw Error('must not call');}}),base='/api/evaluation-results/'+'a'.repeat(64)+'/publication-resolution';
 await assert.rejects(request('POST',base,{}),/DESK_ROUTE_UNSUPPORTED/);
 await assert.rejects(request('GET',base+'?requestId=synthetic-001&requestHash='+'b'.repeat(64)),/DESK_ROUTE_UNSUPPORTED/);
});
test('registration transport allows only claim and result with exact keys and preserves uncertain writes',async()=>{
 const calls=[],request=makeDeskRequest({scope,bridge:async(source,options)=>{calls.push({source,options});return{ok:true,data:{ok:true}};}}),key='a'.repeat(64);
 for(const action of ['register-claim','register-result']){await request('POST','/api/evaluation-results/'+key+'/'+action,{expectedOrg:'DESK',runId:'run-01'});assert.equal(calls.at(-1).options.writeAttempted,true);assert.match(calls.at(-1).source,/run-01/);}
 for(const action of ['review','unreview','delete'])await assert.rejects(request('POST','/api/evaluation-results/'+key+'/'+action,{}),/DESK_ROUTE_UNSUPPORTED/);
 await assert.rejects(request('POST','/api/evaluation-results/invalid/register-claim',{}),/DESK_ROUTE_UNSUPPORTED/);assert.equal(calls.length,2);
});

const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const {runAside}=require('../aside-cli.cjs');
const {runEvaluationSequence,isCommonError}=require('./sequence.cjs');

function isolatedDesk({orgStatus=200,endSessionAfterWrite=false,showTab=true,role='admin'}={}){
 const origin='https://desk.example.test';
 const scope={organization:{id:'LT-TEST',name:'Test Center',deskId:'ORG-TEST'},origins:{desk:origin},targets:[{service:'desk',targetId:'desk-tab'}]};
 const requests=[];
 const spawnProcess=()=>{
  const child=new EventEmitter();
  child.stdin=new EventEmitter();
  child.stdout=new EventEmitter();
  child.stderr=new EventEmitter();
  child.kill=()=>{};
  child.stdin.end=input=>queueMicrotask(async()=>{
   const context=vm.createContext({
    URL,
    console:{log:message=>child.stdout.emit('data',Buffer.from(message+'\n'))},
    location:{origin},
    listBrowserTabs:async()=>showTab?[{targetId:'desk-tab',url:origin+'/dashboard.html'}]:[],
    attachBrowserTab:async()=>({evaluate:async(fn,arg)=>fn(arg)}),
    openTab:async()=>{throw Error('UNEXPECTED_OPEN');},
    fetch:async(path,options)=>{
     const method=options.method||'GUARD';
     requests.push({path,method});
     const status=path==='/api/org'?orgStatus:200;
     if(endSessionAfterWrite&&method==='PUT')orgStatus=401;
     return {status,ok:status===200,redirected:false,json:async()=>({id:'ORG-TEST',name:'Test Center',me:{role}})};
    },
   });
   try{
    const expression=input.split('\n')[0];
    await vm.runInContext('(async()=>{'+expression+'})()',context);
    child.emit('close',0);
   }catch(error){
    child.stderr.emit('data',Buffer.from(error.message+'\n'));
    child.emit('close',1);
   }
  });
  return child;
 };
 const bridge=(source,options)=>runAside(source,{...options,spawnProcess,executable:'isolated-desk',env:{}});
 return {requests,bridge,scope,request:makeDeskRequest({scope,bridge})};
}

test('the compiled guard preserves a shared Desk login failure and the sequence stops',async()=>{
 const {request,requests}=isolatedDesk({orgStatus:401});
 const outcomes=[];
 const result=await runEvaluationSequence({
  tasks:[{taskId:'A'},{taskId:'B'},{taskId:'C'}],
  execute:async()=>request('GET','/api/org'),
  recordOutcome:async(task,value)=>outcomes.push([task.taskId,value.code]),
 });
 assert.deepEqual(result.manualIds,['A']);
 assert.deepEqual(result.notAttemptedIds,['B','C']);
 assert.equal(result.stopReason,'DESK_LOGIN_UNCONFIRMED');
 assert.deepEqual(outcomes,[['A','DESK_LOGIN_UNCONFIRMED']]);
 assert.deepEqual(requests,[{path:'/api/org',method:'GUARD'}]);
});

test('a failed Desk guard after a PUT preserves an unknown write outcome',async()=>{
 const {request,requests}=isolatedDesk({endSessionAfterWrite:true});
 await assert.rejects(request('PUT','/api/evaluation-results',{}),error=>
  error.message==='DESK_LOGIN_UNCONFIRMED'&&error.outcome==='unknown');
 assert.equal(requests.filter(({method})=>method==='PUT').length,1);
});

test('a fixed Desk guard code is opt-in and tab failures retain target-level meaning',async()=>{
 const {bridge,scope,request}=isolatedDesk({showTab:false});
 await assert.rejects(bridge('throw Error("UNREACHABLE")',{scope}),/BRIDGE_RESULT_UNCONFIRMED/);
 await assert.rejects(request('GET','/api/org'),/BOUND_TAB_MISSING/);
 assert.equal(isCommonError('BOUND_TAB_MISSING'),false);
 assert.equal(isCommonError('BROWSER_BINDINGS_STALE_OR_MISSING'),false);
 assert.equal(isCommonError('SHARED_DESK_BINDING_UNCONFIRMED'),true);
});

test('an authenticated Desk account with a different role is a shared stop',async()=>{
 const {request,requests}=isolatedDesk({role:'staff'});
 await assert.rejects(request('GET','/api/org'),error=>
  error.message==='DESK_ADMIN_REQUIRED'&&isCommonError(error.message));
 assert.deepEqual(requests,[{path:'/api/org',method:'GUARD'}]);
});

test('a guard failure after a write is reported as unknown and stops before the next target',async()=>{
 const {request,requests}=isolatedDesk({endSessionAfterWrite:true});
 const result=await runEvaluationSequence({
  tasks:[{taskId:'A'},{taskId:'B'}],
  execute:async()=>request('PUT','/api/evaluation-results',{}),
  recordOutcome:async()=>{},
 });
 assert.deepEqual(result.unknownIds,['A']);
 assert.deepEqual(result.notAttemptedIds,['B']);
 assert.equal(result.stopReason,'DESK_LOGIN_UNCONFIRMED');
 assert.equal(requests.filter(({method})=>method==='PUT').length,1);
});


test('the publication receipt can be read by its exact key and request ID only',async()=>{
 const calls=[],request=makeDeskRequest({scope,bridge:async(source,options)=>{calls.push({source,options});return{ok:true,data:{publicationAccepted:true}};}});
 const route='/api/evaluation-results/'+'a'.repeat(64)+'?publicationRequestId=synthetic-123';
 assert.deepEqual(await request('GET',route),{publicationAccepted:true});
 assert.equal(calls[0].options.writeAttempted,false);
 await assert.rejects(request('POST',route,{}),/DESK_ROUTE_UNSUPPORTED/);
 await assert.rejects(request('GET',route+'&other=1'),/DESK_ROUTE_UNSUPPORTED/);
 assert.equal(calls.length,1);
});
