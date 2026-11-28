// 기존 관리자 브라우저 세션으로 등록한다. 새 인증키·쿠키 추출·파일 선택·확장 권한 변경 없음.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { MAX_BYTES, validateImport, snapshotDigest, summary, normalizeOrg } = require('../lib/workerNotes');
const { compareWorkerNotesContent } = require('../lib/workerNotesContent');
const MARKER = 'WN_RESULT:';
const fail = (code, message) => Object.assign(new Error(message), { code });
function readJson(file) {
  let text; try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { throw fail('FILE_READ', '로컬 자료를 읽지 못했습니다'); }
  try { return JSON.parse(text); } catch { throw fail('FILE_JSON', '로컬 자료 JSON 형식을 확인해 주세요'); }
}
function prepareFile(file, origin, orgName) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw fail('ORIGIN', '정확한 HTTPS 업무데스크 주소가 필요합니다');
  const bytes = fs.readFileSync(file); if (bytes.length > MAX_BYTES) throw fail('FILE_SIZE', '자료 파일이 너무 큽니다');
  const data = validateImport(readJson(file), orgName);
  const meta = summary(data);
  return { data, scope: { origin, orgName, month:data.month, fileSha256:createHash('sha256').update(bytes).digest('hex'),
    contentHash:meta.contentHash, records:meta.count, noteCount:meta.noteCount, recipientCount:meta.recipientCount, workerGroups:meta.workers.length } };
}
function validateApproval(plan, approval, now = Date.now()) {
  for (const key of ['origin','orgName','month','fileSha256','contentHash','records','recipientCount']) {
    if (approval?.[key] !== plan[key]) throw fail('APPROVAL_SCOPE', '승인 범위와 실제 자료가 다릅니다: '+key);
  }
  const checked = Date.parse(approval.sourceVerifiedAt);
  if (approval.sourceOrgVerified !== true || !Number.isFinite(checked) || checked > now+300000 || now-checked > 86400000) throw fail('SOURCE_ORG', '현재 출처 기관 확인이 필요합니다');
  if (!Number.isSafeInteger(approval.expectedVersion) || approval.expectedVersion < 0) throw fail('APPROVAL_VERSION', '기존 자료 버전 확인이 필요합니다');
  const current = plan.current?.version ?? plan.expectedVersion;
  if (!plan.alreadyPresent && approval.expectedVersion !== current) throw fail('VERSION_CONFLICT', '승인 뒤 자료가 바뀌었습니다. 현재 자료를 다시 확인하세요');
  // 일부 대상 승인은 선택 집합·병합 기준 버전과 함께만 쓴다. 일부 대상 승인으로 월 전체 교체를 하거나 그 반대로 쓰지 않는다(2026-11-20).
  if (plan.selection || approval?.selectionHash !== undefined || approval?.baseVersion !== undefined) {
    if (approval?.selectionHash !== plan.selection?.hash || approval?.baseVersion !== plan.selection?.baseVersion || approval?.opinionCarryHash !== plan.selection?.opinionCarryHash) throw fail('APPROVAL_SCOPE', '승인한 일부 대상 범위와 실제 자료가 다릅니다');
  }
}
async function submitInPage(a) {
  let stage = 'read', saved = false;
  const bad = (code, extra = {}) => ({ok:false,code,saved,...extra});
  try {
    if (location.origin !== a.origin) return bad('ORIGIN_CHANGED');
    const g = await fetch('/api/org', {credentials:'same-origin',cache:'no-store'});
    if (!g.ok) return bad('LOGIN_REQUIRED', {status:g.status});
    const org = await g.json();
    const norm = x => String(x||'').normalize('NFKC').replace(/\s+/g,'');
    if (!norm(a.orgName) || norm(org.name) !== norm(a.orgName)) return bad('ORG_CHANGED');
    if (!['admin','owner'].includes(org.me?.role)) return bad('ADMIN_REQUIRED');
    const query = '/api/worker-notes?month='+encodeURIComponent(a.month);
    const r = await fetch(query,{credentials:'same-origin',cache:'no-store'});
    if (!r.ok) return bad('READ_FAILED',{status:r.status});
    const before = await r.json();
    if (!Object.prototype.hasOwnProperty.call(before,'contentHash')) return bad('SERVER_UPGRADE_REQUIRED');
    const current = {version:before.version,count:before.count,contentHash:before.contentHash||null};
    const same = before.contentHash === a.contentHash && before.count === a.count && before.noteCount === a.noteCount && before.recipientCount === a.recipientCount;
    if (a.mode === 'plan') {
      /* 업무 내용 비교용 현재 원문: 기존 작성자별 조회를 모은다. 하나라도 버전·해시가 다르거나 빠지면 비교 불가(null)로 넘긴다.
         buildScript가 줄을 합치므로 이 함수 안에는 줄 주석을 쓰지 않는다. */
      let currentContent = null;
      if (!same && before.version > 0 && Array.isArray(before.workers)) {
        const records = []; let complete = true;
        for (const w of before.workers) {
          const p = await fetch(query+'&worker='+encodeURIComponent(w && w.id),{credentials:'same-origin',cache:'no-store'});
          const part = p.ok ? await p.json() : null;
          if (!part || part.version !== before.version || part.contentHash !== before.contentHash || !Array.isArray(part.records)) { complete = false; break; }
          records.push(...part.records);
        }
        if (complete) currentContent = {month:before.month,orgName:org.name,collectedAt:before.collectedAt,records};
      }
      /* 일부 대상: 원문을 바꾸면 그 달 의견이 이전 원문 기준이 되므로 현재 의견을 함께 읽어 돌려준다(복원용). 조회 실패는 null. */
      let currentReviews = null;
      if (a.readReviews) { const rv = await fetch('/api/worker-note-reviews?month='+encodeURIComponent(a.month),{credentials:'same-origin',cache:'no-store'}); currentReviews = rv.ok ? await rv.json() : null; }
      return {ok:true,orgName:org.name,current,alreadyPresent:same,currentContent,currentReviews};
    }
    if (same) return {ok:true,saved:false,alreadyPresent:true,verified:true,version:before.version,contentHash:before.contentHash,putCount:0};
    if (org.name !== a.orgName) return bad('ORG_CHANGED');
    if (before.version !== a.expectedVersion) return bad('VERSION_CONFLICT');
    /* 일부 대상: 승인 때 읽은 의견 상태가 저장 직전에도 같아야 한다(복원할 의견이 그사이 바뀌면 쓰지 않는다). */
    if (a.selection && typeof a.selection.reviewsKey === 'string') {
      const rv = await fetch('/api/worker-note-reviews?month='+encodeURIComponent(a.month),{credentials:'same-origin',cache:'no-store'});
      if (!rv.ok) return bad('REVIEWS_CHANGED',{outcome:'not-written'});
      const r = await rv.json(), key = r.state === 'current' ? 'current:'+r.reviewHash : String(r.state)+':'+String(r.version);
      if (key !== a.selection.reviewsKey) return bad('REVIEWS_CHANGED',{outcome:'not-written'});
    }
    const raw = Uint8Array.from(atob(a.payload64), c=>c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (data.month !== a.month || data.orgName !== a.orgName || data.records.length !== a.count) return bad('PAYLOAD_SCOPE');
    stage = 'put';
    const put = await fetch('/api/worker-notes',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,expectedVersion:a.expectedVersion})});
    if (!put.ok) return bad('PUT_FAILED',{status:put.status,outcome:put.status>=500?'unknown':'rejected',putCount:1});
    saved = true; stage = 'verify';
    const result = await put.json();
    const check = await fetch(query,{credentials:'same-origin',cache:'no-store'});
    if (!check.ok) return bad('VERIFY_FAILED',{outcome:'unknown',putCount:1});
    const after = await check.json();
    if (result.contentHash !== a.contentHash || after.contentHash !== a.contentHash || after.version !== a.expectedVersion+1 || after.count !== a.count || after.noteCount !== a.noteCount || after.recipientCount !== a.recipientCount) return bad('VERIFY_MISMATCH',{outcome:'unknown',putCount:1});
    return {ok:true,saved:true,alreadyPresent:false,verified:true,version:after.version,contentHash:after.contentHash,putCount:1};
  } catch { return bad(stage === 'read' ? 'READ_FAILED' : 'WRITE_OUTCOME_UNKNOWN',{outcome:stage === 'read'?'not-written':'unknown'}); }
}
// 2026-11-18 창 고정: 업무데스크 탭이 없으면 새 창을 열어 대체하지 않고 멈춘다. 지정 target이 있으면 그 창만 쓴다.
function buildScript(args, targetId) {
  const code = `const p=${JSON.stringify(args)}; const ts=await listBrowserTabs(); let t=${targetId?`ts.find(x=>x.targetId===${JSON.stringify(targetId)})`:"ts.find(x=>x.url.startsWith(p.origin+'/dashboard.html#care-review')) || ts.find(x=>x.url.startsWith(p.origin+'/'))"}; ${targetId?"if(!t) throw new Error('TARGET_MISSING');":""} if(!t) throw new Error('DESK_TAB_REQUIRED'); if(new URL(t.url).origin!==p.origin) throw new Error('ORIGIN_CHANGED'); await attachBrowserTab(t.targetId); const r=await page.evaluate(${submitInPage.toString()},p); console.log(${JSON.stringify(MARKER)}+JSON.stringify({...r,targetId:t?t.targetId:null}));`;
  // 끝에 exit 줄을 붙이지 않고 stdin EOF로 끝낸다(현재 Aside CLI는 exit 줄을 식으로 평가해 종료 코드 1, 2026-11-18 결함4).
  return code.replace(/\r?\n/g,' ')+'\n';
}
// Aside REPL 출력에서 결과 한 줄을 읽는다. 결과가 없을 때 REPL이 낸 실행 오류(예: 업무데스크 탭 없음)를 원인 그대로 알린다.
const BRIDGE_ERRORS={
  DESK_TAB_REQUIRED:'업무데스크 탭이 Aside 브라우저에 없습니다. 이 PC의 Aside에서 업무데스크를 열어 관리자로 로그인해 주세요. 자동 재시도하지 않습니다',
  LT_TARGET_MISSING:'롱텀 탭이 Aside 브라우저에 없습니다. 이 PC의 Aside에서 롱텀에 로그인해 주세요. 자동 재시도하지 않습니다'
};
// 브라우저 쪽 코드가 던지는 고정 한글 오류(근로자 단말기 통합관리 수집 등)의 안정 코드와 안전한 안내(2026-11-18 결함3).
// 원문을 그대로 보여 주지 않는다. 목록에 없는 원문은 이름·전화번호가 섞일 수 있어 확인용 해시만 남긴다.
const KNOWN_BROWSER_ERRORS={
  '전체·퇴사자 포함 조건 필요':['STAFF_RETIRED_FILTER_REQUIRED','롱텀 단말기 통합관리 화면의 조회 조건이 「전체·퇴사자 포함」이 아닙니다. 화면의 퇴사자 포함 체크를 확인해 주세요. 자동 재시도하지 않습니다'],
  '단말기 통합관리 화면 필요':['STAFF_SCREEN_REQUIRED','지정한 롱텀 기관 창에 단말기 통합관리 화면이 열려 있지 않습니다. 자동 재시도하지 않습니다'],
  '미저장 변경 필요 확인':['UNSAVED_SCREEN_CHANGES','롱텀 화면에 저장하지 않은 변경이 있어 읽지 않았습니다. 화면을 확인해 주세요. 자동 재시도하지 않습니다'],
  '근로자 식별 필요':['STAFF_IDENTITY_REQUIRED','근로자 식별 정보를 확인하지 못해 읽기를 멈췄습니다. 자동 재시도하지 않습니다'],
  '빈 명단 확인 필요':['EMPTY_ROSTER_CHECK_REQUIRED','조회 결과가 비어 있어 확인이 필요합니다. 빈 명단으로 처리하지 않았습니다. 자동 재시도하지 않습니다'],
  '전체 조회 조건 변경':['QUERY_CONDITION_CHANGED','조회 뒤 전체 조회 조건이 바뀌어 결과를 쓰지 않았습니다. 자동 재시도하지 않습니다'],
  '조회 중 자료 변경':['DATA_CHANGED_DURING_QUERY','조회 중 화면 자료가 바뀌어 결과를 쓰지 않았습니다. 자동 재시도하지 않습니다']
};
// 결과 표식은 stdout에서만 읽는다. 결과가 없을 때의 오류 원인은 stdout·stderr를 함께 본다.
function parseBridgeOutput(output, errorOutput=''){
  const strip=v=>String(v||'').replace(/\u001b\[[0-9;]*m/g,'');
  const text=strip(output);
  const lines=text.split(/\r?\n/).filter(x=>x.includes(MARKER));
  if(lines.length===1){
    try { return JSON.parse(lines[0].slice(lines[0].indexOf(MARKER)+MARKER.length)); }
    catch { throw fail('BRIDGE_RESULT','브라우저 결과 형식이 올바르지 않습니다'); }
  }
  if(!lines.length){
    const all=text+'\n'+strip(errorOutput);
    const line=all.split(/\r?\n/).map(l=>/Error:\s*(?:Error:\s*)?(.+)$/.exec(l)).find(Boolean);
    const raw=line?line[1].trim():'';
    if(Object.hasOwn(KNOWN_BROWSER_ERRORS,raw)){const [code,message]=KNOWN_BROWSER_ERRORS[raw];throw fail(code,message);}
    const m=/Error:\s*([A-Z][A-Z0-9_]{3,60})/.exec(all);
    if(m&&BRIDGE_ERRORS[m[1]])throw fail(m[1],BRIDGE_ERRORS[m[1]]);
    if(m)throw fail('BRIDGE_RESULT','브라우저 실행 오류('+m[1]+')로 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다');
    if(raw)throw fail('BRIDGE_RESULT','브라우저 실행 오류(확인 코드 '+createHash('sha256').update(raw).digest('hex').slice(0,8)+')로 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다');
  }
  throw fail('BRIDGE_RESULT','브라우저 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다');
}
const {runAside}=require('../../configured-aside.cjs');
async function execute(options, bridge = runAside) {
  if (!options.out || path.resolve(options.out) === path.resolve(options.file) || fs.existsSync(options.out)) throw fail('OUTPUT','새 로컬 결과 파일 경로가 필요합니다');
  const prepared = prepareFile(options.file,options.origin,options.org);
  let scope=prepared.scope, data=prepared.data, result, attemptingWrite=false;
  try {
    if(options.apply && !options.approval) throw fail('APPROVAL_REQUIRED','실제 등록에는 이 자료에 대한 승인 파일이 필요합니다');
    // 일부 대상(2026-11-20): 로컬 자료는 선택한 수급자 기록만 담아야 한다. 서버를 읽기 전에 확인한다.
    let selected=null,selectionHash=null,opinionCarry=null;
    if(options.selectedRecipients!==undefined){
      const ids=options.selectedRecipients;
      if(!Array.isArray(ids)||!ids.length||ids.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(x))||new Set(ids).size!==ids.length)throw fail('SELECTION_SCOPE','선택한 수급자 목록을 확인해 주세요');
      selected=new Set(ids);
      if(data.records.some(r=>!selected.has(r.recipientId)))throw fail('SELECTION_SCOPE','선택하지 않은 수급자 기록이 로컬 자료에 있습니다');
      selectionHash=createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
    }
    const first=await bridge(buildScript({mode:'plan',...scope,count:scope.records,readReviews:!!selected},options.target));
    if(!first.ok) result={...scope,...first,phase:'preflight'};
    else {
      if(normalizeOrg(first.orgName)!==normalizeOrg(scope.orgName))throw fail('ORG_CHANGED','기관이 변경됐습니다');
      data=validateImport(data,first.orgName);scope={...scope,orgName:first.orgName,contentHash:snapshotDigest(data)};
      if(selected){
        // 서버의 현재 월 원문(작성자별 조회를 모아 공개 contentHash로 검증한 것)에서 비선택 수급자 기록은 그대로 두고 선택 수급자 기록만 로컬 자료로 바꾼다.
        // 서버 원문을 완전히 확인하지 못하면(구 서버·조회 실패·손상) 일부 자료를 월 전체로 보내지 않고 멈춘다.
        let base;
        if(first.current?.version===0&&first.current.count===0)base=[];
        else if(first.alreadyPresent)base=data.records;
        else {
          const c=first.currentContent;
          if(!c||!Array.isArray(c.records)||c.records.length!==first.current?.count||snapshotDigest({schemaVersion:1,month:c.month,orgName:c.orgName,collectedAt:c.collectedAt,records:c.records})!==first.current.contentHash)throw fail('PARTIAL_MERGE_UNSUPPORTED','서버의 현재 원문 전체를 확인하지 못해 일부 대상만 반영할 수 없습니다');
          base=c.records;
        }
        const kept=base.filter(r=>!selected.has(r.recipientId));
        data=validateImport({schemaVersion:1,month:data.month,orgName:first.orgName,collectedAt:data.collectedAt,records:[...kept,...data.records]},first.orgName);
        const m=summary(data);
        scope={...scope,contentHash:m.contentHash,records:m.count,noteCount:m.noteCount,recipientCount:m.recipientCount,workerGroups:m.workers.length,
          selection:{hash:selectionHash,selected:selected.size,keptRecords:kept.length,replacedRecords:base.length-kept.length,baseVersion:first.current.version}};
        // 비선택 기록의 현재 의견(서버가 같은 원문으로 확인한 current만)을 복원용으로 돌려준다. 원문을 바꾸면 서버는 이 의견을 이전 원문 기준으로 돌린다.
        const rv=first.currentReviews;
        if(!rv||typeof rv.state!=='string'||rv.state==='current'&&(!Array.isArray(rv.entries)||typeof rv.reviewHash!=='string'))throw fail('PARTIAL_MERGE_UNSUPPORTED','현재 기록 검토의견을 확인하지 못해 일부 대상만 반영할 수 없습니다');
        const keptIds=new Set(kept.map(r=>r.id));
        const carry=rv.state==='current'?rv.entries.filter(e=>keptIds.has(e?.recordId)).map(e=>({recordId:e.recordId,status:e.status,opinion:e.opinion,planCheck:e.planCheck,planBasis:e.planBasis,...(e.concise===true?{concise:true}:{})})).sort((x,y)=>x.recordId<y.recordId?-1:x.recordId>y.recordId?1:0):[];
        const reviewsKey=rv.state==='current'?'current:'+rv.reviewHash:String(rv.state)+':'+String(rv.version);
        scope.selection={...scope.selection,opinionCarryHash:createHash('sha256').update(JSON.stringify(carry)).digest('hex'),reviewsKey};
        opinionCarry={count:carry.length,reviewVersion:Number.isSafeInteger(rv.version)?rv.version:null,reviewsKey,entries:carry};
      }
      // 업무 내용 비교(형식 버전 1). same이면 PUT 0회로 끝내고 current에는 서버의 현재 version/contentHash만 담는다.
      const cmp=compareWorkerNotesContent({candidate:data,current:first.current&&{...first.current,...(first.currentContent||{})},scope:{orgName:first.orgName,month:scope.month}});
      const plan={...scope,current:first.current,alreadyPresent:first.alreadyPresent && first.current.contentHash===scope.contentHash,ok:true,phase:'plan',...(opinionCarry?{opinionCarry}:{}),
        contentComparison:cmp.kind,contentSame:cmp.kind==='same',candidateBusinessHash:cmp.candidateBusinessHash,...(cmp.currentBusinessHash?{currentBusinessHash:cmp.currentBusinessHash}:{})};
      if(cmp.kind==='unconfirmed')result={...plan,ok:false,code:'CONTENT_COMPARISON_UNCONFIRMED',reason:cmp.code,putCount:0,phase:'stopped',outcome:'not-written'};
      else if(cmp.kind==='same')result=options.apply?{...plan,saved:false,verified:true,putCount:0,phase:'complete'}:{...plan,putCount:0};
      else if(!options.apply)result=plan;
      else {
        const approval=readJson(options.approval); validateApproval(plan,approval);
        attemptingWrite=true;
        const applied=await bridge(buildScript({...scope,mode:'apply',count:scope.records,expectedVersion:approval.expectedVersion,payload64:Buffer.from(JSON.stringify(data),'utf8').toString('base64')},first.targetId||options.target));
        result={...scope,...applied,phase:applied.ok?'complete':'stopped'};
      }
    }
  } catch(e) { result={...scope,ok:false,code:e.code||'LOCAL_ERROR',phase:'stopped',outcome:attemptingWrite?'unknown':'not-written'}; }
  fs.mkdirSync(path.dirname(path.resolve(options.out)),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx'});
  return result;
}
function parseArgs(argv) {
  const options={}; const values={ '--file':'file','--origin':'origin','--org':'org','--approval':'approval','--out':'out','--target':'target' };
  for(let i=0;i<argv.length;i++){if(argv[i]==='--apply'){options.apply=true;continue;}const key=values[argv[i]];if(!key||!argv[i+1])throw fail('ARGS','인자를 확인해 주세요');options[key]=argv[++i];}
  if(!options.file||!options.origin||!options.org||!options.out)throw fail('ARGS','--file --origin --org --out 인자가 필요합니다');return options;
}
if(require.main===module) Promise.resolve().then(()=>execute(parseArgs(process.argv.slice(2)))).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.ok?0:1;}).catch(e=>{console.error(e.code||'LOCAL_ERROR');process.exitCode=1;});
module.exports={prepareFile,validateApproval,submitInPage,buildScript,runAside,parseBridgeOutput,execute,parseArgs};
