const fs=require('node:fs'),path=require('node:path');
const {fromCheck,summary}=require('../lib/scheduleReview');
function prepare({file,org,out}){if(!file||!org||!out||fs.existsSync(out)||path.resolve(file)===path.resolve(out))throw Error('새 출력 경로와 --check --org --out을 지정해 주세요');const check=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));const data=fromCheck(check,{orgName:org});fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(data,null,2),{flag:'wx'});return {...summary(data),file:out};}
if(require.main===module){const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){const key={'--check':'file','--org':'org','--out':'out'}[args[i]];if(!key)throw Error('인자를 확인해 주세요');o[key]=args[i+1];}console.log(JSON.stringify(prepare(o)));}
module.exports={prepare};
