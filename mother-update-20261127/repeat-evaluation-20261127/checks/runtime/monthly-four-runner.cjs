'use strict';
// 4번 여러 달·여러 단계 실행기와 명시 이어하기(2026-11-20 Task A).
// 실제 수집·작성·등록은 하지 않는다. 어댑터(doctor·phases·reconcile·verifyEvidence)를 정해진 순서로 부르고 결과를 증빙으로 남긴다.
// - 시작(run·resume 모두) 때 doctor를 먼저 부른다. ok!==true면 DOCTOR_BLOCKED로 보류하고 다른 어댑터를 부르지 않는다.
// - 달 순서·단계 순서대로 부른다. 단계가 succeeded가 아니면 그 달의 뒤 단계는 부르지 않는다.
//   쓰기 아닌 단계의 held/failed/conflict와 쓰기 단계의 held는 다음 달로 계속, 어느 단계든 unknown과 쓰기 단계 conflict/failed는 실행 전체를 멈춘다.
// - 어댑터 예외: 쓰기 단계는 unknown(ADAPTER_THREW_DURING_WRITE), 아니면 failed(ADAPTER_THREW). 예외 문구는 남기지 않는다.
// - 이어하기는 사용자의 명시 지시({action:'resume',runId,message,at})가 있을 때만 한다. 자동 재개 경로는 없다.
//   범위가 바뀌면 RESUME_SCOPE_CHANGED, 사슬이 깨졌으면 STATE_TORN(어댑터 0회·파일 변경 0).
//   running/unknown 단계는 단계 호출 전에 모두 reconcile로 확인한다. 불명이면 RECONCILIATION_REQUIRED로 새 쓰기 0회 보류.
//   succeeded 단계는 다시 부르지 않는다. 쓰기 아닌 succeeded 단계는 verifyEvidence로 확인하고 same:false면 그 달은 SOURCE_CHANGED 충돌.
//   기존 conflict 단계는 이 실행에서 다시 부르지 않는다(원천이 바뀐 달은 새 실행으로 다룬다).
// 같은 승인 작업 안의 계속 진행(2026-11-20 Task B):
// - run/resume/continue가 held로 끝나고 멈춘 원인이 모두 CONTINUABLE이며 unknown/conflict/running/failed가 없을 때만
//   보고서에 continuation:{token,expiresAt}을 넣는다. 토큰은 무작위 32바이트 hex, 상태에는 sha256(토큰 hex 문자열)만 남긴다.
// - continueMonthlyFour는 마지막 실행이 발급한 미사용·미만료 토큰으로만 진행한다(사용 즉시 소비 기록, 1회용).
//   사용자 이어하기 지시 이벤트를 만들지 않는다. 토큰이 없거나 만료·대체되면 명시 resume만 가능하다(자동 재개 없음).
// - 미게시 초안 수정: 그 달 쓰기 단계 이벤트가 하나도 없고 validate가 충돌이 아니면, resume/continue에서 draft 증빙이 바뀌었을 때
//   SOURCE_CHANGED 대신 draft·validate를 supersede 이벤트(이전 증빙 포함)로 무효화하고 다시 부른다. 앞 단계 증빙 변경은 그대로 충돌.
const S=require('./monthly-four-state.cjs');
const {PHASES,WRITE_PHASES}=S;
const crypto=require('node:crypto');
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=s=>crypto.createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isWrite=p=>WRITE_PHASES.includes(p);
const CODE=/^[A-Z][A-Z0-9_]{1,63}$/,HEX=/^[0-9a-f]{64}$/;
const safeCode=v=>typeof v==='string'&&CODE.test(v);
const isEvidence=v=>plain(v)&&Object.entries(v).every(([k,x])=>k.length>0&&k.length<=200&&typeof x==='string'&&HEX.test(x));
const isNames=v=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=200);
const RESULT_STATUSES=['succeeded','held','conflict','unknown','failed'];
// 같은 작업 안에서 작성·수집 에이전트가 채우면 계속할 수 있는 보류 코드(P가 조정 가능).
// 작성 에이전트가 같은 범위의 작성물로 고칠 수 있는 보류만. 관문 닫힘(기관·권한·버전 확인)·동의창 등 사용자 판단 정지는 넣지 않는다(2026-11-20 독립 검토 Minor 1).
const CONTINUABLE=Object.freeze(['DRAFT_REQUIRED','DRAFT_INVALID','OPINIONS_REVIEW_REQUIRED','OPINIONS_INVALID']);
const CONTINUATION_TTL_MS=6*60*60*1000;
const writeStarted=(run,month)=>run.events.some(e=>e.month===month&&isWrite(e.phase));
function continuable(report){
 const all=report.months.flatMap(m=>m.phases);
 return report.status==='held'&&report.blockingCodes.length>0&&report.blockingCodes.every(c=>CONTINUABLE.includes(c))&&all.some(p=>p.status==='held')
  &&all.every(p=>p.status==='succeeded'||p.status==='pending'&&!p.code||p.status==='held'&&CONTINUABLE.includes(p.code));
}

