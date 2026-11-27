'use strict';
// 업무 시작 전 진단(읽기 전용). 업무가 요구하는 서비스의 지정 target만 한 번씩 확인하고, 어떤 파일도 쓰지 않는다.
// 연결 불명(unknown)을 로그아웃이나 성공으로 바꾸지 않으며, 긴 대기·재시도로 실패를 숨기지 않는다.
// 기존 control doctor(로컬 설치 확인, browserChecked:false)와는 별개이며 그 의미를 바꾸지 않는다.
const fs=require('node:fs');
const {safeWithin,readJson}=require('./context.cjs');
const SERVICES=['lt','ltRfid','desk','cm','ez'];
const ACTIONS={
 BINDING_MISSING:'창 지정(bind)이 없습니다. 현재 기관 설정으로 업무 창을 다시 지정한 뒤 진단하세요.',
 BOUND_TARGET_MISSING:'이 업무에 필요한 지정 창이 없거나 사라졌습니다. 다른 창을 대신 쓰지 말고 창을 다시 지정하세요.',
 TARGET_STATE_UNKNOWN:'지정 창 상태를 확인하지 못했습니다. 로그아웃이나 정상으로 보지 말고 창 상태를 직접 확인한 뒤 다시 진단하세요.',
 ORGANIZATION_MISMATCH:'지정 창의 기관이 현재 기관 설정과 다릅니다. 올바른 기관으로 접속한 창을 지정하세요.',
 ORGANIZATION_UNKNOWN:'지정 창의 기관을 확인하지 못했습니다. 기관 화면을 연 뒤 다시 진단하세요.',
 ROLE_MISMATCH:'장기요양 창의 접속 역할이 업무에 필요한 역할과 다릅니다. 필요한 역할로 접속한 창을 지정하세요.',
 ROLE_UNKNOWN:'장기요양 창의 접속 역할을 확인하지 못했습니다. 역할을 확인한 뒤 다시 진단하세요.',
 LOGGED_OUT:'지정 창이 로그아웃 상태입니다. 사용자가 직접 로그인한 뒤 다시 진단하세요.',
 LOGIN_STATE_UNKNOWN:'지정 창의 로그인 상태를 확인하지 못했습니다. 로그인 여부를 직접 확인한 뒤 다시 진단하세요.',
 UNSAVED_CHANGES:'지정 창에 저장하지 않은 입력이 있습니다. 사용자가 저장하거나 취소한 뒤 다시 진단하세요.',
 UNSAVED_STATE_UNKNOWN:'지정 창의 미저장 입력 여부를 확인하지 못했습니다. 화면을 직접 확인한 뒤 다시 진단하세요.',
 CLI_MISSING:'브라우저 연결 도구(Aside CLI)를 찾지 못했습니다. 설치를 확인한 뒤 다시 진단하세요.',
 CLI_UNSUPPORTED:'브라우저 연결 도구(Aside CLI) 버전을 지원하지 않습니다. 지원 버전으로 바꾼 뒤 다시 진단하세요.',
 CLI_STATE_UNKNOWN:'브라우저 연결 도구(Aside CLI) 상태를 확인하지 못했습니다. 도구 상태를 확인한 뒤 다시 진단하세요.',
 BROWSER_NOT_CHECKED:'브라우저 연결 도구가 준비되지 않아 지정 창을 확인하지 않았습니다. 도구 문제를 해결한 뒤 다시 진단하세요.',
 FOREIGN_LEASE:'다른 실행이 작업공간을 점유하고 있습니다. 점유를 지우지 말고 그 실행의 결과를 먼저 확인하세요.',
 LEASE_UNKNOWN:'작업공간 점유 파일을 읽지 못했습니다. 파일을 고치거나 지우지 말고 담당자에게 확인하세요.'
};
const check=(code,status,extra={})=>({code,status,...extra,...(status==='pass'?{}:{action:ACTIONS[code]})});
const expectedOrganization=(context,service)=>{const o=context.settings.organization;return service==='desk'?o.deskId:['cm','ez'].includes(service)?o.name:o.id;};

