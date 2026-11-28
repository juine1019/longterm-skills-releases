'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./context.cjs'),{activeRelease}=require('./active.cjs'),{loadScope}=require('./environment.cjs'),{runAside}=require('./aside-cli.cjs');
const routes={
 'longterm-past-schedule':['scripts/register-schedule-review.js'],
 'care-visit-review':['scripts/register-worker-notes.js'],
 'care-worker-note-review':['scripts/register-worker-note-reviews.js'],
 'caremanager-next-month':['scripts/next-month-desk.js']
};
const must=(v,c)=>{if(!v)throw Error(c);},sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function privateFile(context,file,{fresh=false}={}){
 must(typeof file==='string'&&file,'PRIVATE_CLIENT_PATH_REQUIRED');const absolute=path.resolve(file),rel=path.relative(context.stateRoot,absolute);must(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'ORGANIZATION_PRIVATE_INPUT_REQUIRED');const checked=C.safeWithin(context.stateRoot,rel);
 if(fresh)must(!fs.existsSync(checked),'NEW_CLIENT_OUTPUT_REQUIRED');else{must(fs.statSync(checked).isFile(),'PRIVATE_INPUT_FILE_REQUIRED');must(fs.realpathSync(checked)===checked,'PRIVATE_INPUT_LINK_NOT_ALLOWED');}return checked;
}
async function callClient({root,skill,entry,inputFile,checkInstruction,bridge=runAside}){
 must(routes[skill]?.includes(entry),'SUPPORTED_CLIENT_ENTRY_REQUIRED');const context=C.loadContext(root),release=activeRelease(root),input=C.readJson(privateFile(context,inputFile)),parameters=input.parameters;
 must(parameters&&typeof parameters==='object'&&!Array.isArray(parameters),'PARAMETERS_OBJECT_REQUIRED');
 const readOnly=entry==='scripts/next-month-desk.js',allowed=readOnly?['action','month','org','origin','target','out']:['file','approval','apply','org','origin','target','out'];must(Object.keys(parameters).every(k=>allowed.includes(k)),'UNSUPPORTED_CLIENT_PARAMETER');
 if(readOnly)must((parameters.action||'read')==='read'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(parameters.month),'USE_REVIEWED_NEXT_MONTH_PUBLICATION');
 else must(parameters.apply===undefined||typeof parameters.apply==='boolean','BOOLEAN_APPLY_REQUIRED');
 const options={...parameters},files={};for(const key of ['file','approval'])if(options[key]!==undefined){options[key]=privateFile(context,options[key]);files[key]=sha(fs.readFileSync(options[key]));}
 if(!readOnly)must(options.file,'PRIVATE_CLIENT_SOURCE_REQUIRED');if(options.apply)must(options.approval,'SOURCE_APPROVAL_FILE_REQUIRED');
 if(options.org!==undefined)must(options.org===context.settings.organization.name,'PARAMETER_ORGANIZATION_MISMATCH');if(options.origin!==undefined)must(options.origin===context.settings.origins.desk,'PARAMETER_ORIGIN_MISMATCH');
 const {scope}=loadScope(root),target=scope.targets.find(t=>t.service==='desk');must(target,'BOUND_DESK_TAB_REQUIRED');if(options.target!==undefined)must(options.target===target.targetId,'CLIENT_TARGET_OUTSIDE_BINDING');options.target=target.targetId;options.org=context.settings.organization.name;options.origin=context.settings.origins.desk;
 const script=C.safeWithin(release.root,'runtime','client',entry);must(fs.existsSync(script),'INSTALLED_CLIENT_ENTRY_MISSING');must(typeof checkInstruction==='function','CLIENT_INSTRUCTION_CHECK_REQUIRED');const writing=checkInstruction(input,skill,'client/'+entry,parameters,context);
 const runId=crypto.randomUUID(),runDir=C.safeWithin(context.stateRoot,'runs',runId);options.out=privateFile(context,options.out||path.join(runDir,'result.json'),{fresh:true});
 const lease=C.acquire(context,'client:'+skill+':'+entry);let keep=false,started=false;
 try{
  fs.mkdirSync(runDir,{recursive:true});C.writeNewJson(path.join(runDir,'request.json'),{skill,entry,writing,configHash:context.configHash,inputSha256:sha(fs.readFileSync(inputFile)),files,at:new Date().toISOString()});
  // Recheck every source immediately before execution; copied approvals cannot drift.
  for(const[key,digest]of Object.entries(files))must(sha(fs.readFileSync(options[key]))===digest,'APPROVED_SOURCE_FILE_CHANGED_OR_UNBOUND');
  const client=require(script);must(typeof client.execute==='function','INSTALLED_CLIENT_INTERFACE_REQUIRED');started=true;
  const result=await client.execute(options,source=>bridge(source,{scope:{...scope,targets:[target]},writeAttempted:writing}));must(result&&typeof result.ok==='boolean','CLIENT_RESULT_UNCONFIRMED');
  must(C.loadContext(root).configHash===context.configHash,'CONFIGURATION_CHANGED_DURING_CLIENT_CALL');keep=writing&&(result.outcome==='unknown'||result.ok!==true&&result.outcome!=='not-written');
  const summary={ok:result.ok&&!keep,status:keep?'unknown-inspect-before-retry':result.ok?'process-finished-check-workflow-verification':'failed',skill,entry,runId,runDir,resultFile:options.out,writing,leaseRetained:keep};C.writeNewJson(path.join(runDir,'summary.json'),summary);return summary;
 }catch(e){keep=writing&&started;const summary={ok:false,status:keep?'unknown-inspect-before-retry':'blocked-before-write',code:e.code||e.message,runId,runDir,writing,leaseRetained:keep};C.writeNewJson(path.join(runDir,'summary-error.json'),summary);return summary;}
 finally{if(!keep)lease.release();}
}
module.exports={callClient,routes,privateFile};