function checkAdapters(a,phases){
 if(!a||typeof a.doctor!=='function'||typeof a.reconcile!=='function'||typeof a.verifyEvidence!=='function'||!plain(a.phases)||phases.some(p=>typeof a.phases[p]!=='function'))fail('ADAPTERS_INVALID');
}
function checkContinuation(c,request){
 if(!plain(c)||Object.keys(c).length!==2||c.runId!==request.runId||typeof c.token!=='string'||!HEX.test(c.token))fail('CONTINUATION_INVALID');
}
function clockOf(now){
 return()=>{const v=now==null?Date.now():typeof now==='function'?now():now,ms=v instanceof Date?v.getTime():v;if(typeof ms!=='number'||!Number.isFinite(ms))fail('CLOCK_INVALID');return ms;};
}
function checkInstruction(n,request){
 if(!plain(n)||n.action!=='resume'||n.runId!==request.runId||typeof n.message!=='string'||!n.message.trim()||typeof n.at!=='string'||!Number.isFinite(Date.parse(n.at)))fail('RESUME_INSTRUCTION_REQUIRED');
}
// 어댑터 결과를 저장 가능한 모양으로 좁힌다. 모양이 틀리면 쓰기 단계는 unknown, 아니면 failed.
function phaseResult(r,phase){
 const okShape=plain(r)&&RESULT_STATUSES.includes(r.status)&&(r.code==null||safeCode(r.code))&&(r.evidence==null||isEvidence(r.evidence))&&(r.outputs==null||plain(r.outputs))&&(r.needed==null||isNames(r.needed));
 if(!okShape)return{status:isWrite(phase)?'unknown':'failed',code:'ADAPTER_RESULT_INVALID'};
 let outputs=null;if(r.outputs!=null){try{outputs=JSON.parse(JSON.stringify(r.outputs));}catch{return{status:isWrite(phase)?'unknown':'failed',code:'ADAPTER_RESULT_INVALID'};}}
 return{status:r.status,code:r.code??null,evidence:r.evidence??null,outputs,needed:r.needed??null};
}
function reconcileResult(r){
 if(!plain(r)||!['succeeded','not-written','unknown'].includes(r.status)||r.evidence!=null&&!isEvidence(r.evidence)||r.outputs!=null&&!plain(r.outputs))return{status:'unknown'};
 let outputs=null;if(r.outputs!=null){try{outputs=JSON.parse(JSON.stringify(r.outputs));}catch{return{status:'unknown'};}}
 return{status:r.status,evidence:r.evidence??null,outputs};
}
const publicState=s=>Object.fromEntries(Object.entries(s).filter(([,v])=>v!==null));

