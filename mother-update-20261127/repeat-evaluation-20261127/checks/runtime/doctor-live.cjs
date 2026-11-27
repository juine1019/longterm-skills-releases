'use strict';
// 업무 시작 전 실제 연결 진단(2026-11-20 P1). doctor-checks.cjs(checkTaskEnvironment)에 실제 cliProbe·inspect를 붙인다.
// - cliProbe: Aside CLI 실행 파일을 찾고 설치 폴더 이름으로 버전만 판정한다. 실행 파일을 실행하지 않는다.
//   버전을 폴더로 알 수 없으면 supported:null(= 상태 불명, 진단 차단)로 남긴다. 성공으로 꾸미지 않는다.
// - inspect(targetId): 지정 target 하나만 담은 scope로 공용 guard(browser-guard compileGuarded, reportGuardErrors)를 거쳐
//   읽기 전용 페이지 스크립트를 한 번 실행한다. 다른 탭 탐색·새 창 열기·쓰기 없음. guard 거절은 unknown(+guardCode)이다.
// - 기존 control doctor(browserChecked:false)의 의미는 바꾸지 않는다. 이 진단은 control doctor-task 명령으로만 부른다.
const fs=require('node:fs'),path=require('node:path');
const C=require('./context.cjs'),{loadScope}=require('./environment.cjs'),{checkTaskEnvironment}=require('./doctor-checks.cjs'),{runAside}=require('./aside-cli.cjs');
// 이 PC 환경에서 정상 동작을 확인한 Aside CLI 최소 버전(aside-cli.cjs 주석의 1.26.1115.1556).
const MIN_VERSION='1.26.1115.1556';
const TASKS=Object.freeze({
 'care-visit-review':Object.freeze({id:'care-visit-review',services:Object.freeze([Object.freeze({service:'lt',role:'20A'}),Object.freeze({service:'desk'})])})
});
const CODE=/^[A-Z][A-Z0-9_]{1,63}$/;
const versionOf=name=>/^\d+(?:\.\d+){1,3}$/.test(name)?name:null;
function compareVersion(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;}
// 버전 출력 읽기(읽기 전용): 단계 검사(stage-check)와 같은 `--version` 신호. 한 번, 짧은 제한 시간, 셸 없음.
function defaultRunVersion(exe){try{const r=require('node:child_process').spawnSync(exe,['--version'],{encoding:'utf8',windowsHide:true,timeout:5000});return r.status===0?String(r.stdout||''):null;}catch{return null;}}
function cliProbe({env=process.env,platform=process.platform,minVersion=MIN_VERSION,runVersion=defaultRunVersion}={}){
 return async()=>{
  let exe=null;
  if(platform==='win32'){const p=path.join(env.LOCALAPPDATA||'','Aside','CLI','current','aside.exe');if(env.LOCALAPPDATA&&fs.existsSync(p))exe=p;}
  else for(const dir of String(env.PATH||'').split(path.delimiter).filter(Boolean)){const p=path.join(dir,'aside');if(fs.existsSync(p)){exe=p;break;}}
  if(!exe)return{found:false};
  let version=null;try{version=versionOf(path.basename(path.dirname(fs.realpathSync(exe))));}catch{version=null;}
  // 정션이 아니어서 폴더 이름으로 버전을 모르면 --version 출력에서 x.y.z.w를 읽는다(2026-11-20 독립 검토 Important 4).
  if(!version){const out=runVersion(exe),m=/(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(String(out||''));version=m?versionOf(m[1])||m[1]:null;}
  if(!version)return{found:true,supported:null,version:null};
  return{found:true,supported:compareVersion(version,minVersion)>=0,version};
 };
}
// 페이지 안에서만 실행되는 읽기 함수. 값을 바꾸거나 저장·이동하지 않는다. 확인하지 못한 값은 null.
async function readTargetState(a){
 const out={organizationId:null,role:null,loggedIn:null,unsaved:null};
 if(a.service==='desk'){
  let r=null;try{r=await fetch('/api/org',{credentials:'same-origin',cache:'no-store'});}catch(e){r=null;}
  if(r&&r.status===401)out.loggedIn=false;
  else if(r&&r.status===200&&!r.redirected){try{const j=await r.json();out.organizationId=typeof j.id==='string'&&j.id?j.id:null;out.role=j.me&&typeof j.me.role==='string'?j.me.role:null;out.loggedIn=true;}catch(e){out.loggedIn=null;}}
  try{const ev=new Event('beforeunload',{cancelable:true});window.dispatchEvent(ev);out.unsaved=ev.defaultPrevented===true;}catch(e){out.unsaved=null;}
  return out;
 }
 if(a.service==='lt'){
  let app=null;try{app=typeof nexacro==='undefined'?null:nexacro.getApplication();}catch(e){app=null;}
  const u=app&&app.gds_userInfo;
  try{if(u&&u.getRowCount()){const c=k=>String(u.getColumn(0,k)||'');out.organizationId=c('LTC_ADMIN_SYM')||c('ADMIN_SYM')||null;out.role=c('USER_TYPE')||null;}}catch(e){}
  let top=null;try{top=app.mainframe.VFrameSet.frameTop;}catch(e){top=null;}
  if(!top){try{top=app.mainframe.VFrameSet.HFrameSet.frameTop;}catch(e){top=null;}}
  /* 로그인 신호는 기존 롱텀 상태 확인(caremanager-rfid-check/scripts/lt-status.js)과 같은 fn_getRealDateTime 응답이다. 실제 화면에서의 판정은 첫 실제 사용 때 확인 항목. */
  if(top){try{out.loggedIn=/^\d{8,}/.test(String(top.form.fn_getRealDateTime()))?true:null;}catch(e){out.loggedIn=null;}}
  let fw=null;try{fw=app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;}catch(e){fw=null;}
  if(fw&&fw.frames&&typeof fw.frames.length==='number'){
   let dirty=false,readable=true;
   const changed=d=>{
    if(typeof d.getDeletedRowCount==='function'&&d.getDeletedRowCount()>0)return true;
    for(let k=0;k<d.getRowCount();k++){const t=d.getRowType(k);if(t===2||t===4||t===8)return true;}
    return false;
   };
   try{for(let i=0;i<fw.frames.length;i++){
    const f=fw.frames[i],objs=f&&f.form&&f.form.objects;if(!objs||typeof objs.length!=='number')continue;
    for(let j=0;j<objs.length;j++){
     const d=objs[j];if(!d||typeof d.getRowType!=='function'||typeof d.getRowCount!=='function')continue;
     // 실제 확인한 가정방문형 버튼 권한 표만 제외한다. 이름만 같거나 업무 열이 더 있으면 제외하지 않는다.
     const buttonCols=['SEQ','TYPE','BUTTON_ID','SCREEN_AUTH','USER_AUTH'];
     if(f.id==='winNPS01322100'&&d.id==='ds_functionButton'&&typeof d.getColCount==='function'&&typeof d.getColID==='function'
      &&d.getColCount()===buttonCols.length&&buttonCols.every((id,n)=>d.getColID(n)===id))continue;
     if(changed(d))dirty=true;
    }
    if(f.id==='winNPS01322100'){
     // 이 화면의 조회조건·코드·그리드 메타는 최초 열기부터 변경 상태다. 확인된 일지 업무 표만 추가 검사한다.
     const diary=f.form?._div_bizFrameMain?.form?.tab_SswCha?.tabpage1?.form;
     for(const id of ['ds_tbnpsb40','ds_temp','ds_hist']){
      const d=diary&&diary[id];
      if(!d||typeof d.getRowCount!=='function'||typeof d.getRowType!=='function')throw Error('DIARY_DATASET_UNCONFIRMED');
      if(changed(d))dirty=true;
     }
    }
   }}catch(e){readable=false;}
   out.unsaved=readable?dirty:null;
  }
  return out;
 }
 return out;
}
function pageSource(targetId,service){
 return 'const __t=(await listBrowserTabs()).find(x=>x.targetId==='+JSON.stringify(targetId)+');\n'
  +'if(!__t){console.log(\'WN_RESULT:\'+JSON.stringify({ok:false,missing:true}));}\n'
  +'else{await attachBrowserTab(__t.targetId);const __s=await page.evaluate('+readTargetState.toString()+',{service:'+JSON.stringify(service)+'});console.log(\'WN_RESULT:\'+JSON.stringify({ok:true,state:__s}));}\n';
}
const pick=(v,ok)=>ok(v)?v:null;
function inspector({scope,transport=runAside,env=process.env,timeoutMs=30000}={}){
 return{async inspect(targetId){
  const target=scope&&Array.isArray(scope.targets)?scope.targets.find(t=>t.targetId===targetId):null;
  if(!target)return{state:'missing'};
  const r=await transport(pageSource(targetId,target.service),{scope:{...scope,targets:[target]},reportGuardErrors:true,writeAttempted:false,openTabs:[],timeoutMs,env});
  if(r&&r.browserGuardError==='BOUND_TAB_MISSING'||r&&r.missing===true)return{state:'missing'};
  if(r&&typeof r.browserGuardError==='string')return{state:'unknown',guardCode:CODE.test(r.browserGuardError)?r.browserGuardError:'BROWSER_GUARD_REJECTED'};
  const s=r&&r.ok===true&&r.state&&typeof r.state==='object'?r.state:null;
  if(!s)return{state:'unknown'};
  const str=v=>typeof v==='string'&&v.length>0&&v.length<=100,bool=v=>typeof v==='boolean';
  return{state:'ok',organizationId:pick(s.organizationId,str),role:pick(s.role,str),loggedIn:pick(s.loggedIn,bool),unsaved:pick(s.unsaved,bool)};
 }};
}
// guard가 남긴 거절 코드도 함께 보여 준다(진단 판정은 checkTaskEnvironment 그대로).
async function liveDoctor({context,scope,task,transport=runAside,cliProbe:probe=cliProbe(),ownedLeaseId,env=process.env}){
 const base=inspector({scope,transport,env}),targets=[];
 const bridge={async inspect(targetId){const r=await base.inspect(targetId);const t=scope.targets.find(x=>x.targetId===targetId);targets.push({service:t?t.service:null,targetId,state:r.state,...(r.guardCode?{guardCode:r.guardCode}:{})});return r;}};
 const report=await checkTaskEnvironment({context,scope,task,bridge,cliProbe:probe,ownedLeaseId});
 return{...report,targets};
}
async function doctorTask({root,taskId,transport=runAside,cliProbe:probe,env=process.env}){
 const task=TASKS[taskId];if(!task){throw Object.assign(Error('TASK_UNSUPPORTED'),{code:'TASK_UNSUPPORTED'});}
 const context=C.loadContext(root);let scope=null;try{scope=loadScope(root).scope;}catch{scope=null;}
 const r=await liveDoctor({context,scope,task,transport,cliProbe:probe||cliProbe({env}),ownedLeaseId:undefined,env});
 return{...r,realSiteWritesVerified:false};
}
module.exports={TASKS,MIN_VERSION,cliProbe,inspector,liveDoctor,doctorTask,readTargetState};
