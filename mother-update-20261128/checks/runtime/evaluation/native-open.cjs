'use strict';
// Opens a NEW result-evaluation input screen exactly like the normal UI does: search the recipient by name,
// select the exact recognition number, press "new input", then choose the exact plan in the site's plan popup.
// Runs only inside the already open evaluation menu of the bound 20L worker tab. It never calls a save service,
// never discards an existing draft and never opens an existing evaluation (that stays a manual normal-UI step).
async function openEvaluationPage(p){
 const must=(v,c)=>{if(!v)throw Error(c);},str=v=>String(v??''),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const fail=(code,extra={})=>({ok:false,code,writes:0,...extra});
 const app=typeof nexacro!=='undefined'&&nexacro.getApplication();must(app?.gds_userInfo,'LOGIN_UNCONFIRMED');
 const user=k=>str(app.gds_userInfo.getColumn(0,k));must(user('USER_TYPE')==='20L'&&user('LTC_ADMIN_SYM')===p.context?.orgId,'WORKER_LOGIN_REQUIRED');
 if(p.action!=='open-new')return fail('OPEN_ACTION_UNSUPPORTED');
 const ctx=p.context;for(const k of ['recognitionNo','recognitionSeq','serviceCode'])must(typeof ctx[k]==='string'&&ctx[k],'OPEN_CONTEXT_REQUIRED:'+k);
 if(typeof ctx.workerId!=='string'||!ctx.workerId||user('USER_ID')!==ctx.workerId)return fail('OPEN_WORKER_ID_MISMATCH');
 if(ctx.serviceCode!=='001')return fail('OPEN_SERVICE_UNSUPPORTED');
 if(typeof p.recipientName!=='string'||!p.recipientName.trim())return fail('OPEN_RECIPIENT_NAME_REQUIRED');
 const frame=app.mainframe?.VFrameSet?.HFrameSet?.VFrameSetSub?.framesetWork?.winNPS01230000,f=frame?.form?._div_bizFrameMain?.form||frame?.form;
 must(f?.ds_cond&&f.ds_prsList&&typeof f.btn_search_onclick==='function'&&typeof f.fn_insert==='function','OPEN_EVALUATION_MENU_IN_NORMAL_UI');
 const popups=()=>Array.from(nexacro.getPopupFrames?.()||[]);
 if(f.fv_sInDivCd)return fail('OPEN_EVALUATION_DRAFT_IN_PROGRESS');
 if(popups().length)return fail('OPEN_POPUP_ALREADY_OPEN');
 if(f.chk_TotalSchYn&&f.chk_TotalSchYn.value===true)return fail('OPEN_TOTAL_SEARCH_CHECKED');
 const until=async(test,ms=10000,step=200)=>{for(let spent=0;spent<=ms;spent+=step){const value=test();if(value)return value;await wait(step);}return null;};
 const rows=ds=>Array.from({length:ds.getRowCount()},(_,i)=>Object.fromEntries(Array.from({length:ds.getColCount()},(_,j)=>{const k=ds.getColID(j);return[k,str(ds.getColumn(i,k))];})));
 // 1) search by name. A recognition number left in the condition by earlier work would hide the recipient, so it is cleared first.
 f.ds_cond.setColumn(0,'LTC_MGMT_NO','');f.ds_cond.setColumn(0,'LTC_MGMT_NO_SEQ','');f.ds_cond.setColumn(0,'FNM',p.recipientName.trim());
 f.ds_prsList.clearData?.();f.btn_search_onclick(f.btn_search,{});
 await until(()=>f.ds_prsList.getRowCount()>0,10000);
 const list=rows(f.ds_prsList),index=list.findIndex(r=>r.LTC_MGMT_NO===ctx.recognitionNo&&r.LTC_MGMT_NO_SEQ===ctx.recognitionSeq&&r.LTCP_CLSFC_CD===ctx.serviceCode);
 if(index<0||list.filter(r=>r.LTC_MGMT_NO===ctx.recognitionNo&&r.LTC_MGMT_NO_SEQ===ctx.recognitionSeq).length!==1)return fail('OPEN_TARGET_NOT_FOUND',{matches:list.length});
 // 2) select the exact row the way the grid does, then open the new input screen.
 f.ds_prsList.set_rowposition(index);must(f.fn_preSelectPofRsltVltList(),'OPEN_PRE_SELECT_REFUSED');
 // The site copies the logged-in worker's status row into fv_* only for one row layout; when it leaves them empty the author fields stay blank.
 // Fill them from the status row of exactly the logged-in worker (same ID as the login), and stop if that row cannot be found.
 if(f.ds_wkfcStusDtl&&!str(f.fv_fnm)){
  if(f.ds_wkfcStusDtl.getRowCount()===0&&typeof f.fn_preSelectWkfcStusDtl==='function'&&typeof f.fn_selectWkfcStusDtl==='function'){
   if(f.fn_preSelectWkfcStusDtl()!==true)return fail('OPEN_WORKER_QUERY_REFUSED');f.fn_selectWkfcStusDtl();
   if(!await until(()=>f.ds_wkfcStusDtl.getRowCount()>0,10000))return fail('OPEN_WORKER_QUERY_UNCONFIRMED',{pending:true});
  }
  const ws=f.ds_wkfcStusDtl,at=Array.from({length:ws.getRowCount()},(_,i)=>i).filter(i=>str(ws.getColumn(i,'HIPIN'))===user('USER_ID'));
  if(at.length!==1)return fail('OPEN_WORKER_INFO_UNAVAILABLE',{matches:at.length});
  if(str(ws.getColumn(at[0],'FNM'))!==ctx.workerName)return fail('OPEN_WORKER_NAME_MISMATCH');
  const g=k=>ws.getColumn(at[0],k);f.fv_hipin=g('HIPIN');f.fv_fnm=g('FNM');f.fv_qlfNo=g('QLF_NO');f.fv_clfyCd=g('CLFY_CD');f.fv_clfyCdNm=g('CLFY_CD_NM');f.fv_eggrWkgTpNm=g('EGGR_WKG_TP_NM');f.fv_qlctChwidukDt=g('QLCT_CHWIDUK_DT');
 }
 f.fn_insert();
 const detail=await until(()=>{const form=f.div_pofRsltVltDtl?.form;return form?.ds_tbnpsb80&&form.btn_prsPop_onclick&&f.fv_sInDivCd==='INSERT'&&form.ds_tbnpsb80.getRowCount()>=1?form:null;},12000);
 if(!detail)return fail('OPEN_NEW_INPUT_NOT_READY');
 // 3) plan popup: choose only the exact plan.
 // The site opens this popup modally, so the call may not return until the popup closes: start it asynchronously and poll for the popup.
 setTimeout(()=>{try{detail.btn_prsPop_onclick(detail.btn_prsPop,{});}catch(e){}},0);
 const popup=await until(()=>popups().find(x=>x.id==='npsb800p02'),10000);if(!popup)return fail('OPEN_PLAN_POPUP_NOT_OPENED');
 // The modal wrapper can exist before its business form is ready.
 // Resolve the live inner form on each poll rather than freezing the wrapper.
 let form=null;
 const resolveForm=()=>{const current=popup.form?._div_bizFrameMain?.form||popup.form;if(current?.ds_tbnpba50&&typeof current.btn_choice_onclick==='function')form=current;return form;};
 const closePopup=async()=>{const current=resolveForm();if(popups().includes(popup)&&typeof current?.btn_close_onclick==='function')current.btn_close_onclick(current.btn_close,{});return await until(()=>!popups().includes(popup),5000)!==null;};
 const plans=await until(()=>{const current=resolveForm();return current?.ds_tbnpba50.getRowCount()>0?current.ds_tbnpba50:null;},10000);
 if(!plans){const closed=await closePopup();return fail(form?'OPEN_PLAN_POPUP_EMPTY':'OPEN_PLAN_POPUP_NOT_READY',...(!closed?[{pending:true}]:[]));}
 const candidates=rows(plans).map((r,i)=>({r,i})).filter(x=>(!ctx.planId||x.r.POF_PLNPP_MGMT_NO===ctx.planId)&&x.r.LTC_MGMT_NO===ctx.recognitionNo&&x.r.LTC_MGMT_NO_SEQ===ctx.recognitionSeq);
 if(candidates.length!==1){await closePopup();return fail(candidates.length?'OPEN_PLAN_AMBIGUOUS':'OPEN_PLAN_NOT_FOUND',{plans:plans.getRowCount()});}
 for(let i=0;i<plans.getRowCount();i++)plans.setColumn(i,'CHK',i===candidates[0].i?'1':'0');
 form.btn_choice_onclick(form.btn_choice,{});
 const closed=await until(()=>!popups().includes(popup),8000)!==null;
 if(!closed){return fail('OPEN_PLAN_POPUP_CLOSE_UNCONFIRMED',{pending:true});}
 // 4) the screen must now show exactly the requested recipient and plan with its goals loaded.
 const b=detail.ds_tbnpsb80;
 const loaded=await until(()=>str(b.getColumn(0,'ADPT_FR_DT'))&&detail.ds_tbnpsb81&&detail.ds_tbnpsb81.getRowCount()>0?true:null,10000);
 if(!loaded)return fail('OPEN_PLAN_NOT_LOADED');
 const v=k=>str(b.getColumn(0,k)),iso=s=>/^\d{8}$/.test(s)?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6):s;
 if(v('LTC_MGMT_NO')!==ctx.recognitionNo||v('LTC_MGMT_NO_SEQ')!==ctx.recognitionSeq||(ctx.planId&&v('POF_PLNPP_MGMT_NO')!==ctx.planId))return fail('OPEN_LOADED_IDENTITY_MISMATCH');
 return{ok:true,mode:str(f.fv_sInDivCd),plan:{planId:v('POF_PLNPP_MGMT_NO'),utilSeq:v('UTIL_PLNPP_SEQ_NO'),period:{from:iso(v('ADPT_FR_DT')),to:iso(v('ADPT_TO_DT'))}},evaluationDate:iso(v('WRT_DT')),goalCount:detail.ds_tbnpsb81.getRowCount(),writes:0};
}

