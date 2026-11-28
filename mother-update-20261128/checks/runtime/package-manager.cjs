'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {safeWithin,writeNewJson,readJson}=require('./context.cjs');
const catalog=require('../catalog.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const fileHash=f=>hash(fs.readFileSync(f));
function relativeName(name){
 if(typeof name!=='string'||!name||name.includes('\\')||path.posix.isAbsolute(name)||path.win32.isAbsolute(name))fail('INVALID_PACKAGE_PATH');
 const parts=name.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('INVALID_PACKAGE_PATH');
 if(parts.some(p=>/^(?:data|output|corpus|backups|memory|state|\.git|\.claude|\.codex|\.env.*)$/i.test(p))||/\.(?:enc|pem|key|pfx|p12)$/i.test(name))fail('PRIVATE_PATH_IN_PACKAGE');return name;
}
function validatePackage(folder,expectedFingerprint,{kind='base'}={}){
 if(!/^[a-f0-9]{64}$/.test(expectedFingerprint||''))fail('TRUSTED_MANIFEST_FINGERPRINT_REQUIRED');
 const manifestFile=path.join(folder,'manifest.json'),bytes=fs.readFileSync(manifestFile);if(hash(bytes)!==expectedFingerprint)fail('PACKAGE_FINGERPRINT_MISMATCH');
 const m=JSON.parse(bytes.toString('utf8'));
 if(m.schemaVersion!==1||m.kind!==kind||m.runtimeApi!==1||m.stateSchemaVersion!==1||!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(m.version)||!Array.isArray(m.files)||!m.files.length)fail('PACKAGE_MANIFEST_UNSUPPORTED');
 if(kind==='base'&&(!Array.isArray(catalog.skills)||!catalog.skills.length||new Set(catalog.skills.map(s=>s.id)).size!==catalog.skills.length||!Array.isArray(m.skills)||m.skills.length!==catalog.skills.length||new Set(m.skills).size!==m.skills.length||JSON.stringify([...m.skills].sort())!==JSON.stringify(catalog.skills.map(s=>s.id).sort())))fail('FULL_SKILL_PACKAGE_REQUIRED');
 if(kind==='addon'&&(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.skillId||'')||['caremanager-rfid-check','longterm-schedule-change','easycare-plan-write'].includes(m.skillId)||m.requiresRuntimeApi!==1))fail('ADDON_ID_OR_VERSION_CONFLICT');
 const names=new Set();for(const f of m.files){relativeName(f.path);if(kind==='base'&&!/^(?:skills\/|runtime\/|assets\/|catalog\.json$|package\.json$|workspace\.example\.json$|README\.md$)/.test(f.path))fail('PACKAGE_NAMESPACE_INVALID');if(kind==='addon'&&!f.path.startsWith('skills/'+m.skillId+'/'))fail('ADDON_OUTSIDE_OWN_NAMESPACE');const key=f.path.toLowerCase();if(names.has(key)||!f.sha256?.match(/^[a-f0-9]{64}$/))fail('DUPLICATE_OR_INVALID_PACKAGE_FILE');names.add(key);const actual=safeWithin(folder,f.path);if(!fs.existsSync(actual)||!fs.statSync(actual).isFile()||fileHash(actual)!==f.sha256)fail('PACKAGE_FILE_HASH_MISMATCH');}
 if(kind==='base')for(const id of m.skills)if(!names.has('skills/'+id+'/skill.md'))fail('SKILL_ENTRY_MISSING');
 if(kind==='base'&&catalog.helpers!==undefined){if(!Array.isArray(catalog.helpers))fail('SHARED_HELPER_CATALOG_INVALID');const helperIds=catalog.helpers.map(h=>h?.id);if(helperIds.some(id=>typeof id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||catalog.skills.some(s=>s.id===id))||new Set(helperIds).size!==helperIds.length)fail('SHARED_HELPER_CATALOG_INVALID');for(const id of ['caremanager-rfid-check','longterm-schedule-change','easycare-plan-write'])if(names.has('skills/'+id+'/skill.md'))fail('RETIRED_SKILL_ENTRY');for(const id of helperIds)if(![...names].some(p=>p.startsWith('skills/'+id+'/scripts/')))fail('SHARED_HELPER_MISSING');}
 if(kind==='addon'&&!names.has('skills/'+m.skillId+'/skill.md'))fail('SKILL_ENTRY_MISSING');
 return m;
}
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function listFiles(root){if(!fs.existsSync(root))return[];return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>{const f=path.join(root,e.name);if(e.isSymbolicLink())return[];return e.isDirectory()?listFiles(f):[f];});}
function assertIdle(root,ownedLease){
 const file=path.join(root,'state/runtime.lock');if(!fs.existsSync(file))return;
 // 업데이트 도구가 이 프로세스에서 직접 잡은 update 점유만 자기 점유로 인정한다(다른 업무·불명 점유는 그대로 중단).
 if(ownedLease){let current;try{current=readJson(file);}catch{current=null;}if(current?.id===ownedLease.id&&typeof current.operation==='string'&&current.operation.startsWith('update:')&&current.pid===process.pid)return;}
 fail('WORKSPACE_BUSY_OR_PREVIOUS_RUN_UNCONFIRMED');
}
function entry(id,{addon=false}={}){const skill=addon?undefined:catalog.skills.find(s=>s.id===id),description=id==='longterm-start'?'롱텀업무시작·롱텀 업무 시작·메뉴 요청 또는 현재 번호 선택을 해당 단계로 연결한다. 롱텀 스킬 업데이트 확인·롱텀 스킬 업데이트해 줘 요청도 처리한다.':skill?('롱텀업무 '+(skill.steps.join('·')||'4번 상세·옛 호칭')+' '+skill.capability):('추가 업무 '+id+'를 요청하거나 이 스킬을 이름으로 지정할 때 사용한다.');return'---\nname: '+id+'\ndescription: '+JSON.stringify(description)+'\n---\n\n# '+id+'\n\n모든 롱텀 스킬의 서술형 업무 문장은 확인된 사실을 구체적으로 자연스러운 업무 기록체로 쓴다. 특정 날짜와 출처 설명은 본문에서 제외하고, 내부 근거의 출처·기록일과 필수 날짜 입력란은 보존한다. 직접 관찰을 꾸미거나 사실을 추정하지 않는다. 명시적으로 날짜·출처가 필요한 경우는 해당 지시와 서식을 따른다.\n\n이 작업 폴더의 `node control.cjs menu`로 현재 등록을 확인한다. `node control.cjs skill '+id+'`가 알려 주는 현재 버전 지침을 읽고 실행한다. 설정·자료·완료/unknown 이력을 보존한다. 실제 사이트 쓰기는 그 업무의 사용자 지시/승인 범위만 수행한다. 브라우저는 Aside CLI를 사용하고 MCP를 설치하지 않는다.\n'+(id==='longterm-start'?'\n「롱텀 스킬 업데이트 있는지 확인해 줘」·「롱텀 스킬 업데이트 확인」은 `node control.cjs update-check`만 실행한다(읽기만). 확인 요청만으로 적용하지 않는다. 「롱텀 스킬 업데이트해 줘」는 `node control.cjs update`를 실행한다(작업 폴더 `update-source.json`의 공식 소스·고정 공개키·서명·호환을 통과한 공통 코드만 적용). 진행 중 업무·수집, 충돌, 검증 실패면 이유를 알리고 멈추며 다시 시도하거나 점유를 지우지 않는다. 결과·설정은 현재 버전의 `assets/update-guide.md`를 따른다. 이전 버전 복귀는 `node control.cjs rollback --version <버전>`이며 코드만 되돌린다.\n':'');}
function ensureNoDuplicateSkills(root,ids,userRoot){
 for(const base of [path.join(userRoot,'.agents/skills'),path.join(userRoot,'.codex/skills')])for(const id of ids)if(fs.existsSync(path.join(base,id,'SKILL.md')))fail('GLOBAL_SKILL_NAME_CONFLICT:'+id);
 let parent=path.dirname(path.resolve(root));while(true){for(const id of ids)if(fs.existsSync(path.join(parent,'.agents/skills',id,'SKILL.md')))fail('ANCESTOR_SKILL_NAME_CONFLICT:'+id);const next=path.dirname(parent);if(next===parent)break;parent=next;}
}
function readActive(root){const file=path.join(root,'active.json');return fs.existsSync(file)?readJson(file):null;}
function releaseRoot(root,version){if(!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(version))fail('INVALID_RELEASE_ID');return safeWithin(root,'releases',version);}
function operationLock(root,fn){
 fs.mkdirSync(root,{recursive:true});const lock=safeWithin(root,'.install.lock');let fd;
 try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('INSTALLATION_OPERATION_BUSY');throw e;}
 try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function preservedConfiguration(root){return listFiles(root).filter(f=>{const r=path.relative(root,f).replaceAll('\\','/');return r==='longterm.workspace.json'||r==='update-source.json'||r==='update-state.json'||r==='update-pending.json'||r.startsWith('state/')||r.startsWith('addons/');}).map(f=>({file:f,hash:fileHash(f)}));}
