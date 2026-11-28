'use strict';
const fs=require('node:fs'),path=require('node:path');
const C=require('../context.cjs'),{activeRelease}=require('../active.cjs'),{privateFile}=require('../client-call.cjs'),{loadScope}=require('../environment.cjs'),{runAside}=require('../aside-cli.cjs'),D=require('./documentation.cjs'),S=require('./compatibility.cjs');
async function main(command,options,root,{bridge=runAside,now=Date.now()}={}){
 const allowed={'care-record-policy-template':['out'],'care-record-prepare':['collection','policy','content','out'],'care-record-server-check':['month','out']};if(!allowed[command]||Object.keys(options).some(k=>!allowed[command].includes(k)))throw Error('SUPPORTED_CARE_RECORD_COMMAND_REQUIRED');
 const context=C.loadContext(root,{requireConfigured:command!=='care-record-policy-template'}),output=privateFile(context,options.out,{fresh:true});
 const read=file=>C.readJson(privateFile(context,file));const lease=C.acquire(context,command);
 try{
  if(command==='care-record-policy-template'){if(!context.settings.organization.id||!context.settings.organization.name)throw Error('CONFIGURE_ORGANIZATION_FIRST');C.writeNewJson(output,D.template(context.settings.organization));return{ok:true,output,adopted:false,siteWrites:0};}
  if(command==='care-record-prepare'){
   const collection=read(options.collection),policy=read(options.policy),content=options.content?read(options.content):undefined;D.validatePolicy(policy,context.settings.organization,now);
   if((collection.review!==undefined&&typeof collection.review!=='boolean')||(collection.includeHeaders!==undefined&&typeof collection.includeHeaders!=='boolean')||((collection.noteSource!=null||collection.headerSource!=null||collection.includeHeaders===true)&&collection.review!==true)||(collection.includeHeaders===true&&!collection.headerSource))throw Error('CARE_RECORD_REVIEW_SOURCE_NOT_SUPPORTED');
   if(collection.manifest?.org?.sourceId!==context.settings.organization.id)throw Error('CARE_RECORD_SOURCE_ORGANIZATION_CHANGED');
   const release=activeRelease(root),prepare=require(C.safeWithin(release.root,'skills/longterm-care-record/scripts/prepare.js')).prepare;
   const snapshot=prepare(collection.billProof,collection.batches,{orgName:context.settings.organization.name,month:collection.manifest.month,testMode:collection.testMode,manifest:collection.manifest,now,review:collection.review===true,noteSource:collection.noteSource??null,headerSource:collection.headerSource??null});
   const result=D.prepareDocumentation(snapshot,policy,content,{organization:context.settings.organization,sourceOrgId:collection.manifest.org.sourceId,now});C.writeNewJson(output,result);return{ok:true,status:result.needsConfirmation?'needs-record-content':'prepared-needs-clinical-review',output,preparedHash:result.preparedHash,ready:result.ready,needsConfirmation:result.needsConfirmation,publicationEnabled:false,siteWrites:0};
  }
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(options.month))throw Error('CARE_RECORD_MONTH_REQUIRED');const {scope}=loadScope(root),target=scope.targets.find(t=>t.service==='desk');if(!target)throw Error('BOUND_DESK_TAB_REQUIRED');
  const a={origin:context.settings.origins.desk,month:options.month},source='await attachBrowserTab('+JSON.stringify(target.targetId)+');const result=await page.evaluate('+S.readCompatibilityPage.toString()+','+JSON.stringify(a)+");console.log('WN_RESULT:'+JSON.stringify({ok:true,result}));";
  const response=await bridge(source,{scope:{...scope,targets:[target]},writeAttempted:false});if(response?.ok!==true||!response.result)throw Error('CARE_RECORD_COMPATIBILITY_UNCONFIRMED');
  const raw=response.result,observed={orgId:typeof raw.orgId==='string'?raw.orgId:null,month:typeof raw.month==='string'?raw.month:null,version:Number.isSafeInteger(raw.version)?raw.version:null,capabilities:Object.fromEntries(Object.entries(S.expected).map(([k,v])=>[k,raw.capabilities?.[k]===v?v:null]))};
  const result=S.checkCompatibility(observed,{deskId:context.settings.organization.deskId,month:options.month});C.writeNewJson(output,{...result,observed});return{...result,output};
 }finally{lease.release();}
}
module.exports={main};
