'use strict';
// Evaluation form v2: evaluation round, separate overall comment (총평) and comprehensive opinion (X9900),
// and reason inputs of the future-plan choices. Synthetic data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {hash,validateSpec,comparable}=require('./core.cjs'),{evaluationPage}=require('./native-page.cjs'),{prepare}=require('./prepare.cjs');
const AREAS=['X111','X221','X222','X223','X331','X332','X441','X551','X661'];
const stateKeys=[...AREAS.flatMap(a=>[a+'1',a+'2',a+'3',a+'4']),'Z1101','Z1102','Z1103','Z1201','Z1202','Z1203','Z1204','Z1205','Z1206','Z1207','Z1209'].sort();
function specFixture({existing=[]}={}){
 const context={orgId:'SYNTHETIC-ORG',workerId:'SYNTHETIC-WORKER',workerName:'가상작성자',recipientId:'SYNTHETIC-RECIPIENT',recognitionNo:'SYNTHETIC-RECOGNITION',recognitionSeq:'001',planId:'SYNTHETIC-PLAN',serviceCode:'001'},period={from:'2026-10-01',to:'2026-10-28'};
 const structure={nativeVersion:'npsb800-20l-v2',goalKeys:['세면'],stateKeys,goalTextMax:200,summaryMax:500,overallMax:2000,stateTextMax:Object.fromEntries(stateKeys.map(k=>[k,k==='Z1201'||k==='Z1209'?20:500])),reasonKeys:['Z1201','Z1209'],roundControl:'edt_pofVltChasu'};
 const schema={schemaVersion:1,formId:'NPS01230000',structure,fingerprint:hash(structure),labelsReviewedFrom:hash(structure),reviewLabels:Object.fromEntries(stateKeys.map(k=>[k,'라벨 '+k]))};
 const entry=(id,kind,content,extra={})=>({id,kind,content,contentHash:hash(content),context,...extra}),read=records=>({status:records.length?'complete':'empty',records,collectedAt:'2026-10-28T01:00:00Z',query:{context,period},coverage:[{month:'202610',status:records.length?'complete':'empty'}]});
 const bundle={schemaVersion:1,context,period,reads:{plans:read([entry('plan','plan','가상 계획',{planId:context.planId,from:period.from,to:'2027-09-30'})]),visits:read([entry('visit','visit','세면 도움 제공. 행동증상 없음.',{date:'2026-10-03'})]),workerNotes:{...read([]),service:'ltRfid',coverageScope:'RFID-transmissions-and-their-specific-content'},evaluations:read(existing.map((round,i)=>entry('evaluation-'+i,'evaluation',{basic:{POF_VLT_CHASU:String(round),POF_PLNPP_VLT_SEQ:'E'+i}},{evaluationId:'E'+i,date:'2026-10-0'+(i+1)})))}};
 const ev={evidenceState:'verified',evidenceIds:['visit']};
 const observations=stateKeys.map(key=>{const area=AREAS.includes(key.slice(0,4));const choice=/^X\d{3}1$/.test(key)||key==='Z1103'||key==='Z1201';const text=/^X\d{3}4$/.test(key)?'세면 도움 제공함.':key==='Z1201'?'욕구 변화 없음':'';return{key,selected:choice,text,...ev};});
 const spec={schemaVersion:1,operation:'create',context,evaluationId:null,evaluationDate:period.to,period,formId:schema.formId,schemaFingerprint:schema.fingerprint,evaluationKind:'02',evaluationRound:String(existing.length?Math.max(...existing)+1:1),
  goals:[{key:'세면',provided:true,text:'세면 도움 제공함.',...ev}],observations,overallComment:{text:'세면 도움을 제공 중이며 상태가 유지됨.',...ev},summary:{text:'세면 도움 제공함. 행동증상 없음.',...ev}};
 const policy={adopted:true,version:'synthetic-policy-1',evaluationKind:'02'};return{spec,schema,bundle,policy,context};
}
const issues=f=>validateSpec(f.spec,f.schema,f.bundle,f.policy).issues.join();
test('local review document includes the observed profile with age calculated for its evaluation date',t=>{
 const f=specFixture(),output=fs.mkdtempSync(path.join(os.tmpdir(),'lt-profile-'));
 t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
 f.bundle.recipientProfile={sex:'여자',birthDate:'1940-11-01',age:85,ageAsOf:'2026-11-10',grade:'3등급'};
 const dir=path.join(output,'review');prepare({...f,output:dir});
 const script="import sys;sys.stdout.reconfigure(encoding='utf-8');from docx import Document;d=Document(sys.argv[1]);print(' | '.join(c.text for t in d.tables for r in t.rows for c in r.cells))";
 const result=spawnSync('python',['-I','-c',script,path.join(dir,'review.docx')],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(result.status,0,result.stderr);
 for(const expected of ['여자','1940-11-01','만 85세','3등급'])assert(result.stdout.includes(expected),expected);
});
test('reviewed content materializes into an evidence-valid execution spec',()=>{
 const f=specFixture(),{materializeReviewed}=require('./desk-register.cjs');
 const data={evaluationDate:f.spec.evaluationDate,evidenceObservedTo:f.spec.evaluationDate,contentHash:'a'.repeat(64),review:{at:'2026-10-28T01:00:00Z'},goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[]};
 const next=materializeReviewed({data,spec:f.spec,bundle:f.bundle,actualRound:'1'});
 const proof=validateSpec(next.spec,f.schema,next.bundle,f.policy);assert.equal(proof.ok,true,proof.issues.join());
 assert.deepEqual(f.bundle.reads.userConfirmations,undefined);
});
test('execution input must exactly reconstruct from the approved desk record and original bundle',()=>{
 const f=specFixture(),{materializeReviewed,verifyPreparedExecution}=require('./desk-register.cjs');
 const data={evaluationDate:f.spec.evaluationDate,evidenceObservedTo:f.spec.evaluationDate,contentHash:'a'.repeat(64),review:{at:'2026-10-28T01:00:00Z'},goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[]},fresh={status:'empty',records:[],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:01:00Z',query:{context:f.context,period:f.spec.period}};
 const prepared=materializeReviewed({data,spec:f.spec,bundle:f.bundle,actualRound:'1',freshEvaluations:fresh});assert.equal(verifyPreparedExecution({data,work:f,prepared,actualRound:'1'}),true);
 const bad=structuredClone(prepared);bad.spec.goals[0].text='바뀐 문장';assert.throws(()=>verifyPreparedExecution({data,work:f,prepared:bad,actualRound:'1'}),/PREPARED_CONTENT_CHANGED/);
});
test('6-2 validates a fresh evaluation list without changing the original evidence cutoff',()=>{
 const f=specFixture(),day='2026-10-27';f.spec.evidenceObservedTo='2026-10-26';
 for(const [name,read] of Object.entries(f.bundle.reads)){read.query.observationPeriod={from:f.spec.period.from,to:f.spec.evidenceObservedTo};if(name==='visits')read.records[0].date='2026-10-03';}
 const content={basic:{POF_PLNPP_MGMT_NO:f.context.planId,ADPT_FR_DT:'20261001',ADPT_TO_DT:'20261028',WRT_DT:'20261027',POF_VLT_CHASU:'1'}};
 f.bundle.currentEvaluations={status:'complete',historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:00:00Z',query:{context:f.context,period:f.spec.period,observationPeriod:f.spec.period},records:[{id:'evaluation:fresh',kind:'evaluation',context:f.context,date:day,content,contentHash:hash(content)}]};
 f.spec.requireFreshEvaluations=true;f.spec.evaluationRound='2';assert.equal(issues(f),'');
 const saved=f.bundle.currentEvaluations;delete f.bundle.currentEvaluations;assert.match(issues(f),/FRESH_EVALUATIONS_REQUIRED/);f.bundle.currentEvaluations=saved;
 f.bundle.currentEvaluations.records[0].content.basic.POF_VLT_CHASU='0';f.bundle.currentEvaluations.records[0].contentHash=hash(f.bundle.currentEvaluations.records[0].content);assert.match(issues(f),/FRESH_EVALUATIONS_INVALID/);
 f.bundle.currentEvaluations.records[0].content.basic.POF_VLT_CHASU='1';
 f.bundle.currentEvaluations.records[0].date='2026-10-28';f.bundle.currentEvaluations.records[0].content.basic.WRT_DT='20261028';f.bundle.currentEvaluations.records[0].contentHash=hash(f.bundle.currentEvaluations.records[0].content);assert.match(issues(f),/EVALUATION_ALREADY_SAVED_ON_DATE/);
});
test('fresh evaluation search includes later evaluations in the same service period for correct next round',()=>{
 const f=specFixture();f.spec.period.to='2026-11-30';f.bundle.period.to=f.spec.period.to;
 for(const read of Object.values(f.bundle.reads)){read.query.period.to=f.spec.period.to;read.query.observationPeriod={from:f.spec.period.from,to:f.spec.evaluationDate};}
 const content={basic:{POF_PLNPP_MGMT_NO:f.context.planId,ADPT_FR_DT:'20261001',ADPT_TO_DT:'20261130',WRT_DT:'20261101',POF_VLT_CHASU:'1'}};
 f.bundle.currentEvaluations={status:'complete',historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-11-02T00:00:00Z',query:{context:f.context,period:f.spec.period},records:[{id:'evaluation:later',kind:'evaluation',context:f.context,date:'2026-11-01',content,contentHash:hash(content)}]};
 f.spec.requireFreshEvaluations=true;f.spec.evaluationRound='2';assert.equal(issues(f),'');
});
test('fresh plan history counts a same-plan evaluation outside the service period',()=>{
 const f=specFixture(),content={basic:{POF_PLNPP_MGMT_NO:f.context.planId,ADPT_FR_DT:'20261001',ADPT_TO_DT:'20261028',WRT_DT:'20260930',POF_VLT_CHASU:'1'}};
 f.bundle.currentEvaluations={status:'complete',records:[{id:'evaluation:older',kind:'evaluation',context:f.context,date:'2026-09-30',content,contentHash:hash(content)}],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:01:00Z',query:{context:f.context,period:f.spec.period}};f.spec.requireFreshEvaluations=true;f.spec.evaluationRound='2';assert.equal(issues(f),'');
});
test('one reviewed synthetic evaluation prepares validated 6-2 data without writing either site',async()=>{
 const f=specFixture(),bridge=require('./desk-bridge.cjs'),{prepareRegistration}=require('./desk-register.cjs'),secret='e'.repeat(64),crypto=require('node:crypto'),{canonical}=require('./core.cjs');
 const localWorkKey=crypto.createHash('sha256').update(canonical(['evaluation-work',hash(f.spec),hash(f.bundle),hash(f.schema),hash(f.policy)])).digest('hex');
 const data={...bridge.deskKeys(secret,f.context),evaluationKey:'a'.repeat(64),version:1,status:'reviewed',operation:'create',servicePeriod:f.spec.period,evaluationDate:f.spec.evaluationDate,evaluationRound:'1',evaluationKind:'02',evidenceObservedTo:f.spec.evaluationDate,goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[],bundleHash:hash(f.bundle),localWorkKey,schemaFingerprint:f.schema.fingerprint};
 data.contentHash=bridge.deskContentHash(data);data.review={at:'2026-10-28T01:00:00Z',contentHash:data.contentHash};
 let reads=0;const fresh={status:'empty',records:[],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:01:00Z',query:{context:f.context,period:f.spec.period}};
 const result=await prepareRegistration({records:[data],work:f,secret,today:'2026-10-28',readCurrent:async()=>{reads++;return fresh;}});
 assert.equal(result.state,'ready');assert.equal(result.actualRound,'1');assert.equal(result.proof.ok,true);assert.equal(reads,1);assert.equal(result.spec.requireFreshEvaluations,true);
 const content={basic:{POF_PLNPP_MGMT_NO:f.context.planId,ADPT_FR_DT:'20261001',ADPT_TO_DT:'20261028',WRT_DT:'20261027',POF_VLT_CHASU:'1'}};
 const changed={...fresh,status:'complete',records:[{id:'evaluation:new',kind:'evaluation',context:f.context,date:'2026-10-27',content,contentHash:hash(content)}]};
 const args={records:[data],work:f,secret,today:'2026-10-28',readCurrent:async()=>changed};
 const ask=await prepareRegistration(args);assert.equal(ask.state,'round-confirmation-required');assert.equal(ask.evaluationRound,'2');
 await assert.rejects(prepareRegistration({...args,readCurrent:async()=>({...changed,query:{...changed.query,period:{from:'2026-10-02',to:'2026-10-28'}}})}),/FRESH_EVALUATIONS_SCOPE_MISMATCH/);
 const accepted=await prepareRegistration({...args,confirmedRound:'2'});assert.equal(accepted.state,'ready');assert.equal(accepted.actualRound,'2');
});
test('6-2 preparation command binds review, source and generated document using synthetic data',async t=>{
 const f=specFixture(),C=require('../context.cjs'),bridge=require('./desk-bridge.cjs'),{main}=require('./commands.cjs'),secret='e'.repeat(64),crypto=require('node:crypto'),{canonical}=require('./core.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-prepare-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 C.writeNewJson(path.join(root,'longterm.workspace.json'),{schemaVersion:1,organization:{id:f.context.orgId,name:'가상기관'},operator:{name:f.context.workerName,job:'직원'},origins:{lt:'https://lt.example.test',ltRfid:'https://rfid.example.test',cm:'https://cm.example.test',desk:'https://desk.example.test',ez:'https://ez.example.test'},policy:{accepted:true,version:'test'}});
 const c=C.loadContext(root),work=path.join(c.stateRoot,'source'),out=path.join(c.stateRoot,'prepared');for(const name of ['spec','schema','bundle','policy'])C.writeNewJson(path.join(work,name+'.json'),f[name]);
 const bindings={schemaVersion:1,configHash:c.configHash,targets:[{service:'lt',targetId:'LT',role:'20L'},{service:'desk',targetId:'DESK'}]};C.writeNewJson(path.join(c.stateRoot,'browser-bindings.json'),bindings);
 const localWorkKey=crypto.createHash('sha256').update(canonical(['evaluation-work',hash(f.spec),hash(f.bundle),hash(f.schema),hash(f.policy)])).digest('hex');
 const data={...bridge.deskKeys(secret,f.context),orgId:'DESK',evaluationKey:'a'.repeat(64),version:1,status:'reviewed',operation:'create',servicePeriod:f.spec.period,evaluationDate:f.spec.evaluationDate,evaluationRound:'1',evaluationKind:'02',evidenceObservedTo:f.spec.evaluationDate,goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[],bundleHash:hash(f.bundle),localWorkKey,schemaFingerprint:f.schema.fingerprint};data.contentHash=bridge.deskContentHash(data);data.review={at:'2026-10-28T01:00:00Z',contentHash:data.contentHash};
 const instruction=path.join(c.stateRoot,'instruction.json');C.writeNewJson(instruction,{action:'evaluation-desk-register-prepare',organizationId:f.context.orgId,deskOrgId:'DESK',message:'가상 6-2'});
 const fake={sessionId:'synthetic-session-id',captureScreen:async()=>({sessionId:'synthetic-session-id'}),readEvaluations:async()=>({status:'empty',records:[],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:01:00Z',query:{context:f.context,period:f.spec.period}}),assertScreenUnchanged:async()=>{},readStateConfirmed:()=>true};
 const result=await main('evaluation-desk-register-prepare',{instruction,work,out},root,{deskClient:()=>({list:async()=>({orgId:'DESK',complete:true,records:[data]})}),loadDeskSecret:()=>({secret}),makeEvidenceAdapter:()=>fake});
 assert.equal(result.status,'prepared');assert.equal(result.siteWrites,0);assert(fs.existsSync(path.join(out,'review','review.docx')));assert.equal(C.readJson(path.join(out,'prepared.json')).originalBundleHash,hash(f.bundle));assert.deepEqual(C.readJson(path.join(out,'prepared.json')).bindings,bindings);assert(!fs.existsSync(path.join(root,'state/runtime.lock')));
 const prepared=C.readJson(path.join(out,'prepared.json')),executeInstruction=path.join(c.stateRoot,'execute.json');C.writeNewJson(executeInstruction,{action:'evaluation-desk-register',organizationId:f.context.orgId,deskOrgId:'DESK',message:'가상 6-2',saveAllowed:true,...Object.fromEntries(['evaluationKey','contentHash','actualRound','originalBundleHash','documentSha256'].map(k=>[k,prepared[k]]))});
 let desk=structuredClone(data),clicks=0,session=0;const client={get:async()=>structuredClone(desk),claim:async body=>{desk={...desk,version:desk.version+1,lease:{runId:body.runId}};return desk;},result:async body=>{assert.equal(body.outcome,'verified');desk={...desk,status:'registered',lease:null,registration:{...body}};return desk;},list:async()=>({orgId:'DESK',complete:true,records:[desk]})};
 const fresh=()=>({...fake,sessionId:'synthetic-session-'+(++session),captureScreen:async()=>({})});let activeSpec;
 const adapter={preflight:async s=>{activeSpec=s;},readServer:async()=>({status:'complete',records:clicks?[{evaluationId:'SYNTHETIC-ID',values:comparable(activeSpec),submitted:false,savedAt:'2026-10-28T01:01:00Z'}]:[]}),fill:async s=>({specHash:hash(s),valuesHash:hash(comparable(s))}),assertOwnedDraft:async()=>{},clickSaveOnce:async()=>{clicks++;},reopenSaved:async()=>({mode:'UPDATE',evaluationDateEnabled:false,valuesHash:hash(comparable(activeSpec))})};
 const executed=await main('evaluation-desk-register',{instruction:executeInstruction,work:path.join(out,'review')},root,{deskClient:()=>client,loadDeskSecret:()=>({secret}),makeEvidenceAdapter:fresh,makeAdapter:()=>adapter});assert.equal(executed.status,'verified');assert.equal(clicks,1);assert.equal(desk.status,'registered');assert(!fs.existsSync(path.join(root,'state/runtime.lock')));
 const pending={...fake,readEvaluations:async()=>{throw Object.assign(Error('LT_READ_TIMEOUT_PENDING'),{preserveLease:true});},assertScreenUnchanged:async()=>{throw Object.assign(Error('LT_READ_STILL_PENDING'),{preserveLease:true});},readStateConfirmed:()=>false};
 const out2=path.join(c.stateRoot,'pending'),failed=await main('evaluation-desk-register-prepare',{instruction,work,out:out2},root,{deskClient:()=>({list:async()=>({orgId:'DESK',complete:true,records:[data]})}),loadDeskSecret:()=>({secret}),makeEvidenceAdapter:()=>pending});
 assert.equal(failed.leaseRetained,true);assert.equal(failed.siteWrites,0);assert(fs.existsSync(path.join(root,'state/runtime.lock')));assert.equal(C.readJson(path.join(out2,'session.json')).sessionId,pending.sessionId);
});
test('prepared v2 evaluation travels through the real runner and reports only independently verified save',async t=>{
 const f=specFixture(),{materializeReviewed,runRegistration,makeRunOperations}=require('./desk-register.cjs'),{runEvaluation,journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),bridge=require('./desk-bridge.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-run-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const data={evaluationDate:f.spec.evaluationDate,evidenceObservedTo:f.spec.evaluationDate,contentHash:'b'.repeat(64),review:{at:'2026-10-28T01:00:00Z'},goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[]};
 const fresh={status:'empty',records:[],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:01:00Z',query:{context:f.context,period:f.spec.period}};
 const w=materializeReviewed({data,spec:f.spec,bundle:f.bundle,actualRound:'1',freshEvaluations:fresh}),proof=validateSpec(w.spec,f.schema,w.bundle,f.policy),journal=openJournal(root,journalKey(w.spec));assert.equal(proof.ok,true,proof.issues.join());
 const instruction={specHash:proof.specHash,bundleHash:proof.bundleHash,policyHash:proof.policyHash,organizationId:f.context.orgId,message:'가상 등록',source:'desk-review:test',saveAllowed:true};
 let clicks=0,reported=null;const saved={evaluationId:'E1',values:comparable(w.spec),submitted:false,savedAt:'2026-10-28T01:02:00Z'};
 const adapter={preflight:async()=>{},readServer:async()=>({status:'complete',records:clicks?[saved]:[]}),fill:async()=>({specHash:hash(w.spec),valuesHash:hash(comparable(w.spec))}),assertOwnedDraft:async()=>{},clickSaveOnce:async()=>{clicks++;},reopenSaved:async()=>({mode:'UPDATE',evaluationDateEnabled:false,valuesHash:hash(comparable(w.spec))})};
 const record={...data,evaluationKey:'a'.repeat(64),version:1,status:'reviewed',subjectKey:'s',planKey:'p',servicePeriod:f.spec.period,evaluationKind:'02'};record.contentHash=bridge.deskContentHash(record);record.review.contentHash=record.contentHash;
 const client={claim:async()=>{},get:async()=>({...record,version:2,lease:{runId:'synthetic-run'}}),result:async r=>{reported=r;}};
 const ops=makeRunOperations({approved:record,runId:'synthetic-run',expectedRead:fresh,acquire:async()=>({release:()=>{}}),assertNoPending:async()=>{},recordIntent:async()=>{},client,readCurrent:async()=>fresh,verifyOriginal:async()=>{},adapter,runner:async guarded=>{const r=await runEvaluation({...w,schema:f.schema,policy:f.policy,instruction,journal},guarded);return r.state==='verified'?{...r,verifiedAt:'2026-10-28T01:03:00Z'}:r;}});
 const result=await runRegistration({record,runId:'synthetic-run',actualRound:'1',ops});
 assert.equal(result.state,'verified');assert.equal(clicks,1);assert.equal(reported.outcome,'verified');assert.equal(journal.read().filter(e=>e.type==='save-attempt').length,1);
});
function savedEvaluation(f,{plan=f.context.planId,from=f.spec.period.from,to=f.spec.period.to,date='2026-10-27',round='1'}={}){
 const content={basic:{POF_PLNPP_MGMT_NO:plan,ADPT_FR_DT:from.replaceAll('-',''),ADPT_TO_DT:to.replaceAll('-',''),WRT_DT:date.replaceAll('-',''),POF_VLT_CHASU:round}};
 const read=f.bundle.reads.evaluations;read.status='complete';read.records=[{id:'saved',kind:'evaluation',context:f.context,content,contentHash:hash(content)}];
}
test('same plan and period on a different date allows the next round, but not a wrong round',()=>{
 const f=specFixture();savedEvaluation(f);f.spec.evaluationRound='2';assert.equal(issues(f),'');f.spec.evaluationRound='1';assert.match(issues(f),/EVALUATION_ROUND_MISMATCH/);
});
test('same plan, period and evaluation date refuses a duplicate save',()=>{
 const f=specFixture();savedEvaluation(f,{date:f.spec.evaluationDate});f.spec.evaluationRound='2';assert.match(issues(f),/EVALUATION_ALREADY_SAVED_ON_DATE/);
});
test('6-1 desk draft validation allows an existing evaluation while actual save validation still blocks it',()=>{
 const f=specFixture();savedEvaluation(f,{date:f.spec.evaluationDate});f.spec.evaluationRound='2';
 assert.equal(validateSpec(f.spec,f.schema,f.bundle,f.policy,{deskDraft:true}).ok,true);
 assert.match(issues(f),/EVALUATION_ALREADY_SAVED_ON_DATE/);
});
test('unreadable saved evaluation dates never permit another evaluation',()=>{
 for(const d of ['', '2026-02-30']){const f=specFixture();savedEvaluation(f,{date:d});f.spec.evaluationRound='2';assert.match(issues(f),/SAVED_EVALUATION_DATE_UNCONFIRMED/);}
});
test('unknown saved service periods never permit another evaluation for the same plan',()=>{
 const f=specFixture();savedEvaluation(f,{from:'',to:''});f.spec.evaluationRound='2';assert.match(issues(f),/SAVED_EVALUATION_PERIOD_UNCONFIRMED/);
});
test('partially overlapping periods allow the next evaluation on a different date',()=>{
 const f=specFixture();savedEvaluation(f,{to:'2026-10-20'});f.spec.evaluationRound='2';assert.equal(issues(f),'');
});
test('fixed evidence observation date must be within the service period and no later than evaluation date',()=>{
 const f=specFixture();f.spec.evidenceObservedTo='2026-10-15';for(const read of Object.values(f.bundle.reads))read.query.observationPeriod={from:f.spec.period.from,to:f.spec.evidenceObservedTo};assert.equal(issues(f),'');
 for(const d of ['2026-09-30','2026-10-29','invalid']){f.spec.evidenceObservedTo=d;assert.match(issues(f),/EVALUATION_PERIOD/);}
 const legacy=specFixture();assert.equal(issues(legacy),'');
});
test('a complete v2 specification validates and its comparable values include round and overall comment',()=>{
 const f=specFixture(),proof=validateSpec(f.spec,f.schema,f.bundle,f.policy);assert.equal(proof.ok,true,proof.issues.join());
 const c=comparable(f.spec);assert.equal(c.evaluationRound,'1');assert.equal(c.overallComment,f.spec.overallComment.text);assert.equal(c.summary,f.spec.summary.text);
});
test('the evaluation round must be the next number after the evaluations already read for the plan',()=>{
 const none=specFixture();none.spec.evaluationRound='2';assert.match(issues(none),/EVALUATION_ROUND/);
 const two=specFixture({existing:[1,2]});assert.equal(validateSpec(two.spec,two.schema,two.bundle,two.policy).ok,true);two.spec.evaluationRound='2';assert.match(issues(two),/EVALUATION_ROUND/);
 for(const bad of [undefined,'','0','01','1.5','x',1]){const f=specFixture();if(bad===undefined)delete f.spec.evaluationRound;else f.spec.evaluationRound=bad;assert.match(issues(f),/EVALUATION_ROUND/);}
});
test('the overall comment is required, evidence-linked and limited to the observed form length',()=>{
 const missing=specFixture();delete missing.spec.overallComment;assert.match(issues(missing),/OVERALL/);
 const long=specFixture();long.spec.overallComment.text='가'.repeat(2001);assert.match(issues(long),/TEXT_LIMIT/);
 const ok=specFixture();ok.spec.overallComment.text='가'.repeat(2000);assert.equal(validateSpec(ok.spec,ok.schema,ok.bundle,ok.policy).ok,true);
 const unlinked=specFixture();unlinked.spec.overallComment.evidenceIds=[];assert.match(issues(unlinked),/EVIDENCE|UNSUPPORTED/);
});
test('each physical or environment area needs exactly one state choice and a written basis, as the site requires before saving',()=>{
 for(const area of AREAS){
  const none=specFixture();none.spec.observations.find(o=>o.key===area+'1').selected=false;assert.match(issues(none),/STATE_AREA_CHOICE/,area);
  const two=specFixture();two.spec.observations.find(o=>o.key===area+'2').selected=true;assert.match(issues(two),/STATE_AREA_CHOICE/,area);
  const noBasis=specFixture();noBasis.spec.observations.find(o=>o.key===area+'4').text='';assert.match(issues(noBasis),/STATE_AREA_BASIS/,area);
 }
});
test('the comprehensive opinion, a need confirmation and a future plan are required',()=>{
 const noOpinion=specFixture();noOpinion.spec.summary.text='';assert.match(issues(noOpinion),/TEXT_LIMIT|SUMMARY|OPINION/);
 const noNeed=specFixture();noNeed.spec.observations.find(o=>o.key==='Z1103').selected=false;assert.match(issues(noNeed),/NEED_CONFIRMATION/);
 const noPlan=specFixture();noPlan.spec.observations.find(o=>o.key==='Z1201').selected=false;noPlan.spec.observations.find(o=>o.key==='Z1201').text='';assert.match(issues(noPlan),/FUTURE_PLAN/);
});
test('a selected reason choice needs its reason within the input length and an unselected one must have none',()=>{
 const noReason=specFixture();noReason.spec.observations.find(o=>o.key==='Z1201').text='';assert.match(issues(noReason),/REASON/);
 const long=specFixture();long.spec.observations.find(o=>o.key==='Z1201').text='가'.repeat(21);assert.match(issues(long),/TEXT_LIMIT|REASON/);
 const stray=specFixture();stray.spec.observations.find(o=>o.key==='Z1209').text='불필요한 사유';assert.match(issues(stray),/REASON/);
 const other=specFixture();const z9=other.spec.observations.find(o=>o.key==='Z1209');z9.selected=true;z9.text='기타 사유';assert.equal(validateSpec(other.spec,other.schema,other.bundle,other.policy).ok,true);
});
test('a v1 form keeps its original specification shape and comparable keys',()=>{
 const f=specFixture();f.schema.structure={nativeVersion:'npsb800-20l-v1',goalKeys:['세면'],stateKeys:['X1111','X1114']};f.schema.fingerprint=hash(f.schema.structure);f.schema.labelsReviewedFrom=f.schema.fingerprint;f.schema.reviewLabels={X1111:'a',X1114:'b'};f.spec.schemaFingerprint=f.schema.fingerprint;
 f.spec.observations=[{key:'X1111',selected:true,text:'',evidenceState:'verified',evidenceIds:['visit']},{key:'X1114',selected:false,text:'세면 도움 제공함.',evidenceState:'verified',evidenceIds:['visit']}];delete f.spec.evaluationRound;delete f.spec.overallComment;
 const proof=validateSpec(f.spec,f.schema,f.bundle,f.policy);assert.equal(proof.ok,true,proof.issues.join());assert.deepEqual(Object.keys(comparable(f.spec)).sort(),['context','evaluationDate','evaluationKind','goals','observations','period','summary']);
});
test('the review document names the round and prints the overall comment and the comprehensive opinion separately',t=>{
 const f=specFixture(),output=fs.mkdtempSync(path.join(os.tmpdir(),'lt-v2-doc-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
 const dir=path.join(output,'out'),receipt=prepare({...f,output:dir});assert.equal(receipt.serverWrites,0);
 const text=spawnSync('python',['-I','-X','utf8','-c','import docx,sys\nd=docx.Document(sys.argv[1])\nprint("\\n".join(p.text for p in d.paragraphs))\nfor t in d.tables:\n  for r in t.rows:\n    print("|".join(c.text for c in r.cells))',path.join(dir,'review.docx')],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}}).stdout;
 assert(text.includes('평가 차수: 1'),text.slice(0,400));assert(text.includes('총평'));assert(text.includes(f.spec.overallComment.text));assert(text.includes('기타 및 종합의견'));assert(text.includes(f.spec.summary.text));
});

// ---- native form (v2) --------------------------------------------------------------------------------------
class Dataset{
 constructor(id){this.id=id;this.rows=[];this.columns=[];this.rowposition=0;this.types=[];}
 assign(other){this.rows=structuredClone(other.rows);this.columns=[...other.columns];this.types=[...other.types];}
 getRowCount(){return this.rows.length;}getColCount(){return this.columns.length;}getColID(i){return this.columns[i];}getColumn(i,k){return this.rows[i]?.[k];}getColumnInfo(k){return this.columns.includes(k);}
 addColumn(k){if(!this.columns.includes(k))this.columns.push(k);}addRow(){this.rows.push({});this.types.push(2);return this.rows.length-1;}setColumn(i,k,v){this.addColumn(k);this.rows[i][k]=v;this.types[i]=4;}getRowType(i){return this.types[i]||1;}getDeletedRowCount(){return 0;}
 deleteRow(i){this.rows.splice(i,1);this.types.splice(i,1);}findRowExpr(expr){const m=/DSRE_ITEM_CD_PTTN == '(\w+)' && DSRE_ITEM_CD == '(\w+)'/.exec(expr);return this.rows.findIndex(r=>m&&r.DSRE_ITEM_CD_PTTN===m[1]&&r.DSRE_ITEM_CD===m[2]);}
 clearData(){this.rows=[];this.types=[];}saveXML(){return JSON.stringify({rows:this.rows,columns:this.columns,types:this.types});}destroy(){}
}
function ds(id,rows){const d=new Dataset(id);d.rows=structuredClone(rows);d.columns=[...new Set(rows.flatMap(Object.keys))];return d;}
function nativeFixture(t){
 const oldWindow=global.window;global.window={};t.after(()=>{if(oldWindow===undefined)delete global.window;else global.window=oldWindow;});
 const original=global.nexacro;t.after(()=>{if(original===undefined)delete global.nexacro;else global.nexacro=original;});
 const basic={LTC_MGMT_NO:'SYNTHETIC-NUMBER',LTC_MGMT_NO_SEQ:'001',POF_PLNPP_MGMT_NO:'SYNTHETIC-PLAN',POF_PLNPP_VLT_SEQ:'',WRT_DT:'20261028',ADPT_FR_DT:'20261001',ADPT_TO_DT:'20261028',POF_VLT_KIND_CD:'',POF_VLT_CHASU:'',RSLT_VLT_DESC:'',PRS_NM:'가상대상'};
 const goals=[{NSST_CONTN_GROUP_NM:'세면',NSST_CONTN_OFFR_YN:'0',NSST_CONTN_OFFR_CFR_CONTN:'',NSST_CONTN_NOT_OFFR_RSN:'',DETAIL_GOAL_ACHM_RT:''}];
 const d={ds_cond:ds('detailCond',[{}]),ds_tbnpsb80:ds('basic',[basic]),ds_tbnpsb81:ds('goals',goals),ds_tbnpsb82:ds('states',[]),fv_sInDivCd:'INSERT',cal_wrtDt:{enable:true},stc_saveTm:{text:''}};
 const comp=(id,type,extra={})=>({id,value:'',text:'',_type_name:type,getOffsetLeft:()=>220,getOffsetTop:()=>20,...extra});
 const t2=[],t3=[];for(const k of stateKeys){const isText=/^X\d{3}4$/.test(k)||k==='X9900';(k.startsWith('Z')?t3:t2).push(comp((isText?'txt_':'cbx_')+k,isText?'TextArea':'CheckBox',isText?{maxlength:500}:{}));}
 t2.push(comp('txt_X9900','TextArea',{maxlength:500}));
 const reasonControls={};for(const k of ['Z1201','Z1209']){reasonControls['edt_'+k]=comp('edt_'+k,'Edit',{maxlength:20,enable:false,set_value(v){this.value=v;}});t3.push(reasonControls['edt_'+k]);}
 const mk=list=>({form:{components:list,...Object.fromEntries(list.map(c=>[c.id,c]))}});
 for(const c of [...t2,...t3]){if(!c.set_value)c.set_value=function(v){this.value=v;};}
 const overall=comp('txt_ovrOpin','TextArea',{maxlength:2000,set_value(v){this.value=v;d.ds_tbnpsb80.setColumn(0,'RSLT_VLT_DESC',v);}});
 d.tab_sub={tpage1:mk([overall]),tpage2:mk(t2),tpage3:mk(t3)};
 d.edt_pofVltChasu=comp('edt_pofVltChasu','Edit',{maxlength:3,set_value(v){this.value=v;d.ds_tbnpsb80.setColumn(0,'POF_VLT_CHASU',v);}});
 d.cmb_pofVltKindCd=comp('cmb_pofVltKindCd','Combo',{set_value(v){this.value=v;}});
 const row=key=>({LTC_ADMIN_SYM:'SYNTHETIC-ORG',DSRE_ITEM_CD_PTTN:key.slice(0,2),DSRE_ITEM_CD:key.slice(2),DSRE_ITEM_CHOICE_YN:'Y'});
 d.cbx_onclick=(obj)=>{const key=obj.id.slice(4);const idx=d.ds_tbnpsb82.findRowExpr("DSRE_ITEM_CD_PTTN == '"+key.slice(0,2)+"' && DSRE_ITEM_CD == '"+key.slice(2)+"'");
  if(obj.value==1){if(idx===-1){const i=d.ds_tbnpsb82.addRow();for(const[k,v]of Object.entries(row(key)))d.ds_tbnpsb82.setColumn(i,k,v);}
   if(/^X\d{3}[123]$/.test(key)){for(const other of ['1','2','3']){if(other===key.slice(-1))continue;const ok=key.slice(0,4)+other,oi=d.ds_tbnpsb82.findRowExpr("DSRE_ITEM_CD_PTTN == '"+ok.slice(0,2)+"' && DSRE_ITEM_CD == '"+ok.slice(2)+"'");if(oi!==-1){d.ds_tbnpsb82.deleteRow(oi);const c=d.tab_sub.tpage2.form['cbx_'+ok];if(c)c.value=0;}}}
   const edit=d.tab_sub.tpage3.form['edt_'+key];if(edit)edit.enable=true;}
  else{if(idx!==-1)d.ds_tbnpsb82.deleteRow(idx);const edit=d.tab_sub.tpage3.form['edt_'+key];if(edit){edit.enable=false;edit.value='';}}};
 d.edtX_change=(obj,e)=>{const key=obj.id.slice(4);const idx=d.ds_tbnpsb82.findRowExpr("DSRE_ITEM_CD_PTTN == '"+key.slice(0,2)+"' && DSRE_ITEM_CD == '"+key.slice(2)+"'");
  if(idx===-1){const i=d.ds_tbnpsb82.addRow();for(const[k,v]of Object.entries(row(key)))d.ds_tbnpsb82.setColumn(i,k,v);d.ds_tbnpsb82.setColumn(i,'ETC_CONTN',e.postvalue);}else if(e.postvalue.length===0)d.ds_tbnpsb82.deleteRow(idx);else d.ds_tbnpsb82.setColumn(idx,'ETC_CONTN',e.postvalue);};
 d.tpage2_content_onchanged=()=>{};d.content_onchanged=()=>{};d.edt_pofVltChasu_onchanged=()=>{};
 const f={fv_fnm:'가상작성자',fv_sInDivCd:'INSERT',ds_cond:ds('condition',[{FNM:'가상대상'}]),ds_prsList:ds('people',[]),ds_tbnpsb80:ds('list',[]),div_pofRsltVltDtl:{form:d}};
 const frame={form:{_div_bizFrameMain:{form:f}}},user=ds('user',[{USER_TYPE:'20L',USER_ID:'SYNTHETIC-WORKER',LTC_ADMIN_SYM:'SYNTHETIC-ORG'}]);
 global.nexacro={Dataset,getApplication:()=>({gds_userInfo:user,mainframe:{VFrameSet:{HFrameSet:{VFrameSetSub:{framesetWork:{winNPS01230000:frame}}}}}})};
 return{f,d,basic,reasonControls};
}
test('v2 inspection reports the round control, overall comment limit and reason inputs',async t=>{
 nativeFixture(t);const r=await evaluationPage({action:'inspect'});
 assert.equal(r.structure.nativeVersion,'npsb800-20l-v2');assert.equal(r.structure.overallMax,2000);assert.equal(r.structure.roundControl,'edt_pofVltChasu');assert.deepEqual(r.structure.reasonKeys,['Z1201','Z1209']);assert.equal(r.structure.stateTextMax.Z1201,20);
 assert.equal(r.values.evaluationRound,'');assert.equal(r.values.overallComment,'');assert.equal(r.values.summary,'');
});
test('v2 fill sets the round, overall comment, comprehensive opinion and reason, and reads them back as the same values',async t=>{
 const fx=nativeFixture(t),seen=await evaluationPage({action:'inspect'}),f=specFixture();
 f.spec.context={...f.spec.context,orgId:'SYNTHETIC-ORG',workerId:'SYNTHETIC-WORKER',workerName:'가상작성자',recipientId:'SYNTHETIC-NUMBER|001',recognitionNo:'SYNTHETIC-NUMBER',recognitionSeq:'001',planId:'SYNTHETIC-PLAN'};
 f.spec.evaluationDate='2026-10-28';f.spec.period={from:'2026-10-01',to:'2026-10-28'};
 const out=await evaluationPage({action:'fill',context:seen.context,spec:f.spec,expectedRaw:seen.raw});
 assert.equal(fx.d.ds_tbnpsb80.rows[0].POF_VLT_CHASU,'1');assert.equal(fx.d.ds_tbnpsb80.rows[0].RSLT_VLT_DESC,f.spec.overallComment.text);assert.equal(fx.d.ds_tbnpsb80.rows[0].POF_VLT_KIND_CD,'02');
 const x9900=fx.d.ds_tbnpsb82.rows.find(r=>r.DSRE_ITEM_CD_PTTN==='X9'&&r.DSRE_ITEM_CD==='900');assert.equal(x9900.ETC_CONTN,f.spec.summary.text);
 const z1201=fx.d.ds_tbnpsb82.rows.find(r=>r.DSRE_ITEM_CD_PTTN==='Z1'&&r.DSRE_ITEM_CD==='201');assert.equal(z1201.ETC_CONTN,'욕구 변화 없음');
 assert.equal(out.values.evaluationRound,'1');assert.equal(out.values.overallComment,f.spec.overallComment.text);assert.equal(out.values.summary,f.spec.summary.text);
 assert.deepEqual(JSON.parse(JSON.stringify(out.values)),JSON.parse(JSON.stringify(comparable(f.spec))));
 const after=await evaluationPage({action:'inspect'});assert.deepEqual(after.structure.controls,seen.structure.controls,'filled text must not change the control fingerprint');assert.equal(after.structure.controls.filter(c=>c.kind==='text').every(c=>c.label===''),true);
});
test('a structure observed from the v2 screen is accepted by the specification validator end to end',async t=>{
 nativeFixture(t);const seen=await evaluationPage({action:'inspect'}),base=specFixture();
 const schema={schemaVersion:1,formId:'NPS01230000',structure:seen.structure,fingerprint:hash(seen.structure),labelsReviewedFrom:hash(seen.structure),reviewLabels:Object.fromEntries(seen.structure.stateKeys.map(k=>[k,'라벨 '+k]))};
 const spec=structuredClone(base.spec);spec.schemaFingerprint=schema.fingerprint;spec.goals=[{...spec.goals[0],key:seen.structure.goalKeys[0]}];
 spec.observations=seen.structure.stateKeys.map(key=>base.spec.observations.find(o=>o.key===key)||{key,selected:false,text:'',evidenceState:'verified',evidenceIds:['visit']});
 const proof=validateSpec(spec,schema,base.bundle,base.policy);assert.equal(proof.ok,true,proof.issues.join());
});

test('the normal save button is found when the site keeps its pre-save check on the detail form, and a missing check refuses',async t=>{
 const fx=nativeFixture(t),seen=await evaluationPage({action:'inspect'}),frame=nexacro.getApplication().mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork.winNPS01230000;
 frame.form.div_functionButton={form:{btn_save:{enable:true,getElement:()=>({handle:{id:'synthetic-save-button'}})}}};
 await assert.rejects(evaluationPage({action:'save-button',context:seen.context,expectedRaw:seen.raw}),/NORMAL_SAVE_BUTTON_UNSUPPORTED/);
 fx.d.fn_preSavePofRsltVlt=()=>true;const out=await evaluationPage({action:'save-button',context:seen.context,expectedRaw:seen.raw});assert.equal(out.buttonId,'synthetic-save-button');
});

test('6번 검토완료 다음 날(서비스기간 종료 뒤) 등록해도 평가일은 등록일로 바뀌지 않는다',async()=>{
 const f=specFixture(),bridge=require('./desk-bridge.cjs'),{prepareRegistration}=require('./desk-register.cjs'),secret='e'.repeat(64),crypto=require('node:crypto'),{canonical}=require('./core.cjs');
 const localWorkKey=crypto.createHash('sha256').update(canonical(['evaluation-work',hash(f.spec),hash(f.bundle),hash(f.schema),hash(f.policy)])).digest('hex');
 const data={...bridge.deskKeys(secret,f.context),evaluationKey:'a'.repeat(64),version:1,status:'reviewed',operation:'create',servicePeriod:f.spec.period,evaluationDate:'2026-10-28',evaluationRound:'1',evaluationKind:'02',evidenceObservedTo:'2026-10-28',goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[],bundleHash:hash(f.bundle),localWorkKey,schemaFingerprint:f.schema.fingerprint};
 data.contentHash=bridge.deskContentHash(data);data.review={at:'2026-10-28T01:00:00Z',contentHash:data.contentHash};
 const fresh={status:'empty',records:[],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-29T01:01:00Z',query:{context:f.context,period:f.spec.period}};
 const result=await prepareRegistration({records:[data],work:f,secret,today:'2026-10-29',readCurrent:async()=>fresh});
 assert.equal(result.state,'ready');assert.equal(result.spec.evaluationDate,'2026-10-28');assert.equal(result.proof.ok,true);
});


test('6번 저장 직전에 검토본이나 현재 평가 목록이 바뀌면 실제 실행기에서도 저장을 누르지 않고 미처리로 보고한다',async t=>{
 const f=specFixture(),{materializeReviewed,runRegistration,makeRunOperations}=require('./desk-register.cjs'),{runEvaluation,journalKey}=require('./runner.cjs'),{openJournal}=require('./journal.cjs'),bridge=require('./desk-bridge.cjs');
 const data={evaluationDate:f.spec.evaluationDate,evidenceObservedTo:f.spec.evaluationDate,contentHash:'b'.repeat(64),review:{at:'2026-10-28T01:00:00Z'},goals:f.spec.goals,observations:f.spec.observations,summary:f.spec.summary,overallComment:f.spec.overallComment,evidence:[]};
 const fresh={status:'empty',records:[],historyRange:{from:'2000-01-01',to:'2099-12-31'},collectedAt:'2026-10-28T01:01:00Z',query:{context:f.context,period:f.spec.period}};
 const record={...data,evaluationKey:'a'.repeat(64),version:1,status:'reviewed',subjectKey:'s',planKey:'p',servicePeriod:f.spec.period,evaluationKind:'02'};record.contentHash=bridge.deskContentHash(record);record.review.contentHash=record.contentHash;
 const leased={...record,version:2,lease:{runId:'synthetic-run'}},content={basic:{POF_PLNPP_MGMT_NO:f.context.planId,ADPT_FR_DT:'20261001',ADPT_TO_DT:'20261028',WRT_DT:'20261028',POF_VLT_CHASU:'1'}};
 const cases=[['review',{...leased,summary:{...leased.summary,text:'저장 직전에 바뀐 문장'}},fresh],['version',{...leased,version:3},fresh],['list',leased,{...fresh,status:'complete',records:[{id:'evaluation:other',kind:'evaluation',context:f.context,date:'2026-10-28',content,contentHash:hash(content)}]}]];
 for(const [name,changedRecord,changedRead] of cases){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-presave-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const w=materializeReviewed({data,spec:f.spec,bundle:f.bundle,actualRound:'1',freshEvaluations:fresh}),proof=validateSpec(w.spec,f.schema,w.bundle,f.policy),journal=openJournal(root,journalKey(w.spec));assert.equal(proof.ok,true,proof.issues.join());
  const instruction={specHash:proof.specHash,bundleHash:proof.bundleHash,policyHash:proof.policyHash,organizationId:f.context.orgId,message:'가상 등록',source:'desk-review:test',saveAllowed:true};
  let clicks=0,gets=0,reads=0;const reported=[];
  const adapter={preflight:async()=>{},readServer:async()=>({status:'complete',records:[]}),fill:async()=>({specHash:hash(w.spec),valuesHash:hash(comparable(w.spec))}),assertOwnedDraft:async()=>{},clickSaveOnce:async()=>{clicks++;},reopenSaved:async()=>{throw Error('NOT_REACHED');}};
  // 첫 확인(점유 직후)은 승인본 그대로이고 저장 직전 확인에서만 바뀐다.
  const client={claim:async()=>{},get:async()=>gets++===0?leased:changedRecord,result:async r=>{reported.push(r);}};
  const ops=makeRunOperations({approved:record,runId:'synthetic-run',expectedRead:fresh,acquire:async()=>({release:()=>{}}),assertNoPending:async()=>{},recordIntent:async()=>{},client,readCurrent:async()=>reads++===0?fresh:changedRead,verifyOriginal:async()=>{},adapter,runner:guarded=>runEvaluation({...w,schema:f.schema,policy:f.policy,instruction,journal},guarded)});
  const result=await runRegistration({record,runId:'synthetic-run',actualRound:'1',ops});
  assert.equal(clicks,0,name);assert.equal(result.state,'blocked',name);assert.match(result.code,/DESK_REVIEW_CHANGED|CURRENT_EVALUATIONS_CHANGED/,name);
  assert.deepEqual(reported.map(r=>[r.outcome,r.failureCode,r.saveAttempted]),[['not-verified','EXECUTION_BLOCKED',false]],name);
  assert.equal(journal.read().filter(e=>e.type==='save-attempt').length,0,name);
 }
});

test('repeat evaluations allow different starts, ends, nested and disjoint service periods',()=>{
 for(const period of [{from:'2026-09-01',to:'2026-10-20'},{from:'2026-10-15',to:'2026-11-10'},
  {from:'2026-09-01',to:'2026-11-30'},{from:'2026-09-01',to:'2026-09-30',date:'2026-09-29'}]){
  const f=specFixture();savedEvaluation(f,period);f.spec.evaluationRound='2';assert.equal(issues(f),'',JSON.stringify(period));
 }
});
test('same-date duplicates and wrong rounds stay blocked even when service periods differ',()=>{
 const duplicate=specFixture();savedEvaluation(duplicate,{to:'2026-10-20',date:duplicate.spec.evaluationDate});duplicate.spec.evaluationRound='2';assert.match(issues(duplicate),/EVALUATION_ALREADY_SAVED_ON_DATE/);
 const wrong=specFixture();savedEvaluation(wrong,{from:'2026-09-01',to:'2026-09-30',date:'2026-09-29'});wrong.spec.evaluationRound='1';assert.match(issues(wrong),/EVALUATION_ROUND_MISMATCH/);
});
