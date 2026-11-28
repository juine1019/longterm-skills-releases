'use strict';
function validateScope(scope){
 if(!scope?.organization?.id||!scope.organization.name||!scope.origins||!Array.isArray(scope.targets)||!scope.targets.length)throw Error('BROWSER_BINDINGS_REQUIRED');
 const seen=new Set(),services=new Set();for(const t of scope.targets){if(!['lt','ltRfid','desk','cm','ez'].includes(t.service)||typeof t.targetId!=='string'||!t.targetId||seen.has(t.targetId)||services.has(t.service))throw Error('AMBIGUOUS_BROWSER_BINDING');seen.add(t.targetId);services.add(t.service);const u=new URL(scope.origins[t.service]);if(u.protocol!=='https:'||u.origin!==scope.origins[t.service])throw Error('BROWSER_ORIGIN_INVALID');if(t.service==='lt'&&!['20A','20L'].includes(t.role)||t.service==='ltRfid'&&t.role!=='20A')throw Error('EXACT_LT_ROLE_REQUIRED');if(t.service==='desk'&&!scope.organization.deskId)throw Error('DESK_ORGANIZATION_ID_REQUIRED');if(['cm','ez'].includes(t.service)&&(!t.headerSelector||t.headerText!==scope.organization.name))throw Error('VISIBLE_ORGANIZATION_HEADER_BINDING_REQUIRED');}
 return scope;
}
async function confirmInPage(a){
 const reject=code=>{if(a.reportGuardErrors)return{verified:false,guardCode:code};throw Error(code);};
 if(location.origin!==a.origin)return reject('SERVICE_ORIGIN_CHANGED');
 if(a.service==='lt'||a.service==='ltRfid'){
  const app=typeof nexacro==='undefined'?null:nexacro.getApplication(),u=app?.gds_userInfo;
  const code=k=>String(u?.getColumn(0,k)||'');if(code('LTC_ADMIN_SYM')!==a.organization.id&&code('ADMIN_SYM')!==a.organization.id)return reject('LT_ORGANIZATION_CHANGED');if(code('USER_TYPE')!==a.role)return reject('LT_ROLE_CHANGED');
 }else if(a.service==='desk'){
  const r=await fetch('/api/org',{credentials:'same-origin',cache:'no-store'});if(r.status!==200||r.redirected)return reject('DESK_LOGIN_UNCONFIRMED');const j=await r.json();if(j.id!==a.organization.deskId||j.name!==a.organization.name)return reject('DESK_ORGANIZATION_CHANGED');if(j.me?.role!=='admin')return reject('DESK_ADMIN_REQUIRED');
 }else{
  if(document.querySelector('input[type=password]'))return reject('SERVICE_LOGIN_UNCONFIRMED');const entries=[...document.querySelectorAll(a.headerSelector)].filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden');if(entries.length!==1)return reject('ORGANIZATION_HEADER_AMBIGUOUS');const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');if(norm(entries[0].textContent)!==norm(a.organization.name))return reject('SERVICE_ORGANIZATION_CHANGED');
 }
 return{verified:true,service:a.service};
}
// 새 창은 명시 등록만 허용한다: 처음 창 준비(initial)·사용자가 요청한 새 창(user-request). 실행 중 사라진 지정 창의 대체는 등록할 수 없다(2026-11-18 창 고정).
function validateOpenTabs(openTabs,scope){
 if(!Array.isArray(openTabs)||openTabs.some(x=>!x||Object.keys(x).some(k=>!['service','reason'].includes(k))||!['initial','user-request'].includes(x.reason)||!scope.targets.some(t=>t.service===x.service)))throw Error('OPEN_TAB_REGISTRATION_INVALID');
 return openTabs.map(x=>({service:x.service,reason:x.reason}));
}
function compileGuarded(source,scope,{reportGuardErrors=false,openTabs=[]}={}){
 validateScope(scope);const registered=validateOpenTabs(openTabs,scope);
 return `await(async(__ltList,__ltAttach,__ltOpen)=>{
class __ltGuardError extends Error{}
const __ltReport=${reportGuardErrors===true};
try{
const __ltScope=${JSON.stringify(scope)},__ltAvailable=await __ltList(),__ltAllowed=new Map(),__ltOpenable=${JSON.stringify(registered)},__ltPages=new Map(),__ltChildren=new Map();
for(const binding of __ltScope.targets){const tab=__ltAvailable.find(x=>x.targetId===binding.targetId);if(!tab)throw new __ltGuardError('BOUND_TAB_MISSING');const u=new URL(tab.url);if(u.origin!==__ltScope.origins[binding.service])throw new __ltGuardError('BOUND_TAB_ORIGIN_CHANGED');__ltAllowed.set(tab.targetId,{...binding,url:tab.url});}
let page;
const __ltConfirm=${confirmInPage.toString()};
const __ltWrap=async(raw,binding,childCheck)=>{const args={...binding,origin:__ltScope.origins[binding.service],organization:__ltScope.organization};const check=childCheck||(async()=>{const reply=await raw.evaluate(__ltConfirm,__ltReport?{...args,reportGuardErrors:true}:args);if(__ltReport&&reply?.verified!==true)throw new __ltGuardError(reply?.guardCode||'BROWSER_GUARD_RESULT_UNCONFIRMED');});await check();const actions=new Set(['click','dblclick','fill','type','press','check','uncheck','selectOption']);const wrapLocator=value=>new Proxy(value,{get(target,key){const member=target[key];if(typeof member!=='function')return member;if(actions.has(key))return async(...a)=>{await check();const result=await member.apply(target,a);await check();return result;};return(...a)=>{const result=member.apply(target,a);return result&&typeof result==='object'&&typeof result.click==='function'?wrapLocator(result):result;};}});const result=new Proxy(raw,{get(target,key){if(key==='evaluate')return async(fn,a)=>{await check();const r=await raw.evaluate(fn,a);await check();return r;};if(key==='locator')return(...a)=>wrapLocator(raw.locator(...a));if(key==='mouse'||key==='keyboard')return new Proxy(raw[key],{get(t,k){const f=t[k];return typeof f==='function'?async(...a)=>{await check();const r=await f.apply(t,a);await check();return r;}:f;}});const v=target[key];return typeof v==='function'?v.bind(target):v;}});page=result;__ltPages.set(result,{targetId:binding.targetId,binding,check});return result;};
const listBrowserTabs=async()=>[...__ltAllowed].map(([targetId,b])=>({targetId,url:b.url}));
const attachBrowserTab=async targetId=>{const binding=__ltAllowed.get(targetId);if(!binding)throw Error('TAB_OUTSIDE_ORGANIZATION_BINDINGS');if(binding.parentTargetId){const child=__ltChildren.get(targetId);await __ltPages.get(child).check();page=child;return child;}return __ltWrap(await __ltAttach(targetId),{...binding,targetId});};
const openTab=async url=>{const u=new URL(url);const binding=__ltScope.targets.find(x=>__ltScope.origins[x.service]===u.origin);if(!binding||u.username||u.password)throw Error('OPEN_TAB_OUTSIDE_BOUND_SERVICE');const slot=__ltOpenable.findIndex(x=>x.service===binding.service);if(slot<0)throw new __ltGuardError('OPEN_TAB_NOT_REGISTERED');const current=await __ltList();for(const t of __ltScope.targets)if(t.service===binding.service&&!current.some(x=>x.targetId===t.targetId))throw new __ltGuardError('BOUND_TAB_MISSING');__ltOpenable.splice(slot,1);const before=new Set((await __ltList()).map(t=>t.targetId));const raw=await __ltOpen(url);const fresh=(await __ltList()).filter(t=>!before.has(t.targetId));const tab=fresh.find(x=>x.targetId===raw.targetId)||(fresh.length===1?fresh[0]:null);if(!tab||new URL(tab.url).origin!==u.origin)throw Error('NEW_TAB_ID_UNCONFIRMED');const b={...binding,targetId:tab.targetId,url:tab.url};__ltAllowed.set(tab.targetId,b);return __ltWrap(raw,b);};
// 검증한 지정 부모 창의 동작으로 새로 열린 같은 서비스 창 1개만 자식으로 등록한다. 자식의 매 동작 전후에 주소와 부모 창의 기관·역할을 다시 확인한다.
const openChildTab=async(parent,action)=>{const info=__ltPages.get(parent);if(!info||info.binding.parentTargetId)throw new __ltGuardError('CHILD_TAB_PARENT_UNVERIFIED');if(typeof action!=='function')throw new __ltGuardError('CHILD_TAB_ACTION_REQUIRED');const before=new Set((await __ltList()).map(t=>t.targetId));await action(parent);await info.check();let fresh=[];for(let i=0;i<20;i++){fresh=(await __ltList()).filter(t=>!before.has(t.targetId));if(fresh.length||typeof setTimeout!=='function')break;await new Promise(r=>setTimeout(r,250));}if(fresh.length!==1)throw new __ltGuardError('CHILD_TAB_UNCONFIRMED');const tab=fresh[0],origin=__ltScope.origins[info.binding.service];if(new URL(tab.url).origin!==origin)throw new __ltGuardError('CHILD_TAB_ORIGIN_CHANGED');const b={...info.binding,targetId:tab.targetId,url:tab.url,parentTargetId:info.targetId};const raw=await __ltAttach(tab.targetId);const child=await __ltWrap(raw,b,async()=>{await info.check();if(await raw.evaluate(()=>location.origin)!==origin)throw new __ltGuardError('CHILD_TAB_ORIGIN_CHANGED');});__ltAllowed.set(tab.targetId,b);__ltChildren.set(tab.targetId,child);return child;};
${source}
}catch(error){
 if(!__ltReport||!(error instanceof __ltGuardError))throw error;
 console.log('WN_RESULT:'+JSON.stringify({ok:false,browserGuardError:error.message}));
}
})(listBrowserTabs,attachBrowserTab,openTab);`;
}
module.exports={validateScope,confirmInPage,compileGuarded};
