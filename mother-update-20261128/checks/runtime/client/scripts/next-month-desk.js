const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {runAside}=require('./register-worker-notes');
const {validateSnapshot,hash,canonical}=require('../lib/nextMonth');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
// 주의: inPage 안에는 줄 주석(//)을 쓰지 않는다. buildScript가 줄바꿈을 공백으로 합쳐 뒤 코드가 주석이 된다.
// prep-take/prep-deliver(3-1 준비): 로컬 실행기가 이 탭의 우편함에서 버튼 요청을 가져가고 결과를 같은 탭 메모리에 돌려준다. 서버로는 아무것도 보내지 않는다.
async function inPage(a){let writing=false;try{
 const bad=code=>({ok:false,code,outcome:writing?'unknown':'not-written'});
 if(location.origin!==a.origin)return bad('ORIGIN_CHANGED');
 const get=async u=>{const r=await fetch(u,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('READ_FAILED');return r.json();};
 const org=await get('/api/org'),norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');if(!norm(a.orgName)||norm(org.name)!==norm(a.orgName)||!['admin','owner'].includes(org.me?.role)||a.orgId&&org.id!==a.orgId)return bad('ADMIN_OR_ORG_CHANGED');
 if(a.action==='prep-take'||a.action==='prep-deliver'){const b=window.NextMonthPrepBridge;if(!b)return bad('PAGE_BRIDGE_REQUIRED');return a.action==='prep-take'?{ok:true,request:b.take(a.runnerId)||null,orgId:org.id}:{ok:true,accepted:b.deliver(a.result)===true};}
 const q='/api/next-month?month='+encodeURIComponent(a.month),before=await get(q);
 if(!Number.isSafeInteger(before.version)||!Array.isArray(before.people))return bad('SERVER_UPGRADE_REQUIRED');
 if(a.action==='read')return {ok:true,data:before};
 if(['publish','claim'].includes(a.action)&&before.capabilities?.ltOnly!==2)return bad('SERVER_UPGRADE_REQUIRED');
 if(a.action==='publish'&&a.data?.schemaVersion===2&&before.capabilities?.nextMonthPreparation!==1)return bad('SERVER_UPGRADE_REQUIRED');
 if(a.action==='claim'&&a.runProtocol!==undefined&&before.capabilities?.nextMonthRun!==a.runProtocol)return bad('SERVER_UPGRADE_REQUIRED');
 const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 const prior=before.runs.find(r=>r.runId===a.manifest?.runId);
 if(['verify','transition'].includes(a.action)){
  if(!prior||prior.manifestHash!==a.manifest.manifestHash||stable(prior.people)!==stable(a.manifest.people)||prior.approval.source!=='desk-selection'||before.activeRunId!==prior.runId)return bad('RUN_CHANGED');
  if(a.action==='verify')return {ok:true,manifest:prior,data:before};
 }
 let url,body,method;
 const org2=a.orgId?{expectedOrgId:a.orgId}:{};
 if(a.action==='publish'){if(before.version!==a.expectedVersion||before.activeRunId)return bad('SOURCE_CHANGED');url='/api/next-month';method='PUT';body={...org2,data:a.data,expectedVersion:a.expectedVersion,resolvedRequestIds:a.resolvedRequestIds||[]};}
 else if(a.action==='claim'){if(!before.confirmed.length||before.activeRunId||before.version!==a.expectedVersion)return bad('NO_SAVED_SELECTION');url='/api/next-month/executions';method='POST';body={...org2,month:a.month,expectedVersion:before.version,requestId:a.requestId,runProtocol:a.runProtocol};}
 else if(a.action==='transition'){url='/api/next-month/executions';method='PATCH';body={...org2,month:a.month,expectedVersion:before.version,runId:prior.runId,personId:a.personId,stage:a.stage,evidence:a.evidence||{},reason:a.reason||'',runnerId:a.runnerId,jobId:a.jobId,runProtocol:a.runProtocol,jobIds:a.jobIds};}
 else return bad('ACTION');
 writing=true;const r=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)return {ok:false,code:'WRITE_REJECTED',status:r.status,outcome:r.status>=500?'unknown':'rejected'};
 const result=await r.json(),after=await get(q);
 if(a.action==='publish'){if(stable(after.snapshot)!==stable(a.data)||after.version!==result.version)return bad('VERIFY_FAILED');return {ok:true,verified:true,data:after};}
 const run=after.runs.find(r=>r.runId===(a.action==='claim'?result.runId:prior.runId));
 if(!run||a.action==='claim'&&(run.manifestHash!==result.manifestHash||after.activeRunId!==run.runId)||a.action==='transition'&&(after.version!==result.version||(a.stage==='finalized'?!run.finalCheck||after.activeRunId:run.groups.find(g=>g.personId===a.personId)?.status!==a.stage)))return bad('VERIFY_FAILED');
 return {ok:true,verified:true,manifest:run,data:after};
 }catch(e){return {ok:false,code:e.message||'BRIDGE_FAILED',outcome:writing?'unknown':'not-written'};}}
