'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const C=require('./context.cjs'),{activeRelease,materializeState}=require('./active.cjs'),{scopeFor,loadScope}=require('./environment.cjs'),{runAside}=require('./aside-cli.cjs');
const catalog=require('../catalog.json');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function argsMap(args){const o={};for(let i=0;i<args.length;i+=2){if(!/^--[a-z][a-z-]*$/.test(args[i])||!args[i+1]||o[args[i].slice(2)]!==undefined)throw Error('NAMED_ARGUMENTS_REQUIRED');o[args[i].slice(2)]=args[i+1];}return o;}
function skillEntry(root,id){const release=activeRelease(root);if(!catalog.skills.some(s=>s.id===id)){const registryFile=path.join(root,'addons/registry.json'),registry=fs.existsSync(registryFile)?C.readJson(registryFile):{};const addon=registry[id];if(!addon?.enabled)throw Error('UNKNOWN_SKILL');return C.safeWithin(root,'addons',id,addon.version,'skills',id,'SKILL.md');}return C.safeWithin(release.root,'skills',id,'SKILL.md');}
function writeIntent(entry,p){
 if(/(?:^|\/)desk-publish-prepared\.js$/.test(entry))return true;
 // 4번 정식 진입: 상태 조회(status)만 읽기, 그 밖(run·resume·값 없음)은 업무데스크 쓰기 가능 실행으로 분류한다(2026-11-20 P1).
 if(/(?:^|\/)monthly-four\.cjs$/.test(entry)&&!(p.Apply===true||p.apply===true))return String(p.Mode||'').toLowerCase()!=='status';
 if(p.Apply===true||p.apply===true||p.Params?.Apply===true||p.Params?.apply===true)return true;
 const modes=[p.Mode,p.mode,p.Action,p.action,p.Phase,p.phase,p.Params?.Mode,p.Params?.mode,p.Params?.phase,p.Params?.action].filter(x=>typeof x==='string').map(x=>x.toLowerCase());
 if(modes.some(x=>['apply','import','delete','cancel','add','publish','save','claim','transition','complete','release','record'].includes(x)))return true;
 if(/(?:put|post|save|register|delete|import)/i.test(p.Step||''))return true;
 if(/fix-schedule\.js$/.test(p.Script||'')&&p.Params?.dry!=='1')return true;
 if(/(?:lt-fill|cm-basic-write|cm-basic-delete|import-tags)\.js$/.test(p.Script||'')&&p.Params?.dry!=='1')return true;
 if(p.Params?.approve||p.Approve)return true;
 if(/(?:^|\/)desk-run\.ps1$/.test(entry))return true;
 if(/(?:^|\/)desk-prepare\.ps1$/.test(entry)&&p.PreviewOnly!==true)return true;
 if(/(?:^|\/)(?:apply|delete-run|basic-apply|basic-delete|register)\.ps1$/.test(entry)&&!['check','verify','status','report'].includes(String(p.Mode||'').toLowerCase()))return true;
 return false;
}
function validateInstruction(input,skill,entry,parameters,context){
 if(!writeIntent(entry,parameters))return false;const a=input.instruction;
 if(a?.action!=='write'||a.scopeHash!==hash({skill,entry,parameters})||a.organizationId!==context.settings.organization.id||typeof a.message!=='string'||!a.message.trim())throw Error('MATCHING_USER_WRITE_INSTRUCTION_REQUIRED');
 for(const key of ['Spec','RequestFile','ResumeFile','LocalFile','ManifestFile','BatchFile','SurveyFile','PlanFile','source','file','approval','public','local','review','resolved'])if(typeof parameters[key]==='string'&&fs.existsSync(parameters[key])){const actual=ensurePrivateFile(context,parameters[key]),digest=crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex');if(a.files?.[key]!==digest)throw Error('APPROVED_SOURCE_FILE_CHANGED_OR_UNBOUND');}
 return true;
}
// 공용 점유. 4번 정식 진입은 점유 이름에 실행 runId를 붙인다. 같은 실행이 결과 불명으로 남긴 점유는
// 그 실행의 명시 이어하기(Mode resume)만 이어받으며(이어받은 뒤 쓰기 전 대조는 실행기의 reconcile이 한다), 다른 실행·업무·새 실행은 기존대로 막는다.
// 점유 파일은 지우거나 바꾸지 않고, 확인된 결과로 끝날 때만 기존 규칙대로 해제한다(2026-11-20 P 결정).
function acquireCallLease(context,skill,entry,parameters){
 let operation=skill+':'+entry;
 const four=skill==='care-visit-review'&&entry==='scripts/monthly-four.cjs'&&typeof parameters.RequestFile==='string';
 if(four){try{const r=C.readJson(ensurePrivateFile(context,parameters.RequestFile));if(typeof r?.runId==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(r.runId))operation+='#'+r.runId;}catch{}}
 try{return C.acquire(context,operation);}catch(e){
  if(e.code!=='WORKSPACE_BUSY_OR_PREVIOUS_RUN_UNCONFIRMED'||!four||!operation.includes('#')||String(parameters.Mode||'').toLowerCase()!=='resume')throw e;
  const file=C.safeWithin(context.root,'state','runtime.lock');let held;try{if(fs.lstatSync(file).isSymbolicLink())throw e;held=C.readJson(file);}catch{throw e;}
  if(held?.schemaVersion!==1||typeof held.id!=='string'||!held.id||held.operation!==operation||held.orgKey!==context.orgKey||held.configHash!==context.configHash)throw e;
  // 살아 있는 소유자의 점유는 이어받지 않는다: 이전 호출이 결과 불명으로 이 점유를 남겼다는 요약 기록이 있거나, 소유 프로세스가 이미 끝났을 때만(2026-11-20 독립 검토 Critical 1).
  if(!retainedBySummary(context,held.id,skill,entry)&&processAlive(held.pid)!==false)throw e;
  const assertOwned=()=>{let current;try{current=C.readJson(file);}catch{const x=Error('LEASE_OWNERSHIP_CHANGED');x.code='LEASE_OWNERSHIP_CHANGED';throw x;}if(current?.id!==held.id){const x=Error('LEASE_OWNERSHIP_CHANGED');x.code='LEASE_OWNERSHIP_CHANGED';throw x;}};
  return{lease:held,inherited:true,adopted:true,assertOwned,release(){assertOwned();fs.unlinkSync(file);}};
 }
}
function retainedBySummary(context,leaseId,skill,entry){
 const runs=C.safeWithin(context.stateRoot,'runs');if(!fs.existsSync(runs))return false;
 for(const d of fs.readdirSync(runs))for(const n of ['summary.json','summary-error.json']){const f=path.join(runs,d,n);if(!fs.existsSync(f))continue;try{const s=C.readJson(f);if(s?.leaseRetained===true&&s.leaseId===leaseId&&s.skill===skill&&s.entry===entry)return true;}catch{}}
 return false;
}
// true=살아 있음, false=끝남, null=판정 불가(이어받지 않음).
function processAlive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return null;try{process.kill(pid,0);return true;}catch(e){return e.code==='ESRCH'?false:e.code==='EPERM'?true:null;}}
function ensurePrivateFile(context,file){const resolved=fs.realpathSync(path.resolve(file)),rel=path.relative(context.stateRoot,resolved);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('ORGANIZATION_PRIVATE_INPUT_REQUIRED');return C.safeWithin(context.stateRoot,rel);}
async function call({root,skill,entry,inputFile,spawnProcess=spawnSync,bridge=runAside}){
 if(catalog.skills.find(s=>s.id===skill)?.releaseStatus==='paused')throw Error('SKILL_RELEASE_PAUSED');
 const context=C.loadContext(root),release=activeRelease(root);if(!catalog.skills.some(s=>s.id===skill)||!/^scripts\/[a-zA-Z0-9._-]+\.(?:ps1|js|cjs)$/.test(entry))throw Error('INSTALLED_SCRIPT_ENTRY_REQUIRED');
 const script=C.safeWithin(release.root,'skills',skill,entry);if(!fs.existsSync(script))throw Error('INSTALLED_SCRIPT_MISSING');
 const input=C.readJson(ensurePrivateFile(context,inputFile)),parameters=input.parameters;if(!parameters||Array.isArray(parameters)||typeof parameters!=='object')throw Error('PARAMETERS_OBJECT_REQUIRED');
 if(skill==='care-visit-review'&&entry==='scripts/monthly-four.cjs'&&String(parameters.Mode||'').toLowerCase()==='status')return statusMonthlyFour({context,release,script,parameters});
 const writing=validateInstruction(input,skill,entry,parameters,context);continueInstruction(context,skill,entry,parameters,input);const lease=acquireCallLease(context,skill,entry,parameters),runId=crypto.randomUUID(),runDir=C.safeWithin(context.stateRoot,'runs',runId);fs.mkdirSync(runDir,{recursive:true});let keepLease=false,executionStarted=false;
 try{
  materializeState(context,release.root);const p={...parameters},source=fs.readFileSync(script,'utf8'),client=path.join(release.root,'runtime/client');
  for(const key of ['OrgName','org']){if(p[key]!==undefined&&p[key]!==context.settings.organization.name)throw Error('PARAMETER_ORGANIZATION_MISMATCH');}
  if(/\$OrgName\b/.test(source))p.OrgName=context.settings.organization.name;
  if(/\$ProductRoot\b/.test(source)){if(p.ProductRoot&&path.resolve(p.ProductRoot)!==client)throw Error('EXTERNAL_PRODUCT_SOURCE_NOT_ALLOWED');p.ProductRoot=client;}
  if(/\$Writer\b/.test(source)){if(!p.Writer)p.Writer=context.settings.operator.name;if(!p.Writer)throw Error('CURRENT_OPERATOR_REQUIRED');}
  if(/\$Job\b/.test(source)){if(!p.Job)p.Job=context.settings.operator.job;if(!p.Job)throw Error('CURRENT_OPERATOR_JOB_REQUIRED');}
  for(const key of ['Since','Opening'])if(new RegExp('\\$'+key+'\\b').test(source)&&!p[key]){if(!context.settings.organization.openingDate)throw Error('ORGANIZATION_OPENING_DATE_REQUIRED');p[key]=context.settings.organization.openingDate;}
  const parameterFile=path.join(runDir,'parameters.json');C.writeNewJson(parameterFile,redactToken(p));C.writeNewJson(path.join(runDir,'request.json'),{skill,entry,inputHash:hash(input),writing,configHash:context.configHash,at:new Date().toISOString()});
  const env={...process.env,LONGTERM_WORKSPACE:root,LONGTERM_RUNTIME_LEASE_ID:lease.lease.id,LONGTERM_RUN_TEMP:path.join(runDir,'tmp')};fs.mkdirSync(env.LONGTERM_RUN_TEMP);
  let result;
  if(entry.endsWith('.ps1')){executionStarted=true;result=spawnProcess('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'invoke.ps1'),'-Script',script,'-ParameterFile',parameterFile],{cwd:root,encoding:'utf8',windowsHide:true,env:require('./process-env.cjs').windowsPowerShellEnvironment(env),timeout:3600000,maxBuffer:16*1024*1024});}
  else{
   if(skill==='caremanager-next-month'&&entry==='scripts/desk-publish-prepared.js'){executionStarted=true;result=await require('./prepared-call.cjs').publishReviewedPair({context,release,script,parameters:p,runDir,bridge});}
   else if(skill==='care-visit-review'&&entry==='scripts/monthly-four.cjs'){executionStarted=true;result=await callMonthlyFour({context,release,script,parameters:p,runDir,writing,bridge,env});}
   else{if(!['longterm-recipient-import','longterm-staff-import','longterm-care-record'].includes(skill)||entry!=='scripts/desk.js')throw Error('USE_DOCUMENTED_NODE_ENTRY');const bound=deskBinding(context,p);executionStarted=true;result=await callDesk({context,release,skill,script,parameters:p,runDir,writing,bridge,bound});}
  }
  fs.writeFileSync(path.join(runDir,'stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(runDir,'stderr.txt'),result.stderr||'');
  const output=(result.stdout||'')+(result.stderr||''),machineFailure=/"ok"\s*:\s*false/.test(output),uncertain=writing&&!result.writeNotAttempted&&(result.status!==0||machineFailure||/"(?:status|state|outcome)"\s*:\s*"(?:unknown|conflict|fail|상태 확인 필요|삭제된 채 남음)"/i.test(output));
  // 이어받은 결과 불명 점유는 실행기가 확인된 결과(confirmed)를 돌려줬을 때만 푼다. 쓰기 전 거절·상태 조회는 이전 불명 상태가 그대로이므로 점유를 둔다.
  keepLease=uncertain||(lease.adopted===true&&result.confirmed!==true);const success=result.status===0&&!machineFailure&&!uncertain;const summary={ok:success,status:uncertain?'unknown-inspect-before-retry':success?'process-finished-check-workflow-verification':'failed',runId,skill,entry,writing,leaseRetained:keepLease,...(keepLease?{leaseId:lease.lease.id}:{}),runDir,...(result.code?{code:result.code}:{}),...(result.report?{report:result.report}:{})};C.writeNewJson(path.join(runDir,'summary.json'),redactToken(summary));return summary;
 }catch(e){keepLease=(writing&&executionStarted)||lease.adopted===true;const summary={ok:false,status:keepLease?'unknown-inspect-before-retry':'blocked-before-write',code:e.code||e.message,runId,skill,entry,writing,leaseRetained:keepLease,...(keepLease?{leaseId:lease.lease.id}:{}),runDir};const file=path.join(runDir,'summary-error.json');C.writeNewJson(file,summary);return summary;}finally{if(!keepLease)lease.release();}
}
// 10·11·12번 desk.js: 시작 때 binding을 확인해 작업별 target 하나(수집=기관20A LT, 조회·게시=업무데스크)를 확정하고
// 그 target만 담은 scope 연결을 넘긴다. binding이 없거나 다른 target을 요구하면 실행 전에 멈춘다(자동 탐색 없음, 2026-11-18 창 고정).
function deskBinding(context,p){
 if(p.action==='prepare')return null;const lt=/^collect/.test(String(p.action||'read')),{scope}=loadScope(context.root);
 const target=scope.targets.find(t=>lt?t.service==='lt'&&t.role==='20A':t.service==='desk');if(!target)throw Error(lt?'BOUND_LT_20A_TAB_REQUIRED':'BOUND_DESK_TAB_REQUIRED');
 if(p.target!==undefined&&p.target!==target.targetId)throw Error('CLIENT_TARGET_OUTSIDE_BINDING');return{scope:{...scope,targets:[target]},target};
}
async function callDesk({context,release,skill,script,parameters:p,runDir,writing,bridge=runAside,bound}){
 const options={...p};if(options.org&&options.org!==context.settings.organization.name)throw Error('PARAMETER_ORGANIZATION_MISMATCH');if(options.origin&&options.origin!==context.settings.origins.desk)throw Error('PARAMETER_ORIGIN_MISMATCH');const client=path.join(release.root,'runtime/client');if(options['repo-root']&&path.resolve(options['repo-root'])!==client)throw Error('EXTERNAL_PRODUCT_SOURCE_NOT_ALLOWED');options.org=context.settings.organization.name;options.origin=context.settings.origins.desk;options['repo-root']=client;
 if(!options.out)options.out=path.join(release.root,'skills',skill,'data',path.basename(runDir)+'.json');
 if(bound)options.target=bound.target.targetId;
 const r=await require(script).execute(options,bound?(source,o={})=>bridge(source,{...o,scope:bound.scope,writeAttempted:writing===true}):undefined);return{status:r.ok?0:1,stdout:JSON.stringify({ok:r.ok,outcome:r.outcome||null,status:r.code||null,resultFile:options.out}),stderr:'',writeNotAttempted:r.ok===false&&r.outcome==='not-written'};
}
// 4번 정식 진입(2026-11-20 P1): 공용 점유를 쥔 채 같은 프로세스에서 진입 main을 부르고, 점유 id는 env로 물려준다.
// 진입은 실행 보고(RunReport, 개인정보 없음)를 돌려준다. 결과 불명(unknown)만 점유를 유지하고, 보류·확정 거절·쓰기 전 거절은 점유를 푼다.
// 진입이 예외로 끝나면 위 공통 규칙대로 쓰기 실행이면 점유를 유지한다.
// 4번 계속 진행(2026-11-20 사용 흐름 마감 2): 새 사용자 지시가 아니라 원래 승인 작업의 지시로만 부른다.
// 쓰기 지시 문구가 RequestFile에 결속된 원래 사용자 지시 문구와 같아야 한다(에이전트가 지시를 꾸며 넣지 못하게). 토큰 대조는 실행기가 잠금 안에서 한다.
function continueInstruction(context,skill,entry,parameters,input){
 if(skill!=='care-visit-review'||entry!=='scripts/monthly-four.cjs'||String(parameters.Mode||'').toLowerCase()!=='continue')return;
 let request=null;try{request=C.readJson(ensurePrivateFile(context,parameters.RequestFile));}catch{request=null;}
 const original=request?.instruction?.message;
 // 실행 기록에 저장된 원래 요청의 지시 문구와도 같아야 한다(요청 파일의 문구만 바꿔 넣는 경우 거절, 2026-11-20 독립 검토 Minor 2).
 let stored=null;try{if(/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(request?.runId||''))stored=C.readJson(C.safeWithin(context.stateRoot,'monthly-four-runs',request.runId,'request.json'))?.instruction?.message;}catch{stored=null;}
 if(typeof original!=='string'||!original.trim()||input.instruction?.message!==original||stored!==original){const e=Error('CONTINUE_INSTRUCTION_MISMATCH');e.code='CONTINUE_INSTRUCTION_MISMATCH';throw e;}
}
// 계속 토큰 평문은 호출자에게 돌려주는 값에만 둔다. 실행 기록 파일(parameters·summary)에는 sha256만 남긴다.
const tokenDigest=t=>'sha256:'+crypto.createHash('sha256').update(String(t),'utf8').digest('hex');
function redactToken(v){
 const out={...v};if(typeof out.ContinuationToken==='string')out.ContinuationToken=tokenDigest(out.ContinuationToken);
 if(out.report?.continuation?.token)out.report={...out.report,continuation:{...out.report.continuation,token:tokenDigest(out.report.continuation.token)}};
 return out;
}
// 4번 상태 조회(2026-11-20 사용 흐름 마감 3): Mode status·RequestFile 두 인자만 받는다. 다른 인자가 섞이면 아무것도 실행하지 않는다.
// 공용 점유 취득·결과 불명 점유 이어받기·진단·브라우저·실행 기록 폴더·요약 파일이 모두 없다. 진입은 로컬 증빙만 읽어 돌려준다.
async function statusMonthlyFour({context,release,script,parameters}){
 const keys=Object.keys(parameters).sort().join(',');
 if(keys!=='Mode,RequestFile'||typeof parameters.RequestFile!=='string'||!parameters.RequestFile){const e=Error('STATUS_PARAMETERS_INVALID');e.code='STATUS_PARAMETERS_INVALID';throw e;}
 const r=await require(script).main({context,release,parameters:{Mode:'status',RequestFile:parameters.RequestFile},writing:false});
 if(!r||typeof r!=='object')throw Error('MONTHLY_FOUR_RESULT_INVALID');
 return{ok:r.ok===true,status:'read-only-status',skill:'care-visit-review',entry:'scripts/monthly-four.cjs',writing:false,leaseRetained:false,...(r.code?{code:r.code}:{}),report:r};
}
async function callMonthlyFour({context,release,script,parameters,runDir,writing,bridge,env}){
 const r=await require(script).main({context,release,parameters,runDir,writing,bridge,env});
 if(!r||typeof r!=='object')throw Error('MONTHLY_FOUR_RESULT_INVALID');
 if(r.ok===false&&r.code&&r.writeNotAttempted===true)return{status:1,stdout:JSON.stringify({ok:false,code:r.code}),stderr:'',writeNotAttempted:true,code:r.code};
 // 실행 전체가 unknown이거나, 이전 불명 단계를 대조하지 못해 보류(RECONCILIATION_REQUIRED)된 경우도 결과 불명으로 본다.
 const unknown=r.status==='unknown'||(r.blockingCodes||[]).includes('RECONCILIATION_REQUIRED')||(r.months||[]).some(m=>(m.phases||[]).some(p=>p.status==='unknown'||p.status==='running'));
 return{status:r.status==='succeeded'?0:1,stdout:JSON.stringify({runId:r.runId,status:r.status,blockingCodes:r.blockingCodes}),stderr:'',writeNotAttempted:!unknown,confirmed:!unknown,report:r};
}
async function main(args,{workspaceRoot,bridge=runAside,cliProbe}={}){
 const [command,...rest]=args,root=workspaceRoot||C.findWorkspace(process.cwd());
 if(command?.startsWith('evaluation-'))return require('./evaluation/commands.cjs').main(command,argsMap(rest),root);
 if(command?.startsWith('care-record-'))return require('./care-records/commands.cjs').main(command,argsMap(rest),root,{bridge});
 if(command==='client-call'){const o=argsMap(rest);if(!o.skill||!o.entry||!o.input)throw Error('SKILL_ENTRY_PRIVATE_INPUT_REQUIRED');return require('./client-call.cjs').callClient({root,skill:o.skill,entry:o.entry,inputFile:o.input,checkInstruction:validateInstruction,bridge});}
 if(command==='menu')return{version:activeRelease(root).active.version,browser:'aside-cli',skills:catalog.skills.map(s=>({id:s.id,steps:s.steps,capability:s.capability,...(s.releaseStatus?{releaseStatus:s.releaseStatus}:{})}))};
 if(command==='skill'){if(rest.length!==1)throw Error('SKILL_ID_REQUIRED');return{instruction:skillEntry(root,rest[0]),workspace:root};}
 if(command==='doctor'){const c=C.loadContext(root,{requireConfigured:false}),r=activeRelease(root);return{runtimeApi:1,version:r.active.version,node:process.versions.node,skills:catalog.skills.map(s=>({id:s.id,found:fs.existsSync(skillEntry(root,s.id))})),organizationConfigured:!!c.settings.organization.id,policyAdopted:c.settings.policy.accepted===true,browser:'aside-cli',browserChecked:false,realSiteWritesVerified:false};}
 // 업무별 시작 전 실제 연결 진단: 작업 정의의 지정 target만 읽기 전용으로 확인한다(설정·점유·binding 변경 없음).
 if(command==='doctor-task'){const o=argsMap(rest);if(!o.task)throw Error('TASK_ID_REQUIRED');return require('./doctor-live.cjs').doctorTask({root,taskId:o.task,transport:bridge,cliProbe});}
 if(command==='configure'){
  const o=argsMap(rest);if(!o.file)throw Error('CONFIGURATION_FILE_REQUIRED');if(fs.existsSync(path.join(root,'state/runtime.lock')))throw Error('WORKSPACE_BUSY_OR_PREVIOUS_RUN_UNCONFIRMED');const next=C.validateSettings(C.readJson(o.file)),file=path.join(root,'longterm.workspace.json');if(fs.existsSync(file))C.writeNewJson(C.safeWithin(root,'state','configuration-history',crypto.randomUUID()+'.json'),C.readJson(file));require('./package-manager.cjs');const temp=file+'.'+crypto.randomUUID()+'.tmp';C.writeNewJson(temp,next);fs.renameSync(temp,file);const context=C.loadContext(root);return{ok:true,...materializeState(context,activeRelease(root).root),browserChecked:false};
 }
 if(command==='bind'){
  const o=argsMap(rest),context=C.loadContext(root);if(!o.file)throw Error('OBSERVED_BROWSER_BINDINGS_FILE_REQUIRED');const targets=C.readJson(o.file),bindings={schemaVersion:1,configHash:context.configHash,targets},scope=scopeFor(context,bindings);
  const result=await bridge("for(const t of await listBrowserTabs())await attachBrowserTab(t.targetId);console.log('WN_RESULT:'+JSON.stringify({ok:true,bindingsVerified:true}));",{scope});if(!result?.bindingsVerified)throw Error('BROWSER_BINDINGS_UNCONFIRMED');const file=C.safeWithin(context.stateRoot,'browser-bindings.json'),temp=file+'.'+crypto.randomUUID()+'.tmp';C.writeNewJson(temp,bindings);fs.renameSync(temp,file);return{ok:true,services:targets.map(t=>t.service),writes:0};
 }
 if(command==='call'){const o=argsMap(rest);if(!o.skill||!o.entry||!o.input)throw Error('SKILL_ENTRY_PRIVATE_INPUT_REQUIRED');return call({root,skill:o.skill,entry:o.entry,inputFile:o.input,bridge});}
 // 업데이트 확인은 읽기만, 업데이트는 고정 로컬 설정(update-source.json)의 공식 소스·서명·호환을 통과한 공통 코드만 적용한다.
 if(command==='update-check'){if(rest.length)throw Error('UPDATE_CHECK_TAKES_NO_ARGUMENTS');return require('./public-update.cjs').checkUpdate({workspace:root});}
 if(command==='update'){if(rest.length)throw Error('UPDATE_TAKES_NO_ARGUMENTS');return require('./public-update.cjs').applyUpdate({workspace:root});}
 if(command==='update-reconcile'){if(rest.length)throw Error('UPDATE_RECONCILE_TAKES_NO_ARGUMENTS');return require('./public-update.cjs').reconcileUpdate({workspace:root});}
 if(command==='rollback'){const o=argsMap(rest);return require('./package-manager.cjs').rollback({workspace:root,version:o.version});}
 if(command==='remove-skill'){const o=argsMap(rest);return require('./package-manager.cjs').removeSkill({workspace:root,id:o.id});}
 throw Error('SUPPORTED_COMMAND_REQUIRED: menu skill doctor doctor-task configure bind call client-call update-check update update-reconcile rollback remove-skill');
}
module.exports={main,argsMap,writeIntent,validateInstruction,call,hash};
if(require.main===module){Promise.resolve().then(()=>main(process.argv.slice(2),{workspaceRoot:C.findWorkspace(process.env.LONGTERM_WORKSPACE||__dirname)})).then(result=>{if(result!==undefined)console.log(JSON.stringify(result));if(result?.ok===false)process.exitCode=1;}).catch(e=>{console.error(e.code||e.message);process.exitCode=1;});}
