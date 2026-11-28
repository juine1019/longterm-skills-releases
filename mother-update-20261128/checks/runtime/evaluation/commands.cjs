'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../context.cjs'),{must,hash,comparable}=require('./core.cjs'),{prepare}=require('./prepare.cjs'),{openJournal,pendingNativeRead}=require('./journal.cjs'),{runEvaluation,journalKey}=require('./runner.cjs'),{nativeAdapter}=require('./native-adapter.cjs'),{reconcileAttempt}=require('./reconcile.cjs');
const {collectEvidence}=require('./collect.cjs'),{validateRequest}=require('./evidence-source.cjs'),{nativeEvidenceAdapter,checkEvidenceSession}=require('./native-evidence-adapter.cjs');
const {acquireRecoveryGuard}=require('./recovery-guard.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function privatePath(context,file,{existing=true}={}){must(typeof file==='string'&&file,'PRIVATE_PATH_REQUIRED');const resolved=existing?fs.realpathSync(path.resolve(file)):path.resolve(file),rel=path.relative(context.stateRoot,resolved);must(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'CURRENT_ORGANIZATION_PRIVATE_PATH_REQUIRED');return C.safeWithin(context.stateRoot,rel);}
function workFiles(context,dir){dir=privatePath(context,dir);const out={dir};for(const name of ['spec','schema','bundle','policy','validation','review'])out[name]=C.readJson(path.join(dir,name+'.json'));must(out.spec.context.orgId===context.settings.organization.id&&out.spec.context.workerName===context.settings.operator.name,'CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH');for(const name of ['spec','schema','bundle','policy'])must(out.review[name+'Hash']===hash(out[name]),'REVIEW_SOURCE_CHANGED:'+name);return out;}
function deskWorkFiles(context,dir){dir=privatePath(context,dir);const out={dir};for(const name of ['spec','schema','bundle','policy'])out[name]=C.readJson(privatePath(context,path.join(dir,name+'.json')));must(out.spec.context.orgId===context.settings.organization.id&&out.spec.context.workerName===context.settings.operator.name,'CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH');return out;}
function registrationScope(context,bindings,deskOrgId){must(typeof deskOrgId==='string'&&deskOrgId&&(!context.settings.organization.deskId||context.settings.organization.deskId===deskOrgId),'DESK_ORGANIZATION_MISMATCH');const scoped={...context,settings:{...context.settings,organization:{...context.settings.organization,deskId:deskOrgId}}};return require('../environment.cjs').scopeFor(scoped,bindings);}
// 순차 실행(evaluation-desk-register-sequence)이 잡은 공용 점유는 그 실행에서 시작한 대상들의 복구 점유로 인정한다.
// 대상의 실행 기록 잠금이 남아 있는(미확인·중단) 대상만 대기 중이다. 마지막 대기 대상을 정리할 때만 공용 점유를 푼다.
function writeNewJsonAtomic(file,value){must(!fs.existsSync(file),'STATE_FILE_EXISTS');const tmp=file+'.'+crypto.randomUUID()+'.tmp';C.writeNewJson(tmp,value);fs.renameSync(tmp,file);}
function sequenceOf(operation){const m=/^evaluation-sequence:([0-9a-f-]{36})$/.exec(String(operation||''));return m?m[1]:null;}
function sequenceDir(context,id){return C.statePath(context,'longterm-result-evaluation','sequences',id);}
function sequenceStarted(context,id){const dir=sequenceDir(context,id);if(!fs.existsSync(dir))return[];return fs.readdirSync(dir).filter(f=>/^started-[A-Za-z0-9_-]{1,64}\.json$/.test(f)).map(f=>C.readJson(path.join(dir,f))).filter(r=>/^[a-f0-9]{64}$/.test(String(r.key))).map(r=>({key:r.key,journal:r.journal==='desk-publication-journal'?'desk-publication-journal':'journal'}));}
function sequencePending(context,id){return sequenceStarted(context,id).filter(s=>fs.existsSync(path.join(C.statePath(context,'longterm-result-evaluation',s.journal),s.key+'.lock')));}
function leaseCovers(context,lock,key,journal='journal'){
 if(lock?.orgKey!==context.orgKey||lock?.configHash!==context.configHash)return false;if(lock.operation===(journal==='journal'?'evaluation:':'evaluation-desk-publish:')+key)return true;
 const id=sequenceOf(lock.operation);if(!id)return false;let record;try{record=C.readJson(path.join(sequenceDir(context,id),'sequence.json'));}catch{return false;}
 return record.sequenceId===id&&record.leaseId===lock.id&&sequenceStarted(context,id).some(s=>s.key===key&&s.journal===journal);
}
function releaseRuntimeLock(context,file,item){const id=sequenceOf(item.record.operation);if(id&&sequencePending(context,id).length)return false;must(sha(fs.readFileSync(file))===sha(item.bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');fs.unlinkSync(file);return true;}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function releaseVerifiedLocks(context,journal,key,expectedLeaseId,result){
 must(result.state==='verified'&&result.reopenedVerified===true,'ONLY_VERIFIED_RECOVERY_MAY_RELEASE');const file=C.safeWithin(context.root,'state/runtime.lock');
 const lockFiles=[file,journal.lock].filter(fs.existsSync),copies=[];
 for(const lock of lockFiles){const bytes=fs.readFileSync(lock),record=JSON.parse(bytes);if(lock===file)must(record.id===expectedLeaseId&&leaseCovers(context,record,key),'RECOVERY_LEASE_SCOPE_CHANGED');else must(record.key===key,'RECOVERY_JOURNAL_SCOPE_CHANGED');must(!alive(record.pid),'RECOVERY_OWNER_STILL_RUNNING');copies.push({lock,bytes,digest:sha(bytes),record});}
 const evidence=C.safeWithin(context.stateRoot,'evaluation-recovery',crypto.randomUUID()+'.json');C.writeNewJson(evidence,{schemaVersion:1,key,result,locks:copies.map(x=>({name:path.basename(x.lock),sha256:x.digest,record:x.record})),at:new Date().toISOString()});
 for(const item of copies){if(item.lock===file)continue;must(sha(fs.readFileSync(item.lock))===item.digest,'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');fs.unlinkSync(item.lock);}
 for(const item of copies)if(item.lock===file)releaseRuntimeLock(context,file,item);return evidence;
}
function releaseReadLocks(context,journal,key,expectedLeaseId,result){
 must(result?.readClosed===true&&result.pending===false&&result.contextMatched===true,'DRAINED_NATIVE_READ_REQUIRED');must(!journal.read().some(e=>e.type==='save-attempt'),'SAVED_EVALUATION_RECONCILIATION_REQUIRED');
 const file=C.safeWithin(context.root,'state/runtime.lock');must(fs.existsSync(file),'READ_LEASE_MISSING');const copies=[];
 for(const lock of [file,journal.lock].filter(fs.existsSync)){const bytes=fs.readFileSync(lock),record=JSON.parse(bytes);if(lock===file)must(record.id===expectedLeaseId&&leaseCovers(context,record,key),'READ_LEASE_SCOPE_CHANGED');else must(record.key===key,'READ_JOURNAL_SCOPE_CHANGED');must(!alive(record.pid),'READ_OWNER_STILL_RUNNING');copies.push({lock,bytes,record});}
 const evidence=C.safeWithin(context.stateRoot,'evaluation-read-recovery',crypto.randomUUID()+'.json');
 C.writeNewJson(evidence,{key,result,locks:copies.map(x=>({name:path.basename(x.lock),sha256:sha(x.bytes),record:x.record})),siteWrites:0});
 journal.append({type:'read-release-ready',leaseId:expectedLeaseId,readSessionId:result.readSessionId||null,evidence});
 journal.release();
 const runtime=copies.find(item=>item.lock===file);
 releaseRuntimeLock(context,file,runtime);
 return evidence;
}
function finishReadRelease(context,options,key,journal,history){
 if(!options['release-lease'])return null;
 const ready=history.findLast(e=>e.type==='read-release-ready'&&e.leaseId===options['release-lease']);
 if(!ready)return null;
 must(!history.some(e=>e.type==='save-attempt')&&!pendingNativeRead(history),'READ_RELEASE_PROOF_CHANGED');
 if(options['close-read'])must(options['close-read']===ready.readSessionId,'NATIVE_READ_SESSION_CHANGED');
 const file=C.safeWithin(context.root,'state/runtime.lock'),bytes=fs.readFileSync(file),record=JSON.parse(bytes);
 must(record.id===ready.leaseId&&leaseCovers(context,record,key)&&!alive(record.pid),'READ_LEASE_SCOPE_CHANGED');
 const evidence=C.readJson(privatePath(context,ready.evidence));
 must(evidence.key===key&&evidence.result?.readClosed===true&&evidence.result?.pending===false&&evidence.result?.contextMatched===true&&evidence.locks?.some(item=>item.name==='runtime.lock'&&item.sha256===sha(bytes)),'READ_RELEASE_PROOF_CHANGED');
 if(fs.existsSync(journal.lock)){
  journal.adoptDeadLease(C.readJson(journal.lock).id);
  journal.release();
 }
 releaseRuntimeLock(context,file,{record,bytes});
 return{ok:true,status:'read-drained',readClosed:true,readSessionId:ready.readSessionId,leaseRetained:fs.existsSync(file),recoveryEvidence:ready.evidence,siteWrites:0,deskWrites:0,saveReconciliationRequired:false};
}
const RECOVERY_COMMANDS=new Set(['evaluation-sequence-release','evaluation-desk-publish-check','evaluation-desk-claim-check','evaluation-desk-report','evaluation-desk-read-check','evaluation-read-check','evaluation-reconcile','evaluation-collection-check']);
async function main(command,options,root,deps){
 if(!RECOVERY_COMMANDS.has(command))return execute(command,options,root,deps);
 const context=C.loadContext(root),file=C.safeWithin(context.root,'state/runtime.lock');
 if(command==='evaluation-reconcile')must(fs.existsSync(file),'RECONCILIATION_LEASE_MISSING');
 const bytes=fs.readFileSync(file),lock=JSON.parse(bytes);
 if(options['release-lease'])must(options['release-lease']===lock.id,'RECOVERY_LEASE_SCOPE_CHANGED');
 const release=acquireRecoveryGuard(context,lock.id);
 try{
  must(fs.readFileSync(file).equals(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');
  return await execute(command,options,root,deps);
 }finally{release();}
}
async function execute(command,options,root,{makeAdapter=nativeAdapter,makeEvidenceAdapter=nativeEvidenceAdapter,checkCollection=checkEvidenceSession,deskClient,loadDeskSecret,buildDeskDraft,sequenceLease}={}){
 const context=C.loadContext(root),read=file=>C.readJson(privatePath(context,file));
 if(command==='evaluation-desk-register'){
  const instruction=read(options.instruction);must(instruction?.action===command&&instruction.saveAllowed===true,'REGISTRATION_INSTRUCTION_MISMATCH');
  const reg=require('./desk-register.cjs'),work=workFiles(context,options.work),folder=privatePath(context,path.dirname(work.dir)),prep=read(path.join(folder,'prepared.json')),record=read(path.join(folder,'desk-record.json')),original=deskWorkFiles(context,prep.originalWork);
  const docSha=sha(fs.readFileSync(path.join(work.dir,'review.docx')));reg.validateRegistrationInstruction({prepared:prep,instruction,organizationId:context.settings.organization.id,deskOrgId:prep.instruction?.deskOrgId,documentSha256:docSha});
  must(work.review.documentSha256===docSha&&record.evaluationKey===prep.evaluationKey&&record.version===prep.version&&record.contentHash===prep.contentHash&&hash(original.bundle)===prep.originalBundleHash,'REGISTRATION_PREPARATION_CHANGED');
  const secret=(loadDeskSecret||require('./desk-bridge.cjs').loadOrCreateSecret)(context.settings.organization.id).secret;reg.verifyReviewedSource({data:record,...original,secret});reg.verifyPreparedExecution({data:record,work:original,prepared:work,actualRound:prep.actualRound});
  const bindings=prep.bindings||undefined,client=deskClient?deskClient(context,root):(()=>{const scope=registrationScope(context,bindings,instruction.deskOrgId),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:instruction.deskOrgId});})();
  const latest=await client.get(record.evaluationKey);must(hash(latest)===hash(record),'DESK_REVIEW_CHANGED');
  const key=journalKey(work.spec),journalRoot=C.statePath(context,'longterm-result-evaluation','journal'),journal=openJournal(journalRoot,key),runId=crypto.randomUUID(),request=reg.evaluationReadRequest(work.spec),adapter=makeAdapter(root,{bindings});
  let lease;const now=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const verifyOriginal=async()=>{sequenceLease?.assertOwned();const current=deskWorkFiles(context,prep.originalWork);reg.verifyReviewedSource({data:record,...current,secret});reg.validateReviewedDate(record,now());must(C.loadContext(root).configHash===context.configHash,'CONFIGURATION_CHANGED_DURING_EXECUTION');};
  const readCurrent=async()=>{const reader=makeEvidenceAdapter(root,request,{evaluationsOnly:true,bindings});return reg.journaledCurrentRead({adapter:reader,journal,requestHash:hash(request),bindingHash:hash(bindings||null)});};
  const trackedClient={get:key=>client.get(key),claim:async body=>{const beforeDispatch=()=>{sequenceLease?.assertOwned();journal.append({type:'registration-claim-started',runId,evaluationKey:record.evaluationKey});};if(deskClient)beforeDispatch();const result=await client.claim(body,deskClient?undefined:{beforeDispatch});journal.append({type:'registration-claim-confirmed',runId,evaluationKey:record.evaluationKey});return result;},result:async body=>{sequenceLease?.assertOwned();journal.append({type:'registration-report-started',runId,outcome:body.outcome,body});const result=await client.result(body);journal.append({type:'registration-report-confirmed',runId,outcome:body.outcome});return result;}};
  const guardedAdapter=sequenceLease?{...adapter,clickSaveOnce(...args){sequenceLease.assertOwned();return adapter.clickSaveOnce(...args);}}:adapter;
  const proof=require('./core.cjs').validateSpec(work.spec,work.schema,work.bundle,work.policy),runInstruction={specHash:proof.specHash,bundleHash:proof.bundleHash,policyHash:proof.policyHash,organizationId:context.settings.organization.id,message:instruction.message,source:'desk-review:'+record.evaluationKey+':'+record.contentHash,saveAllowed:true};
  const ops=reg.makeRunOperations({approved:record,runId,expectedRead:work.bundle.currentEvaluations,acquire:async()=>{if(sequenceLease){sequenceLease.assertOwned();journal.acquire();return{release:()=>{journal.release();}};}lease=C.acquire(context,'evaluation:'+key);try{journal.acquire();}catch(e){lease.release();throw e;}return{release:()=>{journal.release();lease.release();}};},assertNoPending:async()=>reg.assertPlanJournalClear(work.spec,reg.loadPlanHistories(context.stateRoot,journalRoot)),recordIntent:async details=>journal.append({type:'registration-intent',...details,deskOrgId:instruction.deskOrgId,bindingHash:hash(bindings||null),leaseId:sequenceLease?.leaseId||lease.lease.id}),client:trackedClient,readCurrent,verifyOriginal,adapter:guardedAdapter,runner:async guarded=>{const result=await runEvaluation({...work,instruction:runInstruction,journal,journalAlreadyAcquired:true,keepJournalOnExit:true},guarded);return result.state==='verified'?{...result,verifiedAt:new Date().toISOString(),ltWrittenDate:null}:result;}});
  const result=await reg.runRegistration({record,runId,actualRound:prep.actualRound,ops});return{ok:result.state==='verified',status:result.state,code:result.code||null,cause:result.cause||null,runId,remainingReviewed:prep.remainingReviewed,evidenceObservedTo:record.evidenceObservedTo,siteWrites:result.state==='verified'?1:null};
 }
 if(command==='evaluation-sequence-release'){
  // 대상 사이(또는 대상의 실행 기록 잠금 전)에 중단된 순차 실행의 공용 점유만 푼다. 시작한 대상 중 실행 기록 잠금이 남은 대상이 있으면 그 대상부터 기존 복구 명령으로 정리한다.
  const id=String(options.sequence||''),lockFile=C.safeWithin(context.root,'state/runtime.lock');
  must(/^[0-9a-f-]{36}$/.test(id)&&typeof options['release-lease']==='string'&&options['release-lease'],'SEQUENCE_RELEASE_SCOPE_REQUIRED');
  const bytes=fs.readFileSync(lockFile),lock=JSON.parse(bytes);
  must(sequenceOf(lock.operation)===id&&lock.id===options['release-lease']&&lock.orgKey===context.orgKey&&lock.configHash===context.configHash,'RECOVERY_LEASE_SCOPE_CHANGED');
  must(Number.isSafeInteger(lock.pid)&&!alive(lock.pid),'RECOVERY_OWNER_STILL_RUNNING');
  must(sequencePending(context,id).length===0,'SEQUENCE_TARGETS_PENDING');
  const evidence=C.safeWithin(context.stateRoot,'evaluation-recovery',crypto.randomUUID()+'.json');
  C.writeNewJson(evidence,{schemaVersion:1,sequenceId:id,result:{state:'sequence-interrupted',pendingTargets:0},locks:[{name:'runtime.lock',sha256:sha(bytes),record:lock}],at:new Date().toISOString()});
  must(sha(fs.readFileSync(lockFile))===sha(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');fs.unlinkSync(lockFile);
  return{ok:true,status:'sequence-lease-released',sequenceId:id,leaseRetained:false,siteWrites:0,deskWrites:0,recoveryEvidence:evidence};
 }
 if(command==='evaluation-desk-register-sequence'||command==='evaluation-desk-publish-sequence'){
  // 사용자가 범위를 정한 작업 목록(6-2 등록 또는 6-1 게시)을 순서대로 처리한다. 각 작업은 기존 단건 지시·바인딩을 그대로 검사한다(목록은 승인이 아님). 명령과 목록의 단계가 다르면 실행하지 않는다.
  const phase=command==='evaluation-desk-publish-sequence'?'6-1':'6-2';
  const plan=read(options.tasks);must(plan?.schemaVersion===1&&plan.phase===phase&&Array.isArray(plan.tasks)&&plan.tasks.every(t=>typeof t?.instruction==='string'&&typeof t?.work==='string'),'SEQUENCE_TASKS_INVALID');
  const {runEvaluationSequence}=require('./sequence.cjs'),sequenceId=crypto.randomUUID(),dir=sequenceDir(context,sequenceId),lockFile=C.safeWithin(context.root,'state/runtime.lock');
  const lease=C.acquire(context,'evaluation-sequence:'+sequenceId);let keep=false;
  let publicationScopeHash,publicationViewerKey;
  const owned={leaseId:lease.lease.id,assertOwned(){let current=null;try{current=C.readJson(lockFile);}catch{}must(current&&current.id===lease.lease.id&&current.operation==='evaluation-sequence:'+sequenceId&&current.pid===process.pid,'SEQUENCE_LEASE_CHANGED');},
   pinPublicationScope(scope){
    const digest=hash(scope);
    if(publicationScopeHash===undefined)publicationScopeHash=digest;
    must(digest===publicationScopeHash,'SHARED_DESK_BINDING_UNCONFIRMED');
   },pinPublicationViewer(viewerKey){
    if(publicationViewerKey===undefined)publicationViewerKey=viewerKey;
    must(viewerKey===publicationViewerKey,'SHARED_DESK_BINDING_UNCONFIRMED');
   }};
  try{
   writeNewJsonAtomic(path.join(dir,'sequence.json'),{schemaVersion:1,sequenceId,leaseId:lease.lease.id,phase,tasksHash:hash(plan.tasks),taskIds:plan.tasks.map(t=>t.taskId),startedAt:new Date().toISOString()});
   const publishError=code=>['BROWSER_BINDINGS_STALE_OR_MISSING','BOUND_TAB_MISSING','BOUND_TAB_ORIGIN_CHANGED','BOUND_DESK_TAB_REQUIRED','SERVICE_ORIGIN_CHANGED'].includes(code)?'SHARED_DESK_BINDING_UNCONFIRMED':code;
   const summary=await runEvaluationSequence({tasks:plan.tasks,
    execute:async task=>{owned.assertOwned();let targetLock=null;
     // 이전 실행의 잠금이 남은 대상은 시작하지 않는다(순차 점유가 그 대상을 덮지 않는다). 시작 기록은 대상 잠금을 잡기 전에 남긴다.
     const begin=(journalName,key)=>{const lock=path.join(C.statePath(context,'longterm-result-evaluation',journalName),key+'.lock');must(!fs.existsSync(lock),'TARGET_PREVIOUS_RUN_UNRESOLVED');writeNewJsonAtomic(path.join(dir,'started-'+task.taskId+'.json'),{taskId:task.taskId,key,journal:journalName,at:new Date().toISOString()});targetLock=lock;};
     const deps={makeAdapter,makeEvidenceAdapter,checkCollection,deskClient,loadDeskSecret,buildDeskDraft,sequenceLease:{...owned,begin}};
     try{
      if(phase==='6-2'){begin('journal',journalKey(workFiles(context,task.work).spec));const r=await main('evaluation-desk-register',{instruction:task.instruction,work:task.work},root,deps);return{state:r.status,code:r.code,cause:r.cause,runId:r.runId};}
      const r=await main('evaluation-desk-publish',{instruction:task.instruction,work:task.work},root,deps);
      return{state:['verified','existing'].includes(r.status)?'verified':r.status==='not-written'?'blocked':'unknown',code:publishError(r.code)||null};
     }catch(e){const code=phase==='6-1'?publishError(e.message):e.message;if(targetLock&&fs.existsSync(targetLock))return{state:'unknown',code};if(code!==e.message)throw Error(code);throw e;}},
    recordOutcome:async(task,outcome)=>C.writeNewJson(path.join(dir,'outcome-'+task.taskId+'.json'),{taskId:task.taskId,...outcome,at:new Date().toISOString()})});
   keep=sequencePending(context,sequenceId).length>0;C.writeNewJson(path.join(dir,'summary.json'),{...summary,leaseRetained:keep,at:new Date().toISOString()});
   const status=summary.stopped?'stopped':summary.unknownIds.length?'unknown-targets-kept':summary.manualIds.length?'manual-targets':'verified';
   return{ok:status==='verified',status,sequenceId,leaseId:lease.lease.id,leaseRetained:keep,...summary};
  }catch(e){keep=sequencePending(context,sequenceId).length>0;throw e;}finally{if(!keep&&fs.existsSync(lockFile)&&C.readJson(lockFile).id===lease.lease.id)lease.release();}
 }
 if(command==='evaluation-desk-register-prepare'){
  const instruction=read(options.instruction),work=deskWorkFiles(context,options.work),reg=require('./desk-register.cjs');
  must(instruction?.action===command&&instruction.organizationId===context.settings.organization.id&&typeof instruction.deskOrgId==='string'&&instruction.deskOrgId.trim()&&typeof instruction.message==='string'&&instruction.message.trim(),'REGISTRATION_INSTRUCTION_REQUIRED');
  const requestedBindings=options.bindings?read(options.bindings):undefined;
  const client=deskClient?deskClient(context,root):(()=>{const bound=requestedBindings||read(path.join(context.stateRoot,'browser-bindings.json')),scope=registrationScope(context,bound,instruction.deskOrgId),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:instruction.deskOrgId});})();
  const list=await client.list();must(list?.complete===true&&list.orgId===instruction.deskOrgId,'DESK_ALL_REVISIONS_UNCONFIRMED');
  const selected=reg.chooseReviewed(list.records,instruction.evaluationKey);if(selected.status!=='selected')return{ok:true,status:selected.status,candidates:(selected.candidates||[]).map(r=>({evaluationKey:r.evaluationKey,recipient:r.recipient?.name,servicePeriod:r.servicePeriod,evaluationDate:r.evaluationDate,evaluationRound:r.evaluationRound})),siteWrites:0};
  const bindings=requestedBindings||read(path.join(context.stateRoot,'browser-bindings.json'));registrationScope(context,bindings,instruction.deskOrgId);
  const secret=(loadDeskSecret||require('./desk-bridge.cjs').loadOrCreateSecret)(context.settings.organization.id).secret;
  reg.verifyReviewedSource({data:selected.record,...work,secret});const request=reg.evaluationReadRequest(work.spec),output=privatePath(context,options.out,{existing:false});must(!fs.existsSync(output),'NEW_COLLECTION_DIRECTORY_REQUIRED');
  const lease=C.acquire(context,'evaluation-collect:'+hash(request));let keep=false,adapter,checkpoint=0;
  try{
   fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output);C.writeNewJson(path.join(output,'request.json'),{...request,configHash:context.configHash});
   adapter=makeEvidenceAdapter(root,request,{evaluationsOnly:true,bindings,onCheckpoint:async value=>C.writeNewJson(path.join(output,'source-'+String(++checkpoint).padStart(4,'0')+'.json'),value)});
   must(typeof adapter.sessionId==='string'&&/^[a-zA-Z0-9-]{10,80}$/.test(adapter.sessionId),'COLLECTION_SESSION_ID_REQUIRED');
   C.writeNewJson(path.join(output,'session.json'),{schemaVersion:1,requestHash:hash(request),configHash:context.configHash,leaseId:lease.lease.id,sessionId:adapter.sessionId,evaluationsOnly:true,...(bindings?{bindings}:{})});
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const result=await reg.prepareRegistration({records:list.records,selectedKey:selected.record.evaluationKey,work,secret,today,confirmedRound:instruction.confirmedRound,readCurrent:()=>reg.readCurrentEvaluations(adapter)});
   must(C.loadContext(root).configHash===context.configHash,'CONFIGURATION_CHANGED_DURING_COLLECTION');
   if(result.state!=='ready')return{ok:true,status:result.state,evaluationRound:result.evaluationRound,expectedRound:result.expectedRound,siteWrites:0};
   const document=prepare({spec:result.spec,bundle:result.bundle,schema:work.schema,policy:work.policy,output:path.join(output,'review')});
   C.writeNewJson(path.join(output,'desk-record.json'),result.record);C.writeNewJson(path.join(output,'prepared.json'),{schemaVersion:1,originalWork:work.dir,originalBundleHash:hash(work.bundle),evaluationKey:result.record.evaluationKey,version:result.record.version,contentHash:result.record.contentHash,actualRound:result.actualRound,remainingReviewed:result.remainingReviewed,documentSha256:document.documentSha256,instruction,bindings:bindings||null});
   return{ok:true,status:'prepared',output,actualRound:result.actualRound,remainingReviewed:result.remainingReviewed,siteWrites:0};
  }catch(e){keep=e.preserveLease===true||!!adapter&&adapter.readStateConfirmed?.()!==true;const result={ok:false,status:keep?'read-state-unconfirmed-inspect-before-retry':'preparation-failed',code:e.message,output,requestHash:hash(request),leaseRetained:keep,leaseId:keep?lease.lease.id:null,sessionId:adapter?.sessionId,siteWrites:0};if(fs.existsSync(output))C.writeNewJson(path.join(output,'failure.json'),result);return result;}finally{if(!keep)lease.release();}
 }
 if(command==='evaluation-desk-publish-check'){
  const instruction=read(options.instruction),work=deskWorkFiles(context,options.work),{loadOrCreateSecret,buildDeskDraft:build}=require('./desk-bridge.cjs');
  must(instruction?.action==='evaluation-desk-publish'&&instruction.allowWrite===true&&typeof instruction.recipientName==='string'&&instruction.recipientName.trim(),'DESK_PUBLICATION_INSTRUCTION_REQUIRED');
  must(instruction.organizationId===context.settings.organization.id&&instruction.deskOrgId===context.settings.organization.deskId&&instruction.deskOrgId,'DESK_ORGANIZATION_MISMATCH');
  for(const name of ['spec','schema','bundle','policy'])must(instruction[name+'Hash']===hash(work[name]),'DESK_INSTRUCTION_SCOPE_CHANGED:'+name);
  const secret=(loadDeskSecret||loadOrCreateSecret)(context.settings.organization.id).secret,built=(buildDeskDraft||build)({...work,recipientName:instruction.recipientName,settings:context.settings,secret});
  const deskKey=hash([built.data.subjectKey,built.data.planKey,built.data.servicePeriod]),journal=openJournal(C.statePath(context,'longterm-result-evaluation','desk-publication-journal'),deskKey);
  const lockFile=C.safeWithin(context.root,'state/runtime.lock'),bytes=fs.readFileSync(lockFile),lock=JSON.parse(bytes);
  must(leaseCovers(context,lock,deskKey,'desk-publication-journal')&&options['release-lease']===lock.id,'RECOVERY_LEASE_SCOPE_CHANGED');must(!alive(lock.pid),'RECOVERY_OWNER_STILL_RUNNING');
  const journalBytes=fs.existsSync(journal.lock)?fs.readFileSync(journal.lock):null,journalLock=journalBytes&&JSON.parse(journalBytes);
  if(journalLock)must(journalLock.key===deskKey&&!alive(journalLock.pid),'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
  const {publicationAttempt,verifyAttemptedDraft}=require('./desk-publish-run.cjs');
  const {attempt,dispatch,settled}=publicationAttempt(journal.read(),{leaseId:lock.id,scopeHash:hash(instruction),contentHash:built.contentHash});
  must(journalLock||settled,'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
  if(!journalLock&&sequenceOf(lock.operation)&&sequencePending(context,sequenceOf(lock.operation)).length)throw Error('RECOVERY_JOURNAL_OWNER_OR_SCOPE');
  let event=settled;
  if(!event&&dispatch){
   const client=deskClient?deskClient(context,root):(()=>{const {scope}=require('../environment.cjs').loadScope(root),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:instruction.deskOrgId});})();
   if(!await verifyAttemptedDraft(built,dispatch,client,instruction.deskOrgId))return{ok:false,status:'unknown',code:'DESK_PUBLISH_NOT_YET_CONFIRMED',evaluationKey:dispatch.evaluationKey,siteWrites:0,deskWrites:0,leaseRetained:true};
   event={type:'publish-existing',evaluationKey:dispatch.evaluationKey};
  }
  event||={type:'publish-not-written',evaluationKey:null};
  must(fs.readFileSync(lockFile).equals(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');
  const evidence=C.safeWithin(context.stateRoot,'evaluation-recovery',crypto.randomUUID()+'.json'),locks=[{name:'runtime.lock',sha256:sha(bytes),record:lock}];
  if(journalLock)locks.push({name:path.basename(journal.lock),sha256:sha(journalBytes),record:journalLock});
  C.writeNewJson(evidence,{schemaVersion:1,key:deskKey,result:{state:event.type,evaluationKey:event.evaluationKey,attemptIndex:attempt.index},locks,at:new Date().toISOString()});
  if(journalLock){
   journal.adoptDeadLease(journalLock.id);
   if(!settled)journal.append({...event,attemptIndex:attempt.index,recovered:true});
   journal.release();
  }
  releaseRuntimeLock(context,lockFile,{record:lock,bytes});
  return{ok:true,status:event.type.slice('publish-'.length),evaluationKey:event.evaluationKey,siteWrites:0,deskWrites:0,leaseRetained:fs.existsSync(lockFile),recoveryEvidence:evidence};
 }
 if(command==='evaluation-desk-publish'){
  const instruction=read(options.instruction),work=deskWorkFiles(context,options.work),{loadOrCreateSecret,buildDeskDraft:build}=require('./desk-bridge.cjs');
  must(instruction?.action==='evaluation-desk-publish'&&instruction.allowWrite===true&&typeof instruction.message==='string'&&instruction.message.trim()&&typeof instruction.recipientName==='string'&&instruction.recipientName.trim(),'DESK_PUBLICATION_INSTRUCTION_REQUIRED');
  must(instruction.organizationId===context.settings.organization.id&&instruction.deskOrgId===context.settings.organization.deskId&&instruction.deskOrgId,'DESK_ORGANIZATION_MISMATCH');
  for(const name of ['spec','schema','bundle','policy'])must(instruction[name+'Hash']===hash(work[name]),'DESK_INSTRUCTION_SCOPE_CHANGED:'+name);
  const secret=(loadDeskSecret||loadOrCreateSecret)(context.settings.organization.id).secret;
  const built=(buildDeskDraft||build)({...work,recipientName:instruction.recipientName,settings:context.settings,secret});
  const deskKey=hash([built.data.subjectKey,built.data.planKey,built.data.servicePeriod]),journal=openJournal(C.statePath(context,'longterm-result-evaluation','desk-publication-journal'),deskKey);if(sequenceLease){sequenceLease.assertOwned();sequenceLease.begin('desk-publication-journal',deskKey);}
  const lease=sequenceLease?{release(){}}:C.acquire(context,'evaluation-desk-publish:'+deskKey);let keep=false;
  try{
   if(!sequenceLease)must(!fs.existsSync(journal.lock),'TARGET_PREVIOUS_RUN_UNRESOLVED');
   const loadPublicationScope=()=>{
    must(C.loadContext(root).configHash===context.configHash,'CONFIGURATION_CHANGED_DURING_EXECUTION');
    const {scope}=require('../environment.cjs').loadScope(root);
    sequenceLease?.pinPublicationScope(scope);
    return scope;
   };
   const client=deskClient?deskClient(context,root):(()=>{const scope=loadPublicationScope(),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:context.settings.organization.deskId,onViewerKey:sequenceLease?.pinPublicationViewer});})();
   const identity={leaseId:sequenceLease?.leaseId||lease.lease.id,scopeHash:hash(instruction),contentHash:built.contentHash};
   keep=true;const result=await require('./desk-publish-run.cjs').runPublication({journal,identity,publish:recordDispatch=>require('./desk-publish.cjs').publishDraft({
    built,client,deskOrgId:context.settings.organization.deskId,requestId:crypto.randomUUID(),beforeDispatch:event=>{sequenceLease?.assertOwned();if(!deskClient)loadPublicationScope();recordDispatch(event);}
   })});
   C.writeNewJson(path.join(work.dir,'desk-publish-'+crypto.randomUUID()+'.json'),result);keep=result.leaseRetained;return{ok:['verified','existing'].includes(result.status),...result};
  }finally{if(!keep)lease.release();}
 }
 if(command==='evaluation-collection-check'){
  const folder=privatePath(context,options.work),stored=read(path.join(folder,'request.json')),{configHash,...request}=stored,sessionFile=path.join(folder,'session.json'),failureFile=path.join(folder,'failure.json'),session=fs.existsSync(sessionFile)?read(sessionFile):null,failure=fs.existsSync(failureFile)?read(failureFile):null,prior=session||failure;validateRequest(request);must(configHash===context.configHash&&prior?.requestHash===hash(request)&&typeof prior.sessionId==='string'&&prior.sessionId&&typeof prior.leaseId==='string'&&prior.leaseId,'EXACT_FAILED_COLLECTION_REQUIRED');if(session)must(session.schemaVersion===1&&session.configHash===context.configHash,'EXACT_FAILED_COLLECTION_REQUIRED');if(failure)must(failure.leaseRetained===true&&failure.requestHash===prior.requestHash&&failure.leaseId===prior.leaseId&&failure.sessionId===prior.sessionId,'EXACT_FAILED_COLLECTION_REQUIRED');
  const file=C.safeWithin(root,'state/runtime.lock'),bytes=fs.readFileSync(file),lock=JSON.parse(bytes);must(lock.id===prior.leaseId&&lock.operation==='evaluation-collect:'+hash(request)&&lock.orgKey===context.orgKey&&lock.configHash===context.configHash,'COLLECTION_LEASE_SCOPE_CHANGED');
  if(options['release-lease'])must(options['release-lease']===lock.id&&!alive(lock.pid),'COLLECTION_OWNER_STILL_RUNNING_OR_LEASE_CHANGED');
  {
   const scoped=prior.evaluationsOnly===true?{evaluationsOnly:true,...(prior.bindings?{bindings:prior.bindings}:{})}:{};
   const snapshot=await checkCollection(root,request,prior.sessionId,scoped),result={ok:snapshot.ok===true&&!snapshot.pending&&snapshot.contextMatched===true,status:snapshot.pending?'read-still-pending':snapshot.contextMatched?'read-drained':'context-changed-review',snapshot,leaseRetained:true,siteWrites:0};
   if(options['release-lease']){must(snapshot.ok===true&&snapshot.pending===false&&snapshot.contextMatched===true,'EXACT_READ_SESSION_NOT_DRAINED');const closed=await checkCollection(root,request,prior.sessionId,{...scoped,close:true});must(closed.ok===true&&!closed.pending,'READ_SESSION_CLOSE_UNCONFIRMED');result.closed=closed;const evidence=path.join(folder,'read-recovery-'+crypto.randomUUID()+'.json');C.writeNewJson(evidence,{requestHash:hash(request),lockSha256:sha(bytes),lock,snapshot,closed,siteWrites:0});must(sha(fs.readFileSync(file))===sha(bytes),'COLLECTION_LEASE_CHANGED_DURING_CHECK');fs.unlinkSync(file);result.leaseRetained=false;result.recoveryEvidence=evidence;}
   C.writeNewJson(path.join(folder,'read-check-'+crypto.randomUUID()+'.json'),result);return result;
  }
 }
 if(command==='evaluation-collect'){
  const request=validateRequest(require('./local-notes-prior.cjs').localRequest(read(options.request)));must(typeof request.recipientName==='string'&&request.recipientName.trim(),'RECIPIENT_NAME_REQUIRED');must(request.context.orgId===context.settings.organization.id&&request.context.workerName===context.settings.operator.name,'CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH');const output=privatePath(context,options.out,{existing:false});must(!fs.existsSync(output),'NEW_COLLECTION_DIRECTORY_REQUIRED');
  const lease=C.acquire(context,'evaluation-collect:'+hash(request));let keep=false,checkpoint=0,adapter;try{
   fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output);C.writeNewJson(path.join(output,'request.json'),{...request,configHash:context.configHash});
   adapter=makeEvidenceAdapter(root,request,{onCheckpoint:async value=>{C.writeNewJson(path.join(output,'source-'+String(++checkpoint).padStart(4,'0')+'.json'),value);}});must(typeof adapter.sessionId==='string'&&/^[a-zA-Z0-9-]{10,80}$/.test(adapter.sessionId),'COLLECTION_SESSION_ID_REQUIRED');C.writeNewJson(path.join(output,'session.json'),{schemaVersion:1,requestHash:hash(request),configHash:context.configHash,leaseId:lease.lease.id,sessionId:adapter.sessionId});
   const bundle=await collectEvidence(request,adapter);must(C.loadContext(root).configHash===context.configHash,'CONFIGURATION_CHANGED_DURING_COLLECTION');
   if(request.evaluationId){const target=bundle.reads.evaluations.records.find(r=>r.evaluationId===request.evaluationId&&r.date===request.evaluationDate);if(target)bundle.existing={evaluationId:request.evaluationId,evaluationDate:request.evaluationDate};else{bundle.reads.evaluations.status='failed';bundle.reads.evaluations.error={code:'EXISTING_EVALUATION_NOT_CONFIRMED'};}}
   bundle.complete=Object.values(bundle.reads).every(r=>['complete','empty'].includes(r.status));const bundleFile=path.join(output,'bundle.json');C.writeNewJson(bundleFile,bundle);const schema=adapter.getObservation?.()?.schema;if(schema)C.writeNewJson(path.join(output,'schema.json'),schema);
   const summary={ok:bundle.complete,status:bundle.complete?'collected-needs-content-review':'incomplete-evidence-no-input',output,bundleFile,bundleHash:hash(bundle),reads:Object.fromEntries(Object.entries(bundle.reads).map(([key,value])=>[key,{status:value.status,records:value.records.length,error:value.error?.code||null}])),checkpoints:checkpoint,siteWrites:0};C.writeNewJson(path.join(output,'summary.json'),summary);return summary;
  }catch(e){keep=e.preserveLease===true||!!adapter&&adapter.readStateConfirmed?.()!==true;const result={ok:false,status:keep?'read-state-unconfirmed-inspect-before-retry':'collection-failed',code:e.message,output,requestHash:hash(request),checkpoints:checkpoint,leaseRetained:keep,leaseId:keep?lease.lease.id:null,sessionId:adapter?.sessionId,siteWrites:0};if(fs.existsSync(output))C.writeNewJson(path.join(output,'failure.json'),result);return result;}finally{if(!keep)lease.release();}
 }
 if(command==='evaluation-prepare'){
  const spec=read(options.spec),schema=read(options.schema),bundle=read(options.bundle),policy=read(options.policy);must(spec.context.orgId===context.settings.organization.id&&spec.context.workerName===context.settings.operator.name,'CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH');const output=privatePath(context,options.out,{existing:false}),lease=C.acquire(context,'evaluation-prepare');try{return{ok:true,...prepare({spec,schema,bundle,policy,output}),directory:output};}finally{lease.release();}
 }
 if(command==='evaluation-open'){
  // Opens the needed normal screens and one NEW evaluation input screen (no save, no server write, no draft discarded).
  const request=read(options.request);must(request.context.orgId===context.settings.organization.id&&request.context.workerName===context.settings.operator.name,'CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH');must(typeof request.recipientName==='string'&&request.recipientName.trim(),'RECIPIENT_NAME_REQUIRED');
  const output=privatePath(context,options.out,{existing:false});must(!fs.existsSync(output),'NEW_OPEN_RESULT_FILE_REQUIRED');const lease=C.acquire(context,'evaluation-open');
  try{const adapter=makeAdapter(root),steps=[];let failed=null;
   const menus=[['lt','NPS01322100'],...(request.workerNotesMode==='live'?[['ltRfid','np00000000097']]:[]),['lt','NPS01230000']];
   for(const[service,menuId]of menus){/* keep evaluation in front of the diary */const r=await adapter.openMenu(service,menuId,request.context);steps.push({step:'menu',service,menuId,ok:r.ok===true,code:r.code||null,alreadyOpen:r.alreadyOpen===true});if(r.ok!==true){failed=r.code||'OPEN_MENU_FAILED';break;}}
   if(!failed&&!options['menus-only']){const r=await adapter.openNew({context:request.context,recipientName:request.recipientName});steps.push({step:'open-new',ok:r.ok===true,code:r.code||null,mode:r.mode||null,plan:r.plan||null,evaluationDate:r.evaluationDate||null,goalCount:r.goalCount||null,pending:r.pending===true});if(r.ok!==true)failed=r.code||'OPEN_NEW_FAILED';}
   const result={ok:!failed,code:failed,steps,serverWrites:0};C.writeNewJson(output,result);return{...result,output};}finally{lease.release();}
 }
 if(command==='evaluation-inspect'){
  const request=read(options.request);must(request.context.orgId===context.settings.organization.id&&request.context.workerName===context.settings.operator.name,'CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH');const output=privatePath(context,options.out,{existing:false});must(!fs.existsSync(output),'NEW_INSPECTION_FILE_REQUIRED');const lease=C.acquire(context,'evaluation-inspect');try{const result=await makeAdapter(root).inspect(request);C.writeNewJson(output,result);return{ok:true,output,serverWrites:0};}finally{lease.release();}
 }
 if(command==='evaluation-desk-claim-check'){
  const work=workFiles(context,options.work),key=journalKey(work.spec),journal=openJournal(C.statePath(context,'longterm-result-evaluation','journal'),key),history=journal.read(),prep=read(path.join(path.dirname(work.dir),'prepared.json')),intent=history.findLast(e=>e.type==='registration-intent');
  const finished=finishReadRelease(context,options,key,journal,history);if(finished)return finished;
  must(intent?.evaluationKey===prep.evaluationKey&&intent.contentHash===prep.contentHash&&intent.bindingHash===hash(prep.bindings||null)&&typeof intent.runId==='string'&&!history.some(e=>e.type==='save-attempt'),'EXACT_PRE_SAVE_CLAIM_REQUIRED');
  const lockFile=C.safeWithin(context.root,'state/runtime.lock'),bytes=fs.readFileSync(lockFile),lock=JSON.parse(bytes);must(leaseCovers(context,lock,key)&&options['release-lease']===lock.id&&!alive(lock.pid),'RECOVERY_LEASE_SCOPE_CHANGED');
  must(!intent.leaseId||intent.leaseId===lock.id,'REGISTRATION_RECOVERY_SCOPE_CHANGED');
  if(!fs.existsSync(journal.lock)){
   const completed=history.findLast(e=>e.type==='registration-report-confirmed'&&e.runId===intent.runId&&e.outcome==='not-verified'&&e.index>intent.index);
   must(completed&&intent.leaseId===lock.id&&!sequenceOf(lock.operation)&&!pendingNativeRead(history),'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
   releaseRuntimeLock(context,lockFile,{record:lock,bytes});
   return{ok:true,status:'claim-settled',leaseRetained:fs.existsSync(lockFile),siteWrites:0,deskWrites:0};
  }
  must(!alive(C.readJson(journal.lock).pid),'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
  const client=deskClient?deskClient(context,root):(()=>{const scope=registrationScope(context,prep.bindings,prep.instruction.deskOrgId),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:prep.instruction.deskOrgId});})();
  {
   if(!history.some(e=>e.type==='registration-claim-started'&&e.runId===intent.runId)){must(!pendingNativeRead(history),'PRIOR_READ_REQUIRES_CHECK');journal.adoptDeadLease(C.readJson(journal.lock).id);journal.append({type:'registration-claim-not-dispatched',runId:intent.runId});must(sha(fs.readFileSync(lockFile))===sha(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');const recoveryEvidence=releaseReadLocks(context,journal,key,lock.id,{readClosed:true,pending:false,contextMatched:true});return{ok:true,status:'claim-not-dispatched',leaseRetained:fs.existsSync(C.safeWithin(context.root,'state/runtime.lock')),siteWrites:0,deskWrites:0,recoveryEvidence};}
   let desk=await client.get(prep.evaluationKey),deskWrites=0;must(desk.status==='reviewed'&&desk.contentHash===intent.contentHash,'DESK_ATTEMPT_UNCONFIRMED');
   journal.adoptDeadLease(C.readJson(journal.lock).id);
   if(desk.lease?.runId===intent.runId){const previous=history.findLast(e=>e.type==='registration-report-started'&&e.runId===intent.runId&&e.outcome==='not-verified')?.body,body=previous||{evaluationKey:prep.evaluationKey,runId:intent.runId,outcome:'not-verified',failureCode:'RECOVERED_BEFORE_SAVE',saveAttempted:false};must(body.evaluationKey===prep.evaluationKey&&body.runId===intent.runId&&body.saveAttempted===false,'DESK_REPORT_CONFLICT');journal.append({type:'registration-report-started',runId:intent.runId,outcome:'not-verified',body,recovered:true});desk=await client.result(body);deskWrites=1;}
   must(desk.status==='reviewed'&&!desk.lease&&desk.lastAttempt?.runId===intent.runId&&desk.lastAttempt.saveAttempted===false,'DESK_ATTEMPT_UNCONFIRMED');journal.append({type:'registration-claim-recovered',runId:intent.runId});
   const pending=pendingNativeRead(journal.read());if(pending)return{ok:false,status:'read-session-pending',leaseRetained:true,readKind:pending.readKind||'native',siteWrites:0,deskWrites};
   must(sha(fs.readFileSync(lockFile))===sha(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');const recoveryEvidence=releaseReadLocks(context,journal,key,lock.id,{readClosed:true,pending:false,contextMatched:true});return{ok:true,status:'claim-settled',leaseRetained:fs.existsSync(C.safeWithin(context.root,'state/runtime.lock')),siteWrites:0,deskWrites,recoveryEvidence};
  }
 }
 if(command==='evaluation-desk-report'){
  const work=workFiles(context,options.work),key=journalKey(work.spec),journal=openJournal(C.statePath(context,'longterm-result-evaluation','journal'),key),history=journal.read(),prep=read(path.join(path.dirname(work.dir),'prepared.json'));
  must(!pendingNativeRead(history),'PRIOR_READ_REQUIRES_CHECK');const intent=history.findLast(e=>e.type==='registration-intent'),attempt=history.findLast(e=>e.type==='save-attempt'),verified=history.findLast(e=>e.type==='verified');
  must(intent?.evaluationKey===prep.evaluationKey&&intent.runId&&attempt?.specHash===hash(work.spec)&&attempt.index>intent.index&&verified&&verified.index>attempt.index&&verified.evaluationId&&verified.reopened?.mode==='UPDATE'&&verified.reopened.evaluationDateEnabled===false&&verified.reopened.valuesHash===hash(comparable(work.spec)),'VERIFIED_SAVE_REQUIRED');
  must(typeof intent.deskOrgId==='string'&&intent.deskOrgId===prep.instruction?.deskOrgId&&intent.bindingHash===hash(prep.bindings||null)
   &&/^[a-f0-9]{64}$/.test(intent.contentHash||'')&&intent.contentHash===prep.contentHash&&intent.actualRound===prep.actualRound&&intent.actualRound===work.spec.evaluationRound,'REGISTRATION_RECOVERY_SCOPE_CHANGED');
  const lockFile=C.safeWithin(context.root,'state/runtime.lock'),bytes=fs.readFileSync(lockFile),lock=JSON.parse(bytes);must(leaseCovers(context,lock,key)&&options['release-lease']===lock.id&&!alive(lock.pid),'RECOVERY_LEASE_SCOPE_CHANGED');
  must(!intent.leaseId||intent.leaseId===lock.id,'REGISTRATION_RECOVERY_SCOPE_CHANGED');
  if(!fs.existsSync(journal.lock)){
   const confirmed=history.findLast(e=>e.type==='registration-report-confirmed'&&e.runId===intent.runId&&e.outcome==='verified'&&e.index>verified.index);
   must(confirmed&&(confirmed.releaseLeaseId===lock.id||intent.leaseId===lock.id)&&!sequenceOf(lock.operation),'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
   const recoveryEvidence=releaseVerifiedLocks(context,journal,key,lock.id,{state:'verified',reopenedVerified:true,evaluationId:verified.evaluationId});
   return{ok:true,status:'verified',siteWrites:0,deskWrites:0,leaseRetained:fs.existsSync(lockFile),recoveryEvidence};
  }
  must(!alive(C.readJson(journal.lock).pid),'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
  const started=history.findLast(e=>e.type==='registration-report-started'&&e.runId===intent.runId&&e.outcome==='verified'),body=started?.body||{evaluationKey:prep.evaluationKey,runId:intent.runId,outcome:'verified',evaluationId:verified.evaluationId,verifiedAt:new Date().toISOString(),ltWrittenDate:null,evaluationRound:prep.actualRound};
  must(body.evaluationKey===prep.evaluationKey&&body.runId===intent.runId&&body.outcome==='verified'&&body.evaluationId===verified.evaluationId&&body.evaluationRound===prep.actualRound,'REGISTRATION_REPORT_MISMATCH');
  const client=deskClient?deskClient(context,root):(()=>{const scope=registrationScope(context,prep.bindings,prep.instruction.deskOrgId),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:prep.instruction.deskOrgId});})();
  {
   let desk=await client.get(prep.evaluationKey),deskWrites=0;
   const matches=record=>{const r=record?.registration;return record?.status==='registered'&&r?.runId===body.runId&&r.evaluationId===body.evaluationId&&r.verifiedAt===body.verifiedAt&&(r.evaluationRound??null)===(body.evaluationRound??null)&&(r.ltWrittenDate??null)===(body.ltWrittenDate??null);};
   must(sha(fs.readFileSync(lockFile))===sha(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');
   journal.adoptDeadLease(C.readJson(journal.lock).id);
   if(desk.status==='registered')must(started&&matches(desk),'DESK_REPORT_CONFLICT');
   else{
    must(desk.status==='reviewed'&&(desk.lease?.runId===intent.runId||!desk.lease&&desk.lastAttempt?.runId===intent.runId),'DESK_ATTEMPT_UNCONFIRMED');
    if(!started)journal.append({type:'registration-report-started',runId:intent.runId,outcome:'verified',body,recovered:true});
    desk=await client.result(body);deskWrites=1;must(matches(desk),'DESK_RESULT_UNCONFIRMED');
   }
   must(sha(fs.readFileSync(lockFile))===sha(bytes),'RECOVERY_LEASE_CHANGED_DURING_VERIFICATION');journal.append({type:'registration-report-confirmed',runId:intent.runId,outcome:'verified',recovered:true,releaseLeaseId:lock.id});
   const recoveryEvidence=releaseVerifiedLocks(context,journal,key,lock.id,{state:'verified',reopenedVerified:true,evaluationId:verified.evaluationId});return{ok:true,status:'verified',siteWrites:0,deskWrites,leaseRetained:fs.existsSync(lockFile),recoveryEvidence};
  }
 }
 if(command==='evaluation-desk-read-check'){
  const work=workFiles(context,options.work),key=journalKey(work.spec),journal=openJournal(C.statePath(context,'longterm-result-evaluation','journal'),key),history=journal.read(),pending=pendingNativeRead(history);
  const finished=finishReadRelease(context,options,key,journal,history);if(finished)return finished;
  must(pending?.readKind==='evaluation-list'&&pending.readSessionId&&!history.some(e=>e.type==='save-attempt'),'EXACT_PRE_SAVE_LIST_READ_REQUIRED');
  const prep=read(path.join(path.dirname(work.dir),'prepared.json')),request=require('./desk-register.cjs').evaluationReadRequest(work.spec),lockFile=C.safeWithin(context.root,'state/runtime.lock'),bytes=fs.readFileSync(lockFile),lock=JSON.parse(bytes);
  const started=history.findLast(e=>e.type==='list-read-started'&&e.readSessionId===pending.readSessionId);must(started?.requestHash===hash(request)&&started.bindingHash===hash(prep.bindings||null),'READ_BINDING_CHANGED');
  must(leaseCovers(context,lock,key)&&options['release-lease']===lock.id&&!alive(lock.pid),'READ_LEASE_SCOPE_CHANGED');
  must(fs.existsSync(journal.lock)&&!alive(C.readJson(journal.lock).pid),'RECOVERY_JOURNAL_OWNER_OR_SCOPE');
  const intent=history.findLast(e=>e.type==='registration-intent');must(intent&&intent.evaluationKey===prep.evaluationKey&&typeof intent.runId==='string'&&prep.instruction?.deskOrgId,'DESK_ATTEMPT_UNCONFIRMED');
  const client=deskClient?deskClient(context,root):(()=>{const scope=registrationScope(context,prep.bindings,prep.instruction.deskOrgId),request=require('./desk-transport.cjs').makeDeskRequest({scope,bridge:require('../aside-cli.cjs').runAside});return require('./desk-client.cjs').createDeskClient({request,expectedOrg:prep.instruction.deskOrgId});})();
  const desk=await client.get(intent.evaluationKey);must(desk?.status==='reviewed'&&!desk.lease&&desk.lastAttempt?.runId===intent.runId&&desk.lastAttempt.saveAttempted===false,'DESK_ATTEMPT_UNCONFIRMED');
  {
   const opts={evaluationsOnly:true,...(prep.bindings?{bindings:prep.bindings}:{})},snapshot=await checkCollection(root,request,pending.readSessionId,opts);must(snapshot.ok===true&&!snapshot.pending&&snapshot.contextMatched===true,'EXACT_READ_SESSION_NOT_DRAINED');
   const closed=await checkCollection(root,request,pending.readSessionId,{...opts,close:true});must(closed.ok===true&&!closed.pending&&closed.contextMatched===true,'READ_SESSION_CLOSE_UNCONFIRMED');
   must(sha(fs.readFileSync(lockFile))===sha(bytes),'READ_LEASE_CHANGED_DURING_CHECK');const evidence=path.join(path.dirname(work.dir),'list-read-recovery-'+crypto.randomUUID()+'.json');C.writeNewJson(evidence,{requestHash:hash(request),readSessionId:pending.readSessionId,snapshot,closed,siteWrites:0});
   journal.adoptDeadLease(C.readJson(journal.lock).id);journal.append({type:'read-recovered',readSessionId:pending.readSessionId,readKind:'evaluation-list',specHash:hash(work.spec),evidence,saveReconciliationRequired:false});
   const recoveryEvidence=releaseReadLocks(context,journal,key,lock.id,{readClosed:true,pending:false,contextMatched:true,readSessionId:pending.readSessionId});return{ok:true,readClosed:true,leaseRetained:fs.existsSync(C.safeWithin(context.root,'state/runtime.lock')),recoveryEvidence,siteWrites:0};
  }
 }
 const work=workFiles(context,options.work),key=journalKey(work.spec),journalRoot=C.statePath(context,'longterm-result-evaluation','journal'),journal=openJournal(journalRoot,key);
 const registrationIntent=journal.read().findLast(e=>e.type==='registration-intent');let adapter;
 if(command==='evaluation-reconcile'&&options['release-lease']&&registrationIntent)must(false,'DESK_REPORT_REQUIRED_BEFORE_RELEASE');
 if(registrationIntent){const prep=read(path.join(path.dirname(work.dir),'prepared.json'));must(registrationIntent.bindingHash===hash(prep.bindings||null),'READ_BINDING_CHANGED');adapter=makeAdapter(root,{bindings:prep.bindings||undefined});}else adapter=makeAdapter(root);
 if(command==='evaluation-read-check'){
  const history=journal.read(),finished=finishReadRelease(context,options,key,journal,history);if(finished)return finished;
  const pending=pendingNativeRead(history);must(pending?.readSessionId,'EXACT_PRIOR_NATIVE_READ_REQUIRED');must(pending.readKind!=='evaluation-list','EVALUATION_LIST_READ_REQUIRES_DESK_CHECK');const attempted=history.some(e=>e.type==='save-attempt'),closing=!!(options['close-read']||options['release-lease']);
  if(registrationIntent&&options['release-lease']&&!attempted)must(history.some(e=>e.type==='registration-claim-recovered'&&e.runId===registrationIntent.runId),'DESK_CLAIM_CHECK_REQUIRED');
  const globalLock=C.safeWithin(root,'state/runtime.lock'),bytes=fs.readFileSync(globalLock),lease=JSON.parse(bytes);must(leaseCovers(context,lease,key),'NATIVE_READ_LEASE_SCOPE_CHANGED');if(options['release-lease']){must(!attempted,'SAVED_EVALUATION_RECONCILIATION_REQUIRED');must(options['release-lease']===lease.id,'NATIVE_READ_LEASE_ID_CHANGED');}if(options['close-read'])must(options['close-read']===pending.readSessionId,'NATIVE_READ_SESSION_CHANGED');if(closing)must(!alive(lease.pid),'READ_OWNER_STILL_RUNNING');
  {
   const snapshot=await adapter.checkPendingRead(work.spec,pending.readSessionId),result={ok:snapshot.ok===true&&!snapshot.pending&&snapshot.contextMatched===true,status:snapshot.pending?'read-still-pending':'read-drained',snapshot,readSessionId:pending.readSessionId,leaseRetained:true,saveReconciliationRequired:attempted,siteWrites:0};
   if(closing){must(result.ok,'NATIVE_READ_NOT_DRAINED');const closed=await adapter.checkPendingRead(work.spec,pending.readSessionId,{close:true});must(closed.ok===true&&!closed.pending&&closed.contextMatched===true,'NATIVE_READ_CLOSE_UNCONFIRMED');must(sha(fs.readFileSync(globalLock))===sha(bytes),'NATIVE_READ_LEASE_CHANGED_DURING_CHECK');const file=path.join(work.dir,'native-read-check-'+crypto.randomUUID()+'.json');C.writeNewJson(file,{snapshot,closed,readSessionId:pending.readSessionId,siteWrites:0});journal.adoptDeadLease(C.readJson(journal.lock).id);journal.append({type:'read-recovered',readSessionId:pending.readSessionId,specHash:hash(work.spec),evidence:file,saveReconciliationRequired:attempted});result.readClosed=true;result.evidence=file;if(options['release-lease']){result.recoveryEvidence=releaseReadLocks(context,journal,key,options['release-lease'],{readClosed:true,pending:false,contextMatched:true,readSessionId:pending.readSessionId});result.leaseRetained=fs.existsSync(globalLock);}}
   return result;
  }
 }
 if(command==='evaluation-run'){
  const instruction=read(options.instruction);must(instruction.documentSha256===work.review.documentSha256&&sha(fs.readFileSync(path.join(work.dir,'review.docx')))===work.review.documentSha256,'REVIEWED_DOCUMENT_CHANGED_OR_UNBOUND');
  must(!journal.read().some(e=>e.type==='save-attempt'),'PRIOR_SAVE_ATTEMPT_RECONCILE_ONLY');const lease=C.acquire(context,'evaluation:'+key);let keep=false;try{const result=await runEvaluation({...work,instruction,journal},adapter);keep=!!result.reconcileRequired;C.writeNewJson(path.join(work.dir,'run-'+crypto.randomUUID()+'.json'),result);return result;}catch(e){keep=true;const h=journal.read();keep=h.some(x=>x.type==='save-attempt')||!!pendingNativeRead(h);throw e;}finally{if(!keep)lease.release();}
 }
 if(command==='evaluation-reconcile'){
  const globalLock=path.join(context.root,'state/runtime.lock');must(fs.existsSync(globalLock),'RECONCILIATION_LEASE_MISSING');const lease=C.readJson(globalLock);must(leaseCovers(context,lease,key),'DIFFERENT_OPERATION_OWNS_WORKSPACE');must(!alive(lease.pid),'RECONCILIATION_OWNER_STILL_RUNNING');must(fs.existsSync(journal.lock),'RECONCILIATION_JOURNAL_LEASE_MISSING');const journalLease=C.readJson(journal.lock);must(journalLease.key===key&&!alive(journalLease.pid),'RECONCILIATION_JOURNAL_OWNER_OR_SCOPE');
  {
   const history=journal.read(),attempt=history.findLast(e=>e.type==='save-attempt'),baseline=history.findLast(e=>e.type==='baseline'&&e.specHash===hash(work.spec))?.baseline;must(!(options['release-lease']&&history.some(e=>e.type==='registration-intent')),'DESK_REPORT_REQUIRED_BEFORE_RELEASE');must(attempt?.specHash===hash(work.spec),'EXACT_PRIOR_ATTEMPT_REQUIRED');must(!pendingNativeRead(history),'PRIOR_READ_REQUIRES_CHECK');journal.adoptDeadLease(C.readJson(journal.lock).id);const readSessionId=crypto.randomUUID();journal.append({type:'reconcile-read-started',specHash:hash(work.spec),readSessionId});let snapshot;try{snapshot=await adapter.readServer(work.spec,{readSessionId});}catch(e){if(e.preserveLease===true&&e.readSessionId&&e.readSessionId!==readSessionId)throw Error('RECONCILIATION_READ_SESSION_CHANGED');throw e;}journal.append({type:'reconcile-read-completed',specHash:hash(work.spec),readSessionId});const result=reconcileAttempt({spec:work.spec,baseline,attempt},snapshot);
   if(result.state==='verified'){try{const reopened=await adapter.reopenSaved(result.evaluationId,work.spec);must(reopened.mode==='UPDATE'&&reopened.evaluationDateEnabled===false&&reopened.valuesHash===hash(comparable(work.spec)),'REOPEN_VERIFICATION_FAILED');result.reopenedVerified=true;journal.append({type:'verified',evaluationId:result.evaluationId,reopened,reconciled:true});}catch(e){result.state='unknown';result.differences.push(e.message);}}
   const output=path.join(work.dir,'reconciliation-'+crypto.randomUUID()+'.json');C.writeNewJson(output,{result,snapshot,siteWrites:0});if(options['release-lease'])result.recoveryEvidence=releaseVerifiedLocks(context,journal,key,options['release-lease'],result);return{ok:result.state==='verified',...result,output,siteWrites:0};
  }
 }
 throw Error('SUPPORTED_EVALUATION_COMMAND_REQUIRED');
}
module.exports={main,privatePath,releaseVerifiedLocks,releaseReadLocks,leaseCovers,sequencePending};