function buildReport(run,{status,codes=[],overrides={}}={}){
 const states=S.phaseStates(run);
 const months=run.request.months.map(month=>({month,phases:run.request.phases.map(phase=>{
  const s=overrides[month+'|'+phase]||states.get(month+'|'+phase)||{status:'pending'};
  return{phase,status:s.status,...(s.code?{code:s.code}:{}),...(s.needed?{needed:[...s.needed]}:{})};
 })}));
 const all=months.flatMap(m=>m.phases),has=x=>all.some(p=>p.status===x);
 const blockingCodes=[...new Set([...codes,...all.filter(p=>p.status!=='succeeded'&&p.code).map(p=>p.code)])];
 const derived=has('unknown')?'unknown':has('conflict')?'conflict':has('failed')?'failed':(has('held')||has('pending')||has('running')||codes.length)?'held':'succeeded';
 return{runId:run.runId,status:status||derived,months,blockingCodes,evidenceDir:S.evidenceDir(run.runId)};
}

async function drive({run,lock,adapters,mode}){
 const {months,phases,runId}=run.request,append=f=>S.appendEvent(run,f,lock),state=k=>S.phaseStates(run).get(k)||{status:'pending',code:null,evidence:null,outputs:null,needed:null};
 // 1) 시작 진단
 let doc=null;try{doc=await adapters.doctor({months:[...months]});}catch{doc=null;}
 const docOk=plain(doc)&&doc.ok===true,docCodes=plain(doc)&&Array.isArray(doc.blockingCodes)?doc.blockingCodes.map(c=>safeCode(c)?c:'DOCTOR_CODE_INVALID'):['DOCTOR_FAILED'];
 append({type:'doctor',status:docOk?'ok':'blocked',code:docOk?null:'DOCTOR_BLOCKED',blockingCodes:[...new Set(docCodes)]});
 if(!docOk)return buildReport(run,{status:'held',codes:['DOCTOR_BLOCKED',...docCodes]});
 // 2) 시작만 있거나 불명인 단계는 어떤 단계 호출보다 먼저 확인한다.
 const fresh=new Set();
 for(const month of months)for(const phase of phases){
  const key=month+'|'+phase,cur=state(key);if(cur.status!=='running'&&cur.status!=='unknown')continue;
  let r;try{r=reconcileResult(await adapters.reconcile({month,phase,runId,evidence:cur.evidence}));}catch{r={status:'unknown'};}
  append({type:'reconcile',month,phase,status:r.status,evidence:r.evidence??null,outputs:r.outputs??null});
  if(r.status==='unknown')return buildReport(run,{status:'held',codes:['RECONCILIATION_REQUIRED']});
  if(r.status==='succeeded')fresh.add(key);
 }
 // 3) 달·단계 순서대로 남은 범위만 진행
 const overrides={},codes=[];
 for(const month of months){
  for(let i=0;i<phases.length;i++){
   const phase=phases[i],key=month+'|'+phase,cur=state(key);
   if(cur.status==='succeeded'){
    if(mode==='run'||isWrite(phase)||fresh.has(key))continue;
    let v;try{v=await adapters.verifyEvidence({month,phase,evidence:cur.evidence});}catch{v=null;}
    if(plain(v)&&v.same===true){append({type:'verify',month,phase,status:'same'});continue;}
    if(!(plain(v)&&v.same===false)){append({type:'verify',month,phase,status:'unconfirmed',code:'EVIDENCE_UNCONFIRMED'});overrides[key]={status:'held',code:'EVIDENCE_UNCONFIRMED'};codes.push('EVIDENCE_UNCONFIRMED');break;}
    // 미게시 초안 수정: 이전 증빙은 사슬에 남기고 draft·validate를 대체한 뒤 아래에서 다시 부른다.
    const vkey=month+'|validate';
    if(phase==='draft'&&!writeStarted(run,month)&&state(vkey).status!=='conflict'){
     for(const p of ['draft','validate'])if(phases.includes(p)&&S.phaseStates(run).has(month+'|'+p))append({type:'supersede',month,phase:p,status:'superseded',code:'DRAFT_REVISED',evidence:state(month+'|'+p).evidence});
    }else{append({type:'phase',month,phase,status:'conflict',code:'SOURCE_CHANGED',evidence:cur.evidence});break;}
   }
   else if(cur.status==='conflict')break;
   const previous=Object.fromEntries(phases.slice(0,i).map(p=>[p,publicState(state(month+'|'+p))]));
   append({type:'phase',month,phase,status:'running'});
   let r;
   try{r=phaseResult(await adapters.phases[phase]({month,runId,previous}),phase);}
   catch{r=isWrite(phase)?{status:'unknown',code:'ADAPTER_THREW_DURING_WRITE'}:{status:'failed',code:'ADAPTER_THREW'};}
   append({type:'phase',month,phase,...r});
   if(r.status==='succeeded'){fresh.add(key);continue;}
   if(r.status==='unknown'||isWrite(phase)&&(r.status==='conflict'||r.status==='failed'))return buildReport(run,{overrides,codes});
   break;
  }
 }
 return buildReport(run,{overrides,codes});
}

