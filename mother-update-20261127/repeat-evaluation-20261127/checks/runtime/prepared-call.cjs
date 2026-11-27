'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./context.cjs'),{privateFile}=require('./client-call.cjs'),{loadScope}=require('./environment.cjs'),{runAside}=require('./aside-cli.cjs');
async function publishReviewedPair({context,release,script,parameters:p,runDir,bridge=runAside}){
 let dispatched=false,output;
 try{
  const allowed=['source','public','local','review','resolved','org','month','origin','version','target','out'];if(Object.keys(p).some(k=>!allowed.includes(k)))throw Error('UNSUPPORTED_PREPARED_PUBLICATION_PARAMETER');
  const files={};for(const k of ['source','public','local','review','resolved'])if(p[k]!==undefined)files[k]=privateFile(context,p[k]);for(const k of ['source','public','local'])if(!files[k])throw Error('PREPARED_FILES_AND_SCOPE_REQUIRED');
  if(p.org!==undefined&&p.org!==context.settings.organization.name)throw Error('PARAMETER_ORGANIZATION_MISMATCH');if(p.origin!==undefined&&p.origin!==context.settings.origins.desk)throw Error('PARAMETER_ORIGIN_MISMATCH');
  output=privateFile(context,p.out||path.join(runDir,'publication.json'),{fresh:true});const before=privateFile(context,output+'.before.json',{fresh:true}),published=privateFile(context,output+'.published.json',{fresh:true});
  const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),bytes=Object.fromEntries(Object.entries(files).map(([k,f])=>[k,fs.readFileSync(f)])),read=k=>bytes[k]?JSON.parse(bytes[k].toString('utf8').replace(/^\uFEFF/,'')):undefined,o={source:read('source'),data:read('public'),local:read('local'),review:read('review'),resolvedRequestIds:read('resolved')||[],org:context.settings.organization.name,month:p.month,origin:context.settings.origins.desk,version:Number(p.version)},publisher=require(script);
  // Validate the exact source/review/price/public/local relationship before any browser call.
  publisher.validatePrepared(o);
  const {scope}=loadScope(context.root),target=scope.targets.find(t=>t.service==='desk');if(!target||p.target!==undefined&&p.target!==target.targetId)throw Error('BOUND_DESK_TAB_REQUIRED');
  const client=require(C.safeWithin(release.root,'runtime/client/scripts/next-month-desk.js')),staged=C.safeWithin(runDir,'reviewed-public.json'),resolved=C.safeWithin(runDir,'reviewed-resolved.json');C.writeNewJson(staged,o.data);C.writeNewJson(resolved,o.resolvedRequestIds);const stagedHash=sha(fs.readFileSync(staged)),resolvedHash=sha(fs.readFileSync(resolved));
  const result=await publisher.publishPrepared(o,action=>{if(!['read','publish'].includes(action))throw Error('UNSUPPORTED_PREPARED_ACTION');if(action==='publish'){for(const[k,f]of Object.entries(files))if(sha(fs.readFileSync(f))!==sha(bytes[k]))throw Error('REVIEWED_SOURCE_CHANGED_BEFORE_PUBLICATION');if(sha(fs.readFileSync(staged))!==stagedHash||sha(fs.readFileSync(resolved))!==resolvedHash)throw Error('STAGED_PUBLICATION_CHANGED');dispatched=true;}return client.execute({action,month:o.month,org:o.org,origin:o.origin,version:o.version,file:staged,resolved:resolved,target:target.targetId,out:action==='read'?before:published},source=>bridge(source,{scope:{...scope,targets:[target]},writeAttempted:action==='publish'}));});
  C.writeNewJson(output,{...result,localFile:files.local,publicFile:files.public});return{status:0,stdout:JSON.stringify({ok:true,verified:result.verified,writes:result.writes,version:result.version,resultFile:output}),stderr:'',writeNotAttempted:!dispatched};
 }catch(e){const result={ok:false,code:e.code||e.message,outcome:dispatched?'unknown':'not-written'};if(output&&!fs.existsSync(output))C.writeNewJson(output,result);return{status:1,stdout:JSON.stringify(result),stderr:'',writeNotAttempted:!dispatched};}
}
module.exports={publishReviewedPair};
