'use strict';
// Copied to the workspace root as control.cjs; release updates preserve it.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname;
try{
 const active=JSON.parse(fs.readFileSync(path.join(root,'active.json'),'utf8'));
 if(active.schemaVersion!==1||!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(active.version))throw Error('ACTIVE_RELEASE_INVALID');
 Promise.resolve(require(path.join(root,'releases',active.version,'runtime/control.cjs')).main(process.argv.slice(2),{workspaceRoot:root})).then(result=>{if(result!==undefined)console.log(JSON.stringify(result));if(result?.ok===false)process.exitCode=1;}).catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
}catch(e){console.error(e.code||e.message);process.exitCode=1;}
