'use strict';
const fs=require('node:fs'),path=require('node:path');
const manager=require('./package-manager.cjs'),{checkStage}=require('./stage-check.cjs');
function argumentsOf(args){const out={};for(let i=0;i<args.length;i+=2){if(!/^--[a-z][a-z0-9-]*$/.test(args[i])||!args[i+1]||out[args[i].slice(2)]!==undefined)throw Error('NAMED_ARGUMENT_VALUE_REQUIRED');out[args[i].slice(2)]=args[i+1];}return out;}
function main(args){const [command,...rest]=args,o=argumentsOf(rest);if(!o.workspace)throw Error('EXPLICIT_WORKSPACE_REQUIRED');
 if(command==='install')return manager.install({packageRoot:o.package,workspace:o.workspace,expectedFingerprint:o['manifest-sha256'],checkStage:({releaseRoot})=>checkStage(releaseRoot),bootstrapSource:fs.readFileSync(path.join(__dirname,'workspace-bootstrap.cjs'),'utf8'),settingsTemplate:JSON.parse(fs.readFileSync(path.join(__dirname,'../workspace.example.json'),'utf8'))});
 if(command==='add-skill')return manager.addSkill({packageRoot:o.package,workspace:o.workspace,expectedFingerprint:o['manifest-sha256']});
 if(command==='update-skill')return manager.updateSkill({packageRoot:o.package,workspace:o.workspace,expectedFingerprint:o['manifest-sha256']});
 if(command==='rollback-skill')return manager.rollbackSkill({workspace:o.workspace,id:o.skill,version:o.version});
 if(command==='list-skills')return manager.listInstalledSkills({workspace:o.workspace});
 if(command==='rollback')return manager.rollback({workspace:o.workspace,version:o.version});
 if(command==='archive-inactive')return manager.archiveInactive({workspace:o.workspace,version:o.version});
 throw Error('SUPPORTED_INSTALLER_COMMAND_REQUIRED');
}
module.exports={main,argumentsOf};
if(require.main===module){try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
