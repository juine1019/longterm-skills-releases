'use strict';
const fs=require('node:fs'),path=require('node:path');
function inspectLinks(root,file,text){
 const errors=[],relative=path.relative(root,file).replaceAll('\\','/'),body=text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
 for(const match of body.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)){
  const target=match[1].replace(/^<|>$/g,'');if(/^(?:https?:\/\/|#)/i.test(target))continue;
  if(/^(?:[a-z]:|[\\/]|\w+:)/i.test(target)){errors.push({file:relative,code:'NONPORTABLE_DOCUMENT_LINK',target});continue;}
  let resolved;try{resolved=path.resolve(path.dirname(file),decodeURIComponent(target.split('#')[0]));}catch{errors.push({file:relative,code:'INVALID_DOCUMENT_LINK',target});continue;}
  const local=path.relative(root,resolved);if(local.startsWith('..')||path.isAbsolute(local)||!fs.existsSync(resolved))errors.push({file:relative,code:'DOCUMENT_LINK_MISSING',target});
 }
 return errors;
}
module.exports={inspectLinks};
