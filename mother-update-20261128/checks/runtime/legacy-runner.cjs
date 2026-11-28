'use strict';
// Compose installed legacy browser scripts without flattening or command-line JavaScript.
const fs=require('node:fs'),path=require('node:path');
const {execute}=require('./repl.cjs');
const {loadContext}=require('./context.cjs');
const inside=(root,file)=>{const r=path.relative(root,file);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
function compose(start,input,{now=new Date(),temp=process.env.LONGTERM_RUN_TEMP}={}){
 const scripts=fs.realpathSync(start),skills=fs.realpathSync(path.resolve(scripts,'../..'));
 if(path.basename(scripts)!=='scripts'||path.basename(skills)!=='skills')throw Error('INSTALLED_SCRIPT_DIRECTORY_REQUIRED');
 if(!input||typeof input.script!=='string'||!input.script||!input.params||Array.isArray(input.params)||typeof input.params!=='object')throw Error('LEGACY_INPUT_INVALID');
 const sourceFile=fs.realpathSync(path.resolve(scripts,input.script)),tempRoot=temp?fs.realpathSync(temp):null;
 if(!inside(skills,sourceFile)&&!(tempRoot&&inside(tempRoot,sourceFile)))throw Error('SCRIPT_OUTSIDE_INSTALLED_CODE_OR_OWNED_RUN');
 if(!sourceFile.endsWith('.js'))throw Error('JAVASCRIPT_SOURCE_REQUIRED');
 const visited=new Set(),stack=new Set();let total=0;
 function expand(file){
  file=fs.realpathSync(file);if(!inside(skills,file)&&!(file===sourceFile&&tempRoot&&inside(tempRoot,file)))throw Error('INCLUDE_OUTSIDE_INSTALLED_SKILLS');
  if(stack.has(file))throw Error('INCLUDE_CYCLE');if(visited.has(file))return '';
  stack.add(file);let source=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');total+=Buffer.byteLength(source);if(total>2*1024*1024||stack.size>25)throw Error('LEGACY_SOURCE_LIMIT');
  source=source.replace(/^\s*\/\/ @include ([a-zA-Z0-9_./-]+\.js)\s*$/gm,(_,name)=>{
   const candidates=[path.resolve(path.dirname(file),name),path.resolve(skills,'caremanager-rfid-check/scripts',name)];
   const found=candidates.find(p=>fs.existsSync(p));if(!found)throw Error('INCLUDE_MISSING');return expand(found);
  });stack.delete(file);visited.add(file);return source;
 }
 const params=Object.create(null);
 for(const [k,v]of Object.entries(input.params)){if(!/^[a-zA-Z_$][\w$]*$/.test(k)||['__proto__','constructor','prototype'].includes(k)||v!==null&&typeof v==='object')throw Error('LEGACY_PARAMETER_INVALID');params[k]=v==null?'':String(v);}
 const korea=new Date(now.getTime()+9*3600000);params.today??=korea.toISOString().slice(0,10);params.nowMin??=String(korea.getUTCHours()*60+korea.getUTCMinutes());params.exc??='';
 const source=expand(sourceFile).replaceAll('__P__',JSON.stringify(params));
 return {source,file:sourceFile,params};
}
async function run(start,input,options={}){const context=options.context||loadContext(start);if(input?.params?.orgName&&input.params.orgName!==context.settings.organization.name)throw Error('PARAMETER_ORGANIZATION_MISMATCH');const scoped={...input,params:{...input.params,orgName:context.settings.organization.name}};const {source}=compose(start,scoped,options);return(options.execute||execute)(source,start);}
module.exports={compose,run};
if(require.main===module){let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{data+=x;if(Buffer.byteLength(data)>2*1024*1024){process.exitCode=1;process.stdin.destroy();}});process.stdin.on('end',async()=>{try{if(process.exitCode)throw Error('LEGACY_INPUT_LIMIT');const a=process.argv.slice(2);if(a.length!==2||a[0]!=='--start')throw Error('EXPLICIT_INSTALLATION_START_REQUIRED');const result=await run(a[1],JSON.parse(data.replace(/^\uFEFF/,'')));process.stdout.write(result+'\n');}catch(e){console.error(e.code||e.message);process.exitCode=1;}});}
