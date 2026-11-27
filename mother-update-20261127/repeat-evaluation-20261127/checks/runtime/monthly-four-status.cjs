'use strict';
// 4번 여러 달 실행의 로컬 읽기 전용 상태 조회(2026-11-20 Task C).
// - 해당 기관 context.stateRoot 아래 monthly-four-runs/<runId>/ 증빙과 점유 파일만 읽는다. 어떤 파일·폴더도 만들거나 고치거나 지우지 않는다.
// - 점유(state/runtime.lock, monthly-four-runs/locks/<runId>.lock)를 쥐거나 이어받지 않는다. 있으면 정보만 보고한다.
// - 브라우저·진단·자식 프로세스·네트워크를 쓰지 않는다(browserChecked:false). 창 binding이 없거나 바뀌어도 조회를 막지 않는다.
// - 이벤트 사슬이 깨졌으면 integrity:'torn'(STATE_TORN)으로 보고만 한다. 실행 점유가 있는 동안 마지막 파일만 불완전하거나
//   request.json이 아직 없으면 쓰는 중 스냅샷으로 보고 'snapshot-incomplete'(STATE_SNAPSHOT_INCOMPLETE)로 구분한다. 수리·삭제·이동 0.
// - 결과에는 코드·상태·메타 출력(해시·건수·버전)만 담는다. 개인정보·원문을 넣지 않는다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const S=require('./monthly-four-state.cjs'),{safeWithin}=require('./context.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const RUN_ID=/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/,EVENT_FILE=/^(\d{6})\.json$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const base={readOnly:true,browserChecked:false};
const refuse=(runId,code)=>({ok:false,...base,runId:typeof runId==='string'&&RUN_ID.test(runId)?runId:null,code});