function verifyPreserved(rows){for(const x of rows)if(!fs.existsSync(x.file)||fileHash(x.file)!==x.hash)fail('PRESERVED_STATE_CHANGED');}
function readAddonRegistry(root){
 const file=safeWithin(root,'addons','registry.json');
 const registry=fs.existsSync(file)?readJson(file):{};
 if(!registry||typeof registry!=='object'||Array.isArray(registry))fail('ADDON_REGISTRY_INVALID');
 return registry;
}
function commonEntryHash(release,id){
 return release?.commonEntryHashes?.[id]||(catalog.skills.some(skill=>skill.id===id)?hash(Buffer.from(entry(id))):undefined);
}
function assertBaseSkillIds(root,ids,previousIds=[],historicalRelease){
 const registry=readAddonRegistry(root);
 const conflicts=ids.filter(id=>{
  if(Object.hasOwn(registry,id))return true;
  if(previousIds.includes(id))return false;
  const target=safeWithin(root,'.agents','skills',id,'SKILL.md');
  return fs.existsSync(target)&&(!historicalRelease||fileHash(target)!==commonEntryHash(historicalRelease,id));
 });
 if(conflicts.length)throw Object.assign(Error('BASE_SKILL_ID_CONFLICT: '+conflicts.join(', ')),{code:'BASE_SKILL_ID_CONFLICT',conflicts});
}
function install({packageRoot,workspace,expectedFingerprint,userRoot=process.env.USERPROFILE||process.env.HOME,checkStage,bootstrapSource,settingsTemplate,ownedLease}){
 const m=validatePackage(packageRoot,expectedFingerprint),root=path.resolve(workspace);
 if(typeof checkStage!=='function')fail('STAGING_CHECK_REQUIRED');
 ensureNoDuplicateSkills(root,m.skills,userRoot);
 return operationLock(root,()=>{
  assertIdle(root,ownedLease);const active=readActive(root),prior=active?releaseRoot(root,active.version):null;
  if(!active)for(const id of m.skills)if(fs.existsSync(path.join(root,'.agents/skills',id,'SKILL.md')))fail('EXISTING_WORKSPACE_SKILL_CONFLICT:'+id);
  const baseline=prior?readJson(path.join(prior,'release.json')):null;
  assertBaseSkillIds(root,m.skills,baseline?.skills);
  if(!fs.existsSync(path.join(root,'longterm.workspace.json'))&&!settingsTemplate)fail('SETTINGS_TEMPLATE_REQUIRED');
  if(!fs.existsSync(path.join(root,'control.cjs'))&&!bootstrapSource)fail('BOOTSTRAP_REQUIRED');
  if(active?.version===m.version)fail('RELEASE_ALREADY_ACTIVE');
  const destination=releaseRoot(root,m.version);if(fs.existsSync(destination))fail('RELEASE_DIRECTORY_ALREADY_EXISTS');
  const protectedRows=preservedConfiguration(root),sources=new Map(m.files.map(f=>[f.path,{file:path.join(packageRoot,f.path),hash:f.sha256}])),retained=[],conflicts=[];
  if(prior){const old=new Map(baseline.files.map(f=>[f.path,f.sha256]));
   for(const f of baseline.files){const current=path.join(prior,f.path);if(sources.has(f.path)&&(!fs.existsSync(current)||fs.lstatSync(current).isSymbolicLink()))conflicts.push(f.path);}
   for(const file of listFiles(prior)){const relative=path.relative(prior,file).replaceAll('\\','/');if(relative==='release.json')continue;const current=fileHash(file),base=old.get(relative),next=sources.get(relative);
    if(base&&current===base)continue;
    if(next&&next.hash!==current&&next.hash!==base){conflicts.push(relative);continue;}
    if(base&&!next){conflicts.push(relative);continue;}
    sources.set(relative,{file,hash:current,custom:true});retained.push(relative);
   }
  }
  if(conflicts.length){const e=Object.assign(Error('CUSTOM_MODIFICATION_CONFLICT'),{code:'CUSTOM_MODIFICATION_CONFLICT',conflicts});throw e;}
  // Validate everything before touching the active release or settings.
  for(const [relative,s]of sources){relativeName(relative);if(fileHash(s.file)!==s.hash)fail('PACKAGE_CHANGED_DURING_REVIEW');}
  fs.mkdirSync(destination,{recursive:true});for(const [relative,s]of sources){const target=safeWithin(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(s.file,target,fs.constants.COPYFILE_EXCL);if(fileHash(target)!==s.hash)fail('STAGED_COPY_MISMATCH');}
  const commonEntryHashes=Object.fromEntries(m.skills.map(id=>[id,commonEntryHash(baseline,id)]));
  writeNewJson(path.join(destination,'release.json'),{...m,trustedFingerprint:expectedFingerprint,retainedCustomFiles:retained,stagedFiles:[...sources].map(([path,s])=>({path,sha256:s.hash})),commonEntryHashes});
  if(checkStage){const checked=checkStage({releaseRoot:destination,manifest:m});if(!checked?.ok)fail('STAGING_CHECK_FAILED');}
  assertIdle(root,ownedLease);verifyPreserved(protectedRows);
  for(const id of m.skills){const target=safeWithin(root,'.agents','skills',id,'SKILL.md');if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,entry(id),{flag:'wx'});}else if(!active)fail('EXISTING_WORKSPACE_SKILL_CONFLICT:'+id);}
  const settings=path.join(root,'longterm.workspace.json');if(!fs.existsSync(settings)){if(!settingsTemplate)fail('SETTINGS_TEMPLATE_REQUIRED');fs.writeFileSync(settings,JSON.stringify(settingsTemplate,null,2)+'\n',{flag:'wx'});}
  const bootstrap=path.join(root,'control.cjs');if(!fs.existsSync(bootstrap)){if(!bootstrapSource)fail('BOOTSTRAP_REQUIRED');fs.writeFileSync(bootstrap,bootstrapSource,{flag:'wx'});}
  atomicJson(path.join(root,'active.json'),{schemaVersion:1,version:m.version,runtimeApi:m.runtimeApi,stateSchemaVersion:m.stateSchemaVersion,manifestFingerprint:expectedFingerprint});
  verifyPreserved(protectedRows);return{ok:true,version:m.version,priorVersion:active?.version||null,skills:m.skills.length,retainedCustomFiles:retained,activeChanged:true};
 });
}
function rollback({workspace,version,userRoot=process.env.USERPROFILE||process.env.HOME}){
 const root=path.resolve(workspace);return operationLock(root,()=>{assertIdle(root);const prior=readActive(root),target=releaseRoot(root,version),m=readJson(path.join(target,'release.json'));if(m.version!==version)fail('ROLLBACK_VERSION_MISMATCH');if(m.runtimeApi!==1||m.stateSchemaVersion!==1)fail('ROLLBACK_SCHEMA_UNSUPPORTED');
  const rows=m.stagedFiles||(!m.retainedCustomFiles?.length?m.files:null);if(!Array.isArray(rows)||!rows.length)fail('ROLLBACK_TARGET_BASELINE_REQUIRED');const seen=new Set();for(const row of rows){relativeName(row.path);if(seen.has(row.path.toLowerCase())||!/^[a-f0-9]{64}$/.test(row.sha256||''))fail('ROLLBACK_TARGET_BASELINE_REQUIRED');seen.add(row.path.toLowerCase());const file=safeWithin(target,row.path);if(!fs.existsSync(file)||!fs.lstatSync(file).isFile()||fileHash(file)!==row.sha256)fail('ROLLBACK_TARGET_CHANGED');}
  ensureNoDuplicateSkills(root,m.skills,userRoot);
  const current=prior?readJson(safeWithin(releaseRoot(root,prior.version),'release.json')):null;
  assertBaseSkillIds(root,m.skills,current?.skills,m);
  if(Object.values(readAddonRegistry(root)).some(a=>a.enabled&&a.requiresRuntimeApi!==m.runtimeApi))fail('ADDON_INCOMPATIBLE_WITH_ROLLBACK');
  const preserved=preservedConfiguration(root);atomicJson(path.join(root,'active.json'),{schemaVersion:1,version:m.version,runtimeApi:m.runtimeApi,stateSchemaVersion:m.stateSchemaVersion,manifestFingerprint:m.trustedFingerprint});verifyPreserved(preserved);return{ok:true,version,priorVersion:prior?.version,siteWritesReverted:false};});
}
function addSkill({packageRoot,workspace,expectedFingerprint,userRoot=process.env.USERPROFILE||process.env.HOME}){
 const m=validatePackage(packageRoot,expectedFingerprint,{kind:'addon'}),root=path.resolve(workspace);ensureNoDuplicateSkills(root,[m.skillId],userRoot);
 return operationLock(root,()=>{assertIdle(root);const active=assertAddonCompatible(root,m),registry=readAddonRegistry(root);
  if(Object.hasOwn(registry,m.skillId))fail('ADDON_NAME_CONFLICT');
  const id=m.skillId,target=safeWithin(root,'.agents','skills',id,'SKILL.md');
  const marker=safeWithin(root,'addons',id,'registration.json'),entryContent=entry(id,{addon:true}),entryHash=hash(Buffer.from(entryContent));
  const claim={version:m.version,manifestSha256:expectedFingerprint,entryHash};
  const retry=fs.existsSync(marker);
  if(retry&&JSON.stringify(readJson(marker))!==JSON.stringify(claim))fail('ADDON_REGISTRATION_PENDING');
  if(fs.existsSync(path.dirname(target))&&(!retry||(fs.existsSync(target)&&fileHash(target)!==entryHash)))fail('ADDON_NAME_CONFLICT');
  stageAddon(root,packageRoot,m,expectedFingerprint);
  if(!retry)writeNewJson(marker,claim);
  assertIdle(root);
  if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,entryContent,{flag:'wx'});}
  if(fileHash(target)!==entryHash)fail('ADDON_NAME_CONFLICT');
  registry[id]={version:m.version,requiresRuntimeApi:m.requiresRuntimeApi,enabled:true,entryHash,versionFingerprints:{[m.version]:expectedFingerprint}};
  atomicJson(safeWithin(root,'addons','registry.json'),registry);return{ok:true,skillId:m.skillId,baseVersionUnchanged:active.version};
 });
}
function addonRoot(root,id,version){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id||'')||!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(version||''))fail('INVALID_ADDON_ID_OR_VERSION');
 relativeName('skills/'+id+'/SKILL.md');
 return safeWithin(root,'addons',id,version);
}
function assertAddonCompatible(root,manifest){
 const active=readActive(root);
 if(!active||active.runtimeApi!==manifest.requiresRuntimeApi||active.stateSchemaVersion!==manifest.stateSchemaVersion)fail('ADDON_REQUIRES_BASE_UPDATE');
 const base=readJson(safeWithin(releaseRoot(root,active.version),'release.json'));
 if(base.skills.includes(manifest.skillId)||base.files.some(row=>row.path.startsWith('skills/'+manifest.skillId+'/')))fail('ADDON_NAME_CONFLICT');
 return active;
}
function matchesAddonFiles(folder,manifest){
 if(!Array.isArray(manifest.files)||!manifest.files.some(f=>f.path.toLowerCase()==='skills/'+manifest.skillId+'/skill.md'))return false;
 const expected=new Set();
 for(const row of manifest.files){
  relativeName(row.path);
  if(!row.path.startsWith('skills/'+manifest.skillId+'/')||expected.has(row.path.toLowerCase())||!/^[a-f0-9]{64}$/.test(row.sha256||''))return false;
  expected.add(row.path.toLowerCase());
  const file=safeWithin(folder,row.path);
  if(!fs.existsSync(file)||!fs.lstatSync(file).isFile()||fileHash(file)!==row.sha256)return false;
 }
 // Each declared file was checked above. Extra files or links also change the installed code.
 const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).every(item=>{
  const child=path.join(directory,item.name);
  return item.isDirectory()?walk(child):item.isFile()&&((directory===folder&&['release.json','manifest.json'].includes(item.name))||expected.has(path.relative(folder,child).replaceAll('\\','/').toLowerCase()));
 });
 return walk(folder);
}
function readAddonRelease(root,id,version,pinnedFingerprint){
 const folder=addonRoot(root,id,version),receipt=safeWithin(folder,'release.json');
 if(!fs.existsSync(receipt))fail('ADDON_VERSION_NOT_INSTALLED');
 const manifest=readJson(receipt);
 if(manifest.kind!=='addon'||manifest.schemaVersion!==1||manifest.skillId!==id||manifest.version!==version||manifest.runtimeApi!==manifest.requiresRuntimeApi||!/^[a-f0-9]{64}$/.test(manifest.trustedFingerprint||''))fail('ADDON_RELEASE_METADATA_INVALID');
 const original=safeWithin(folder,'manifest.json');
 if(pinnedFingerprint&&!fs.existsSync(original))fail('ADDON_RELEASE_FINGERPRINT_MISMATCH');
 if(fs.existsSync(original)){
  const bytes=fs.readFileSync(original),fingerprint=hash(bytes);
  if(fingerprint!==manifest.trustedFingerprint||(pinnedFingerprint&&fingerprint!==pinnedFingerprint)||JSON.stringify({...JSON.parse(bytes),trustedFingerprint:fingerprint})!==JSON.stringify(manifest))fail('ADDON_RELEASE_FINGERPRINT_MISMATCH');
 }
 return {folder,manifest};
}
function stageAddon(root,packageRoot,manifest,fingerprint){
 const {skillId:id,version}=manifest,destination=addonRoot(root,id,version);
 const bytes=fs.readFileSync(safeWithin(packageRoot,'manifest.json'));
 if(hash(bytes)!==fingerprint)fail('PACKAGE_CHANGED_DURING_REVIEW');
 if(fs.existsSync(destination)){
  const installed=readAddonRelease(root,id,version);
  if(installed.manifest.trustedFingerprint!==fingerprint||JSON.stringify(installed.manifest)!==JSON.stringify({...manifest,trustedFingerprint:fingerprint})||!matchesAddonFiles(destination,manifest))fail('ADDON_DIRECTORY_EXISTS');
  const original=safeWithin(destination,'manifest.json');
  if(!fs.existsSync(original))fs.writeFileSync(original,bytes,{flag:'wx'});
  return;
 }
 const stage=safeWithin(root,'addons',id,'.stage-'+crypto.randomUUID());
 fs.mkdirSync(stage,{recursive:true});
 for(const row of manifest.files){
  const target=safeWithin(stage,row.path);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(safeWithin(packageRoot,row.path),target,fs.constants.COPYFILE_EXCL);
 }
 if(!matchesAddonFiles(stage,manifest))fail('ADDON_STAGED_COPY_MISMATCH');
 writeNewJson(path.join(stage,'release.json'),{...manifest,trustedFingerprint:fingerprint});
 fs.writeFileSync(path.join(stage,'manifest.json'),bytes,{flag:'wx'});
 fs.renameSync(stage,destination);
}
function hasOriginalAddonEntry(root,id,record){
 const target=safeWithin(root,'.agents','skills',id,'SKILL.md');
 return fs.existsSync(target)&&fileHash(target)===record.entryHash;
}
function registeredAddon(root,id,registry){
 if(!Object.hasOwn(registry,id)||!registry[id].enabled)fail('ADDON_NOT_ACTIVE');
 const record=registry[id];
 if(!hasOriginalAddonEntry(root,id,record))fail('CUSTOM_ADDON_ENTRY_PRESERVED');
 return record;
}
function changeAddonVersion(root,registry,id,record,manifest,active,fingerprint){
 assertIdle(root);
 registry[id]={...record,version:manifest.version,requiresRuntimeApi:manifest.requiresRuntimeApi};
 if(fingerprint)registry[id].versionFingerprints={...record.versionFingerprints,[manifest.version]:fingerprint};
 atomicJson(safeWithin(root,'addons','registry.json'),registry);
 return {ok:true,skillId:id,version:manifest.version,priorVersion:record.version,baseVersionUnchanged:active.version};
}
function updateSkill({packageRoot,workspace,expectedFingerprint,userRoot=process.env.USERPROFILE||process.env.HOME}){
 const manifest=validatePackage(packageRoot,expectedFingerprint,{kind:'addon'}),root=path.resolve(workspace),id=manifest.skillId;
 ensureNoDuplicateSkills(root,[id],userRoot);
 return operationLock(root,()=>{
  assertIdle(root);
  const active=assertAddonCompatible(root,manifest),registry=readAddonRegistry(root),record=registeredAddon(root,id,registry);
  if(record.version===manifest.version)fail('ADDON_VERSION_ALREADY_ACTIVE');
  const current=readAddonRelease(root,id,record.version,record.versionFingerprints?.[record.version]);
  if(!matchesAddonFiles(current.folder,current.manifest))fail('CUSTOM_ADDON_FILES_CHANGED');
  stageAddon(root,packageRoot,manifest,expectedFingerprint);
  if(!matchesAddonFiles(current.folder,current.manifest))fail('CUSTOM_ADDON_FILES_CHANGED');
  return changeAddonVersion(root,registry,id,record,manifest,active,expectedFingerprint);
 });
}
function rollbackSkill({workspace,id,version,userRoot=process.env.USERPROFILE||process.env.HOME}){
 const root=path.resolve(workspace),target=addonRoot(root,id,version);
 ensureNoDuplicateSkills(root,[id],userRoot);
 return operationLock(root,()=>{
  assertIdle(root);
  const registry=readAddonRegistry(root),record=registeredAddon(root,id,registry);
  if(record.version===version)fail('ADDON_VERSION_ALREADY_ACTIVE');
  const {manifest}=readAddonRelease(root,id,version,record.versionFingerprints?.[version]),active=assertAddonCompatible(root,manifest);
  if(!matchesAddonFiles(target,manifest))fail('ADDON_ROLLBACK_TARGET_CHANGED');
  return changeAddonVersion(root,registry,id,record,manifest,active);
 });
}
function listInstalledSkills({workspace}){
 const root=path.resolve(workspace),active=readActive(root);
 if(!active)fail('BASE_RELEASE_NOT_INSTALLED');
 const addons=Object.entries(readAddonRegistry(root)).filter(([,record])=>record.enabled).sort(([a],[b])=>a.localeCompare(b)).map(([id,record])=>{
  const {folder,manifest}=readAddonRelease(root,id,record.version,record.versionFingerprints?.[record.version]);
  const result={id,version:manifest.version,manifestSha256:manifest.trustedFingerprint};
  if(!hasOriginalAddonEntry(root,id,record)||!matchesAddonFiles(folder,manifest))result.hasLocalChanges=true;
  return result;
 });
 const base={version:active.version,manifestSha256:active.manifestFingerprint};
 const folder=releaseRoot(root,active.version),release=readJson(safeWithin(folder,'release.json'));
 if(!/^[a-f0-9]{64}$/.test(base.manifestSha256||'')||release.version!==base.version||release.trustedFingerprint!==base.manifestSha256)fail('BASE_RELEASE_FINGERPRINT_MISMATCH');
 const expected=new Map(release.files.map(row=>[row.path,row.sha256]));
 if(listFiles(folder).some(file=>{
  const name=path.relative(folder,file).replaceAll('\\','/');
  return name!=='release.json'&&expected.get(name)!==fileHash(file);
 })||release.files.some(row=>!fs.existsSync(safeWithin(folder,row.path)))||release.skills.some(id=>{
  const target=safeWithin(root,'.agents','skills',id,'SKILL.md');
  return !fs.existsSync(target)||fileHash(target)!==commonEntryHash(release,id);
 }))base.hasLocalChanges=true;
 return {base,addons};
}
function removeSkill({workspace,id}){
 const root=path.resolve(workspace);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||catalog.skills.some(s=>s.id===id))fail('ONLY_REGISTERED_ADDON_REMOVAL_ALLOWED');
 return operationLock(root,()=>{assertIdle(root);const file=path.join(root,'addons/registry.json'),registry=readJson(file),record=registry[id],entryFile=safeWithin(root,'.agents','skills',id,'SKILL.md');if(!record?.enabled)fail('ADDON_NOT_ACTIVE');if(fileHash(entryFile)!==record.entryHash)fail('CUSTOM_ADDON_ENTRY_PRESERVED');fs.unlinkSync(entryFile);record.enabled=false;atomicJson(file,registry);return{ok:true,id,codePreserved:true,statePreserved:true};});
}
function archiveInactive({workspace,version}){
 const root=path.resolve(workspace);return operationLock(root,()=>{assertIdle(root);const active=readActive(root);if(active?.version===version)fail('ACTIVE_RELEASE_CANNOT_BE_ARCHIVED');const source=releaseRoot(root,version);if(!fs.existsSync(source))fail('INACTIVE_RELEASE_NOT_FOUND');
  const visit=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink()||['data','output','state','corpus'].includes(entry.name.toLowerCase()))fail('PRIVATE_OR_LINKED_RELEASE_PRESERVED');if(entry.isDirectory())visit(file);}};visit(source);
  const archive=safeWithin(root,'code-archives',version+'-'+crypto.randomUUID());fs.mkdirSync(path.dirname(archive),{recursive:true});fs.renameSync(source,archive);return{ok:true,version,archive,activeVersionUnchanged:active?.version||null,siteWritesReverted:false};
 });
}
module.exports={relativeName,validatePackage,install,rollback,addSkill,updateSkill,rollbackSkill,listInstalledSkills,removeSkill,entry,readActive,archiveInactive};
