'use strict';
// Opening a new evaluation input screen through the site's own normal UI controls (search, new input, plan popup).
// Synthetic form only; nothing here calls a write service.
const test=require('node:test'),assert=require('node:assert/strict');
const {openEvaluationPage}=require('./native-open.cjs');
class Dataset{
 constructor(id){this.id=id;this.rows=[];this.columns=[];this.rowposition=0;}
 getRowCount(){return this.rows.length;}getColCount(){return this.columns.length;}getColID(i){return this.columns[i];}getColumn(i,k){return this.rows[i]?.[k];}getColumnInfo(k){return this.columns.includes(k);}
 addColumn(k){if(!this.columns.includes(k))this.columns.push(k);}addRow(){this.rows.push({});return this.rows.length-1;}setColumn(i,k,v){this.addColumn(k);this.rows[i][k]=v;}set_rowposition(i){this.rowposition=i;}clearData(){this.rows=[];}
}
const ds=(id,rows)=>{const d=new Dataset(id);d.rows=structuredClone(rows);d.columns=[...new Set(rows.flatMap(Object.keys))];return d;};
const CTX={orgId:'SYNTHETIC-ORG',workerId:'SYNTHETIC-WORKER',workerName:'가상작성자',recipientId:'NO-1|102',recognitionNo:'NO-1',recognitionSeq:'102',planId:'PLAN-B',serviceCode:'001'};
function fixture(t,{roster,plans}={}){
 const oldWindow=global.window;global.window={};t.after(()=>{if(oldWindow===undefined)delete global.window;else global.window=oldWindow;});
 const original=global.nexacro;t.after(()=>{if(original===undefined)delete global.nexacro;else global.nexacro=original;});
 const people=roster||[{PRS_NM:'가상대상',LTC_MGMT_NO:'NO-1',LTC_MGMT_NO_SEQ:'102',LTCP_CLSFC_CD:'001'},{PRS_NM:'가상대상',LTC_MGMT_NO:'NO-OTHER',LTC_MGMT_NO_SEQ:'101',LTCP_CLSFC_CD:'001'}];
 const planRows=plans||[{POF_PLNPP_MGMT_NO:'PLAN-A',LTC_MGMT_NO:'NO-1',LTC_MGMT_NO_SEQ:'102',UTIL_PLNPP_SEQ_NO:'001',PRS_NM:'가상대상',ADPT_FR_DT:'20250101',ADPT_TO_DT:'20251231',CHK:'0'},{POF_PLNPP_MGMT_NO:'PLAN-B',LTC_MGMT_NO:'NO-1',LTC_MGMT_NO_SEQ:'102',UTIL_PLNPP_SEQ_NO:'001',PRS_NM:'가상대상',ADPT_FR_DT:'20260101',ADPT_TO_DT:'20261231',CHK:'0'}];
 const popups=[],log={writes:0,searches:0,inserts:0,choices:0,serviceCalls:[]};
 const d={ds_cond:ds('dcond',[{}]),ds_tbnpsb80:ds('basic',[]),ds_tbnpsb81:ds('goals',[]),ds_tbnpsb82:ds('states',[]),fv_sInDivCd:'',enable:true};
 d.btn_prsPop={};
 d.btn_prsPop_onclick=()=>{const form={edt_prsNm:{value:'가상대상'},ds_tbnpba50:ds('plans',stuckPlans?[]:planRows),btn_close:{},btn_choice:{}};
  const frame={id:'npsb800p02',form:{_div_bizFrameMain:{form}}};
  form.btn_close_onclick=()=>{const i=popups.indexOf(frame);if(i>=0)popups.splice(i,1);};
  form.btn_choice_onclick=()=>{log.choices++;const chosen=form.ds_tbnpba50.rows.filter(r=>r.CHK==='1');if(chosen.length!==1)return;if(stuckClose)return;
   const c=chosen[0];d.ds_tbnpsb80.rows=[{LTC_MGMT_NO:c.LTC_MGMT_NO,LTC_MGMT_NO_SEQ:c.LTC_MGMT_NO_SEQ,POF_PLNPP_MGMT_NO:c.POF_PLNPP_MGMT_NO,UTIL_PLNPP_SEQ_NO:c.UTIL_PLNPP_SEQ_NO,PRS_NM:c.PRS_NM,ADPT_FR_DT:c.ADPT_FR_DT,ADPT_TO_DT:c.ADPT_TO_DT,WRT_DT:'20261106',POF_VLT_CHASU:'',RSLT_VLT_DESC:''}];d.ds_tbnpsb80.columns=Object.keys(d.ds_tbnpsb80.rows[0]);
   d.ds_tbnpsb81.rows=[{NSST_CONTN_GROUP_NM:'세면'}];d.ds_tbnpsb81.columns=['NSST_CONTN_GROUP_NM'];form.btn_close_onclick();};
  popups.push(frame);};
 let stuckPlans=false,stuckClose=false,draft='',searchHook=null;
 const f={fv_sInDivCd:draft,ds_cond:ds('cond',[{LTC_MGMT_NO:'STALE-NO',FNM:'',LTCP_CLSFC_CD:'001'}]),ds_prsList:ds('prs',[]),ds_tbnpsb80:ds('list',[]),chk_TotalSchYn:{value:false},btn_search:{},div_pofRsltVltDtl:{form:d,enable:true}};
 f.btn_search_onclick=()=>{log.searches++;const c=f.ds_cond.rows[0];f.ds_prsList.rows=people.filter(p=>(!c.FNM||p.PRS_NM===c.FNM)&&(!c.LTC_MGMT_NO||p.LTC_MGMT_NO===c.LTC_MGMT_NO));f.ds_prsList.columns=['PRS_NM','LTC_MGMT_NO','LTC_MGMT_NO_SEQ','LTCP_CLSFC_CD'];f.ds_prsList.rowposition=0;};
 f.fn_preSelectPofRsltVltList=()=>{const r=f.ds_prsList.rows[f.ds_prsList.rowposition];f.fv_sLtcMgmtNo=r.LTC_MGMT_NO;f.fv_sLtcMgmtNoSeq=r.LTC_MGMT_NO_SEQ;f.ds_cond.setColumn(0,'LTC_MGMT_NO',r.LTC_MGMT_NO);return true;};
 f.fn_selectPofRsltVltList=()=>{log.serviceCalls.push('selectPofRsltVltList');};
 f.fn_insert=()=>{log.inserts++;f.fv_sInDivCd='INSERT';d.fv_sInDivCd='INSERT';d.ds_tbnpsb80.rows=[{WRT_DT:'20261106',PRS_NM:'가상대상'}];d.ds_tbnpsb80.columns=['WRT_DT','PRS_NM'];};
 f.gfn_callService=()=>{log.writes++;};
 const frame={form:{_div_bizFrameMain:{form:f}}},user=ds('user',[{USER_TYPE:'20L',USER_ID:CTX.workerId,LTC_ADMIN_SYM:CTX.orgId}]);
 global.nexacro={Dataset,getPopupFrames:()=>popups,getApplication:()=>({gds_userInfo:user,mainframe:{VFrameSet:{HFrameSet:{VFrameSetSub:{framesetWork:{winNPS01230000:frame}}}}}})};
 return{f,d,popups,log,setDraft:v=>{f.fv_sInDivCd=v;},stuckClose:()=>{stuckClose=true;},stuckPlans:()=>{stuckPlans=true;},user};
}
const request=over=>({action:'open-new',context:CTX,recipientName:'가상대상',...over});
test('a new evaluation screen is opened through search, new input and the plan popup with the exact plan',async t=>{
 const x=fixture(t);const r=await openEvaluationPage(request());
 assert.equal(r.ok,true,r.code);assert.equal(r.mode,'INSERT');assert.equal(r.plan.planId,'PLAN-B');assert.deepEqual(r.plan.period,{from:'2026-01-01',to:'2026-12-31'});assert.equal(r.goalCount,1);
 assert.equal(x.log.writes,0);assert.equal(x.log.inserts,1);assert.equal(x.popups.length,0);assert.equal(x.f.ds_prsList.getRowCount(),2);assert.equal(x.f.ds_prsList.rowposition,0);
 assert.equal(x.f.ds_cond.rows[0].FNM,'가상대상');assert.equal(x.f.ds_cond.rows[0].LTC_MGMT_NO,'NO-1');
});
test('a stale recognition number left in the search condition cannot hide the recipient and the same-name other recipient is never chosen',async t=>{
 const x=fixture(t);const r=await openEvaluationPage(request());assert.equal(r.ok,true,r.code);
 assert.equal(x.d.ds_tbnpsb80.rows[0].LTC_MGMT_NO,'NO-1');assert.equal(x.d.ds_tbnpsb80.rows[0].LTC_MGMT_NO_SEQ,'102');
 const y=fixture(t,{roster:[{PRS_NM:'가상대상',LTC_MGMT_NO:'NO-OTHER',LTC_MGMT_NO_SEQ:'101',LTCP_CLSFC_CD:'001'}]});
 const miss=await openEvaluationPage(request());assert.equal(miss.ok,false);assert.equal(miss.code,'OPEN_TARGET_NOT_FOUND');assert.equal(y.log.inserts,0);
});
test('an existing draft or opened detail is never discarded',async t=>{
 const x=fixture(t);x.setDraft('INSERT');const r=await openEvaluationPage(request());assert.equal(r.ok,false);assert.equal(r.code,'OPEN_EVALUATION_DRAFT_IN_PROGRESS');assert.equal(x.log.searches,0);assert.equal(x.log.inserts,0);
 const y=fixture(t);y.popups.push({id:'foreign',form:{}});const p=await openEvaluationPage(request());assert.equal(p.ok,false);assert.equal(p.code,'OPEN_POPUP_ALREADY_OPEN');assert.equal(y.log.searches,0);
});
test('the plan popup chooses only the exact plan and fails on an unknown or unavailable plan',async t=>{
 const x=fixture(t);const r=await openEvaluationPage(request({context:{...CTX,planId:'PLAN-UNKNOWN'}}));assert.equal(r.ok,false);assert.equal(r.code,'OPEN_PLAN_NOT_FOUND');assert.equal(x.popups.length,0);assert.equal(x.log.choices,0);
 const y=fixture(t);y.stuckPlans();const e=await openEvaluationPage(request());assert.equal(e.ok,false);assert.equal(e.code,'OPEN_PLAN_POPUP_EMPTY');assert.equal(y.popups.length,0);
});
test('a plan popup that does not close is reported as pending instead of continuing',async t=>{
 const x=fixture(t);x.stuckClose();const r=await openEvaluationPage(request());assert.equal(r.ok,false);assert.equal(r.code,'OPEN_PLAN_POPUP_CLOSE_UNCONFIRMED');assert.equal(r.pending,true);assert.equal(x.log.writes,0);
});
test('updating or reopening an existing evaluation is not automated and other roles or services are rejected',async t=>{
 const x=fixture(t);const u=await openEvaluationPage(request({action:'open-existing'}));assert.equal(u.ok,false);assert.equal(u.code,'OPEN_ACTION_UNSUPPORTED');
 x.user.rows[0].USER_TYPE='20A';await assert.rejects(openEvaluationPage(request()),/WORKER_LOGIN/);x.user.rows[0].USER_TYPE='20L';
 const s=await openEvaluationPage(request({context:{...CTX,serviceCode:'002'}}));assert.equal(s.ok,false);assert.equal(s.code,'OPEN_SERVICE_UNSUPPORTED');
 const n=await openEvaluationPage(request({recipientName:''}));assert.equal(n.ok,false);assert.equal(n.code,'OPEN_RECIPIENT_NAME_REQUIRED');
});

