'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {samePlanEvaluations,chooseReviewed,nextRound,verifyReviewedSource,materializeReviewed,runRegistration,readCurrentEvaluations,assertPlanJournalClear,loadPlanHistories,validateReviewedDate,prepareRegistration,evaluationReadRequest,verifyPreSave,guardSave,makeRunOperations,validateRegistrationInstruction,journaledCurrentRead}=require('./desk-register.cjs');
const {hash,canonical}=require('./core.cjs'),crypto=require('node:crypto'),{deskContentHash,deskKeys}=require('./desk-bridge.cjs');
test('6-2 filters other plans before the existing round validator sees evaluations',()=>{
 const source=[{content:{basic:{POF_PLNPP_MGMT_NO:'PLAN-A',POF_VLT_CHASU:'1'}}},{content:{basic:{POF_PLNPP_MGMT_NO:'PLAN-B',POF_VLT_CHASU:'9'}}}];
 assert.deepEqual(samePlanEvaluations(source,'PLAN-A'),[source[0]]);assert.equal(source.length,2);
});
test('review date must be real, within the service period, and not in the future',()=>{
 const data={operation:'create',evaluationDate:'2026-11-09',servicePeriod:{from:'2026-09-17',to:'2027-09-16'}};
 assert.equal(validateReviewedDate(data,'2026-11-09'),true);
 for(const day of ['2026-11-10','2026-02-30','2026-01-01'])assert.throws(()=>validateReviewedDate({...data,evaluationDate:day},'2026-11-09'),/DESK_EVALUATION_DATE_INVALID/);
});
test('a current-list request covers the whole service period without altering the original spec',()=>{
 const spec={context:{orgId:'o'},period:{from:'2026-09-17',to:'2027-09-16'},evaluationDate:'2026-11-09'};
 const request=evaluationReadRequest(spec);assert.equal(request.evaluationDate,'2027-09-16');assert.deepEqual(request.period,spec.period);assert.equal(spec.evaluationDate,'2026-11-09');
});
test('pre-save check rejects changed review or changed current evaluation list',()=>{
 const approved={evaluationKey:'a'.repeat(64),version:2,status:'reviewed',subjectKey:'s',planKey:'p',servicePeriod:{from:'2026-01-01',to:'2026-12-31'},evaluationDate:'2026-11-01',evaluationKind:'02',goals:[],observations:[],summary:{text:'s'},overallComment:{text:'o'},evidence:[{id:'proof'}]};approved.contentHash=deskContentHash(approved);approved.review={contentHash:approved.contentHash};const latest={...approved,version:3,lease:{runId:'run-1'}};
 const read={status:'empty',query:{period:'synthetic'},historyRange:{from:'2000-01-01',to:'2099-12-31'},records:[]};
 assert.equal(verifyPreSave({approved,latest,runId:'run-1',expectedRead:read,currentRead:structuredClone(read)}),true);
 assert.throws(()=>verifyPreSave({approved,latest:{...latest,lease:null},runId:'run-1',expectedRead:read,currentRead:read}),/DESK_REVIEW_CHANGED/);
 assert.throws(()=>verifyPreSave({approved,latest:{...latest,summary:{text:'changed'}},runId:'run-1',expectedRead:read,currentRead:read}),/DESK_REVIEW_CHANGED/);
 assert.throws(()=>verifyPreSave({approved,latest:{...latest,evidence:[]},runId:'run-1',expectedRead:read,currentRead:read}),/DESK_REVIEW_CHANGED/);
 assert.throws(()=>verifyPreSave({approved,latest,runId:'run-1',expectedRead:read,currentRead:{...read,status:'complete',records:[{id:'new'}]}}),/CURRENT_EVALUATIONS_CHANGED/);
 assert.throws(()=>verifyPreSave({approved,latest,runId:'run-1',expectedRead:read,currentRead:{...read,historyRange:{from:'2020-01-01',to:'2029-12-31'}}}),/CURRENT_EVALUATIONS_CHANGED/);
});
test('the final source check runs after draft ownership and before a save can occur',async()=>{
 const events=[],adapter={assertOwnedDraft:async()=>events.push('draft'),clickSaveOnce:async()=>events.push('save')},safe=guardSave(adapter,async()=>{events.push('check');throw Error('CHANGED');});
 await assert.rejects(safe.assertOwnedDraft({},{}),/CHANGED/);assert.deepEqual(events,['draft','check']);
 await assert.rejects(safe.clickSaveOnce({},{}),/PRE_SAVE_CHECK_REQUIRED/);assert.deepEqual(events,['draft','check']);
});
test('real-run dependencies require matching review, exact original bundle and fresh list immediately before save',async()=>{
 const approved={evaluationKey:'a'.repeat(64),version:2,status:'reviewed',subjectKey:'s',planKey:'p',servicePeriod:{from:'2026-01-01',to:'2026-12-31'},evaluationDate:'2026-11-01',evaluationKind:'02',goals:[],observations:[],summary:{text:'s'},overallComment:{text:'o'}};approved.contentHash=deskContentHash(approved);approved.review={contentHash:approved.contentHash};
 const latest={...approved,version:3,lease:{runId:'run-1'}},current={status:'empty',query:{period:'synthetic'},records:[]},events=[];
 const ops=makeRunOperations({approved,runId:'run-1',actualRound:'1',expectedRead:current,acquire:async()=>({release:()=>{}}),assertNoPending:async()=>{},recordIntent:async()=>{},client:{claim:async()=>{},get:async()=>latest,result:async()=>{}},readCurrent:async()=>current,verifyOriginal:async()=>events.push('original'),runner:async()=>({state:'blocked'}),adapter:{assertOwnedDraft:async()=>events.push('draft'),clickSaveOnce:async()=>events.push('save')}});
 await ops.recheck();assert.deepEqual(events,['original']);await ops.adapter.assertOwnedDraft();await ops.adapter.clickSaveOnce();assert.deepEqual(events,['original','draft','original','save']);
});
test('save instruction is bound to the reviewed record, document, round and original evidence',()=>{
 const prepared={evaluationKey:'a'.repeat(64),contentHash:'b'.repeat(64),actualRound:'2',originalBundleHash:'c'.repeat(64),documentSha256:'d'.repeat(64)},instruction={action:'evaluation-desk-register',message:'가상 6-2',saveAllowed:true,organizationId:'ORG',deskOrgId:'DESK',...prepared};
 assert.equal(validateRegistrationInstruction({prepared,instruction,organizationId:'ORG',deskOrgId:'DESK',documentSha256:prepared.documentSha256}),true);
 assert.throws(()=>validateRegistrationInstruction({prepared,instruction:{...instruction,actualRound:'1'},organizationId:'ORG',deskOrgId:'DESK',documentSha256:prepared.documentSha256}),/REGISTRATION_INSTRUCTION_MISMATCH/);
 assert.throws(()=>validateRegistrationInstruction({prepared,instruction,organizationId:'ORG',deskOrgId:'DESK',documentSha256:'e'.repeat(64)}),/REGISTRATION_DOCUMENT_CHANGED/);
});
test('current evaluation list is read-only and closes its precise captured screen',async()=>{
 const events=[],snapshot={sessionId:'s'},adapter={captureScreen:async()=>{events.push('capture');return snapshot;},readEvaluations:async()=>{events.push('read');return{status:'empty',records:[]};},assertScreenUnchanged:async s=>{assert.equal(s,snapshot);events.push('close');}};
 assert.equal((await readCurrentEvaluations(adapter)).status,'empty');assert.deepEqual(events,['capture','read','close']);
 events.length=0;adapter.readEvaluations=async()=>{events.push('read');throw Object.assign(Error('TIMEOUT'),{preserveLease:true});};
 await assert.rejects(readCurrentEvaluations(adapter),e=>e.preserveLease===true);assert.deepEqual(events,['capture','read','close']);
});
test('the exact evaluation-list session is journaled before browser capture',async()=>{
 const events=[],adapter={sessionId:'synthetic-session-id',captureScreen:async()=>{events.push('capture');return{};},readEvaluations:async()=>({status:'empty',records:[]}),assertScreenUnchanged:async()=>{},readStateConfirmed:()=>true},journal={append:e=>events.push(e.type)};
 const result=await journaledCurrentRead({adapter,journal,requestHash:'a'.repeat(64),bindingHash:'b'.repeat(64)});assert.equal(result.status,'empty');assert.deepEqual(events,['list-read-started','capture','list-read-completed']);
});
test('registration reports verified only after independent save verification and never retries unknown writes',async()=>{
 const events=[],record={evaluationKey:'a'.repeat(64),version:3,contentHash:'b'.repeat(64),status:'reviewed'},runId='run-01';
 const ops={acquire:async()=>({release:()=>events.push('release')}),assertNoPending:async()=>{},recordIntent:async()=>{},claim:async()=>events.push('claim'),recheck:async()=>events.push('recheck'),run:async()=>{events.push('save');return{state:'verified',evaluationId:'synthetic',verifiedAt:'2026-11-01T00:00:00Z'};},report:async r=>events.push(r.outcome)};
 const result=await runRegistration({record,runId,actualRound:'1',ops});assert.equal(result.state,'verified');assert.deepEqual(events,['claim','recheck','save','verified','release']);
 events.length=0;ops.run=async()=>{events.push('save');return{state:'unknown',reconcileRequired:true};};
 const unknown=await runRegistration({record,runId,actualRound:'1',ops});assert.equal(unknown.state,'unknown');assert.deepEqual(events,['claim','recheck','save','not-verified']);
 events.length=0;ops.recheck=async()=>{events.push('recheck');throw Error('REVIEW_CHANGED');};
 const stopped=await runRegistration({record,runId,actualRound:'1',ops});assert.equal(stopped.state,'blocked');assert.deepEqual(events,['claim','recheck','not-verified','release']);
});
test('an unresolved previous save blocks before desk claim or site write',async()=>{
 const calls=[],record={evaluationKey:'a'.repeat(64),version:1,contentHash:'b'.repeat(64),status:'reviewed'};
 const ops={acquire:async()=>({release:()=>calls.push('release')}),assertNoPending:async()=>{throw Error('PRIOR_SAVE_ATTEMPT_RECONCILE_ONLY');},recordIntent:async()=>{},claim:async()=>calls.push('claim'),recheck:async()=>{},run:async()=>calls.push('save'),report:async()=>{}};
 const result=await runRegistration({record,runId:'run-03',actualRound:'1',ops});assert.equal(result.state,'blocked');assert.deepEqual(calls,['release']);
});
test('the registration intent is durable before the claim request',async()=>{
 const events=[],record={evaluationKey:'a'.repeat(64),version:1,contentHash:'b'.repeat(64),status:'reviewed'};
 const ops={acquire:async()=>({release:()=>events.push('release')}),assertNoPending:async()=>{},recordIntent:async()=>{events.push('intent');throw Error('DISK_FULL');},claim:async()=>events.push('claim'),recheck:async()=>{},run:async()=>{},report:async()=>{}};
 await runRegistration({record,runId:'run-04',actualRound:'1',ops});assert.deepEqual(events,['intent','release']);
});
test('plan journal guard rejects unresolved saves across evaluation dates and unrelated unknown histories',()=>{
 const context={orgId:'o',workerId:'w',workerName:'n',recipientId:'r',recognitionNo:'x',recognitionSeq:'1',planId:'p',serviceCode:'001'},period={from:'2026-10-01',to:'2027-09-30'};
 const target={context,period,evaluationDate:'2026-11-09',operation:'create'},old={...target,evaluationDate:'2026-10-01'};
 const pending={spec:old,history:[{type:'save-attempt',specHash:hash(old)}]};
 assert.throws(()=>assertPlanJournalClear(target,[pending]),/PRIOR_SAVE_ATTEMPT_RECONCILE_ONLY/);
 assert.doesNotThrow(()=>assertPlanJournalClear(target,[{...pending,history:[...pending.history,{type:'verified'}]}]));
 const other={...old,context:{...context,planId:'other'}};assert.doesNotThrow(()=>assertPlanJournalClear(target,[{spec:other,history:[{type:'save-attempt',specHash:hash(other)}]}]));
 assert.throws(()=>assertPlanJournalClear(target,[{spec:null,history:pending.history}]),/JOURNAL_SCOPE_UNCONFIRMED/);
});
test('plan journal scan resolves only integrity-checked histories to their exact saved spec',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{openJournal}=require('./journal.cjs'),{journalKey}=require('./runner.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-reg-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const spec={context:{orgId:'o',workerId:'w',workerName:'n',recipientId:'r',recognitionNo:'x',recognitionSeq:'1',planId:'p',serviceCode:'001'},period:{from:'2026-10-01',to:'2027-09-30'},evaluationDate:'2026-11-01',evaluationId:null};
 const work=path.join(root,'work'),journalRoot=path.join(root,'journals');fs.mkdirSync(work);fs.writeFileSync(path.join(work,'spec.json'),JSON.stringify(spec));
 const journal=openJournal(journalRoot,journalKey(spec));journal.acquire();journal.append({type:'save-attempt',specHash:hash(spec)});journal.release();
 assert.throws(()=>assertPlanJournalClear(spec,loadPlanHistories(root,journalRoot)),/PRIOR_SAVE_ATTEMPT_RECONCILE_ONLY/);
 fs.appendFileSync(journal.file,'bad\n');assert.throws(()=>loadPlanHistories(root,journalRoot));
});
test('an unconfirmed pre-save read retains the lock but never claims a save click',async()=>{
 const reports=[],events=[],record={evaluationKey:'a'.repeat(64),version:1,contentHash:'b'.repeat(64),status:'reviewed'};
 const ops={acquire:async()=>({release:()=>events.push('release')}),assertNoPending:async()=>{},recordIntent:async()=>{},claim:async()=>{},recheck:async()=>{},run:async()=>({state:'blocked-read-unconfirmed',reconcileRequired:true,saveClicks:0}),report:async r=>reports.push(r)};
 const result=await runRegistration({record,runId:'run-02',actualRound:'1',ops});assert.equal(result.state,'unknown');assert.equal(reports[0].saveAttempted,false);assert.deepEqual(events,[]);
});
test('a pending pre-save source callback retains the lease and does not report a save',async()=>{
 const reports=[],events=[],record={evaluationKey:'a'.repeat(64),version:1,contentHash:'b'.repeat(64),status:'reviewed'};
 const ops={acquire:async()=>({release:()=>events.push('release')}),assertNoPending:async()=>{},recordIntent:async()=>{},claim:async()=>{},recheck:async()=>{throw Object.assign(Error('READ_TIMEOUT'),{preserveLease:true});},run:async()=>events.push('save'),report:async r=>reports.push(r)};
 const result=await runRegistration({record,runId:'run-02',actualRound:'1',ops});assert.equal(result.state,'unknown');assert.equal(reports[0].saveAttempted,false);assert.deepEqual(events,[]);
});
test('reviewed changes use only matching, hashed human confirmations and preserve original evidence',()=>{
 const context={orgId:'o'},period={from:'2026-10-01',to:'2026-12-01'},evidenceObservedTo='2026-10-31';
 const original={schemaVersion:1,context,period,reads:{visits:{records:[{id:'visit:one'}]}}};
 const content={field:'goal:세면',text:'수정한 내용',by:'u',at:'2026-11-01T00:00:00Z',reviewContentHash:'a'.repeat(64)},confirmed={id:'user-confirmed:one',kind:'user-confirmed',content,contentHash:hash(content)};
 const data={evaluationDate:'2026-11-01',evidenceObservedTo,contentHash:'a'.repeat(64),review:{at:'2026-11-01T00:00:00Z'},goals:[{key:'세면',provided:true,text:content.text,evidenceState:'verified',evidenceIds:['visit:one',confirmed.id]}],observations:[],summary:{text:'',evidenceState:'unverified',evidenceIds:[]},overallComment:{text:'',evidenceState:'unverified',evidenceIds:[]},evidence:[confirmed]};
 const spec={context,period,evaluationDate:'2026-10-31',goals:[{key:'세면'}],observations:[]};
 const result=materializeReviewed({data,spec,bundle:original,actualRound:'2'});
 assert.equal(result.spec.goals[0].text,content.text);assert.equal(result.spec.evaluationRound,'2');assert.equal(result.spec.evidenceObservedTo,evidenceObservedTo);
 assert.equal(result.bundle.reads.userConfirmations.records[0].contentHash,hash(content));assert.equal(original.reads.userConfirmations,undefined);
 const bad=structuredClone(data);bad.evidence[0].content.text='변조';assert.throws(()=>materializeReviewed({data:bad,spec,bundle:original,actualRound:'2'}),/USER_CONFIRMATION_MISMATCH/);
});
test('fresh evaluation status is explicitly bound to the generated execution spec',()=>{
 const spec={context:{orgId:'o'},period:{from:'2026-10-01',to:'2026-12-01'},goals:[],observations:[]},bundle={reads:{}},fresh={status:'empty',records:[]};
 const data={evaluationDate:'2026-11-01',evidenceObservedTo:'2026-10-31',review:{at:'2026-11-01T00:00:00Z'},goals:[],observations:[],summary:{text:'',evidenceIds:[]},overallComment:{text:'',evidenceIds:[]},evidence:[]};
 const result=materializeReviewed({data,spec,bundle,actualRound:'1',freshEvaluations:fresh});assert.equal(result.spec.requireFreshEvaluations,true);assert.deepEqual(result.bundle.currentEvaluations,fresh);
});
test('6-2 stops if a plan number cannot be verified',()=>{
 assert.throws(()=>samePlanEvaluations([{content:{basic:{}}}],'PLAN-A'),/EVALUATION_PLAN_UNCONFIRMED/);
 assert.throws(()=>samePlanEvaluations(null,'PLAN-A'),/EVALUATION_LIST_UNCONFIRMED/);
});
test('6-2 asks for a choice if several reviewed records remain',()=>{
 const rows=[{evaluationKey:'a',status:'reviewed'},{evaluationKey:'b',status:'reviewed'},{evaluationKey:'c',status:'registered'},{evaluationKey:'d',status:'draft'}];
 assert.deepEqual(chooseReviewed(rows),{status:'selection-required',candidates:[rows[0],rows[1]]});
 assert.equal(chooseReviewed(rows,'b').record,rows[1]);assert.throws(()=>chooseReviewed(rows,'c'),/REVIEWED_SELECTION_REQUIRED/);
 assert.equal(chooseReviewed([rows[0],rows[2]]).record,rows[0]);assert.equal(chooseReviewed([rows[2]]).status,'none');
});
test('preparation asks for selection before touching work or the live source',async()=>{
 let reads=0;const records=[{evaluationKey:'a',status:'reviewed'},{evaluationKey:'b',status:'reviewed'}];
 const result=await prepareRegistration({records,readCurrent:async()=>{reads++;}});assert.equal(result.state,'selection-required');assert.equal(reads,0);
});
test('actual round uses only the selected plan and asks for confirmation when it changes',()=>{
 const entries=[{content:{basic:{POF_PLNPP_MGMT_NO:'A',POF_VLT_CHASU:'3'}}},{content:{basic:{POF_PLNPP_MGMT_NO:'B',POF_VLT_CHASU:'9'}}}];
 assert.deepEqual(nextRound(entries,'A','2'),{evaluationRound:'4',confirmationRequired:true});
 assert.deepEqual(nextRound(entries,'A','4'),{evaluationRound:'4',confirmationRequired:false});
 assert.throws(()=>nextRound([{content:{basic:{POF_PLNPP_MGMT_NO:'A',POF_VLT_CHASU:'x'}}}],'A','1'),/EVALUATION_ROUND_UNCONFIRMED/);
});
test('reviewed record is bound to original work, verified content and identity before any write',()=>{
 const secret='e'.repeat(64),context={orgId:'synthetic-org',recipientId:'synthetic-recipient',planId:'synthetic-plan'},period={from:'2026-10-01',to:'2026-12-01'};
 const spec={context,period,operation:'create'},schema={fingerprint:'x'},bundle={source:'synthetic'},policy={adopted:true};
 const localWorkKey=crypto.createHash('sha256').update(canonical(['evaluation-work',hash(spec),hash(bundle),hash(schema),hash(policy)])).digest('hex');
 const data={...deskKeys(secret,context),status:'reviewed',operation:'create',servicePeriod:period,evaluationDate:'2026-11-01',evaluationKind:'02',goals:[],observations:[],summary:{text:'s'},overallComment:{text:'o'},localWorkKey,bundleHash:hash(bundle),schemaFingerprint:'x'};
 data.contentHash=deskContentHash(data);data.review={contentHash:data.contentHash};
 assert.equal(verifyReviewedSource({data,spec,schema,bundle,policy,secret}),true);
 assert.throws(()=>verifyReviewedSource({data:{...data,summary:{text:'changed'}},spec,schema,bundle,policy,secret}),/DESK_REVIEW_HASH_MISMATCH/);
 assert.throws(()=>verifyReviewedSource({data,spec,schema,bundle:{changed:true},policy,secret}),/DESK_LOCAL_WORK_MISMATCH|DESK_BUNDLE_MISMATCH/);
 assert.throws(()=>verifyReviewedSource({data,spec,schema,bundle,policy,secret:'a'.repeat(64)}),/DESK_IDENTITY_MISMATCH/);
 assert.throws(()=>verifyReviewedSource({data:{...data,status:'draft'},spec,schema,bundle,policy,secret}),/NOT_REVIEWED/);
 assert.throws(()=>verifyReviewedSource({data:{...data,schemaFingerprint:'wrong'},spec,schema,bundle,policy,secret}),/DESK_SCHEMA_MISMATCH/);
});

