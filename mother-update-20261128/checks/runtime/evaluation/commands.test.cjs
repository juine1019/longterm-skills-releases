const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {releaseVerifiedLocks,privatePath}=require('./commands.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lt-eval-recovery-'));t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});const stateRoot=path.join(root,'state/organizations/synthetic');fs.mkdirSync(stateRoot,{recursive:true});return{root,stateRoot,orgKey:'synthetic',configHash:'synthetic-config'};}
test('recovery never removes a live owner or an unverified save lease',t=>{const c=fixture(t),key='a'.repeat(64),lease={id:'synthetic-lease',pid:process.pid,operation:'evaluation:'+key,orgKey:c.orgKey,configHash:c.configHash};fs.writeFileSync(path.join(c.root,'state/runtime.lock'),JSON.stringify(lease));const journal={lock:path.join(c.stateRoot,'journal.lock')};assert.throws(()=>releaseVerifiedLocks(c,journal,key,lease.id,{state:'unknown'}),/ONLY_VERIFIED/);assert.throws(()=>releaseVerifiedLocks(c,journal,key,lease.id,{state:'verified',reopenedVerified:true}),/STILL_RUNNING/);assert(fs.existsSync(path.join(c.root,'state/runtime.lock')));});
test('exact verified recovery archives dead-owner evidence before releasing only matching locks',t=>{const c=fixture(t),child=spawnSync(process.execPath,['-e',''],{windowsHide:true}),key='b'.repeat(64),lease={id:'synthetic-lease',pid:child.pid,operation:'evaluation:'+key,orgKey:c.orgKey,configHash:c.configHash},journal={lock:path.join(c.stateRoot,'journal.lock')};assert.equal(child.status,0);fs.writeFileSync(path.join(c.root,'state/runtime.lock'),JSON.stringify(lease));fs.writeFileSync(journal.lock,JSON.stringify({key,pid:child.pid,id:'synthetic-journal'}));assert.throws(()=>releaseVerifiedLocks(c,journal,key,'wrong-id',{state:'verified',reopenedVerified:true}),/SCOPE_CHANGED/);const evidence=releaseVerifiedLocks(c,journal,key,lease.id,{state:'verified',reopenedVerified:true});assert.equal(JSON.parse(fs.readFileSync(evidence)).locks.length,2);assert(!fs.existsSync(journal.lock));assert(!fs.existsSync(path.join(c.root,'state/runtime.lock')));});
test('evaluation inputs stay inside the current organization state',t=>{const c=fixture(t);const file=path.join(c.stateRoot,'request.json');fs.writeFileSync(file,'{}');assert.equal(privatePath(c,file),file);assert.throws(()=>privatePath(c,path.join(c.root,'outside'),{existing:false}),/CURRENT_ORGANIZATION/);});
function collectionFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lt-collect-cli-'));t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});const settings={schemaVersion:1,organization:{id:'SYNTHETIC-ORG',name:'가상기관'},operator:{name:'가상작성자',job:'사회복지사'},origins:{lt:'https://lt.example.test',cm:'https://cm.example.test',ez:'https://ez.example.test',desk:'https://desk.example.test'},policy:{accepted:true,version:'synthetic'}};fs.writeFileSync(path.join(root,'longterm.workspace.json'),JSON.stringify(settings));const context=require('../context.cjs').loadContext(root),request={recipientName:'가상대상',context:{orgId:'SYNTHETIC-ORG',workerId:'SYNTHETIC-WORKER',workerName:'가상작성자',recipientId:'SYNTHETIC|001',recognitionNo:'SYNTHETIC',recognitionSeq:'001',planId:'SYNTHETIC-PLAN',serviceCode:'001'},period:{from:'2026-10-01',to:'2026-10-28'},evaluationDate:'2026-10-28'},file=path.join(context.stateRoot,'request.json');require('../context.cjs').writeNewJson(file,request);return{root,context,request,file,out:path.join(context.stateRoot,'nested','collection')};}
test('desk publication command requires a scoped instruction and verifies one synthetic write',async t=>{
 const C=require('../context.cjs'),core=require('./core.cjs'),bridge=require('./desk-bridge.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t);
 const settings=C.readJson(path.join(x.root,'longterm.workspace.json'));settings.organization.deskId='DESK';fs.writeFileSync(path.join(x.root,'longterm.workspace.json'),JSON.stringify(settings));const context=C.loadContext(x.root),dir=path.join(context.stateRoot,'work');
 const spec={context:x.request.context,operation:'create'},schema={},bundle={},policy={},values={spec,schema,bundle,policy,validation:{}};
 for(const [name,value] of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);
 const instruction={action:'evaluation-desk-publish',organizationId:spec.context.orgId,deskOrgId:'DESK',specHash:core.hash(spec),bundleHash:core.hash(bundle),schemaHash:core.hash(schema),policyHash:core.hash(policy),recipientName:'가상대상',message:'가상 게시 요청',allowWrite:true};const file=path.join(context.stateRoot,'instruction.json');C.writeNewJson(file,instruction);
 const data={subjectKey:'a'.repeat(64),planKey:'b'.repeat(64),servicePeriod:{from:'2026-01-01',to:'2026-12-31'},operation:'create',evaluationId:null,revision:1,evaluationDate:null,evaluationKind:'02',goals:[],observations:[],summary:{text:'가상'},overallComment:{text:'가상'},bundleHash:'c'.repeat(64),evidence:[]};data.evaluationKey=bridge.evaluationKey(data);const built={data,contentHash:bridge.deskContentHash(data)};
 let writes=0,stored;const client={list:async()=>({orgId:'DESK',complete:true,records:[]}),put:async body=>{writes++;stored={...body.data,status:'draft',version:1,contentHash:bridge.deskContentHash(body.data)};return{ok:true};},get:async()=>stored};
 await assert.rejects(main('evaluation-desk-publish',{work:dir},x.root),/PRIVATE_PATH_REQUIRED/);assert.equal(writes,0);
 const result=await main('evaluation-desk-publish',{work:dir,instruction:file},x.root,{deskClient:()=>client,loadDeskSecret:()=>({secret:'f'.repeat(64)}),buildDeskDraft:()=>built});assert.equal(result.status,'verified');assert.equal(writes,1);assert.equal(fs.existsSync(path.join(x.root,'state/runtime.lock')),false);
 client.put=async()=>{writes++;throw Error('TRANSPORT_UNKNOWN');};
 const uncertain=await main('evaluation-desk-publish',{work:dir,instruction:file},x.root,{deskClient:()=>client,loadDeskSecret:()=>({secret:'f'.repeat(64)}),buildDeskDraft:()=>built});assert.equal(uncertain.status,'unknown');assert.equal(uncertain.leaseRetained,true);assert.equal(writes,2);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));
 await assert.rejects(main('evaluation-desk-publish',{work:dir,instruction:file},x.root,{deskClient:()=>client,loadDeskSecret:()=>({secret:'f'.repeat(64)}),buildDeskDraft:()=>built}));assert.equal(writes,2);
});
function collectionAdapter(x,options,{partial=false,pending=false}={}){const S=require('./evidence-source.cjs');const read=records=>S.completedRead(x.request,records,[{month:'202610',status:records.length?'complete':'empty'}]);let closed=0;return{sessionId:'synthetic-collection-session',inspectContext:async()=>({role:'20L',context:x.request.context}),captureScreen:async()=>({sessionId:'synthetic-collection-session'}),readEvaluations:async()=>{const result=read([]);await options.onCheckpoint({service:'lt',action:'evaluations-list',result});return result;},readPlans:async()=>{if(pending)throw Object.assign(Error('LT_READ_TIMEOUT_PENDING'),{preserveLease:true});return read([S.record(x.request.context,'plan','SYNTHETIC-PLAN','가상계획',{planId:'SYNTHETIC-PLAN',from:x.request.period.from,to:'2027-09-30'})]);},readVisits:async()=>read([]),readWorkerNotes:async()=>partial?{...read([]),status:'failed',error:{code:'SOURCE_UNAVAILABLE'}}:read([]),assertScreenUnchanged:async()=>{closed++;if(pending)throw Object.assign(Error('LT_READ_STILL_PENDING'),{preserveLease:true});},readStateConfirmed:()=>closed>0&&!pending,getObservation:()=>({schema:{schemaVersion:1,formId:'synthetic'}})};}
test('6-2 preparation requires the actual scoped request and never selects among multiple reviews',async t=>{
 const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'desk-work');
 for(const [name,value] of Object.entries({spec:{...x.request,operation:'create'},schema:{},bundle:{},policy:{}}))C.writeNewJson(path.join(dir,name+'.json'),value);
 const instruction=path.join(x.context.stateRoot,'registration-instruction.json');C.writeNewJson(instruction,{action:'evaluation-desk-register-prepare',organizationId:x.request.context.orgId,deskOrgId:'DESK',message:'가상 6-2 진행'});
 let sourceReads=0;const client={list:async()=>({orgId:'DESK',complete:true,records:[{evaluationKey:'a',status:'reviewed'},{evaluationKey:'b',status:'reviewed'}]})};
 const deps={deskClient:()=>client,makeEvidenceAdapter:()=>{sourceReads++;throw Error('MUST_NOT_READ');}};
 await assert.rejects(main('evaluation-desk-register-prepare',{work:dir,out:x.out},x.root,deps),/PRIVATE_PATH_REQUIRED/);
 const result=await main('evaluation-desk-register-prepare',{work:dir,out:x.out,instruction},x.root,deps);assert.equal(result.status,'selection-required');assert.equal(sourceReads,0);assert.equal(fs.existsSync(x.out),false);
});
test('6-2 execution refuses before site access without a private save instruction',async t=>{
 const {main}=require('./commands.cjs'),x=collectionFixture(t);let calls=0;
 await assert.rejects(main('evaluation-desk-register',{work:x.out},x.root,{deskClient:()=>{calls++;}}),/PRIVATE_PATH_REQUIRED/);assert.equal(calls,0);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('6-2 read recovery uses the exact saved temporary binding',async t=>{
 const C=require('../context.cjs'),core=require('./core.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),folder=x.out;fs.mkdirSync(folder,{recursive:true});
 const lease=C.acquire(x.context,'evaluation-collect:'+core.hash(x.request)),bindings={schemaVersion:1,configHash:x.context.configHash,targets:[{service:'lt',targetId:'NEW',role:'20L'}]};
 C.writeNewJson(path.join(folder,'request.json'),{...x.request,configHash:x.context.configHash});C.writeNewJson(path.join(folder,'session.json'),{schemaVersion:1,configHash:x.context.configHash,requestHash:core.hash(x.request),leaseId:lease.lease.id,sessionId:'synthetic-session-id',evaluationsOnly:true,bindings});
 let checked=0;const result=await main('evaluation-collection-check',{work:folder},x.root,{checkCollection:async(_root,_request,_session,options)=>{checked++;assert.equal(options.evaluationsOnly,true);assert.deepEqual(options.bindings,bindings);return{ok:true,pending:false,contextMatched:true};}});
 assert.equal(result.ok,true);assert.equal(checked,1);lease.release();
});
test('collect CLI archives source checkpoints privately and never equates a failed source with empty records',async t=>{const {main}=require('./commands.cjs');for(const partial of [false,true]){const x=collectionFixture(t);const result=await main('evaluation-collect',{request:x.file,out:x.out},x.root,{makeEvidenceAdapter:(root,request,o)=>collectionAdapter(x,o,{partial})});assert.equal(result.ok,!partial);assert.equal(result.siteWrites,0);assert.equal(result.reads.workerNotes.status,partial?'failed':'empty');assert.equal(result.checkpoints,1);assert(fs.existsSync(path.join(x.out,'source-0001.json')));assert(fs.existsSync(path.join(x.out,'schema.json')));assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));await assert.rejects(main('evaluation-collect',{request:x.file,out:x.out},x.root),/NEW_COLLECTION/);}});
test('an unconfirmed source session retains the collection lease even when an error lacks a pending flag',async t=>{
 const {main}=require('./commands.cjs'),x=collectionFixture(t);
 const result=await main('evaluation-collect',{request:x.file,out:x.out},x.root,{makeEvidenceAdapter:(root,request,o)=>{const adapter=collectionAdapter(x,o);adapter.readPlans=async()=>{throw Error('TRANSPORT_RESULT_UNCONFIRMED');};adapter.assertScreenUnchanged=async()=>{throw Error('CLEANUP_UNCONFIRMED');};adapter.readStateConfirmed=()=>false;return adapter;}});
 assert.equal(result.leaseRetained,true);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));assert.equal(result.siteWrites,0);
});
test('pending collection recovery requires a drained exact session and a dead matching owner before releasing its lease',async t=>{const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),result=await main('evaluation-collect',{request:x.file,out:x.out},x.root,{makeEvidenceAdapter:(root,request,o)=>collectionAdapter(x,o,{pending:true})});assert.equal(result.leaseRetained,true);const lockFile=path.join(x.root,'state/runtime.lock'),failure=fs.readFileSync(path.join(x.out,'failure.json'));let calls=0;
 await assert.rejects(main('evaluation-collection-check',{work:x.out,'release-lease':result.leaseId},x.root,{checkCollection:async()=>{calls++;}}),/OWNER_STILL_RUNNING/);assert.equal(calls,0);
 const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(child.status,0);const lock=C.readJson(lockFile);lock.pid=child.pid;fs.writeFileSync(lockFile,JSON.stringify(lock));await assert.rejects(main('evaluation-collection-check',{work:x.out,'release-lease':result.leaseId},x.root,{checkCollection:async()=>({ok:true,pending:true,contextMatched:true})}),/NOT_DRAINED/);assert(fs.existsSync(lockFile));
 const checked=await main('evaluation-collection-check',{work:x.out,'release-lease':result.leaseId},x.root,{checkCollection:async(root,request,session,options={})=>{calls++;assert.equal(session,result.sessionId);return options.close?{ok:true,pending:false,screenPreserved:true}:{ok:true,pending:false,contextMatched:true,screenPreserved:true};}});assert.equal(checked.leaseRetained,false);assert.equal(checked.siteWrites,0);assert(!fs.existsSync(lockFile));assert(fs.existsSync(checked.recoveryEvidence));assert.deepEqual(fs.readFileSync(path.join(x.out,'failure.json')),failure);
});
test('collection recovery retains the exact session after a crash before failure summary is written',async t=>{
 const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t);let recordedBeforeRead=false;
 const result=await main('evaluation-collect',{request:x.file,out:x.out},x.root,{makeEvidenceAdapter:(root,request,o)=>{const adapter=collectionAdapter(x,o,{pending:true}),inspect=adapter.inspectContext;adapter.inspectContext=async()=>{recordedBeforeRead=fs.existsSync(path.join(x.out,'session.json'));return inspect();};return adapter;}});assert.equal(recordedBeforeRead,true);assert.equal(result.leaseRetained,true);const session=C.readJson(path.join(x.out,'session.json'));assert.equal(session.sessionId,result.sessionId);fs.unlinkSync(path.join(x.out,'failure.json'));
 const lockFile=path.join(x.root,'state/runtime.lock'),child=spawnSync(process.execPath,['-e',''],{windowsHide:true}),lock=C.readJson(lockFile);lock.pid=child.pid;fs.writeFileSync(lockFile,JSON.stringify(lock));let calls=0;const checked=await main('evaluation-collection-check',{work:x.out,'release-lease':result.leaseId},x.root,{checkCollection:async(_root,_request,id,options={})=>{calls++;assert.equal(id,session.sessionId);return options.close?{ok:true,pending:false}:{ok:true,pending:false,contextMatched:true};}});assert.equal(calls,2);assert.equal(checked.leaseRetained,false);assert(!fs.existsSync(lockFile));
});
test('collection recovery rejects a failure summary that names another native session',async t=>{
 const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),result=await main('evaluation-collect',{request:x.file,out:x.out},x.root,{makeEvidenceAdapter:(root,request,o)=>collectionAdapter(x,o,{pending:true})});const failureFile=path.join(x.out,'failure.json'),failure=C.readJson(failureFile);failure.sessionId='different-session-identifier';fs.writeFileSync(failureFile,JSON.stringify(failure));let calls=0;await assert.rejects(main('evaluation-collection-check',{work:x.out},x.root,{checkCollection:async()=>{calls++;}}),/EXACT_FAILED_COLLECTION_REQUIRED/);assert.equal(calls,0);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));assert(result.leaseRetained);
});
test('inspection respects the workspace lease and private scope before touching the browser',async t=>{const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),lease=C.acquire(x.context,'other-work');let calls=0;await assert.rejects(main('evaluation-inspect',{request:x.file,out:path.join(x.context.stateRoot,'inspection.json')},x.root,{makeAdapter:()=>({inspect:async()=>{calls++;}})}),/BUSY/);assert.equal(calls,0);lease.release();await assert.rejects(main('evaluation-inspect',{request:x.file,out:path.join(x.root,'outside.json')},x.root,{makeAdapter:()=>({inspect:async()=>{calls++;}})}),/PRIVATE_PATH/);assert.equal(calls,0);});
test('save reconciliation cannot read without the original retained lease or while its owner is running',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'save-attempt',specHash:hash(spec)});let reads=0;const deps={makeAdapter:()=>({readServer:async()=>{reads++;throw Error('SHOULD_NOT_READ');}})};
 await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,deps),/LEASE_MISSING/);assert.equal(reads,0);
 const lease=C.acquire(x.context,'evaluation:'+key);await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,deps),/OWNER_STILL_RUNNING/);assert.equal(reads,0);
 const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(child.status,0);const lockFile=path.join(x.root,'state/runtime.lock');for(const file of [lockFile,journal.lock]){const lock=C.readJson(file);lock.pid=child.pid;fs.writeFileSync(file,JSON.stringify(lock));}await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,deps),/SHOULD_NOT_READ/);assert.equal(reads,1);assert(fs.existsSync(lockFile));lease.release();journal.release();
});
test('an unconfirmed reconciliation read records its session and is recoverable without releasing the save lease',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'save-attempt',specHash:hash(spec)});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(child.status,0);for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let session;await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,{makeAdapter:()=>({readServer:async(_spec,options)=>{session=options.readSessionId;throw Object.assign(Error('READ_TIMEOUT_PENDING'),{preserveLease:true,readSessionId:session});}})}),/READ_TIMEOUT_PENDING/);
 assert.equal(journal.read().at(-1).readSessionId,session);let retryReads=0;await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,{makeAdapter:()=>({readServer:async()=>{retryReads++;}})}),/PRIOR_READ_REQUIRES_CHECK/);assert.equal(retryReads,0);const result=await main('evaluation-read-check',{work:dir,'close-read':session},x.root,{makeAdapter:()=>({checkPendingRead:async()=>({ok:true,pending:false,contextMatched:true,found:true})})});assert.equal(result.readClosed,true);assert.equal(result.saveReconciliationRequired,true);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));assert(fs.existsSync(journal.lock));
});
test('reconciliation persists its read identity before the native request and blocks retry after a crash',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'save-attempt',specHash:hash(spec)});C.acquire(x.context,'evaluation:'+key);const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(child.status,0);for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let session;const adapter={readServer:async(_spec,options)=>{session=options?.readSessionId;const last=journal.read().at(-1);assert.equal(last.type,'reconcile-read-started');assert.equal(last.readSessionId,session);throw Error('SIMULATED_PROCESS_INTERRUPTION');}};await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,{makeAdapter:()=>adapter}),/SIMULATED_PROCESS_INTERRUPTION/);assert(session);let calls=0;await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,{makeAdapter:()=>({readServer:async()=>{calls++;}})}),/PRIOR_READ_REQUIRES_CHECK/);assert.equal(calls,0);
 const checked=await main('evaluation-read-check',{work:dir,'close-read':session},x.root,{makeAdapter:()=>({checkPendingRead:async()=>({ok:true,pending:false,contextMatched:true,found:false})})});assert.equal(checked.readClosed,true);assert.equal(checked.leaseRetained,true);assert.equal(checked.saveReconciliationRequired,true);
});
test('a crashed pre-save native read can be recovered from its pre-dispatch journal entry',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'native-read-started',specHash:hash(spec),readSessionId:'pre-dispatch-session'});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 const result=await main('evaluation-read-check',{work:dir,'release-lease':lease.lease.id},x.root,{makeAdapter:()=>({checkPendingRead:async(_spec,id)=>{assert.equal(id,'pre-dispatch-session');return{ok:true,pending:false,contextMatched:true,found:false};}})});assert.equal(result.readClosed,true);assert.equal(result.leaseRetained,false);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('6-2 final source read recovery uses the captured evaluation-list session',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'registration'),dir=path.join(out,'review'),spec={context:x.request.context,period:x.request.period,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const bindings={schemaVersion:1,configHash:x.context.configHash,targets:[{service:'lt',targetId:'LT',role:'20L'}]},evaluationKey='a'.repeat(64);C.writeNewJson(path.join(out,'prepared.json'),{bindings,instruction:{deskOrgId:'DESK'},evaluationKey});
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',evaluationKey,runId:'run-1',bindingHash:hash(bindings)});journal.append({type:'list-read-started',readSessionId:'synthetic-list-session',readKind:'evaluation-list',requestHash:hash(require('./desk-register.cjs').evaluationReadRequest(spec)),bindingHash:hash(bindings)});journal.append({type:'interrupted',specHash:hash(spec),readStateUnconfirmed:true,readSessionId:'synthetic-list-session',readKind:'evaluation-list',code:'READ_TIMEOUT'});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let checks=0;await assert.rejects(main('evaluation-read-check',{work:dir,'release-lease':lease.lease.id},x.root,{makeAdapter:()=>({checkPendingRead:async()=>{checks++;}})}),/EVALUATION_LIST_READ_REQUIRES_DESK_CHECK/);assert.equal(checks,0);
 const blockedClient=()=>({get:async()=>({status:'reviewed',lease:{runId:'different'}})});await assert.rejects(main('evaluation-desk-read-check',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient:blockedClient,checkCollection:async()=>({ok:true,pending:false,contextMatched:true})}),/DESK_ATTEMPT_UNCONFIRMED/);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));
 const deskClient=()=>({get:async()=>({status:'reviewed',lease:null,lastAttempt:{runId:'run-1',saveAttempted:false}})});C.writeNewJson(path.join(out,'backup.json'),{bindings,instruction:{deskOrgId:'DESK'},evaluationKey});fs.writeFileSync(path.join(out,'prepared.json'),JSON.stringify({bindings:{...bindings,targets:[{service:'lt',targetId:'OTHER',role:'20L'}]},instruction:{deskOrgId:'DESK'},evaluationKey}));
 await assert.rejects(main('evaluation-desk-read-check',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient,checkCollection:async()=>({ok:true,pending:false,contextMatched:true})}),/READ_BINDING_CHANGED/);fs.copyFileSync(path.join(out,'backup.json'),path.join(out,'prepared.json'));
 const result=await main('evaluation-desk-read-check',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient,checkCollection:async(_root,request,id,opts)=>{checks++;assert.equal(id,'synthetic-list-session');assert.equal(request.evaluationDate,spec.period.to);assert.equal(opts.evaluationsOnly,true);assert.deepEqual(opts.bindings,bindings);return{ok:true,pending:false,contextMatched:true};}});
 assert.equal(result.leaseRetained,false);assert.equal(checks,2);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('6-2 verified save with a lost desk report is reconciled without another save',async t=>{
 const C=require('../context.cjs'),{hash,comparable}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'registration'),dir=path.join(out,'review'),spec={context:x.request.context,period:x.request.period,evaluationDate:x.request.evaluationDate,operation:'create',evaluationKind:'02',evaluationRound:'1',goals:[],observations:[],summary:{text:'s'}},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const evaluationKey='a'.repeat(64),body={evaluationKey,runId:'run-1',outcome:'verified',evaluationId:'synthetic-id',verifiedAt:'2026-10-28T01:03:00Z',ltWrittenDate:null,evaluationRound:'1'};C.writeNewJson(path.join(out,'prepared.json'),{evaluationKey,actualRound:'1',contentHash:'f'.repeat(64),instruction:{deskOrgId:'DESK'}});
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',evaluationKey,runId:'run-1',deskOrgId:'DESK',bindingHash:hash(null),contentHash:'f'.repeat(64),actualRound:'1'});journal.append({type:'save-attempt',specHash:hash(spec)});journal.append({type:'verified',evaluationId:'synthetic-id',reopened:{mode:'UPDATE',evaluationDateEnabled:false,valuesHash:hash(comparable(spec))}});journal.append({type:'registration-report-started',runId:'run-1',outcome:'verified',body});
 const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let reports=0;const deskClient=()=>({get:async()=>({status:'reviewed',lease:{runId:'run-1'}}),result:async received=>{assert.deepEqual(received,body);reports++;return{status:'registered',registration:{...body}};}});
 const result=await main('evaluation-desk-report',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient});assert.equal(result.status,'verified');assert.equal(result.siteWrites,0);assert.equal(reports,1);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('an unconfirmed 6-2 claim is settled and released without a Long-Term save',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'registration'),dir=path.join(out,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const evaluationKey='a'.repeat(64),contentHash='b'.repeat(64);C.writeNewJson(path.join(out,'prepared.json'),{evaluationKey,contentHash,bindings:null,instruction:{deskOrgId:'DESK'}});
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',evaluationKey,contentHash,runId:'run-1',bindingHash:hash(null)});journal.append({type:'registration-claim-started',evaluationKey,runId:'run-1'});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let reports=0;const client={get:async()=>({status:'reviewed',contentHash,lease:{runId:'run-1'}}),result:async b=>{reports++;assert.equal(b.saveAttempted,false);return{status:'reviewed',lease:null,lastAttempt:{runId:'run-1',saveAttempted:false}};}};
 const result=await main('evaluation-desk-claim-check',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient:()=>client});assert.equal(result.status,'claim-settled');assert.equal(result.siteWrites,0);assert.equal(reports,1);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('a crash before the 6-2 claim was dispatched recovers without any website request',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'registration'),dir=path.join(out,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const evaluationKey='a'.repeat(64),contentHash='b'.repeat(64);C.writeNewJson(path.join(out,'prepared.json'),{evaluationKey,contentHash,bindings:null,instruction:{deskOrgId:'DESK'}});const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',evaluationKey,contentHash,runId:'run-1',bindingHash:hash(null)});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let calls=0;const result=await main('evaluation-desk-claim-check',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient:()=>({get:async()=>{calls++;}})});assert.equal(result.status,'claim-not-dispatched');assert.equal(calls,0);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('independent save reconciliation records the verified reopened evaluation for desk reporting',async t=>{
 const C=require('../context.cjs'),{hash,comparable}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,period:x.request.period,evaluationDate:x.request.evaluationDate,operation:'create',evaluationKind:'02',evaluationRound:'1',goals:[],observations:[],summary:{text:'s'}},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'baseline',specHash:hash(spec),baseline:{status:'complete',records:[]}});journal.append({type:'save-attempt',specHash:hash(spec)});C.acquire(x.context,'evaluation:'+key);const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 const adapter={readServer:async()=>({status:'complete',records:[{evaluationId:'synthetic-id',values:comparable(spec),submitted:false,savedAt:'2026-10-28T01:01:00Z'}]}),reopenSaved:async()=>({mode:'UPDATE',evaluationDateEnabled:false,valuesHash:hash(comparable(spec))})};
 const result=await main('evaluation-reconcile',{work:dir},x.root,{makeAdapter:()=>adapter});assert.equal(result.state,'verified');assert.equal(journal.read().at(-1).type,'verified');assert.equal(journal.read().at(-1).reopened.mode,'UPDATE');
});
test('6-2 reconciliation cannot release its lease before reporting to the desk',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',evaluationKey:'a'.repeat(64),runId:'run-1'});journal.append({type:'save-attempt',specHash:hash(spec)});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let reads=0;await assert.rejects(main('evaluation-reconcile',{work:dir,'release-lease':lease.lease.id},x.root,{makeAdapter:()=>({readServer:async()=>{reads++;}})}),/DESK_REPORT_REQUIRED_BEFORE_RELEASE/);assert.equal(reads,0);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('a 6-2 pending native read cannot release before its desk claim is settled',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'registration'),dir=path.join(out,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));C.writeNewJson(path.join(out,'prepared.json'),{bindings:null});
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',runId:'run-1',bindingHash:hash(null)});journal.append({type:'native-read-started',readSessionId:'native-session-id'});const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let checks=0;await assert.rejects(main('evaluation-read-check',{work:dir,'release-lease':lease.lease.id},x.root,{makeAdapter:()=>({checkPendingRead:async()=>{checks++;return{ok:true,pending:false,contextMatched:true};}})}),/DESK_CLAIM_CHECK_REQUIRED/);assert.equal(checks,0);assert(fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('6-2 save reconciliation uses the exact recorded browser binding',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'reg'),dir=path.join(out,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const bindings={schemaVersion:1,configHash:x.context.configHash,targets:[{service:'lt',targetId:'EXACT',role:'20L'}]};C.writeNewJson(path.join(out,'prepared.json'),{bindings});
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',bindingHash:hash(bindings)});journal.append({type:'save-attempt',specHash:hash(spec)});C.acquire(x.context,'evaluation:'+key);const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 let used=false;await assert.rejects(main('evaluation-reconcile',{work:dir},x.root,{makeAdapter:(_root,opts)=>{assert.deepEqual(opts.bindings,bindings);used=true;return{readServer:async()=>{throw Error('STOP_AFTER_BINDING_CHECK');}};}}),/STOP_AFTER_BINDING_CHECK/);assert.equal(used,true);
});
test('native read recovery releases only a pre-save dead-owner lease and cannot bypass saved-evaluation reconciliation',async t=>{const C=require('../context.cjs'),{hash}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main,releaseReadLocks}=require('./commands.cjs');for(const attempted of [false,true]){const x=collectionFixture(t),dir=path.join(x.context.stateRoot,'review'),spec={context:x.request.context,evaluationDate:x.request.evaluationDate,operation:'create'},key=journalKey(spec),values={spec,schema:{synthetic:true},bundle:{synthetic:true},policy:{synthetic:true},validation:{synthetic:true}};for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();if(attempted)journal.append({type:'save-attempt',specHash:hash(spec)});journal.append({type:'interrupted',readStateUnconfirmed:true,readSessionId:'synthetic-native-read',code:'READ_TIMEOUT_PENDING'});const lease=C.acquire(x.context,'evaluation:'+key),lockFile=path.join(x.root,'state/runtime.lock');let calls=0;const adapters={makeAdapter:()=>({checkPendingRead:async()=>{calls++;return{ok:true,pending:false,contextMatched:true,found:true};}})};
 if(!attempted){await assert.rejects(main('evaluation-read-check',{work:dir,'release-lease':lease.lease.id},x.root,adapters),/OWNER_STILL_RUNNING/);assert.equal(calls,0);}else await assert.rejects(main('evaluation-read-check',{work:dir,'release-lease':lease.lease.id},x.root,adapters),/RECONCILIATION_REQUIRED/);
 const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(child.status,0);for(const file of [lockFile,journal.lock]){const r=C.readJson(file);r.pid=child.pid;fs.writeFileSync(file,JSON.stringify(r));}
 const options=attempted?{work:dir,'close-read':'synthetic-native-read'}:{work:dir,'release-lease':lease.lease.id};
 if(!attempted){
  const unlink=fs.unlinkSync;
  try{
   fs.unlinkSync=function(file){if(file===lockFile)throw Error('SYNTHETIC_INTERRUPTION');return unlink.apply(this,arguments);};
   await assert.rejects(main('evaluation-read-check',options,x.root,adapters),/SYNTHETIC_INTERRUPTION/);
  }finally{fs.unlinkSync=unlink;}
  assert(!fs.existsSync(journal.lock));assert(fs.existsSync(lockFile));
 }
 const readsBefore=calls,result=await main('evaluation-read-check',options,x.root,adapters);
 if(!attempted)assert.equal(calls,readsBefore);
 assert.equal(result.readClosed,true);assert.equal(result.leaseRetained,attempted);assert.equal(result.saveReconciliationRequired,attempted);assert.equal(result.siteWrites,0);assert.equal(journal.read().at(-1).type,attempted?'read-recovered':'read-release-ready');assert.equal(fs.existsSync(lockFile),attempted);assert.equal(fs.existsSync(journal.lock),attempted);if(attempted)assert.throws(()=>releaseReadLocks(x.context,journal,key,lease.lease.id,{readClosed:true,pending:false,contextMatched:true}),/RECONCILIATION_REQUIRED/);
}});

