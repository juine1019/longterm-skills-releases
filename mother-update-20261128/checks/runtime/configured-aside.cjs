'use strict';
const {runAside:transport}=require('./aside-cli.cjs'),{loadScope}=require('./environment.cjs');
function runAside(source,options){const {scope}=loadScope(__dirname);return transport(source,{...options,scope});}
module.exports={runAside};
