'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {validateSpec,must,hash}=require('./core.cjs');
function prepare({spec,bundle,schema,policy,output,python='python'}){
 const proof=validateSpec(spec,schema,bundle,policy);must(proof.ok,proof.issues.join(';'));must(!fs.existsSync(output),'NEW_REVIEW_DIRECTORY_REQUIRED');
 fs.mkdirSync(output,{recursive:true});proof.stateLabels=schema.reviewLabels;
 for(const [name,value]of Object.entries({spec,bundle,schema,policy,validation:proof}))fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 const result=spawnSync(python,['-I',path.join(__dirname,'document.py'),'--spec',path.join(output,'spec.json'),'--bundle',path.join(output,'bundle.json'),'--proof',path.join(output,'validation.json'),'--out',path.join(output,'review.docx')],{encoding:'utf8',windowsHide:true});
 must(result.status===0&&fs.existsSync(path.join(output,'review.docx')),'DOCUMENT_GENERATION_FAILED: '+String(result.stderr||'').slice(0,300));
 const receipt={schemaVersion:1,specHash:proof.specHash,bundleHash:proof.bundleHash,schemaHash:proof.schemaHash,policyHash:proof.policyHash,documentSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(output,'review.docx'))).digest('hex'),status:'draft-requires-render-and-human-review',serverWrites:0};fs.writeFileSync(path.join(output,'review.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
module.exports={prepare};