test('collection stops before any lease or directory when the recipient name needed by the RFID name search is missing',async t=>{
 const {main}=require('./commands.cjs'),x=collectionFixture(t),request=JSON.parse(fs.readFileSync(x.file,'utf8'));delete request.recipientName;fs.writeFileSync(x.file,JSON.stringify(request));
 let adapters=0;await assert.rejects(main('evaluation-collect',{request:x.file,out:x.out},x.root,{makeEvidenceAdapter:()=>{adapters++;throw Error('MUST_NOT_START');}}),/RECIPIENT_NAME_REQUIRED/);
 assert.equal(adapters,0);assert(!fs.existsSync(x.out));assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});

test('evaluation-open opens the needed screens in order, then the new input screen, and records a private result without any write',async t=>{
 const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),req=JSON.parse(fs.readFileSync(x.file,'utf8')),file=path.join(C.loadContext(x.root).stateRoot,'open-request.json'),out=path.join(C.loadContext(x.root).stateRoot,'open-result.json');
 fs.writeFileSync(file,JSON.stringify({context:req.context,recipientName:req.recipientName}));const calls=[];
 const adapter={openMenu:async(service,menuId)=>{calls.push(['menu',service,menuId]);return{ok:true,alreadyOpen:false,menuId,writes:0};},openNew:async r=>{calls.push(['new',r.recipientName]);return{ok:true,mode:'INSERT',plan:{planId:req.context.planId},writes:0};}};
 const result=await main('evaluation-open',{request:file,out},x.root,{makeAdapter:()=>adapter});
 assert.equal(result.ok,true);assert.equal(result.serverWrites,0);assert.deepEqual(calls,[['menu','lt','NPS01322100'],['menu','lt','NPS01230000'],['new',req.recipientName]]);
 assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).steps.length,3);assert(!fs.existsSync(path.join(x.root,'state/runtime.lock')));
});
test('evaluation-open stops before the new input screen when a needed screen cannot be opened and never overwrites its result file',async t=>{
 const C=require('../context.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),req=JSON.parse(fs.readFileSync(x.file,'utf8')),state=C.loadContext(x.root).stateRoot,file=path.join(state,'open-request.json'),out=path.join(state,'open-result.json');
 fs.writeFileSync(file,JSON.stringify({context:req.context,recipientName:req.recipientName,workerNotesMode:'live'}));let created=0;
 const adapter={openMenu:async(service,menuId)=>menuId==='np00000000097'?{ok:false,code:'OPEN_MENU_NOT_READY'}:{ok:true,menuId},openNew:async()=>{created++;return{ok:true};}};
 const result=await main('evaluation-open',{request:file,out},x.root,{makeAdapter:()=>adapter});assert.equal(result.ok,false);assert.equal(result.code,'OPEN_MENU_NOT_READY');assert.equal(created,0);assert.equal(result.serverWrites,0);
 await assert.rejects(main('evaluation-open',{request:file,out},x.root,{makeAdapter:()=>adapter}),/NEW_OPEN_RESULT_FILE_REQUIRED/);
 await assert.rejects(main('evaluation-open',{request:file,out:path.join(os.tmpdir(),'outside.json')},x.root,{makeAdapter:()=>adapter}),/CURRENT_ORGANIZATION_PRIVATE_PATH_REQUIRED/);
});


// ---- 6번 Task 4: 롱텀 저장 검증 뒤 업무데스크 보고 복구(합성). 롱텀에는 다시 쓰지 않는다. ----
function verifiedReportFixture(t,{started}){
 const C=require('../context.cjs'),{hash,comparable}=require('./core.cjs'),{journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),{main}=require('./commands.cjs'),x=collectionFixture(t),out=path.join(x.context.stateRoot,'registration'),dir=path.join(out,'review'),spec={context:x.request.context,period:x.request.period,evaluationDate:x.request.evaluationDate,operation:'create',evaluationKind:'02',evaluationRound:'1',goals:[],observations:[],summary:{text:'s'}},key=journalKey(spec),values={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(values))C.writeNewJson(path.join(dir,name+'.json'),value);C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(values[name])])));
 const evaluationKey='a'.repeat(64),body={evaluationKey,runId:'run-1',outcome:'verified',evaluationId:'synthetic-id',verifiedAt:'2026-10-28T01:03:00Z',ltWrittenDate:null,evaluationRound:'1'};C.writeNewJson(path.join(out,'prepared.json'),{evaluationKey,actualRound:'1',contentHash:'f'.repeat(64),instruction:{deskOrgId:'DESK'}});
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key);journal.acquire();journal.append({type:'registration-intent',evaluationKey,runId:'run-1',deskOrgId:'DESK',bindingHash:hash(null),contentHash:'f'.repeat(64),actualRound:'1'});journal.append({type:'save-attempt',specHash:hash(spec)});journal.append({type:'verified',evaluationId:'synthetic-id',reopened:{mode:'UPDATE',evaluationDateEnabled:false,valuesHash:hash(comparable(spec))}});if(started)journal.append({type:'registration-report-started',runId:'run-1',outcome:'verified',body});
 const lease=C.acquire(x.context,'evaluation:'+key),child=spawnSync(process.execPath,['-e',''],{windowsHide:true});for(const file of [path.join(x.root,'state/runtime.lock'),journal.lock]){const data=C.readJson(file);data.pid=child.pid;fs.writeFileSync(file,JSON.stringify(data));}
 const report=deskClient=>main('evaluation-desk-report',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient});
 return{x,body,journal,report,prepared:path.join(out,'prepared.json'),runtimeLock:path.join(x.root,'state/runtime.lock')};
}
test('6번 롱텀 저장 검증 뒤 보고를 보내기 전에 멈춘 건은 같은 실행의 보고만 한 번 보낸다',async t=>{
 const f=verifiedReportFixture(t,{started:false});let reports=0,received=null;
 const result=await f.report(()=>({get:async()=>({status:'reviewed',lease:{runId:'run-1'}}),result:async b=>{reports++;received=b;return{status:'registered',registration:{...b}};}}));
 assert.equal(result.status,'verified');assert.equal(result.siteWrites,0);assert.equal(result.deskWrites,1);assert.equal(reports,1);
 assert.deepEqual([received.runId,received.outcome,received.evaluationId,received.evaluationRound],['run-1','verified','synthetic-id','1']);assert(!fs.existsSync(f.runtimeLock));
});
test('6번 보고를 보내기 전에 멈췄는데 업무데스크가 이미 등록완료면 충돌로 남기고 점유를 풀지 않는다',async t=>{
 const f=verifiedReportFixture(t,{started:false});let writes=0;
 await assert.rejects(f.report(()=>({get:async()=>({status:'registered',registration:{...f.body}}),result:async()=>{writes++;}})),/DESK_REPORT_CONFLICT/);
 assert.equal(writes,0);assert(fs.existsSync(f.runtimeLock));assert(fs.existsSync(f.journal.lock));
});
test('6번 업무데스크에 등록완료가 반영되고 응답만 유실되면 다시 보내지 않고 확인만 한다',async t=>{
 const f=verifiedReportFixture(t,{started:true});let writes=0;
 const result=await f.report(()=>({get:async()=>({status:'registered',registration:{...f.body}}),result:async()=>{writes++;}}));
 assert.equal(result.status,'verified');assert.equal(result.deskWrites,0);assert.equal(writes,0);assert.equal(result.siteWrites,0);assert(!fs.existsSync(f.runtimeLock));
});
test('6번 업무데스크 등록 내용이 이 실행의 보고와 다르면 확인 필요로 남기고 덮어쓰지 않는다',async t=>{
 for(const change of [{evaluationId:'other-id'},{runId:'run-2'},{evaluationRound:'2'},{verifiedAt:'2026-10-28T09:00:00Z'}]){
  const f=verifiedReportFixture(t,{started:true});let writes=0;
  await assert.rejects(f.report(()=>({get:async()=>({status:'registered',registration:{...f.body,...change}}),result:async()=>{writes++;}})),/DESK_REPORT_CONFLICT/,JSON.stringify(change));
  assert.equal(writes,0);assert(fs.existsSync(f.runtimeLock));
 }
});


