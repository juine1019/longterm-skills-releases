'use strict';
const fs=require('node:fs'),path=require('node:path');
const {safeWithin,readJson,statePath}=require('./context.cjs');
const catalog=require('../catalog.json');
function activeRelease(root){
 const active=readJson(path.join(root,'active.json'));
 if(active.schemaVersion!==1||active.runtimeApi!==1||active.stateSchemaVersion!==1||!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(active.version))throw Error('ACTIVE_RELEASE_UNSUPPORTED');
 const release=safeWithin(root,'releases',active.version),manifest=readJson(path.join(release,'release.json'));
 if(manifest.version!==active.version||manifest.runtimeApi!==1||manifest.stateSchemaVersion!==1)throw Error('ACTIVE_RELEASE_METADATA_MISMATCH');
 return{active,root:release,manifest};
}
function materializeState(context,release){
 const helpers=catalog.helpers===undefined?[]:catalog.helpers;if(!Array.isArray(helpers))throw Error('HELPER_CATALOG_INVALID');const all=[...catalog.skills,...helpers],ids=all.map(s=>s?.id);if(ids.some(id=>typeof id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))||new Set(ids).size!==ids.length)throw Error('HELPER_CATALOG_INVALID');
 const links=[];for(const skill of all)for(const name of ['data','output']){
  const directory=safeWithin(release,'skills',skill.id);if(!fs.existsSync(directory))throw Error('WHOLE_SKILL_RELEASE_REQUIRED');
  const link=path.join(directory,name),destination=statePath(context,skill.id,name);fs.mkdirSync(destination,{recursive:true});
  if(fs.existsSync(link)||(()=>{try{fs.lstatSync(link);return true;}catch{return false;}})()){
   const meta=fs.lstatSync(link);if(!meta.isSymbolicLink())throw Error('EXISTING_UNSCOPED_DATA_REQUIRES_REVIEW');
   const prior=path.resolve(path.dirname(link),fs.readlinkSync(link));const owned=path.join(context.root,'state','organizations')+path.sep;
   if(!prior.startsWith(owned))throw Error('UNOWNED_STATE_LINK_PRESERVED');
   if(prior===destination){links.push({skill:skill.id,name});continue;}
   fs.unlinkSync(link);
  }
  fs.symlinkSync(destination,link,'junction');if(fs.realpathSync(link)!==fs.realpathSync(destination))throw Error('STATE_LINK_TARGET_MISMATCH');links.push({skill:skill.id,name});
 }
 return{links:links.length,organization:context.orgKey};
}
module.exports={activeRelease,materializeState};