async function execute({context,request,adapters,instruction,continuation,now,continuationTtlMs=CONTINUATION_TTL_MS},mode){
 S.validateRequest(request);
 if(mode==='resume')checkInstruction(instruction,request);
 if(mode==='continue')checkContinuation(continuation,request);
 if(!Number.isSafeInteger(continuationTtlMs)||continuationTtlMs<=0)fail('CONTINUATION_TTL_INVALID');
 checkAdapters(adapters,request.phases);
 const clock=clockOf(now);
 if(mode==='run'&&(request.organizationId!==context.settings.organization.id||request.configHash!==context.configHash))fail('REQUEST_CONTEXT_MISMATCH');
 const lock=S.acquireRunLock(context,request.runId);
 let done=false;
 try{
  let run;
  if(mode==='run')run=S.createRun(context,request);
  else{
   run=S.openRun(context,request.runId);
   if(!S.sameScope(run.request,request)||run.request.organizationId!==context.settings.organization.id||run.request.configHash!==context.configHash)fail('RESUME_SCOPE_CHANGED');
   if(mode==='resume')S.appendEvent(run,{type:'resume',status:'requested',instruction:{at:instruction.at,sha256:sha(instruction.message)}},lock);
   else{
    const tokenSha256=sha(continuation.token),nowMs=clock(),code=S.continuationCheck(run,tokenSha256,nowMs);if(code)fail(code);
    S.appendEvent(run,{type:'continuation',status:'used',continuation:{tokenSha256,usedAt:new Date(nowMs).toISOString()}},lock);
   }
  }
  const report=await drive({run,lock,adapters,mode});
  if(continuable(report)){
   // 발급 기록을 못 남기면 토큰을 내지 않는다(명시 이어하기로만 진행).
   try{
    const token=crypto.randomBytes(32).toString('hex'),issued=clock(),issuedAt=new Date(issued).toISOString(),expiresAt=new Date(issued+continuationTtlMs).toISOString();
    S.appendEvent(run,{type:'continuation',status:'issued',continuation:{tokenSha256:sha(token),issuedAt,expiresAt,requestSha256:run.requestSha256}},lock);
    report.continuation={token,expiresAt};
   }catch{}
  }
  done=true;return report;
 }finally{
  // 본 작업 오류를 점유 해제 오류로 가리지 않는다. 남의 점유로 바뀌었으면 지우지 않는다.
  try{lock.release();}catch(e){if(done)throw e;}
 }
}

const runMonthlyFour=args=>execute(args||{},'run');
const resumeMonthlyFour=args=>execute(args||{},'resume');
const continueMonthlyFour=args=>execute(args||{},'continue');
module.exports={PHASES,WRITE_PHASES,CONTINUABLE,CONTINUATION_TTL_MS,runMonthlyFour,resumeMonthlyFour,continueMonthlyFour};