test('6-2 recovery persists the report before the first send and verifies a lost response without sending twice',async t=>{
 const f=verifiedReportFixture(t,{started:false});let reports=0,registration;
 const client=()=>({
  get:async()=>registration?{status:'registered',registration}:{status:'reviewed',lease:{runId:'run-1'}},
  result:async body=>{reports++;registration=body;throw Error('SYNTHETIC_LOST_REPORT_RESPONSE');}
 });
 await assert.rejects(f.report(client),/SYNTHETIC_LOST_REPORT_RESPONSE/);
 assert.deepEqual(f.journal.read().findLast(e=>e.type==='registration-report-started')?.body,registration);
 assert(fs.existsSync(f.runtimeLock));
 const recovered=await f.report(client);
 assert.equal(recovered.status,'verified');assert.equal(recovered.deskWrites,0);assert.equal(reports,1);
 assert(!fs.existsSync(f.runtimeLock));
});


test('6-2 rejects altered prepared scope before the reporting client is opened',async t=>{
 const f=verifiedReportFixture(t,{started:false}),original=JSON.parse(fs.readFileSync(f.prepared,'utf8'));
 for(const patch of [{actualRound:'2'},{contentHash:'a'.repeat(64)},{instruction:{deskOrgId:'OTHER'}},{bindings:{targets:[]}}]){
  fs.writeFileSync(f.prepared,JSON.stringify({...original,...patch}));
  await assert.rejects(f.report(()=>assert.fail('report client opened')),/REGISTRATION_RECOVERY_SCOPE_CHANGED/);
  assert(fs.existsSync(f.runtimeLock));assert(fs.existsSync(f.journal.lock));
 }
});