const {openMenuPage}=require('./native-open.cjs');
function menuFixture(t,{role='20L',frames={}}={}){
 const original=global.nexacro;t.after(()=>{if(original===undefined)delete global.nexacro;else global.nexacro=original;});
 const user=ds('user',[{USER_TYPE:role,USER_ID:'U',LTC_ADMIN_SYM:CTX.orgId}]),work={...frames},opened=[];
 const top={form:{fn_menuOpen:id=>{opened.push(id);work['win'+id]={form:{}};}}};
 global.nexacro={Dataset,getPopupFrames:()=>[],getApplication:()=>({gds_userInfo:user,mainframe:{VFrameSet:{frameTop:top,HFrameSet:{VFrameSetSub:{framesetWork:work}}}}})};
 return{opened,work};
}
test('only the allowed menus of the matching role are opened and an open menu is left untouched',async t=>{
 const x=menuFixture(t);const r=await openMenuPage({context:CTX,menuId:'NPS01322100'});assert.equal(r.ok,true,r.code);assert.deepEqual(x.opened,['NPS01322100']);
 const again=await openMenuPage({context:CTX,menuId:'NPS01322100'});assert.equal(again.ok,true);assert.equal(again.alreadyOpen,true);assert.equal(x.opened.length,1);
 const bad=await openMenuPage({context:CTX,menuId:'NPS01230001'});assert.equal(bad.ok,false);assert.equal(bad.code,'OPEN_MENU_NOT_ALLOWED');assert.equal(x.opened.length,1);
 const wrong=await openMenuPage({context:CTX,menuId:'np00000000097'});assert.equal(wrong.ok,false);assert.equal(wrong.code,'OPEN_MENU_NOT_ALLOWED');
});
test('the institution RFID menu opens only for the institution login',async t=>{
 const x=menuFixture(t,{role:'20A'});const r=await openMenuPage({context:CTX,menuId:'np00000000097'});assert.equal(r.ok,true,r.code);assert.deepEqual(x.opened,['np00000000097']);
 const y=menuFixture(t,{role:'20A'});assert.equal((await openMenuPage({context:CTX,menuId:'NPS01230000'})).code,'OPEN_MENU_NOT_ALLOWED');assert.equal(y.opened.length,0);
 const z=menuFixture(t,{role:'20L'});assert.equal((await openMenuPage({context:CTX,menuId:'np00000000097'})).code,'OPEN_MENU_NOT_ALLOWED');
});

