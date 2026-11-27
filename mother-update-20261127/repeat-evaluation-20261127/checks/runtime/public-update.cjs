'use strict';
// 공개 업데이트 확인(update-check)·적용(update) 흐름.
// 확인은 서명·버전·조건만 보고 아무것도 쓰지 않는다. 적용은 공용 작업 점유를 잡고 기존 설치기(package-manager.install)의 검증·충돌·단계 검사를 그대로 거친다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./context.cjs'),PM=require('./package-manager.cjs'),T=require('./update-trust.cjs'),{download}=require('./update-download.cjs');
const SOURCE_FILE='update-source.json',RECEIPT_FILE='update-state.json',PENDING_FILE='update-pending.json',DESCRIPTOR_ASSET='update-stable.json',METADATA_MAX_BYTES=1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const HEX64=/^[a-f0-9]{64}$/;
function readOptional(file){try{return fs.readFileSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function parseJson(bytes,code){try{return JSON.parse(bytes.toString('utf8').replace(/^﻿/,''));}catch{fail(code);}}
function result(status,{currentVersion=null,candidateVersion=null,reason=null,preserved=true,...extra}={}){
 return{ok:['up-to-date','available','updated','reconciled'].includes(status),status,currentVersion,candidateVersion,reason,preserved,...extra};
}
function readInstalled(root){
 const active=require('./active.cjs').activeRelease(root).active;
 if(!HEX64.test(active.manifestFingerprint||''))fail('ACTIVE_RELEASE_FINGERPRINT_MISSING');
 return{version:active.version,runtimeApi:active.runtimeApi,stateSchemaVersion:active.stateSchemaVersion,manifestFingerprint:active.manifestFingerprint};
}
function validateReceipt(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||!Number.isSafeInteger(value.sequence)||value.sequence<0||!HEX64.test(value.payloadSha256||'')||typeof value.version!=='string')fail('UPDATE_RECEIPT_INVALID');
 return value;
}
function assetUrlMatches(text,source,tag,name){
 let u;try{u=new URL(text);}catch{return false;}
 const parts=u.pathname.split('/');
 return u.protocol==='https:'&&u.hostname==='github.com'&&!u.username&&!u.password&&u.port===''&&!u.search&&!u.hash&&parts.length===7&&parts[1].toLowerCase()===source.owner.toLowerCase()&&parts[2].toLowerCase()===source.repo.toLowerCase()&&parts[3]==='releases'&&parts[4]==='download'&&parts[5]===tag&&parts[6]===name;
}
function findAsset(release,source,name,{size}={}){
 const rows=release.assets.filter(a=>a?.name===name);
 if(rows.length!==1)fail('RELEASE_ASSET_INVALID');
 const asset=rows[0];
 if(!Number.isSafeInteger(asset.size)||asset.size<1||(size!==undefined&&asset.size!==size)||typeof asset.browser_download_url!=='string'||!assetUrlMatches(asset.browser_download_url,source,release.tag_name,name))fail('RELEASE_ASSET_INVALID');
 return asset;
}
// 확인·적용이 함께 쓰는 읽기 전용 계획. 작업공간에 아무것도 쓰지 않는다.
async function plan({workspace,fetchBytes}){
 const root=path.resolve(workspace);let currentVersion=null;
 try{
  const snapshot={active:readOptional(path.join(root,'active.json')),source:readOptional(path.join(root,SOURCE_FILE)),receipt:readOptional(path.join(root,RECEIPT_FILE))};
  if(!snapshot.active)return{done:result('blocked',{reason:'BASE_RELEASE_NOT_INSTALLED'})};
  const installed=readInstalled(root);currentVersion=installed.version;
  if(readOptional(path.join(root,PENDING_FILE))!==null)return{done:result('confirmation-required',{currentVersion,reason:'UPDATE_PREVIOUS_RESULT_UNCONFIRMED',next:'update-reconcile'})};
  if(!snapshot.source)return{done:result('not-configured',{currentVersion,reason:'UPDATE_SOURCE_NOT_CONFIGURED'})};
  let source;try{source=T.validateUpdateSource(parseJson(snapshot.source,'UPDATE_SOURCE_INVALID'));}catch(e){if(e.code==='UPDATE_SOURCE_NOT_CONFIGURED')return{done:result('not-configured',{currentVersion,reason:e.code})};throw e;}
  const receipt=snapshot.receipt?validateReceipt(parseJson(snapshot.receipt,'UPDATE_RECEIPT_INVALID')):null;
  const fetch=fetchBytes||((url,options)=>download(url,{...options,repository:source.repository}));
  const release=parseJson(await fetch('https://api.github.com/repos/'+source.owner+'/'+source.repo+'/releases/latest',{maxBytes:METADATA_MAX_BYTES,accept:'application/vnd.github+json'}),'RELEASE_METADATA_INVALID');
  if(!release||typeof release!=='object'||typeof release.tag_name!=='string'||!/^v\d+\.\d+\.\d+$/.test(release.tag_name)||!Array.isArray(release.assets))fail('RELEASE_METADATA_INVALID');
  if(release.draft!==false||release.prerelease!==false)fail('RELEASE_NOT_STABLE');
  const descriptorAsset=findAsset(release,source,DESCRIPTOR_ASSET);
  if(descriptorAsset.size>T.LIMITS.descriptorBytes)fail('DESCRIPTOR_TOO_LARGE');
  const descriptorBytes=await fetch(descriptorAsset.browser_download_url,{maxBytes:T.LIMITS.descriptorBytes});
  if(descriptorBytes.length!==descriptorAsset.size)fail('RELEASE_ASSET_INVALID');
  const descriptor=T.verifyDescriptor(descriptorBytes,source,installed,receipt);
  if(release.tag_name!=='v'+descriptor.version)fail('RELEASE_TAG_MISMATCH');
  const bundleAsset=findAsset(release,source,descriptor.bundleAsset,{size:descriptor.bundleBytes});
  const status=descriptor.updateAvailable?'available':'up-to-date';
  return{root,snapshot,source,installed,descriptor,descriptorBytes,fetch,bundleUrl:bundleAsset.browser_download_url,done:descriptor.updateAvailable?null:result(status,{currentVersion,candidateVersion:descriptor.version}),available:result(status,{currentVersion,candidateVersion:descriptor.version})};
 }catch(e){return{done:result('blocked',{currentVersion,reason:e.code||'UPDATE_CHECK_FAILED'})};}
}
async function checkUpdate({workspace,fetchBytes,now}={}){
 const p=await plan({workspace,fetchBytes});return p.done||p.available;
}
function collectionLocked(root){
 const organizations=path.join(root,'state','organizations');let names;
 try{names=fs.readdirSync(organizations);}catch(e){return e.code!=='ENOENT';}
 // 특이사항 보관소와 계획서 원문 보관소(2026-11-18 4번 U4-01)의 월·인덱스 잠금을 모두 본다. 읽을 수 없으면 진행 중으로 본다.
 for(const name of names)for(const store of ['worker-notes','plan-sources']){
  let locks;try{locks=fs.readdirSync(path.join(organizations,name,store,'locks'));}catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')continue;return true;}
  if(locks.some(n=>n.toLowerCase().endsWith('.lock')))return true;
 }
 return false;
}
function sameBytes(a,b){return a===null?b===null:b!==null&&a.equals(b);}
function readActiveSafe(root){try{return PM.readActive(root);}catch{return null;}}
function writeReceipt(root,value){
 const file=path.join(root,RECEIPT_FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';
 C.writeNewJson(temp,value);
 try{fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
}
function clearPending(root,expected){
 const file=path.join(root,PENDING_FILE);
 if(!sameBytes(expected,readOptional(file)))fail('UPDATE_PENDING_CHANGED');
 fs.unlinkSync(file);
}
function receiptFor(source,descriptor,descriptorBytes,priorVersion,appliedAt){
 return{schemaVersion:1,repository:source.repository,channel:descriptor.channel,version:descriptor.version,sequence:descriptor.sequence,payloadSha256:descriptor.payloadSha256,descriptorSha256:sha(descriptorBytes),bundleSha256:descriptor.bundleSha256,manifestSha256:descriptor.manifestSha256,priorVersion,appliedAt};
}
async function applyUpdate({workspace,fetchBytes,installPackage=PM.install,checkStage=({releaseRoot})=>require('./stage-check.cjs').checkStage(releaseRoot),userRoot=process.env.USERPROFILE||process.env.HOME,now=()=>new Date()}={}){
 const p=await plan({workspace,fetchBytes});if(p.done)return p.done;
 const {root,descriptor}=p,currentVersion=p.installed.version,candidateVersion=descriptor.version,base={currentVersion,candidateVersion};
 let context,lease;
 try{context=C.loadContext(root,{requireConfigured:false});if(path.resolve(context.root)!==root)fail('WORKSPACE_NOT_FOUND');lease=C.acquire(context,'update:'+candidateVersion);}
 catch(e){return result('blocked',{...base,reason:e.code||'WORKSPACE_CONFIGURATION_INVALID'});}
 let temp=null,outcome,pendingBytes=null;
 try{outcome=await applyWithLease();}
 catch(e){outcome=result(pendingBytes?'confirmation-required':'blocked',{...base,reason:e.code||'UPDATE_APPLY_FAILED'});}
 finally{
  if(temp)try{fs.rmSync(temp,{recursive:true,force:true});}catch{}
  try{lease.release();}catch{if(outcome?.status==='updated'){const {ok,status,...rest}=outcome;outcome=result('confirmation-required',{...rest,reason:'LEASE_RELEASE_UNCONFIRMED'});}}
  if(outcome?.status==='updated')try{clearPending(root,pendingBytes);}catch{outcome=result('confirmation-required',{...base,currentVersion:candidateVersion,reason:'UPDATE_PENDING_CLEAR_FAILED'});}
 }
 return outcome;
 async function applyWithLease(){
  // 공용 작업 점유를 잡은 뒤 보관소 수집 잠금이 없는지 다시 확인한다(읽을 수 없어도 진행 중으로 본다).
  if(collectionLocked(root))return result('blocked',{...base,reason:'COLLECTION_IN_PROGRESS_OR_UNCONFIRMED'});
  const decoded=T.decodeBundle(await p.fetch(p.bundleUrl,{maxBytes:descriptor.bundleBytes}),descriptor);
  temp=C.safeWithin(root,'state','updates',crypto.randomUUID());
  const packageRoot=path.join(temp,'package');fs.mkdirSync(packageRoot,{recursive:true});
  fs.writeFileSync(path.join(packageRoot,'manifest.json'),decoded.manifestBytes,{flag:'wx'});
  for(const f of decoded.files){const target=C.safeWithin(packageRoot,f.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,f.bytes,{flag:'wx'});}
  lease.assertOwned();
  if(collectionLocked(root))return result('blocked',{...base,reason:'COLLECTION_IN_PROGRESS_OR_UNCONFIRMED'});
  for(const [key,name] of [['active','active.json'],['source',SOURCE_FILE],['receipt',RECEIPT_FILE]])if(!sameBytes(p.snapshot[key],readOptional(path.join(root,name))))return result('blocked',{...base,reason:'UPDATE_PLAN_CHANGED'});
  lease.assertOwned();
  const pending={schemaVersion:1,id:crypto.randomUUID(),sourceSha256:sha(p.snapshot.source),priorActiveBase64:p.snapshot.active.toString('base64'),priorReceiptBase64:p.snapshot.receipt?.toString('base64')??null,descriptorBase64:p.descriptorBytes.toString('base64'),manifestBase64:decoded.manifestBytes.toString('base64'),startedAt:now().toISOString()};
  C.writeNewJson(path.join(root,PENDING_FILE),pending);pendingBytes=readOptional(path.join(root,PENDING_FILE));
  let installed;
  try{installed=installPackage({packageRoot,workspace:root,expectedFingerprint:descriptor.manifestSha256,checkStage,userRoot,ownedLease:{id:lease.lease.id}});}
  catch(e){
   const after=readActiveSafe(root);
   if(after?.version===candidateVersion)return result('confirmation-required',{...base,currentVersion:after.version,reason:e.code||'INSTALL_RESULT_UNCONFIRMED',preserved:null});
   if(!sameBytes(p.snapshot.active,readOptional(path.join(root,'active.json'))))return result('confirmation-required',{...base,reason:'INSTALL_RESULT_UNCONFIRMED',preserved:null});
   lease.assertOwned();clearPending(root,pendingBytes);pendingBytes=null;
   const leftover=fs.existsSync(path.join(root,'releases',candidateVersion))?'releases/'+candidateVersion:null;
   return result('blocked',{...base,reason:e.code||'INSTALL_FAILED',...(e.conflicts?{conflicts:e.conflicts}:{}),...(leftover?{inactiveRelease:leftover,next:'archive-inactive'}:{})});
  }
  // 활성 버전을 설치기 반환값이 아니라 파일에서 다시 읽어 확인한다.
  let active;try{active=readInstalled(root);}catch{active=null;}
  if(!installed?.ok||active?.version!==candidateVersion||active.manifestFingerprint!==descriptor.manifestSha256)return result('confirmation-required',{...base,currentVersion:active?.version||null,reason:'ACTIVE_RELEASE_UNCONFIRMED',preserved:null});
  const done={...base,currentVersion:candidateVersion,priorVersion:currentVersion,retainedCustomFiles:installed.retainedCustomFiles||[]};
  try{lease.assertOwned();writeReceipt(root,receiptFor(p.source,descriptor,p.descriptorBytes,currentVersion,now().toISOString()));}
  catch{return result('confirmation-required',{...done,reason:'RECEIPT_WRITE_FAILED'});}
  return result('updated',done);
 }
}
// Explicit recovery never downloads or reinstalls. A pending record survives crashes and all unconfirmed exits.
async function reconcileUpdate({workspace,now=()=>new Date()}={}){
 const root=path.resolve(workspace);let lease,pendingBytes,outcome,currentVersion=null;
 try{
  pendingBytes=readOptional(path.join(root,PENDING_FILE));
  if(!pendingBytes)return result('blocked',{reason:'UPDATE_PENDING_MISSING'});
  const pending=parseJson(pendingBytes,'UPDATE_PENDING_INVALID');
  if(pending.schemaVersion!==1||typeof pending.id!=='string'||!pending.id||!HEX64.test(pending.sourceSha256||'')||typeof pending.startedAt!=='string'||!Number.isFinite(Date.parse(pending.startedAt)))fail('UPDATE_PENDING_INVALID');
  const context=C.loadContext(root,{requireConfigured:false});lease=C.acquire(context,'update:reconcile');
  if(collectionLocked(root))fail('COLLECTION_IN_PROGRESS_OR_UNCONFIRMED');
  const decode=(text,max)=>{if(typeof text!=='string'||text.length>max*2)fail('UPDATE_PENDING_INVALID');const bytes=Buffer.from(text,'base64');if(bytes.length>max||bytes.toString('base64')!==text)fail('UPDATE_PENDING_INVALID');return bytes;};
  const sourceBytes=readOptional(path.join(root,SOURCE_FILE));if(!sourceBytes||sha(sourceBytes)!==pending.sourceSha256)fail('UPDATE_SOURCE_CHANGED');
  const source=T.validateUpdateSource(parseJson(sourceBytes,'UPDATE_SOURCE_INVALID'));
  const priorActiveBytes=decode(pending.priorActiveBase64,METADATA_MAX_BYTES),prior=parseJson(priorActiveBytes,'UPDATE_PENDING_INVALID');
  const priorReceiptBytes=pending.priorReceiptBase64===null?null:decode(pending.priorReceiptBase64,METADATA_MAX_BYTES);
  const priorReceipt=priorReceiptBytes?validateReceipt(parseJson(priorReceiptBytes,'UPDATE_RECEIPT_INVALID')):null;
  const descriptorBytes=decode(pending.descriptorBase64,T.LIMITS.descriptorBytes),descriptor=T.verifyDescriptor(descriptorBytes,source,prior,priorReceipt);
  const activeBytes=readOptional(path.join(root,'active.json')),receiptBytes=readOptional(path.join(root,RECEIPT_FILE));
  const installed=readInstalled(root);currentVersion=installed.version;
  let receipt=null;
  if(sameBytes(activeBytes,priorActiveBytes)){
   if(!sameBytes(receiptBytes,priorReceiptBytes))fail('UPDATE_RECEIPT_CHANGED');
   outcome=result('reconciled',{currentVersion,candidateVersion:descriptor.version,outcome:'not-applied'});
  }else{
   if(installed.version!==descriptor.version||installed.manifestFingerprint!==descriptor.manifestSha256)fail('ACTIVE_RELEASE_UNCONFIRMED');
   const manifestBytes=decode(pending.manifestBase64,T.LIMITS.bundleBytes);
   if(sha(manifestBytes)!==descriptor.manifestSha256)fail('PACKAGE_FINGERPRINT_MISMATCH');
   const manifest=parseJson(manifestBytes,'PACKAGE_MANIFEST_UNSUPPORTED'),release=require('./active.cjs').activeRelease(root);
   if(JSON.stringify(release.manifest.files)!==JSON.stringify(manifest.files)||release.manifest.trustedFingerprint!==descriptor.manifestSha256||!Array.isArray(release.manifest.stagedFiles)||!release.manifest.stagedFiles.length)fail('ACTIVE_RELEASE_UNCONFIRMED');
   const staged=new Map();
   for(const row of release.manifest.stagedFiles){PM.relativeName(row.path);if(staged.has(row.path.toLowerCase())||!HEX64.test(row.sha256||''))fail('ACTIVE_RELEASE_UNCONFIRMED');staged.set(row.path.toLowerCase(),row);const file=C.safeWithin(release.root,row.path);if(fs.lstatSync(file).isSymbolicLink()||sha(fs.readFileSync(file))!==row.sha256)fail('ACTIVE_RELEASE_FILE_CHANGED');}
   for(const row of manifest.files){const stagedRow=staged.get(row.path.toLowerCase());if(!stagedRow||(stagedRow.sha256!==row.sha256&&!release.manifest.retainedCustomFiles?.includes(row.path)))fail('ACTIVE_RELEASE_UNCONFIRMED');}
   receipt=receiptFor(source,descriptor,descriptorBytes,prior.version,pending.startedAt);
   if(!sameBytes(receiptBytes,priorReceiptBytes)){
    const existing=validateReceipt(parseJson(receiptBytes||Buffer.alloc(0),'UPDATE_RECEIPT_INVALID'));
    if(Object.entries(receipt).some(([key,value])=>key!=='appliedAt'&&existing[key]!==value))fail('UPDATE_RECEIPT_CHANGED');
    receipt=null;
   }
   outcome=result('reconciled',{currentVersion,candidateVersion:descriptor.version,outcome:'applied'});
  }
  lease.assertOwned();
  for(const [name,bytes]of [['active.json',activeBytes],[SOURCE_FILE,sourceBytes],[RECEIPT_FILE,receiptBytes],[PENDING_FILE,pendingBytes]])if(!sameBytes(bytes,readOptional(path.join(root,name))))fail('UPDATE_PLAN_CHANGED');
  if(receipt)writeReceipt(root,{...receipt,reconciledAt:now().toISOString()});
 }catch(e){outcome=result('confirmation-required',{currentVersion,reason:e.code||'UPDATE_RECONCILIATION_FAILED'});}
 finally{if(lease)try{lease.release();}catch{outcome=result('confirmation-required',{currentVersion,reason:'LEASE_RELEASE_UNCONFIRMED'});}}
 if(outcome?.status==='reconciled')try{clearPending(root,pendingBytes);}catch{outcome=result('confirmation-required',{currentVersion,reason:'UPDATE_PENDING_CLEAR_FAILED'});}
 return outcome;
}
module.exports={checkUpdate,applyUpdate,reconcileUpdate,SOURCE_FILE,RECEIPT_FILE,PENDING_FILE};