test('6-2 releases the remaining workspace after a confirmed report and interrupted unlock',async t=>{
 const f=verifiedReportFixture(t,{started:true}),client=()=>({get:async()=>({status:'registered',registration:{...f.body}}),result:async()=>assert.fail('report must not write')});
 const unlink=fs.unlinkSync;
 try{
  fs.unlinkSync=function(file){if(file===f.runtimeLock)throw Error('SYNTHETIC_INTERRUPTION');return unlink.apply(this,arguments);};
  await assert.rejects(f.report(client),/SYNTHETIC_INTERRUPTION/);
 }finally{fs.unlinkSync=unlink;}
 assert(!fs.existsSync(f.journal.lock));assert(fs.existsSync(f.runtimeLock));
 const result=await f.report(()=>assert.fail('confirmed report needs only local unlock'));
 assert.equal(result.status,'verified');assert.equal(result.deskWrites,0);assert(!fs.existsSync(f.runtimeLock));
});


test('6-2 report cannot attach an earlier verified save to a later registration claim',async t=>{
 const f=verifiedReportFixture(t,{started:false}),C=require('../context.cjs'),{openJournal}=require('./journal.cjs');
 const history=f.journal.read(),first=history.find(e=>e.type==='registration-intent');
 const next=openJournal(path.dirname(f.journal.file),path.basename(f.journal.file,'.jsonl'));
 next.adoptDeadLease(C.readJson(f.journal.lock).id);
 const {index,at,digest,previous,...intent}=first;
 next.append({...intent,runId:'next-run',leaseId:C.readJson(f.runtimeLock).id});
 await assert.rejects(f.report(()=>assert.fail('earlier save cannot be reported')),{message:'VERIFIED_SAVE_REQUIRED'});
 assert(fs.existsSync(f.runtimeLock));assert(fs.existsSync(f.journal.lock));
});