test('6번 내용이 같아도 검토완료 뒤 버전이 이 실행의 점유 외로 바뀌었으면 저장 전에 멈춘다',()=>{
 const approved={evaluationKey:'a'.repeat(64),version:2,status:'reviewed',subjectKey:'s',planKey:'p',servicePeriod:{from:'2026-01-01',to:'2026-12-31'},evaluationDate:'2026-11-01',evaluationKind:'02',goals:[],observations:[],summary:{text:'s'},overallComment:{text:'o'},evidence:[{id:'proof'}]};approved.contentHash=deskContentHash(approved);approved.review={contentHash:approved.contentHash};
 const read={status:'empty',query:{period:'synthetic'},historyRange:{from:'2000-01-01',to:'2099-12-31'},records:[]},check=latest=>verifyPreSave({approved,latest,runId:'run-1',expectedRead:read,currentRead:structuredClone(read)});
 assert.equal(check({...approved,version:3,lease:{runId:'run-1'}}),true);
 // 같은 내용으로 다시 검토완료(또는 검토취소 후 재검토)되어 버전이 더 올라간 경우, 점유가 반영되지 않은 경우, 다른 실행의 점유
 for(const latest of [{...approved,version:4,lease:{runId:'run-1'}},{...approved,version:2,lease:{runId:'run-1'}},{...approved,version:3,lease:{runId:'run-2'}}])assert.throws(()=>check(latest),/DESK_REVIEW_CHANGED/);
});
