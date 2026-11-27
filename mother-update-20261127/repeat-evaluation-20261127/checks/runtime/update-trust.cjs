'use strict';
// 공개 업데이트 신뢰 검증(순수 검증): 로컬 고정 설정·서명된 배포 정보·코드 묶음만 확인하며 파일을 쓰거나 원격 코드를 실행하지 않는다.
const crypto=require('node:crypto');
const {relativeName}=require('./package-manager.cjs');
const catalog=require('../catalog.json');
const UPDATER_VERSION='1.0.0';
const LIMITS=Object.freeze({descriptorBytes:64*1024,bundleBytes:64*1024*1024,maxFiles:5000,maxFileBytes:8*1024*1024,maxRestoredBytes:32*1024*1024});
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const HEX64=/^[a-f0-9]{64}$/,STABLE_VERSION=/^\d+\.\d+\.\d+$/,ANY_VERSION=/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/;
const isPlain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exactKeys=(v,required,optional=[])=>isPlain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const nonNegativeInteger=v=>Number.isSafeInteger(v)&&v>=0;
function strictBase64(text){
 // 큰 문자열에서도 재귀 없는 문자 집합 검사 후, 정규 재인코딩과 정확히 같은지 확인한다.
 if(typeof text!=='string'||text.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))return null;
 const bytes=Buffer.from(text,'base64');return bytes.toString('base64')===text?bytes:null;
}
function utf8Json(bytes){const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.charCodeAt(0)===0xfeff)throw Error('BOM');return JSON.parse(text);}
function compareVersions(a,b){const x=a.split(/[.-]/,3).map(Number),y=b.split(/[.-]/,3).map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function validateUpdateSource(value){
 if(!isPlain(value))fail('UPDATE_SOURCE_INVALID');
 if(value.repository===''&&value.publicKeyPem==='')fail('UPDATE_SOURCE_NOT_CONFIGURED');
 if(!exactKeys(value,['schemaVersion','repository','channel','publicKeyPem','minimumSequence'],['note'])||value.schemaVersion!==1||value.channel!=='stable'||!nonNegativeInteger(value.minimumSequence)||(value.note!==undefined&&typeof value.note!=='string'))fail('UPDATE_SOURCE_INVALID');
 const m=/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(typeof value.repository==='string'?value.repository:'');
 if(!m||m[2]==='.'||m[2]==='..')fail('UPDATE_SOURCE_INVALID');
 if(typeof value.publicKeyPem!=='string'||/PRIVATE KEY/.test(value.publicKeyPem))fail('UPDATE_SOURCE_INVALID');
 let key;try{key=crypto.createPublicKey(value.publicKeyPem);}catch{fail('UPDATE_SOURCE_INVALID');}
 if(key.asymmetricKeyType!=='ed25519')fail('UPDATE_SOURCE_INVALID');
 return Object.freeze({schemaVersion:1,repository:value.repository,owner:m[1],repo:m[2],channel:'stable',publicKeyPem:value.publicKeyPem,minimumSequence:value.minimumSequence});
}
const PAYLOAD_FIELDS=['schemaVersion','channel','version','sequence','runtimeApi','stateSchemaVersion','minimumUpdaterVersion','minimumNodeMajor','bundleAsset','bundleBytes','bundleSha256','manifestSha256'];
function verifyDescriptor(envelope,source,installed,receipt){
 if(!Buffer.isBuffer(envelope))fail('DESCRIPTOR_ENVELOPE_INVALID');
 if(envelope.length>LIMITS.descriptorBytes)fail('DESCRIPTOR_TOO_LARGE');
 let outer;try{outer=utf8Json(envelope);}catch{fail('DESCRIPTOR_ENVELOPE_INVALID');}
 if(!exactKeys(outer,['payload','signature']))fail('DESCRIPTOR_ENVELOPE_INVALID');
 const payloadBytes=strictBase64(outer.payload),signature=strictBase64(outer.signature);
 if(!payloadBytes||!payloadBytes.length||!signature||signature.length!==64)fail('DESCRIPTOR_ENVELOPE_INVALID');
 // 서명은 받은 payload 바이트 그대로 고정 설정 키로만 확인한다(다시 직렬화한 바이트로 대신 검증하지 않는다).
 let valid=false;try{valid=crypto.verify(null,payloadBytes,crypto.createPublicKey(source.publicKeyPem),signature);}catch{valid=false;}
 if(!valid)fail('DESCRIPTOR_SIGNATURE_INVALID');
 let p;try{p=utf8Json(payloadBytes);}catch{fail('DESCRIPTOR_PAYLOAD_INVALID');}
 if(!exactKeys(p,PAYLOAD_FIELDS)||p.schemaVersion!==1||p.channel!==source.channel||typeof p.version!=='string'||!ANY_VERSION.test(p.version)||!nonNegativeInteger(p.sequence)||!Number.isSafeInteger(p.runtimeApi)||!Number.isSafeInteger(p.stateSchemaVersion)||typeof p.minimumUpdaterVersion!=='string'||!STABLE_VERSION.test(p.minimumUpdaterVersion)||!nonNegativeInteger(p.minimumNodeMajor)||p.bundleAsset!=='longterm-'+p.version+'.bundle.json'||!Number.isSafeInteger(p.bundleBytes)||p.bundleBytes<1||!HEX64.test(p.bundleSha256)||!HEX64.test(p.manifestSha256))fail('DESCRIPTOR_PAYLOAD_INVALID');
 if(!STABLE_VERSION.test(p.version))fail('PRERELEASE_NOT_ALLOWED');
 if(p.bundleBytes>LIMITS.bundleBytes)fail('BUNDLE_TOO_LARGE');
 if(p.runtimeApi!==1||p.stateSchemaVersion!==1||installed?.runtimeApi!==1||installed?.stateSchemaVersion!==1)fail('RUNTIME_OR_STATE_MIGRATION_REQUIRED');
 if(compareVersions(p.minimumUpdaterVersion,installed.updaterVersion||UPDATER_VERSION)>0)fail('UPDATER_TOO_OLD');
 if(p.minimumNodeMajor>(installed.nodeMajor??Number(process.versions.node.split('.')[0])))fail('NODE_VERSION_UNSUPPORTED');
 const payloadSha256=sha(payloadBytes),floor=Math.max(source.minimumSequence,receipt?.sequence??0);
 if(p.sequence<floor)fail('DESCRIPTOR_SEQUENCE_TOO_OLD');
 if(receipt&&p.sequence===receipt.sequence&&payloadSha256!==receipt.payloadSha256)fail('DESCRIPTOR_SEQUENCE_REUSED');
 if(typeof installed.version!=='string'||!ANY_VERSION.test(installed.version))fail('INSTALLED_VERSION_INVALID');
 const order=compareVersions(p.version,installed.version);
 if(order<0)fail('DOWNGRADE_NOT_ALLOWED');
 if(order===0&&p.manifestSha256!==installed.manifestFingerprint)fail('SAME_VERSION_DIFFERENT_MANIFEST');
 return Object.freeze({...p,payloadSha256,updateAvailable:order>0});
}
function sameSkillScope(ids){const expected=catalog.skills.map(s=>s.id).sort();return Array.isArray(ids)&&new Set(ids).size===ids.length&&JSON.stringify([...ids].sort())===JSON.stringify(expected);}
function decodeBundle(bytes,descriptor){
 if(!Buffer.isBuffer(bytes))fail('BUNDLE_FORMAT_INVALID');
 if(bytes.length>LIMITS.bundleBytes)fail('BUNDLE_TOO_LARGE');
 if(bytes.length!==descriptor.bundleBytes)fail('BUNDLE_SIZE_MISMATCH');
 if(sha(bytes)!==descriptor.bundleSha256)fail('BUNDLE_HASH_MISMATCH');
 let outer;try{outer=utf8Json(bytes);}catch{fail('BUNDLE_FORMAT_INVALID');}
 if(!exactKeys(outer,['schemaVersion','manifestBase64','files'])||outer.schemaVersion!==1||!Array.isArray(outer.files))fail('BUNDLE_FORMAT_INVALID');
 const manifestBytes=strictBase64(outer.manifestBase64);if(!manifestBytes||!manifestBytes.length)fail('BUNDLE_FORMAT_INVALID');
 if(manifestBytes.length>LIMITS.maxFileBytes)fail('BUNDLE_LIMIT_EXCEEDED');
 if(sha(manifestBytes)!==descriptor.manifestSha256)fail('BUNDLE_MANIFEST_HASH_MISMATCH');
 let manifest;try{manifest=utf8Json(manifestBytes);}catch{fail('BUNDLE_MANIFEST_MISMATCH');}
 if(!isPlain(manifest)||manifest.schemaVersion!==1||manifest.kind!=='base'||manifest.version!==descriptor.version||manifest.runtimeApi!==1||manifest.stateSchemaVersion!==1||!Array.isArray(manifest.files))fail('BUNDLE_MANIFEST_MISMATCH');
 if(!sameSkillScope(manifest.skills))fail('CATALOG_CHANGE_REQUIRES_MANUAL_MIGRATION');
 if(outer.files.length>LIMITS.maxFiles||manifest.files.length>LIMITS.maxFiles)fail('BUNDLE_LIMIT_EXCEEDED');
 const checkPath=p=>{try{relativeName(p);}catch{fail('BUNDLE_PATH_INVALID');}if(p.toLowerCase()==='manifest.json'||p.toLowerCase()==='release.json')fail('BUNDLE_PATH_INVALID');};
 const expected=new Map(),folded=new Set();
 for(const row of manifest.files){if(!exactKeys(row,['path','sha256'])||typeof row.path!=='string'||!HEX64.test(row.sha256||''))fail('BUNDLE_MANIFEST_MISMATCH');checkPath(row.path);if(folded.has(row.path.toLowerCase()))fail('BUNDLE_DUPLICATE_PATH');folded.add(row.path.toLowerCase());expected.set(row.path,row.sha256);}
 const seen=new Set(),decoded=[];let total=manifestBytes.length;
 for(const row of outer.files){
  if(!exactKeys(row,['path','base64'])||typeof row.path!=='string')fail('BUNDLE_FORMAT_INVALID');
  checkPath(row.path);const key=row.path.toLowerCase();if(seen.has(key))fail('BUNDLE_DUPLICATE_PATH');seen.add(key);
  if(!expected.has(row.path))fail('BUNDLE_FILE_SET_MISMATCH');
  const data=row.base64===''?Buffer.alloc(0):strictBase64(row.base64);if(!data)fail('BUNDLE_FORMAT_INVALID');
  if(data.length>LIMITS.maxFileBytes)fail('BUNDLE_LIMIT_EXCEEDED');total+=data.length;if(total>LIMITS.maxRestoredBytes)fail('BUNDLE_LIMIT_EXCEEDED');
  if(sha(data)!==expected.get(row.path))fail('BUNDLE_FILE_HASH_MISMATCH');
  decoded.push({path:row.path,bytes:data});
 }
 if(seen.size!==expected.size)fail('BUNDLE_FILE_SET_MISMATCH');
 const catalogFile=decoded.find(f=>f.path==='catalog.json');
 if(catalogFile){let c;try{c=utf8Json(catalogFile.bytes);}catch{fail('CATALOG_CHANGE_REQUIRES_MANUAL_MIGRATION');}if(!sameSkillScope(c?.skills?.map?.(s=>s?.id)))fail('CATALOG_CHANGE_REQUIRES_MANUAL_MIGRATION');}
 return{manifest,manifestBytes,files:decoded};
}
module.exports={UPDATER_VERSION,LIMITS,validateUpdateSource,verifyDescriptor,decodeBundle,compareVersions,strictBase64};