test('6-2 pre-save report completion can finish a single interrupted local unlock',async t=>{
 const C=require('../context.cjs'),{hash}=require('./core.cjs'),{main}=require('./commands.cjs');
 const {journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),x=collectionFixture(t);
 const out=path.join(x.context.stateRoot,'no-save-registration'),dir=path.join(out,'review');
 const spec={context:x.request.context,evaluationDate:x.request.evaluationDate},key=journalKey(spec);
 const inputs={spec,schema:{},bundle:{},policy:{},validation:{}};
 for(const[name,value]of Object.entries(inputs))C.writeNewJson(path.join(dir,name+'.json'),value);
 C.writeNewJson(path.join(dir,'review.json'),Object.fromEntries(['spec','schema','bundle','policy'].map(name=>[name+'Hash',hash(inputs[name])])));
 const lease=C.acquire(x.context,'evaluation:'+key),runtimeLock=path.join(x.root,'state/runtime.lock');
 const journal=openJournal(C.statePath(x.context,'longterm-result-evaluation','journal'),key),evaluationKey='f'.repeat(64),contentHash='c'.repeat(64);
 C.writeNewJson(path.join(out,'prepared.json'),{evaluationKey,contentHash});
 journal.acquire();
 journal.append({type:'registration-intent',evaluationKey,contentHash,bindingHash:hash(null),runId:'test-no-save',leaseId:lease.lease.id});
 journal.append({type:'registration-report-confirmed',runId:'test-no-save',outcome:'not-verified'});
 journal.release();
 const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});
 fs.writeFileSync(runtimeLock,JSON.stringify({...lease.lease,pid:child.pid}));
 const result=await main('evaluation-desk-claim-check',{work:dir,'release-lease':lease.lease.id},x.root,{deskClient:()=>assert.fail('local cleanup only')});
 assert.deepEqual([result.ok,result.siteWrites,result.deskWrites,result.leaseRetained],[true,0,0,false]);
 assert.equal(fs.existsSync(runtimeLock),false);
});
