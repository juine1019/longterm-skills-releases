'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const catalog=require('../catalog.json');
const {inspectLinks}=require('./document-links.cjs');
function walk(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>{if(e.isSymbolicLink())throw Error('RELEASE_LINK_NOT_ALLOWED');return e.isDirectory()?walk(path.join(root,e.name)):[path.join(root,e.name)];});}
function checkStage(root,{checkDependencies=true}={}){
 const errors=[],files=walk(root),counts={skills:0,javascript:0,powershell:0,python:0};
 for(const relative of ['runtime/control.cjs','runtime/context.cjs','runtime/aside-cli.cjs','runtime/legacy-runner.cjs','runtime/evaluation/commands.cjs','runtime/client/scripts/register-worker-notes.js','runtime/client/scripts/next-month-desk.js','assets/static/cm-req-2025-labels.json','assets/static/lt-need-catalog.json','assets/static/req-2025-map.json'])if(!fs.existsSync(path.join(root,relative)))errors.push('RUNTIME_RESOURCE_MISSING:'+relative);
 const actual=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));if(JSON.stringify(actual.skills.map(s=>s.id).sort())!==JSON.stringify(catalog.skills.map(s=>s.id).sort()))errors.push('FULL_SKILL_CATALOG_REQUIRED');
 for(const skill of catalog.skills)if(fs.existsSync(path.join(root,'skills',skill.id,'SKILL.md')))counts.skills++;else errors.push('MISSING_SKILL:'+skill.id);
 if(catalog.helpers!==undefined){if(!Array.isArray(catalog.helpers)||!Array.isArray(actual.helpers)||JSON.stringify(actual.helpers.map(h=>h.id).sort())!==JSON.stringify(catalog.helpers.map(h=>h.id).sort()))errors.push('SHARED_HELPER_CATALOG_INVALID');else for(const helper of catalog.helpers){const scripts=path.join(root,'skills',helper.id,'scripts');if(!fs.existsSync(scripts)||!fs.statSync(scripts).isDirectory()||!fs.readdirSync(scripts).some(n=>fs.statSync(path.join(scripts,n)).isFile()))errors.push('SHARED_HELPER_MISSING:'+helper.id);}for(const id of ['caremanager-rfid-check','longterm-schedule-change','easycare-plan-write'])if(fs.existsSync(path.join(root,'skills',id,'SKILL.md')))errors.push('RETIRED_SKILL_ENTRY:'+id);}
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const file of files){const relative=path.relative(root,file).replaceAll('\\','/'),buffer=fs.readFileSync(file),source=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(/\.(?:js|cjs)$/.test(file)){counts.javascript++;try{new AsyncFunction(source);}catch(e){errors.push('JS_PARSE:'+relative+':'+e.message);}
   for(const m of source.matchAll(/\brequire\(['"](\.[^'"]+)['"]\)/g))try{require.resolve(path.resolve(path.dirname(file),m[1]));}catch{errors.push('LOCAL_DEPENDENCY_MISSING:'+relative+':'+m[1]);}
  }
  if(file.endsWith('.ps1')){counts.powershell++;if(!buffer.subarray(0,3).equals(Buffer.from([239,187,191])))errors.push('PS51_UTF8_BOM_REQUIRED:'+relative);}
  if(file.endsWith('.py'))counts.python++;
  if(file.endsWith('.md'))errors.push(...inspectLinks(root,file,source).map(e=>e.code+':'+e.file+':'+e.target));
 }
 const ps="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$eAll=@();Get-ChildItem -LiteralPath $env:LT_STAGE_ROOT -Recurse -Filter '*.ps1'|ForEach-Object {$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$t,[ref]$e);foreach($x in $e){$eAll+=($_.Name+':'+$x.Extent.StartLineNumber+':'+$x.Message)}};ConvertTo-Json -InputObject @($eAll)";
 const parsed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{env:require('./process-env.cjs').windowsPowerShellEnvironment({...process.env,LT_STAGE_ROOT:root}),encoding:'utf8',windowsHide:true});if(parsed.status!==0)errors.push('WINDOWS_POWERSHELL_REQUIRED');else errors.push(...JSON.parse(parsed.stdout.replace(/^\uFEFF/,'')));
 if(counts.python){const parsedPython=spawnSync('python',['-I','-c',"import ast,os,pathlib; root=pathlib.Path(os.environ['LT_STAGE_ROOT']); [ast.parse(p.read_text(encoding='utf-8-sig'),filename=str(p)) for p in root.rglob('*.py')]; print('python-syntax-ok')"],{env:{...process.env,LT_STAGE_ROOT:root},encoding:'utf8',windowsHide:true});if(parsedPython.status!==0)errors.push('PYTHON_PARSE_FAILED:'+String(parsedPython.stderr||'').slice(0,300));}
 if(checkDependencies){const py=spawnSync('python',['-I','-c','import docx, pymupdf; print("document-dependencies-ok")'],{encoding:'utf8',windowsHide:true});if(py.status!==0)errors.push('PYTHON_DOCX_PYMUPDF_REQUIRED');const aside=spawnSync(process.env.ASIDE_CLI||'aside',['--version'],{encoding:'utf8',windowsHide:true});if(aside.status!==0)errors.push('ASIDE_CLI_REQUIRED');}
 return{ok:errors.length===0,counts,errors,liveLoginChecked:false,siteWrites:0};
}
module.exports={checkStage};