// 기관 범위: stateRoot가 <root>/state/organizations/<sha256(기관 id) 앞 32자>와 정확히 같고 요청의 기관이 context 기관과 같아야 한다.
function scopeOk(context,request){
 const org=context?.settings?.organization?.id;
 if(typeof context?.root!=='string'||typeof context.stateRoot!=='string'||typeof org!=='string'||!org)return false;
 if(path.resolve(context.stateRoot)!==path.resolve(context.root,'state','organizations',sha(org).slice(0,32)))return false;
 return plain(request)&&request.organizationId===org;
}
const readJsonOrNull=file=>{try{if(fs.lstatSync(file).isSymbolicLink())return null;return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{return null;}};
const exists=file=>{try{fs.lstatSync(file);return true;}catch{return false;}};

function readLocks(context,paths){
 const wsFile=safeWithin(context.root,'state','runtime.lock');
 const runPresent=exists(paths.lock),runLock=runPresent?readJsonOrNull(paths.lock):null;
 const workspace={present:exists(wsFile)};
 if(workspace.present){
  const lease=readJsonOrNull(wsFile);
  if(plain(lease)&&typeof lease.id==='string'&&typeof lease.operation==='string'){
   workspace.operation=lease.operation;
   workspace.sameRun=plain(runLock)&&runLock.kind==='monthly-four-run-lock'&&runLock.runId===paths.runId&&runLock.workspaceLeaseId===lease.id;
  }
 }
 return{workspace,run:{present:runPresent}};
}

// 사슬이 깨진 원인이 쓰는 중 경합으로 설명되는지: 실행 점유가 있고, request.json이 아직 없거나 마지막 이벤트 파일만 불완전(읽기·파싱 불가)하다.
function inProgressSnapshot(paths,runLockPresent){
 if(!runLockPresent)return false;
 if(!exists(paths.request))return true;
 let names;try{names=fs.readdirSync(paths.events).sort();}catch{return false;}
 if(!names.length||names.some((n,i)=>!EVENT_FILE.test(n)||Number(EVENT_FILE.exec(n)[1])!==i+1))return false;
 let prev;try{prev=sha(fs.readFileSync(paths.request));}catch{return false;}
 for(let i=0;i<names.length-1;i++){
  let b,e;try{b=fs.readFileSync(path.join(paths.events,names[i]));e=JSON.parse(b.toString('utf8'));}catch{return false;}
  if(!plain(e)||e.seq!==i+1||e.prevSha256!==prev)return false;
  prev=sha(b);
 }
 try{JSON.parse(fs.readFileSync(path.join(paths.events,names.at(-1)),'utf8'));return false;}catch{return true;}
}

// 실행기 보고(RunReport)와 같은 모양. 실행 점유가 있는 동안의 running 단계는 전체 상태도 running으로 본다.
function buildStatus(run,runActive){
 const states=S.phaseStates(run),events=run.events,overrides={},codes=[];
 // 마지막 진단이 보류이고 그 뒤 단계 진행이 없으면 실행기가 돌려준 보류 코드와 같다.
 const lastDoctor=events.findLastIndex(e=>e.type==='doctor');
 if(lastDoctor>=0&&events[lastDoctor].status==='blocked'&&!events.slice(lastDoctor+1).some(e=>['phase','reconcile','verify'].includes(e.type)))
  codes.push('DOCTOR_BLOCKED',...(events[lastDoctor].blockingCodes||[]));
 // 증빙 대조 미확인(verify unconfirmed) 뒤 그 단계에 새 결과가 없으면 실행기처럼 보류로 본다.
 events.forEach((e,i)=>{
  if(e.type!=='verify'||e.status!=='unconfirmed')return;
  const key=e.month+'|'+e.phase;
  if(!events.slice(i+1).some(x=>['phase','reconcile'].includes(x.type)&&x.month+'|'+x.phase===key)){overrides[key]={status:'held',code:'EVIDENCE_UNCONFIRMED'};codes.push('EVIDENCE_UNCONFIRMED');}
 });
 const months=run.request.months.map(month=>({month,phases:run.request.phases.map(phase=>{
  const s=overrides[month+'|'+phase]||states.get(month+'|'+phase)||{status:'pending'};
  return{phase,status:s.status,...(s.code?{code:s.code}:{}),...(s.needed?{needed:[...s.needed]}:{}),...(s.outputs?{outputs:s.outputs}:{})};
 })}));
 const all=months.flatMap(m=>m.phases),has=x=>all.some(p=>p.status===x);
 const blockingCodes=[...new Set([...codes,...all.filter(p=>p.status!=='succeeded'&&p.code).map(p=>p.code)])];
 const status=has('unknown')?'unknown':has('conflict')?'conflict':has('failed')?'failed':(has('running')&&runActive)?'running':(has('held')||has('pending')||has('running')||codes.length)?'held':'succeeded';
 return{status,months,blockingCodes};
}

function readMonthlyFourStatus({context,request}={}){
 const runId=plain(request)?request.runId:undefined;
 if(typeof runId!=='string'||!RUN_ID.test(runId)||!scopeOk(context,request))return refuse(runId,'STATUS_SCOPE_INVALID');
 try{S.validateRequest(request);}catch{return refuse(runId,'REQUEST_INVALID');}
 let paths;
 try{paths={...S.runPaths(context,runId),runId};}catch{return refuse(runId,'STATUS_SCOPE_INVALID');}
 // 실행 폴더·events·점유 폴더 자체가 연결(link)이면 따라가지 않는다.
 for(const p of [paths.dir,paths.events,paths.request,path.dirname(paths.lock)])if(exists(p)&&fs.lstatSync(p).isSymbolicLink())return refuse(runId,'STATUS_SCOPE_INVALID');
 const locks=readLocks(context,paths),evidence=S.evidenceDir(runId);
 const common={...base,runId,evidence,locks};
 let run=null,err=null;
 // 다른 실행이 쓰는 중이면 한 번 다시 읽어 본다(쓰기·대기 없음).
 for(let i=0;i<2&&!run;i++){try{run=S.openRun(context,runId);err=null;}catch(e){err=e;if(e?.code==='RUN_NOT_FOUND')break;}}
 if(!run){
  if(err?.code==='RUN_NOT_FOUND')return{ok:true,...common,status:'not-started',months:[],blockingCodes:[],scopeMatches:null,integrity:'not-found'};
  if(err?.code==='STATE_TORN'){
   const snap=inProgressSnapshot(paths,locks.run.present),code=snap?'STATE_SNAPSHOT_INCOMPLETE':'STATE_TORN';
   return{ok:false,...common,status:'unconfirmed',months:[],blockingCodes:[code],scopeMatches:null,integrity:snap?'snapshot-incomplete':'torn',code};
  }
  if(['PATH_OUTSIDE_WORKSPACE','LINK_OUTSIDE_STATE_POLICY'].includes(err?.code))return refuse(runId,'STATUS_SCOPE_INVALID');
  return{ok:false,...common,status:'unconfirmed',months:[],blockingCodes:['STATE_UNREADABLE'],scopeMatches:null,integrity:'torn',code:'STATE_UNREADABLE'};
 }
 const report=buildStatus(run,locks.run.present);
 return{ok:true,...common,...report,scopeMatches:S.sameScope(run.request,request),integrity:'ok'};
}

module.exports={readMonthlyFourStatus};
