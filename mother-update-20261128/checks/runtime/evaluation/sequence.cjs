'use strict';
// 6번 대상별 순차 실행. 사용자가 범위를 정한 로컬 작업 목록을 하나씩 기존 단건 절차로 처리한다.
// 한 대상의 오류·미확인은 그 대상만 미처리/미확인으로 남기고 나머지를 계속한다. 명시적인 공통 오류(로그인·기관·설정·공용 점유 변경)만 전체를 멈춘다.
// 목록 자체는 저장 승인이 아니다. 각 작업의 단건 지시·검토완료본 바인딩은 execute가 기존 절차로 검사한다.
// 결과 기록에 실패하면 그 대상을 확인 대상으로 남기고 다음 쓰기 전에 멈춘다. 미확인 대상을 다시 입력·삭제·완료 처리하지 않는다.
const {must}=require('./core.cjs');

const COMMON_ERRORS=new Set(['WORKER_LOGIN_REQUIRED','ORGANIZATION_MISMATCH','CONFIGURED_ORGANIZATION_OR_OPERATOR_MISMATCH','DESK_ORGANIZATION_MISMATCH','DESK_ORG_OR_ROLE_CHANGED',
 'CONFIGURATION_CHANGED_DURING_EXECUTION','OPEN_WORKER_ID_MISMATCH','OPEN_WORKER_NAME_MISMATCH','WORKSPACE_BUSY_OR_PREVIOUS_RUN_UNCONFIRMED','LEASE_OWNERSHIP_CHANGED','SEQUENCE_LEASE_CHANGED',
 // 로그인 확인 실패와, 같은 화면을 쓰는 다음 대상도 진행할 수 없는 화면 읽기 미확정
 'LT_LOGIN_UNCONFIRMED','LOGIN_UNCONFIRMED','DESK_LOGIN_UNCONFIRMED','DESK_ORGANIZATION_CHANGED','DESK_ADMIN_REQUIRED','DESK_VIEWER_UNCONFIRMED',
 'SHARED_DESK_BINDING_UNCONFIRMED','SERVICE_LOGIN_UNCONFIRMED','PRIOR_NATIVE_READ_STILL_PENDING','READ_SESSION_RECONCILIATION_REQUIRED','READ_STATE_UNCONFIRMED']);
const isCommonError=code=>COMMON_ERRORS.has(String(code||'').split(';')[0].trim());
const TASK_ID=/^[A-Za-z0-9_-]{1,64}$/;

async function runEvaluationSequence({tasks,execute,recordOutcome}){
 must(Array.isArray(tasks)&&tasks.length>0&&tasks.every(t=>TASK_ID.test(String(t?.taskId||'')))&&new Set(tasks.map(t=>t.taskId.toLowerCase())).size===tasks.length,'SEQUENCE_TASKS_INVALID');
 must(typeof execute==='function'&&typeof recordOutcome==='function','SEQUENCE_DEPENDENCY_REQUIRED');
 const out={processedIds:[],manualIds:[],unknownIds:[],notAttemptedIds:[],stopped:false,stopReason:null};
 for(const task of tasks){
  if(out.stopped){out.notAttemptedIds.push(task.taskId);continue;}
  let result;
  try{result=await execute(task);}catch(e){result={state:e.outcome==='unknown'?'unknown':'blocked',code:e.message,thrown:true};}
  const code=result?.code||null,cause=result?.cause||null;
  // verified만 처리됨이다. blocked(저장 전 차단)는 미처리, 그 밖(unknown·알 수 없는 상태)은 모두 미확인이다.
  const state=result?.state==='verified'?'verified':result?.state==='blocked'?'blocked':'unknown';
  try{await recordOutcome(task,{state,code});}
  catch{out.unknownIds.push(task.taskId);out.stopped=true;out.stopReason='OUTCOME_RECORD_FAILED';continue;}
  (state==='verified'?out.processedIds:state==='blocked'?out.manualIds:out.unknownIds).push(task.taskId);
  if(isCommonError(code)||isCommonError(cause)){out.stopped=true;out.stopReason=isCommonError(code)?code:cause;}
 }
 return out;
}
module.exports={runEvaluationSequence,isCommonError,COMMON_ERRORS};
