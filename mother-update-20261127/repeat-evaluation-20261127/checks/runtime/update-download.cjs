'use strict';
// 인증 없는 HTTPS GET: 지정 저장소의 GitHub API·release 경로에서만 시작하고, redirect는 GitHub 자산 호스트로만 따라간다.
// 오류에는 코드만 싣고 URL·query·응답 원문을 남기지 않는다.
const https=require('node:https');
const ASSET_HOSTS=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com']);
const MAX_REDIRECTS=5;
const fail=code=>{throw Object.assign(Error(code),{code});};
function parse(text){try{return new URL(text);}catch{return null;}}
function safeHttps(u){return u&&u.protocol==='https:'&&!u.username&&!u.password&&u.port==='';}
function repositoryParts(repository){const m=/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(typeof repository==='string'?repository:'');return m&&m[2]!=='.'&&m[2]!=='..'?[m[1].toLowerCase(),m[2].toLowerCase()]:null;}
function startAllowed(u,repository){
 const parts=repositoryParts(repository);if(!parts||!safeHttps(u))return false;
 const segments=u.pathname.split('/').slice(1).map(s=>{try{return decodeURIComponent(s).toLowerCase();}catch{return'';}});
 if(u.hostname==='api.github.com')return segments[0]==='repos'&&segments[1]===parts[0]&&segments[2]===parts[1]&&segments[3]==='releases'&&segments.length>4;
 if(u.hostname==='github.com')return segments[0]===parts[0]&&segments[1]===parts[1]&&segments[2]==='releases'&&segments.length>3;
 return false;
}
function defaultRequest(url,{headers,signal}){
 return new Promise((resolve,reject)=>{const req=https.get(url,{headers,signal},res=>resolve({statusCode:res.statusCode,headers:res.headers,body:res}));req.on('error',reject);});
}
// 본문 정리는 기다리지 않는다(정지한 stream이 정리 약속을 끝내지 않아도 시간 한도가 지켜지게).
function closeBody(body){try{if(body&&typeof body.destroy==='function')body.destroy();else if(body&&typeof body.return==='function')Promise.resolve(body.return()).catch(()=>{});}catch{}}
async function download(url,{maxBytes,timeoutMs=15000,totalTimeoutMs=60000,repository,request=defaultRequest,accept='application/octet-stream'}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)fail('DOWNLOAD_LIMIT_REQUIRED');
 let current=parse(url);if(!startAllowed(current,repository))fail('URL_NOT_ALLOWED');
 const deadline=Date.now()+totalTimeoutMs;
 for(let redirects=0;;redirects++){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('DOWNLOAD_TIMEOUT'),{code:'DOWNLOAD_TIMEOUT'}));},Math.max(0,Math.min(timeoutMs,deadline-Date.now())));});
  timeout.catch(()=>{});
  const within=p=>Promise.race([p,timeout]);
  let response;
  try{
   try{response=await within(Promise.resolve().then(()=>request(current.href,{headers:{'User-Agent':'longterm-updater','Accept':accept},signal:controller.signal})));}
   catch(e){if(e?.code==='DOWNLOAD_TIMEOUT')throw e;fail('DOWNLOAD_INTERRUPTED');}
   const status=response?.statusCode,headers=response?.headers||{};
   if([301,302,303,307,308].includes(status)){
    closeBody(response.body);
    const next=typeof headers.location==='string'?parse(new URL(headers.location,current).href):null;
    if(!next||!safeHttps(next)||!(ASSET_HOSTS.has(next.hostname)||startAllowed(next,repository)))fail('REDIRECT_NOT_ALLOWED');
    if(redirects+1>MAX_REDIRECTS)fail('REDIRECT_LIMIT_EXCEEDED');
    current=next;continue;
   }
   if(status!==200){closeBody(response?.body);fail(status===404?'HTTP_NOT_FOUND':status===429?'HTTP_RATE_LIMITED':'HTTP_STATUS_UNEXPECTED');}
   const declared=headers['content-length']===undefined?null:Number(headers['content-length']);
   if(declared!==null&&(!Number.isSafeInteger(declared)||declared<0)){closeBody(response.body);fail('RESPONSE_INVALID');}
   if(declared!==null&&declared>maxBytes){closeBody(response.body);fail('RESPONSE_TOO_LARGE');}
   const parts=[];let size=0;const iterator=response.body[Symbol.asyncIterator]();
   while(true){
    let step;try{step=await within(iterator.next());}catch(e){if(e?.code==='DOWNLOAD_TIMEOUT'){closeBody(response.body);throw e;}fail('DOWNLOAD_INTERRUPTED');}
    if(step.done)break;const chunk=Buffer.from(step.value);size+=chunk.length;
    if(size>maxBytes){closeBody(response.body);fail('RESPONSE_TOO_LARGE');}
    parts.push(chunk);
   }
   if(declared!==null&&size!==declared)fail('RESPONSE_TRUNCATED');
   return Buffer.concat(parts,size);
  }finally{clearTimeout(timer);}
 }
}
module.exports={download,MAX_REDIRECTS,ASSET_HOSTS};
