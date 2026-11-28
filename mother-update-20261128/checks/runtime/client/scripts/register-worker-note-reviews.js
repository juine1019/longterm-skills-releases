// 기존 관리자 세션으로 기록 검토의견만 등록한다. 원문 PUT·쿠키 추출·AI 호출 없음.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {runAside} = require('./register-worker-notes');
const {cleanEntries,reviewHash,MAX_BYTES} = require('../lib/workerNoteReviews');
const {normalizeOrg,validateMonth} = require('../lib/workerNotes');
const fail=(code,message=code)=>Object.assign(new Error(message),{code});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function prepareFile(file,origin,orgName) {
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw fail('ORIGIN');
  const bytes=fs.readFileSync(file);if(bytes.length>MAX_BYTES)throw fail('FILE_SIZE');
  const input=read(file);validateMonth(input.month);
  if(!normalizeOrg(orgName)||normalizeOrg(orgName)!==normalizeOrg(input.orgName))throw fail('ORG_MISMATCH');
  if(!Number.isSafeInteger(input.sourceVersion)||input.sourceVersion<1||!/^[a-f0-9]{64}$/.test(input.sourceContentHash))throw fail('SOURCE_SCOPE');
  const data={orgName:input.orgName,month:input.month,sourceVersion:input.sourceVersion,sourceContentHash:input.sourceContentHash,entries:cleanEntries(input.entries)};
  return {data,scope:{origin,orgName:data.orgName,month:data.month,sourceVersion:data.sourceVersion,sourceContentHash:data.sourceContentHash,
    count:data.entries.length,fileSha256:createHash('sha256').update(bytes).digest('hex'),payloadHash:reviewHash(data)}};
}
function validateApproval(plan,approval) {
  for(const k of ['origin','orgId','orgName','month','fileSha256','payloadHash','count','sourceVersion','sourceContentHash','sourceRecords','expectedReviewVersion']) {
    if(approval?.[k]!==plan[k])throw fail('APPROVAL_SCOPE');
  }
  if(!Number.isSafeInteger(approval.expectedReviewVersion)||approval.expectedReviewVersion<0)throw fail('APPROVAL_VERSION');
}
async function submitInPage(a) {
  let stage='read',saved=false;
  const bad=(code,extra={})=>({ok:false,code,saved,putCount:stage==='read'?0:1,...extra});
  try{
    if(location.origin!==a.origin)return bad('ORIGIN_CHANGED');
    const orgResponse=await fetch('/api/org',{credentials:'same-origin',cache:'no-store'});
    if(!orgResponse.ok)return bad('LOGIN_REQUIRED');
    const org=await orgResponse.json(),norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
    if(norm(org.name)!==norm(a.orgName)||!['owner','admin'].includes(org.me?.role))return bad('ORG_OR_ROLE');
    if(a.orgId&&org.id!==a.orgId)return bad('ORG_CHANGED');
    const rawResponse=await fetch('/api/worker-notes?month='+encodeURIComponent(a.month),{credentials:'same-origin',cache:'no-store'});
    if(!rawResponse.ok)return bad('SOURCE_READ_FAILED');
    const source=await rawResponse.json();
    if(source.version!==a.sourceVersion||source.contentHash!==a.sourceContentHash)return bad('SOURCE_CHANGED');
    const query='/api/worker-note-reviews?month='+encodeURIComponent(a.month);
    const response=await fetch(query,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return bad(response.status===404?'SERVER_UPGRADE_REQUIRED':'READ_FAILED');
    const before=await response.json();
    const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(a.payload64),c=>c.charCodeAt(0))));
    if(data.month!==a.month||data.orgName!==a.orgName||data.sourceVersion!==a.sourceVersion||data.sourceContentHash!==a.sourceContentHash||data.entries.length!==a.count)return bad('PAYLOAD_SCOPE');
    const semantic=e=>JSON.stringify([e.status,e.opinion,e.planCheck,e.planBasis,e.concise===true]);
    const contains=entries=>{const stored=new Map(entries.map(e=>[e.recordId,e]));return data.entries.every(e=>stored.has(e.recordId)&&semantic(stored.get(e.recordId))===semantic(e));};
    const same=before.state==='current'&&before.sourceVersion===a.sourceVersion&&before.sourceContentHash===a.sourceContentHash&&contains(before.entries);
    if(a.mode==='plan')return {ok:true,orgId:org.id,orgName:org.name,sourceRecords:source.count,expectedReviewVersion:before.version,alreadyPresent:same,reviewHash:before.reviewHash,currentCount:before.count};
    if(same)return {ok:true,saved:false,verified:true,alreadyPresent:true,version:before.version,reviewHash:before.reviewHash,putCount:0};
    if(before.version!==a.expectedReviewVersion||source.count!==a.sourceRecords)return bad('VERSION_CONFLICT');
    stage='put';
    const put=await fetch('/api/worker-note-reviews',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,expectedVersion:a.expectedReviewVersion})});
    if(!put.ok)return bad('PUT_FAILED',{status:put.status,outcome:put.status>=500?'unknown':'rejected'});
    saved=true;stage='verify';const result=await put.json();
    const check=await fetch(query,{credentials:'same-origin',cache:'no-store'});if(!check.ok)return bad('VERIFY_FAILED',{outcome:'unknown'});
    const after=await check.json();
    if(after.state!=='current'||after.sourceVersion!==a.sourceVersion||after.sourceContentHash!==a.sourceContentHash||after.version!==a.expectedReviewVersion+1||after.reviewHash!==result.reviewHash||!contains(after.entries))return bad('VERIFY_MISMATCH',{outcome:'unknown'});
    return {ok:true,saved:true,verified:true,alreadyPresent:false,version:after.version,reviewHash:after.reviewHash,count:after.count,putCount:1};
  }catch{return bad(stage==='read'?'READ_FAILED':'WRITE_OUTCOME_UNKNOWN',{outcome:stage==='read'?'not-written':'unknown'});}
}
function buildScript(args,target) {
  const code=`const p=${JSON.stringify(args)}; const ts=await listBrowserTabs(); const t=${target?`ts.find(t=>t.targetId===${JSON.stringify(target)})`:"ts.find(t=>t.url.startsWith(p.origin+'/dashboard.html#care-review'))"}; if(!t)throw new Error('TARGET_MISSING'); if(new URL(t.url).origin!==p.origin)throw new Error('ORIGIN_CHANGED'); await attachBrowserTab(t.targetId); const r=await page.evaluate(${submitInPage.toString()},p); console.log('WN_RESULT:'+JSON.stringify({...r,targetId:t.targetId}));`;
  // 끝에 exit 줄을 붙이지 않고 stdin EOF로 끝낸다(현재 Aside CLI는 exit 줄을 식으로 평가해 종료 코드 1, 2026-11-18 결함4).
  return code.replace(/\r?\n/g,' ')+'\n';
}
async function execute(options,bridge=runAside) {
  if(!options.out||fs.existsSync(options.out)||path.resolve(options.out)===path.resolve(options.file))throw fail('OUTPUT');
  const prepared=prepareFile(options.file,options.origin,options.org);let scope=prepared.scope,result,writeAttempt=false;
  try{
    if(options.apply&&!options.approval)throw fail('APPROVAL_REQUIRED');
    const payload64=Buffer.from(JSON.stringify(prepared.data),'utf8').toString('base64');
    const first=await bridge(buildScript({...scope,payload64,mode:'plan'},options.target));
    if(!first.ok)result={...scope,...first,phase:'preflight'};
    else{
      if(normalizeOrg(first.orgName||scope.orgName)!==normalizeOrg(scope.orgName))throw fail('ORG_CHANGED');
      scope={...scope,orgId:first.orgId,sourceRecords:first.sourceRecords,expectedReviewVersion:first.expectedReviewVersion};
      if(!options.apply)result={...scope,...first,phase:'plan'};
      else{
        validateApproval(scope,read(options.approval));writeAttempt=true;
        const applied=await bridge(buildScript({...scope,payload64,mode:'apply'},first.targetId||options.target));
        result={...scope,...applied,phase:applied.ok?'complete':'stopped'};
      }
    }
  }catch(e){result={...scope,ok:false,code:e.code||'LOCAL_ERROR',phase:'stopped',outcome:writeAttempt?'unknown':'not-written'};}
  fs.mkdirSync(path.dirname(path.resolve(options.out)),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx'});return result;
}
function parseArgs(argv) {
  const result={},keys={'--file':'file','--origin':'origin','--org':'org','--approval':'approval','--out':'out','--target':'target'};
  for(let i=0;i<argv.length;i++){if(argv[i]==='--apply'){result.apply=true;continue;}if(!keys[argv[i]]||!argv[i+1])throw fail('ARGS');result[keys[argv[i]]]=argv[++i];}
  if(!result.file||!result.origin||!result.org||!result.out)throw fail('ARGS');return result;
}
if(require.main===module)Promise.resolve().then(()=>execute(parseArgs(process.argv.slice(2)))).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.ok?0:1;}).catch(e=>{console.error(e.code||'LOCAL_ERROR');process.exitCode=1;});
module.exports={prepareFile,validateApproval,submitInPage,buildScript,execute};