test('the plan may be omitted only when exactly one plan of the recipient exists and the chosen plan is reported',async t=>{
 const one=fixture(t,{plans:[{POF_PLNPP_MGMT_NO:'ONLY-PLAN',LTC_MGMT_NO:'NO-1',LTC_MGMT_NO_SEQ:'102',UTIL_PLNPP_SEQ_NO:'001',PRS_NM:'가상대상',ADPT_FR_DT:'20260101',ADPT_TO_DT:'20261231',CHK:'0'}]});
 const r=await openEvaluationPage(request({context:{...CTX,planId:''}}));assert.equal(r.ok,true,r.code);assert.equal(r.plan.planId,'ONLY-PLAN');assert.equal(one.log.writes,0);
 const two=fixture(t);const a=await openEvaluationPage(request({context:{...CTX,planId:''}}));assert.equal(a.ok,false);assert.equal(a.code,'OPEN_PLAN_AMBIGUOUS');assert.equal(two.popups.length,0);assert.equal(two.log.choices,0);
});

test('worker info the site left empty is filled from the logged-in worker status row before the new input starts',async t=>{
 const x=fixture(t);let seen=null;const original=x.f.fn_insert;
 x.f.ds_wkfcStusDtl=ds('wk',[{HIPIN:'OTHER',FNM:'다른사람',CLFY_CD:'01'},{HIPIN:CTX.workerId,FNM:CTX.workerName,QLF_NO:'Q-1',CLFY_CD:'03',CLFY_CD_NM:'3.사회복지사',EGGR_WKG_TP_NM:'전임',QLCT_CHWIDUK_DT:'20190731'}]);
 x.f.fn_insert=()=>{seen={fnm:x.f.fv_fnm,hipin:x.f.fv_hipin,clfy:x.f.fv_clfyCd};original();};
 const result=await openEvaluationPage(request());
 assert.equal(result.ok,true);assert.deepEqual(seen,{fnm:CTX.workerName,hipin:CTX.workerId,clfy:'03'});assert.equal(x.log.writes,0);
});
test('an empty worker status list is obtained through the normal read-only site flow',async t=>{
 const x=fixture(t);x.f.ds_wkfcStusDtl=ds('wk',[]);let calls=0;x.f.fn_preSelectWkfcStusDtl=()=>true;x.f.fn_selectWkfcStusDtl=()=>{calls++;x.f.ds_wkfcStusDtl=ds('wk',[{HIPIN:CTX.workerId,FNM:CTX.workerName,CLFY_CD:'03',CLFY_CD_NM:'3.사회복지사'}]);};
 const result=await openEvaluationPage(request());assert.equal(result.ok,true,result.code);assert.equal(calls,1);assert.equal(x.f.fv_fnm,CTX.workerName);assert.equal(x.log.writes,0);
});
test('a different logged-in worker stops before searching for a recipient',async t=>{
 const x=fixture(t);x.user.rows[0].USER_ID='OTHER';const r=await openEvaluationPage(request());assert.equal(r.ok,false);assert.equal(r.code,'OPEN_WORKER_ID_MISMATCH');assert.equal(x.log.searches,0);assert.equal(x.log.inserts,0);
});
test('opening stops before the new input when the logged-in worker status row cannot be found',async t=>{
 const x=fixture(t);x.f.ds_wkfcStusDtl=ds('wk',[{HIPIN:'OTHER',FNM:'다른사람',CLFY_CD:'01'}]);
 const result=await openEvaluationPage(request());
 assert.equal(result.ok,false);assert.equal(result.code,'OPEN_WORKER_INFO_UNAVAILABLE');assert.equal(x.log.inserts,0);
});

test('plan popup waits for its inner form without misclassifying a populated list as empty',async t=>{
 const x=fixture(t),open=x.d.btn_prsPop_onclick;
 x.d.btn_prsPop_onclick=function(...args){
  const result=open.apply(this,args),frame=x.popups.at(-1),inner=frame.form._div_bizFrameMain;
  delete frame.form._div_bizFrameMain;
  setTimeout(()=>{frame.form._div_bizFrameMain=inner;},10);
  return result;
 };
 const result=await openEvaluationPage(request());
 assert.equal(result.ok,true,result.code);assert.equal(result.plan.planId,CTX.planId);
 assert.equal(x.log.writes,0);assert.equal(x.log.inserts,1);assert.equal(x.popups.length,0);
});
