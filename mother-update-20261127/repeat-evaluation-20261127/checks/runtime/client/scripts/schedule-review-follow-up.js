// Reuses the normal snapshot CAS/independent GET. This path never calls LT writes.
const fs=require('node:fs'),path=require('node:path');
const {fromCheck,digest}=require('../lib/scheduleReview');
const {submitInPage,buildScript:publishScript}=require('./register-schedule-review');
const {buildScript:executionScript}=require('./schedule-review-execution');
const {runAside}=require('./register-worker-notes');
const fail=code=>Object.assign(Error(code),{code});
async function publishFollowUp({file,artifact,out},bridge=runAside){
 if(!out||fs.existsSync(out))throw fail('OUTPUT');const m=artifact?.manifest,raw=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(!artifact.ok||!m?.runId||raw.schemaVersion!==2||raw.orgName!==artifact.orgName||['month','from','to'].some(k=>raw[k]!==m[k]))throw fail('FOLLOW_UP_SCOPE');
 const data=fromCheck(raw,{orgName:artifact.orgName});const fence=await bridge(executionScript({origin:artifact.origin,orgName:artifact.orgName,month:m.month,action:'follow-up',manifest:m},artifact.targetId));
 let r=fence;if(fence.ok){if(Date.parse(data.collectedAt)<Date.parse(fence.manifest.finishedAt||fence.manifest.claimedAt))throw fail('FOLLOW_UP_NOT_FRESH');const scope={origin:artifact.origin,orgName:artifact.orgName,month:m.month,from:m.from,to:m.to,count:data.records.length,contentHash:digest(data),expectedVersion:m.snapshotVersion,mode:'apply',payload64:Buffer.from(JSON.stringify(data)).toString('base64')};try{r=await bridge(publishScript(scope,fence.targetId||artifact.targetId));}catch{r={ok:false,code:'PUBLISH_OUTCOME_UNKNOWN',outcome:'unknown'};}}
 const result={...r,contentHash:digest(data),snapshotVersion:r.version||null};fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});return result;
}
if(require.main===module){const [file,manifest,out]=process.argv.slice(2);publishFollowUp({file,artifact:JSON.parse(fs.readFileSync(manifest,'utf8').replace(/^\uFEFF/,'')),out}).then(r=>{console.log(JSON.stringify({ok:r.ok,code:r.code||null,outcome:r.outcome||null}));process.exitCode=r.ok?0:1;}).catch(e=>{console.error(e.code||e.message);process.exitCode=1;});}
module.exports={publishFollowUp,submitInPage};
