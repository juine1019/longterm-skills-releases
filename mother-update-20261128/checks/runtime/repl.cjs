'use strict';
// Compatibility entry for reviewed local PowerShell browser scripts; source arrives over UTF-8 stdin.
const {runAside}=require('./aside-cli.cjs'),{loadScope}=require('./environment.cjs');
async function execute(source,start,bridge=runAside){
 const {scope}=loadScope(start);
 // pin 이후 파일이 바뀌어도 새 scope로 자동 전송하지 않는다. 공용 browser-binding.cjs와 같은 지문 계약이다.
 const pinned=process.env.LONGTERM_BINDING_SHA256;
 const current=require('./environment.cjs').transportFingerprint(scope);
 if(pinned&&pinned!==current)throw Object.assign(Error('BROWSER_BINDING_CHANGED'),{code:'BROWSER_BINDING_CHANGED'});
 const code="const __ltOutput=[];await(async(console)=>{"+source+"\n})({log:(...args)=>__ltOutput.push(args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '))});console.log('WN_RESULT:'+JSON.stringify({ok:true,lines:__ltOutput}));";
 const r=await bridge(code,{scope,writeAttempted:true});if(r?.ok!==true||!Array.isArray(r.lines)||r.lines.some(x=>typeof x!=='string'))throw Error('LEGACY_BROWSER_RESULT_INVALID');return r.lines.join('\n');
}
module.exports={execute};
if(require.main===module){let source='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{source+=s;if(Buffer.byteLength(source)>2*1024*1024){console.error('BROWSER_SOURCE_TOO_LARGE');process.exitCode=1;process.stdin.destroy();}});process.stdin.on('end',()=>{if(process.exitCode)return;const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--start'){console.error('EXPLICIT_INSTALLATION_START_REQUIRED');process.exitCode=1;return;}execute(source,args[1]).then(r=>process.stdout.write(r+'\n')).catch(e=>{console.error(e.code||e.message);process.exitCode=1;});});}
