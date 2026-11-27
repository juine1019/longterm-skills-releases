'use strict';
// Standalone transport extracted from the established client bridge. No product/DB dependency.
const path=require('node:path'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
const MARKER='WN_RESULT:';
function error(code,message){return Object.assign(Error(message||code),{code});}
// 브라우저 쪽 고정 한글 오류의 안정 코드(제품 scripts/register-worker-notes.js KNOWN_BROWSER_ERRORS와 같은 목록, 2026-11-18 결함3).
// 원문은 내보내지 않는다. 목록에 없는 원문은 이름·전화번호가 섞일 수 있어 해시 코드만 만든다.
const KNOWN_BROWSER_ERRORS={'전체·퇴사자 포함 조건 필요':'STAFF_RETIRED_FILTER_REQUIRED','단말기 통합관리 화면 필요':'STAFF_SCREEN_REQUIRED','미저장 변경 필요 확인':'UNSAVED_SCREEN_CHANGES','근로자 식별 필요':'STAFF_IDENTITY_REQUIRED','빈 명단 확인 필요':'EMPTY_ROSTER_CHECK_REQUIRED','전체 조회 조건 변경':'QUERY_CONDITION_CHANGED','조회 중 자료 변경':'DATA_CHANGED_DURING_QUERY'};
function browserErrorCode(output){
 const line=String(output||'').replace(/\u001b\[[0-9;]*m/g,'').split(/\r?\n/).map(l=>/Error:\s*(?:Error:\s*)?(.+)$/.exec(l)).find(Boolean);if(!line)return null;const raw=line[1].trim();
 if(Object.hasOwn(KNOWN_BROWSER_ERRORS,raw))return KNOWN_BROWSER_ERRORS[raw];
 if(/^[A-Z][A-Z0-9_]{3,60}$/.test(raw))return raw;
 return 'BROWSER_ERROR_'+crypto.createHash('sha256').update(raw).digest('hex').slice(0,8);
}
function runAside(source,{timeoutMs=110000,spawnProcess=spawn,executable,env=process.env,writeAttempted=false,scope,reportGuardErrors=false,openTabs=[],host='local',profileId}={}){
 if(env.LONGTERM_NO_BROWSER==='1')return Promise.reject(error('OFFLINE_CHECK_BROWSER_DISABLED'));
 if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>2*1024*1024)return Promise.reject(error('INVALID_BROWSER_SOURCE'));
 source=source.replace(/\r?\nexit\s*\n?$/,'');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1)return Promise.reject(error('INVALID_BRIDGE_TIME_BUDGET'));
 const connection=scope?.connection||{host,profileId};if(connection.host!=='local'||connection.profileId!==undefined&&(typeof connection.profileId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(connection.profileId)))return Promise.reject(error('EXPLICIT_LOCAL_BROWSER_CONNECTION_REQUIRED'));
 if(scope?.connection&&(host!=='local'||profileId!==undefined&&profileId!==connection.profileId))return Promise.reject(error('BROWSER_CONNECTION_SCOPE_MISMATCH'));
 // Existing collectors pass the remaining whole-run budget; an individual REPL remains bounded.
 const callBudget=Math.min(timeoutMs,115000);
 if(scope){try{source=require('./browser-guard.cjs').compileGuarded(source.replace(/\nexit\s*\n?$/,''),scope,{reportGuardErrors,openTabs});}catch(e){return Promise.reject(e);}}
 const binary=executable||(process.platform==='win32'?path.join(env.LOCALAPPDATA||'','Aside/CLI/current/aside.exe'):'aside');
 const codeHash=crypto.createHash('sha256').update(source).digest('hex');
 return new Promise((resolve,reject)=>{
  let child,output='',diagnostics='',outputBytes=0,settled=false,timer;
  const stdoutDecoder=new StringDecoder('utf8'),stderrDecoder=new StringDecoder('utf8');
  const finish=(e,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(e){e.sourceHash=codeHash;e.outcome=writeAttempted?'unknown':'read-unconfirmed';reject(e);}else resolve(result);};
  try{child=spawnProcess(binary,['repl','--host','local',...(connection.profileId?['--profile',connection.profileId]:[])],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});}catch(e){finish(error('BRIDGE_START_FAILED'));return;}
  timer=setTimeout(()=>{child.kill();finish(error('BRIDGE_TIMEOUT','Inspect the current result before any retry.'));},callBudget);
  child.on('error',()=>finish(error('BRIDGE_START_FAILED')));
  for(const [stream,decoder,isResult] of [[child.stdout,stdoutDecoder,true],[child.stderr,stderrDecoder,false]])stream.on('data',chunk=>{
   if(settled)return;
   const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);outputBytes+=bytes.length;
   if(outputBytes>8*1024*1024){child.kill();finish(error('BRIDGE_OUTPUT_TOO_LARGE'));return;}
   const text=decoder.write(bytes);if(isResult)output+=text;else diagnostics+=text;
  });
  child.stdin.on('error',()=>{});
  child.on('close',code=>{if(settled)return;output+=stdoutDecoder.end();diagnostics+=stderrDecoder.end();const lines=output.replace(/\u001b\[[0-9;]*m/g,'').split(/\r?\n/).filter(l=>l.includes(MARKER));if(code!==0||lines.length!==1){const browserError=lines.length?null:browserErrorCode(output+'\n'+diagnostics);finish(browserError?Object.assign(error('BRIDGE_RESULT_UNCONFIRMED','BRIDGE_RESULT_UNCONFIRMED:'+browserError),{browserError}):error('BRIDGE_RESULT_UNCONFIRMED'));return;}try{const result=JSON.parse(lines[0].slice(lines[0].indexOf(MARKER)+MARKER.length));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();finish(null,result);}catch{finish(error('BRIDGE_RESULT_INVALID'));}});
  // CLI stdin is line-oriented. Preserve newlines/comments/quoted data inside one complete expression.
  // End with stdin EOF, not an exit line: CLI 1.26.1115.1556 evaluates a trailing exit as an expression and exits 1 after a normal run.
  const program='(async()=>{'+source+'\n})()';child.stdin.end('await eval('+JSON.stringify(program)+');\n');
 });
}
module.exports={runAside,MARKER,KNOWN_BROWSER_ERRORS};