function leaseCheck(context,ownedLeaseId){
 let lock,current;
 try{lock=safeWithin(context.root,'state','runtime.lock');if(!fs.existsSync(lock))return check('LEASE_FREE','pass');current=readJson(lock);}catch{return check('LEASE_UNKNOWN','unknown');}
 if(current?.schemaVersion!==1||typeof current.id!=='string'||!current.id)return check('LEASE_UNKNOWN','unknown');
 // 자기 점유는 context.workspaceLease 이어받기와 같은 조건(같은 id·기관·설정)일 때만 인정한다.
 if(ownedLeaseId&&current.id===ownedLeaseId&&current.orgKey===context.orgKey&&current.configHash===context.configHash)return check('LEASE_OWNED','pass');
 return check('FOREIGN_LEASE','fail');
}
async function cliCheck(cliProbe){
 let r;try{r=await cliProbe();}catch{return check('CLI_STATE_UNKNOWN','unknown');}
 if(r?.found===false)return check('CLI_MISSING','fail');
 if(r?.found!==true||typeof r.supported!=='boolean')return check('CLI_STATE_UNKNOWN','unknown');
 return r.supported?check('CLI_READY','pass',{version:r.version}):check('CLI_UNSUPPORTED','fail',{version:r.version});
}
function targetChecks(context,need,target,r){
 const at={service:need.service,targetId:target.targetId};
 if(r?.state==='missing')return[check('BOUND_TARGET_MISSING','fail',at)];
 if(r?.state!=='ok')return[check('TARGET_STATE_UNKNOWN','unknown',at)];
 const out=[],expected=expectedOrganization(context,need.service);
 if(typeof r.organizationId!=='string'||!r.organizationId)out.push(check('ORGANIZATION_UNKNOWN','unknown',at));
 else if(!expected||r.organizationId!==expected)out.push(check('ORGANIZATION_MISMATCH','fail',at));
 if(['lt','ltRfid'].includes(need.service)){const role=need.role||target.role;if(typeof r.role!=='string'||!r.role)out.push(check('ROLE_UNKNOWN','unknown',at));else if(r.role!==role)out.push(check('ROLE_MISMATCH','fail',at));}
 if(r.loggedIn===false)out.push(check('LOGGED_OUT','fail',at));else if(r.loggedIn!==true)out.push(check('LOGIN_STATE_UNKNOWN','unknown',at));
 if(r.unsaved===true)out.push(check('UNSAVED_CHANGES','fail',at));else if(r.unsaved!==false)out.push(check('UNSAVED_STATE_UNKNOWN','unknown',at));
 return out.length?out:[check('TARGET_READY','pass',at)];
}
async function checkTaskEnvironment({context,scope,task,bridge,cliProbe,ownedLeaseId}){
 if(!Array.isArray(task?.services)||!task.services.length||task.services.some(s=>!SERVICES.includes(s?.service)))throw Error('TASK_SERVICES_REQUIRED');
 const checks=[leaseCheck(context,ownedLeaseId)],cli=await cliCheck(cliProbe);checks.push(cli);
 let browserChecked=false;
 if(!scope||!Array.isArray(scope.targets))checks.push(check('BINDING_MISSING','fail'));
 else{
  for(const need of task.services){
   // 지정 target만 쓴다. 없으면 다른 창을 찾거나 열지 않는다.
   const target=scope.targets.find(t=>t.service===need.service&&(!need.role||t.role===need.role));
   if(!target){checks.push(check('BOUND_TARGET_MISSING','fail',{service:need.service}));continue;}
   if(cli.status!=='pass'){checks.push(check('BROWSER_NOT_CHECKED','unknown',{service:need.service,targetId:target.targetId}));continue;}
   let r;try{browserChecked=true;r=await bridge.inspect(target.targetId);}catch{r=null;}
   checks.push(...targetChecks(context,need,target,r));
  }
 }
 const blockingCodes=[...new Set(checks.filter(c=>c.status!=='pass').map(c=>c.code))];
 return{ok:blockingCodes.length===0,browserChecked,taskId:task.id,checks,blockingCodes};
}
module.exports={checkTaskEnvironment};
