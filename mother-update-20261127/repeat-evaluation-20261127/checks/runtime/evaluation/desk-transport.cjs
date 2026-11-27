'use strict';
const {must}=require('./core.cjs');
const DESK_GUARD_ERRORS=new Set(['BOUND_TAB_MISSING','BOUND_TAB_ORIGIN_CHANGED','SERVICE_ORIGIN_CHANGED',
 'DESK_LOGIN_UNCONFIRMED','DESK_ORGANIZATION_CHANGED','DESK_ADMIN_REQUIRED','BROWSER_GUARD_RESULT_UNCONFIRMED']);
async function pageRequest(p){
 const options={method:p.method,credentials:'same-origin',cache:'no-store',redirect:'error'};
 if(p.method==='PUT'||p.method==='POST'){options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(p.body);}
 const r=await fetch(p.path,options);if(!r.ok||r.redirected){
  let error;try{error=await r.json();}catch{}
  // Keep diagnostics, never copy an arbitrary error message/body containing PII.
  const serverCode=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?error.code:undefined;
  return{ok:false,status:r.status,...(serverCode?{serverCode}:{})};
 }
 return{ok:true,data:await r.json()};
}
function makeDeskRequest({scope,bridge}){
 const targets=(scope?.targets||[]).filter(t=>t.service==='desk');must(targets.length===1&&typeof targets[0].targetId==='string','BOUND_DESK_TAB_REQUIRED');
 must(typeof bridge==='function','DESK_BRIDGE_REQUIRED');const target=targets[0].targetId;
 return async(method,path,body)=>{
  const permitted=method==='GET'&&(path==='/api/org'||path==='/api/evaluation-results?includeRevisions=1'||/^\/api\/evaluation-results\/[a-f0-9]{64}(?:\?publicationRequestId=[-\w]{8,128})?$/.test(path))||method==='PUT'&&path==='/api/evaluation-results'||method==='POST'&&/^\/api\/evaluation-results\/[a-f0-9]{64}\/(?:register-claim|register-result)$/.test(path);
  must(permitted,'DESK_ROUTE_UNSUPPORTED');const args={method,path,...(method!=='GET'?{body}:{})};
  const source=`const p=${JSON.stringify(args)}; const t=${JSON.stringify(target)}; await attachBrowserTab(t); const result=await page.evaluate(${pageRequest.toString()},p); console.log('WN_RESULT:'+JSON.stringify(result));`;
  const writeAttempted=method!=='GET';
  const result=await bridge(source,{scope:{...scope,targets:[targets[0]]},writeAttempted,reportGuardErrors:true});
  if(result?.ok!==true||!result.data||typeof result.data!=='object'){
   const code=result?.ok===false&&DESK_GUARD_ERRORS.has(result.browserGuardError)?result.browserGuardError:
    result?.status===401?'DESK_LOGIN_UNCONFIRMED':result?.status===403?'DESK_ADMIN_REQUIRED':'DESK_REQUEST_FAILED';
   throw Object.assign(Error(code),{code,outcome:writeAttempted?'unknown':'read-unconfirmed',
    ...(Number.isInteger(result?.status)&&result.status>=100&&result.status<=599?{httpStatus:result.status}:{}),
    ...(typeof result?.serverCode==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(result.serverCode)?{serverCode:result.serverCode}:{})});
  }
  return result.data;
 };
}
module.exports={makeDeskRequest};
