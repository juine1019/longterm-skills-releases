'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalog=require('../catalog.json');
const fail=code=>{throw Object.assign(Error(code),{code});};
function safeWithin(root,...parts){
 if(parts.some(p=>typeof p!=='string'||path.isAbsolute(p)||path.win32.isAbsolute(p)||p.split(/[\\/]/).some(x=>x==='..'||x==='.'||x.includes(':'))))fail('PATH_OUTSIDE_WORKSPACE');
 const base=path.resolve(root),file=path.resolve(base,...parts),rel=path.relative(base,file);
 if(!rel||rel.startsWith('..')||path.isAbsolute(rel))fail('PATH_OUTSIDE_WORKSPACE');
 let current=base;for(const part of rel.split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('LINK_OUTSIDE_STATE_POLICY');}
 return file;
}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function findWorkspace(start){
 let dir=path.resolve(start);if(fs.existsSync(dir)&&!fs.statSync(dir).isDirectory())dir=path.dirname(dir);
 while(true){if(fs.existsSync(path.join(dir,'longterm.workspace.json')))return dir;const parent=path.dirname(dir);if(parent===dir)fail('WORKSPACE_NOT_FOUND');dir=parent;}
}
function validateSettings(settings,{requireConfigured=true}={}){
 if(settings?.schemaVersion!==1)fail('WORKSPACE_SCHEMA_UNSUPPORTED');
 const allowed=new Set(['schemaVersion','organization','operator','origins','policy','browser']);
 if(Object.keys(settings).some(k=>!allowed.has(k)))fail('UNSUPPORTED_CONFIGURATION_FIELD');
 const walk=(v)=>{if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){if(/password|secret|token|cookie|credential|certificate|private.?key/i.test(k))fail('CREDENTIALS_NOT_ALLOWED_IN_CONFIGURATION');walk(x);}}};walk(settings);
 const org=settings.organization,operator=settings.operator;
 if(!org||Object.keys(org).some(k=>!['id','deskId','name','openingDate'].includes(k))||typeof org.id!=='string'||typeof org.name!=='string'||org.deskId!==undefined&&typeof org.deskId!=='string')fail('ORGANIZATION_CONFIGURATION_INVALID');
 if(requireConfigured&&(!org.id.trim()||!org.name.trim()))fail('ORGANIZATION_NOT_CONFIGURED');
 if(!operator||Object.keys(operator).some(k=>!['name','job'].includes(k))||typeof operator.name!=='string'||typeof operator.job!=='string')fail('OPERATOR_CONFIGURATION_INVALID');
 if(org.openingDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(org.openingDate)||!Number.isFinite(Date.parse(org.openingDate+'T00:00:00Z'))||new Date(org.openingDate+'T00:00:00Z').toISOString().slice(0,10)!==org.openingDate))fail('OPENING_DATE_INVALID');
 const origins=settings.origins;
 if(!origins||!['cm','desk','ez','lt'].every(k=>Object.hasOwn(origins,k))||Object.keys(origins).some(k=>!['cm','desk','ez','lt','ltRfid'].includes(k)))fail('SERVICE_ORIGINS_REQUIRED');
 for(const u of Object.values(origins)){let parsed;try{parsed=new URL(u);}catch{fail('SERVICE_ORIGIN_INVALID');}if(parsed.protocol!=='https:'||parsed.origin!==u||parsed.username||parsed.password)fail('SERVICE_ORIGIN_INVALID');}
 if(settings.policy?.accepted!==true&&requireConfigured)fail('ORGANIZATION_POLICY_NOT_ADOPTED');
 if(settings.browser&&(Object.keys(settings.browser).some(k=>!['host','profileId'].includes(k))||settings.browser.host!=='local'||settings.browser.profileId!==undefined&&(typeof settings.browser.profileId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(settings.browser.profileId))))fail('LOCAL_BROWSER_CONFIGURATION_INVALID');
 if(typeof settings.policy?.version!=='string')fail('POLICY_VERSION_REQUIRED');
 return settings;
}
function loadContext(start,options={}){
 const root=findWorkspace(start),settings=validateSettings(readJson(path.join(root,'longterm.workspace.json')),options);
 const orgKey=crypto.createHash('sha256').update(settings.organization.id).digest('hex').slice(0,32);
 return{root,settings,orgKey,stateRoot:safeWithin(root,'state','organizations',orgKey),configHash:crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex')};
}
function assertOrganization(context,actual,{service='lt'}={}){
 const expected=service==='desk'?context.settings.organization.deskId:context.settings.organization.id;
 if(!expected||!actual||actual.id!==expected||actual.name!==context.settings.organization.name)fail('ORGANIZATION_MISMATCH');return true;
}
function statePath(context,skill,...parts){
 if(!catalog.skills.some(s=>s.id===skill)&&!(Array.isArray(catalog.helpers)&&catalog.helpers.some(s=>s.id===skill)))fail('UNKNOWN_SKILL');return safeWithin(context.stateRoot,'skills',skill,...parts);
}
function writeNewJson(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function acquire(context,operation){
 const lock=safeWithin(context.root,'state','runtime.lock');
 const lease={schemaVersion:1,id:crypto.randomUUID(),orgKey:context.orgKey,configHash:context.configHash,operation,pid:process.pid,at:new Date().toISOString()};
 try{writeNewJson(lock,lease);}catch(e){if(e.code==='EEXIST')fail('WORKSPACE_BUSY_OR_PREVIOUS_RUN_UNCONFIRMED');throw e;}
 const assertOwned=()=>{let current;try{current=readJson(lock);}catch{fail('LEASE_OWNERSHIP_CHANGED');}if(current?.id!==lease.id)fail('LEASE_OWNERSHIP_CHANGED');};
 return{lease,inherited:false,assertOwned,release(){assertOwned();fs.unlinkSync(lock);}};
}
// 공용 작업 점유 계약(2026-11-17 2차): 고정 순서는 공용 작업 점유(state/runtime.lock) → 월 수집 잠금 → 짧은 인덱스 잠금이다.
// control call이 자식 프로세스에 넘긴 LONGTERM_RUNTIME_LEASE_ID가 있으면 그 점유가 같은 기관·같은 설정의 정확한 같은 ID일 때만 이어받는다.
// 이어받은 점유는 해제하지 않는다(소유자인 부모가 해제). 다른 점유 무시·강제 해제·우회 인자는 제공하지 않는다.
function workspaceLease(context,operation,{env=process.env}={}){
 const id=env.LONGTERM_RUNTIME_LEASE_ID;if(!id)return acquire(context,operation);
 const lock=safeWithin(context.root,'state','runtime.lock');
 const assertOwned=()=>{let current;try{current=readJson(lock);}catch{fail('LEASE_INHERITANCE_MISMATCH');}if(current?.schemaVersion!==1||current.id!==id||current.orgKey!==context.orgKey||current.configHash!==context.configHash)fail('LEASE_INHERITANCE_MISMATCH');return current;};
 const lease=assertOwned();return{lease,inherited:true,assertOwned:()=>{assertOwned();},release(){assertOwned();}};
}
module.exports={safeWithin,findWorkspace,validateSettings,loadContext,assertOrganization,statePath,writeNewJson,acquire,workspaceLease,readJson};