// Opens one of the few screens the evaluation work reads, with the site's own menu function, only for the matching login.
async function openMenuPage(p){
 const must=(v,c)=>{if(!v)throw Error(c);},str=v=>String(v??''),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const app=typeof nexacro!=='undefined'&&nexacro.getApplication();must(app?.gds_userInfo,'LOGIN_UNCONFIRMED');
 const user=k=>str(app.gds_userInfo.getColumn(0,k)),role=user('USER_TYPE');must(user('LTC_ADMIN_SYM')===p.context?.orgId,'WORKER_LOGIN_REQUIRED');
 const allowed={'20L':['NPS01230000','NPS01322100'],'20A':['np00000000097']};
 if(!(allowed[role]||[]).includes(p.menuId))return{ok:false,code:'OPEN_MENU_NOT_ALLOWED',writes:0};
 const hierarchy=app.mainframe?.VFrameSet,work=hierarchy?.HFrameSet?.VFrameSetSub?.framesetWork,top=hierarchy?.frameTop||hierarchy?.HFrameSet?.frameTop;
 if(work?.['win'+p.menuId])return{ok:true,alreadyOpen:true,menuId:p.menuId,writes:0};
 must(top?.form&&typeof top.form.fn_menuOpen==='function','OPEN_MENU_FUNCTION_UNAVAILABLE');
 top.form.fn_menuOpen(p.menuId);
 for(let spent=0;spent<=12000;spent+=250){if(work?.['win'+p.menuId]?.form)return{ok:true,alreadyOpen:false,menuId:p.menuId,writes:0};await wait(250);}
 return{ok:false,code:'OPEN_MENU_NOT_READY',writes:0};
}
module.exports={openEvaluationPage,openMenuPage};
