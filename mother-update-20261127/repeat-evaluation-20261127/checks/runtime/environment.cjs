'use strict';
const path=require('node:path');
const {loadContext,readJson,safeWithin}=require('./context.cjs');
const {validateScope}=require('./browser-guard.cjs');
function scopeFor(context,bindings){
 if(bindings?.schemaVersion!==1||bindings.configHash!==context.configHash||!Array.isArray(bindings.targets))throw Error('BROWSER_BINDINGS_STALE_OR_MISSING');
 for(const t of bindings.targets)if(Object.keys(t).some(k=>!['service','targetId','role','headerSelector','headerText'].includes(k)))throw Error('UNSUPPORTED_BROWSER_BINDING_FIELD');
 return validateScope({organization:context.settings.organization,operator:context.settings.operator,origins:context.settings.origins,targets:bindings.targets,connection:context.settings.browser||{host:'local'}});
}
function loadScope(start){const context=loadContext(start),file=safeWithin(context.stateRoot,'browser-bindings.json');return{context,scope:scopeFor(context,readJson(file))};}
// 공용 browser-binding.cjs의 전송 scope 지문 계약. 월간 요청의 지문 형식과는 다르다.
function transportFingerprint(scope){return require('node:crypto').createHash('sha256').update(JSON.stringify({organization:scope.organization,origins:scope.origins,connection:scope.connection,targets:scope.targets})).digest('hex');}
module.exports={loadScope,scopeFor,transportFingerprint};