function buildScript(a,target){return `const p=${JSON.stringify(a)};const ts=await listBrowserTabs();const t=${target?`ts.find(t=>t.targetId===${JSON.stringify(target)})`:'ts.find(t=>t.url.startsWith(p.origin+"/dashboard.html"))||ts.find(t=>t.url.startsWith(p.origin+"/"))'};if(!t||new URL(t.url).origin!==p.origin)throw Error('DESK_TAB_REQUIRED');await attachBrowserTab(t.targetId);const r=await page.evaluate(${inPage.toString()},p);console.log('WN_RESULT:'+JSON.stringify({...r,targetId:t.targetId}));`.replace(/\r?\n/g,' ')+'\nexit\n';}
async function execute(o,bridge=runAside){
 const u=new URL(o.origin);if(u.origin!==o.origin||u.username||u.password||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('ORIGIN');
 if(!o.out||fs.existsSync(o.out))throw Error('새 결과 경로 필요');
 const a={action:o.action||'read',origin:o.origin,orgName:o.org,orgId:o.orgId,month:o.month,requestId:o.requestId||randomUUID()};
 if(a.action==='publish'){a.data=validateSnapshot(read(o.file),o.org);if(a.data.month!==o.month)throw Error('MONTH');a.expectedVersion=Number(o.version);a.resolvedRequestIds=o.resolved?read(o.resolved):[];}
 if(a.action==='claim')a.expectedVersion=Number(o.version);
 if(['claim','transition'].includes(a.action)&&o.runProtocol!==undefined)a.runProtocol=Number(o.runProtocol);
 if(['verify','transition'].includes(a.action)){const stored=read(o.file);if(stored.origin!==o.origin||stored.orgName!==o.org||stored.manifest?.month!==o.month)throw Error('MANIFEST_SCOPE');a.manifest=stored.manifest;a.personId=o.person;a.stage=o.stage;a.runnerId=o.runnerId;a.jobId=o.jobId;a.jobIds=o.jobIds?read(o.jobIds):undefined;a.reason=o.reason;a.evidence=o.evidence?read(o.evidence):{};}
 let r;try{r=await bridge(buildScript(a,o.target));if(a.action==='publish'&&r.ok&&hash(r.data.snapshot)!==hash(a.data))throw Error('VERIFY_FAILED');}catch(e){r={ok:false,code:e.message,outcome:a.action==='read'||a.action==='verify'?'not-written':'unknown'};}
 r={origin:o.origin,orgName:o.org,action:a.action,...r};fs.mkdirSync(path.dirname(path.resolve(o.out)),{recursive:true});fs.writeFileSync(o.out,canonical(r),{flag:'wx'});return r;
}
// 결과 파일 없이 한 번 호출한다(3-1 준비 세션의 읽기·게시·우편함). 승인 선택·실행 점유 API는 여기서 쓰지 않는다.
async function call(o,bridge=runAside){
 const u=new URL(o.origin);if(u.origin!==o.origin||u.username||u.password||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('ORIGIN');
 if(!['read','publish','prep-take','prep-deliver'].includes(o.action))throw Error('ACTION');
 const a={action:o.action,origin:o.origin,orgName:o.org,orgId:o.orgId,month:o.month,requestId:o.requestId||randomUUID(),runnerId:o.runnerId,result:o.result};
 if(a.action==='publish'){a.data=validateSnapshot(o.data,o.org);if(a.data.month!==o.month)throw Error('MONTH');a.expectedVersion=Number(o.version);a.resolvedRequestIds=[];}
 return bridge(buildScript(a,o.target));
}
function parse(args){const o={};for(let i=0;i<args.length;i++){if(!/^--[a-z]+$/.test(args[i])||args[i+1]===undefined)throw Error('인자 확인');o[args[i].slice(2)]=args[++i];}return o;}
if(require.main===module)execute(parse(process.argv.slice(2))).then(r=>{console.log(JSON.stringify({ok:r.ok,code:r.code||null,action:r.action,version:r.data?.version,confirmed:r.data?.confirmed.length}));process.exitCode=r.ok?0:1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={inPage,buildScript,execute,call,parse};
