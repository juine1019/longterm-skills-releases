'use strict';
// Runs only inside the exact, already-open evaluation frame; no target reset or guessed navigation.
async function evaluationPage(p){
 const must=(v,c)=>{if(!v)throw Error(c);},app=typeof nexacro!=='undefined'&&nexacro.getApplication();must(app?.gds_userInfo,'LOGIN_UNCONFIRMED');
 const user=k=>String(app.gds_userInfo.getColumn(0,k)||''),frame=app.mainframe?.VFrameSet?.HFrameSet?.VFrameSetSub?.framesetWork?.winNPS01230000;
 const f=frame?.form?._div_bizFrameMain?.form||frame?.form,d=f?.div_pofRsltVltDtl?.form;must(f&&d,'OPEN_EXACT_EVALUATION_IN_NORMAL_UI');
 const val=(ds,i,k)=>String(ds.getColumn(i,k)??''),rows=ds=>Array.from({length:ds.getRowCount()},(_,i)=>Object.fromEntries(Array.from({length:ds.getColCount()},(_,j)=>{const k=ds.getColID(j);return[k,val(ds,i,k)];})));
 const basics=d.ds_tbnpsb80,goals=d.ds_tbnpsb81,states=d.ds_tbnpsb82;must(basics?.getRowCount()===1&&goals&&states,'EVALUATION_DETAIL_NOT_READY');
 const b=rows(basics)[0],context={orgId:user('LTC_ADMIN_SYM')||user('ADMIN_SYM'),workerId:user('USER_ID'),workerName:String(f.fv_fnm||''),recipientId:b.LTC_MGMT_NO+'|'+b.LTC_MGMT_NO_SEQ,recognitionNo:b.LTC_MGMT_NO,recognitionSeq:b.LTC_MGMT_NO_SEQ,planId:b.POF_PLNPP_MGMT_NO,serviceCode:'001'};
 must(user('USER_TYPE')==='20L'&&context.workerName,'WORKER_LOGIN_REQUIRED');for(const[k,v]of Object.entries(p.context||{}))must(context[k]===v,'CONTEXT_CHANGED:'+k);
 const watched=[f.ds_cond,f.ds_prsList,f.ds_tbnpsb80,d.ds_cond,basics,goals,states].filter(Boolean);
 const raw=()=>JSON.stringify({context,mode:f.fv_sInDivCd,detailMode:d.fv_sInDivCd,data:watched.map(ds=>[ds.saveXML(),ds.rowposition])});
 const before=raw(),readSessions=window.__longtermEvaluationReadSessions||(window.__longtermEvaluationReadSessions=new Map());
 if(['check-read','close-read'].includes(p.action)){
  const state=readSessions.get(p.readSessionId);if(!state)return{ok:true,found:false,pending:[...readSessions.values()].some(r=>!r.finished||r.pending.size>0),contextMatched:true,screenPreserved:null};
  must(state.context===JSON.stringify(context),'READ_SESSION_CONTEXT_CHANGED');const result={ok:true,found:true,pending:!state.finished||state.pending.size>0,contextMatched:true,screenPreserved:state.before===before};
  if(p.action==='close-read'){must(!result.pending,'READ_STILL_PENDING');state.cleanup();readSessions.delete(p.readSessionId);}return result;
 }
 const tabs=d.tab_sub,controls=[],labels=[],overallControl=tabs?.tpage1?.form?.txt_ovrOpin,roundControl=d.edt_pofVltChasu,v2=!!(overallControl&&roundControl);
 for(const[index,tab]of [tabs?.tpage2,tabs?.tpage3].entries()){
  must(tab?.form,'UNSUPPORTED_DETAIL_TABS');for(const control of Array.from(tab.form.components||[])){
   const name=String(control.id||control.name||''),key=name.replace(/^(?:cbx|txt)_/,'');
   if(/^Static/.test(control._type_name||''))labels.push({tab:index+2,text:String(control.text||''),left:control.getOffsetLeft(),top:control.getOffsetTop()});
   if(/^(?:cbx|txt)_[XZ]\d+$/.test(name)&&key!=='X9900'){const edit=v2&&name.startsWith('cbx_')?tab.form['edt_'+key]:null;controls.push({key,kind:name.startsWith('cbx_')?'checkbox':'text',tab:index+2,left:control.getOffsetLeft(),top:control.getOffsetTop(),maxLength:edit?(Number(edit.maxlength)>0?Math.min(500,Number(edit.maxlength)):20):Number(control.maxlength)>0?Math.min(500,Number(control.maxlength)):500,label:name.startsWith('cbx_')?String(control.text||''):'',...(edit?{reason:{control:'edt_'+key}}:{})});}
  }
 }
 const goalKeys=rows(goals).map(r=>r.NSST_CONTN_GROUP_NM);must(goalKeys.length&&new Set(goalKeys).size===goalKeys.length,'DUPLICATE_OR_MISSING_GOAL_KEYS');must(new Set(controls.map(c=>c.key)).size===controls.length,'DUPLICATE_STATE_KEYS');
 const structure={nativeVersion:v2?'npsb800-20l-v2':'npsb800-20l-v1',goalKeys,stateKeys:controls.map(c=>c.key).sort(),goalTextMax:200,summaryMax:500,...(v2?{overallMax:Number(overallControl.maxlength)>0?Math.min(2000,Number(overallControl.maxlength)):2000,roundControl:'edt_pofVltChasu',reasonKeys:controls.filter(c=>c.reason).map(c=>c.key).sort()}:{}),stateTextMax:Object.fromEntries(controls.map(c=>[c.key,c.maxLength])),controls:controls.sort((a,b)=>a.key.localeCompare(b.key)),labels,basicColumns:Array.from({length:basics.getColCount()},(_,i)=>basics.getColID(i)).sort(),goalColumns:Array.from({length:goals.getColCount()},(_,i)=>goals.getColID(i)).sort(),stateColumns:Array.from({length:states.getColCount()},(_,i)=>states.getColID(i)).sort()};
 const iso=s=>/^\d{8}$/.test(s)?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6):s;
 function values(basicRows,goalRows,stateRows){
  must(basicRows.length===1,'EXACT_BASIC_ROW_REQUIRED');const basic=basicRows[0],stateMap=new Map(stateRows.map(r=>[r.DSRE_ITEM_CD_PTTN+r.DSRE_ITEM_CD,r]));must(stateMap.size===stateRows.length,'DUPLICATE_SERVER_STATE');
  must([...stateMap.keys()].every(k=>k==='X9900'||controls.some(c=>c.key===k)),'UNSUPPORTED_STATE_ROW');
  must(goalRows.every(g=>!g[g.NSST_CONTN_OFFR_YN==='1'?'NSST_CONTN_NOT_OFFR_RSN':'NSST_CONTN_OFFR_CFR_CONTN']),'UNEXPECTED_OPPOSITE_PROVISION_TEXT');
  return{context,evaluationDate:iso(basic.WRT_DT),period:{from:iso(basic.ADPT_FR_DT),to:iso(basic.ADPT_TO_DT)},evaluationKind:basic.POF_VLT_KIND_CD,goals:goalRows.map(g=>{must(['1','0'].includes(g.NSST_CONTN_OFFR_YN),'PROVISION_CODE_CHANGED');return{key:g.NSST_CONTN_GROUP_NM,provided:g.NSST_CONTN_OFFR_YN==='1',text:g[g.NSST_CONTN_OFFR_YN==='1'?'NSST_CONTN_OFFR_CFR_CONTN':'NSST_CONTN_NOT_OFFR_RSN']||''};}).sort((a,b)=>a.key.localeCompare(b.key)),observations:controls.map(c=>{const r=stateMap.get(c.key);return{key:c.key,selected:c.kind==='checkbox'&&r?.DSRE_ITEM_CHOICE_YN==='Y',text:c.kind==='text'||c.reason?(r?.ETC_CONTN||''):''};}).sort((a,b)=>a.key.localeCompare(b.key)),summary:v2?(stateMap.get('X9900')?.ETC_CONTN||''):(basic.RSLT_VLT_DESC||''),...(v2?{evaluationRound:basic.POF_VLT_CHASU||'',overallComment:basic.RSLT_VLT_DESC||''}:{})};
 }
 const dirty=()=>[basics,goals,states].some(ds=>(typeof ds.getDeletedRowCount==='function'&&ds.getDeletedRowCount()>0)||Array.from({length:ds.getRowCount()},(_,i)=>ds.getRowType(i)).some(t=>[2,4,8].includes(t)));
 const snapshot=()=>({context,structure,raw:raw(),values:values(rows(basics),rows(goals),rows(states)),mode:f.fv_sInDivCd,detailMode:d.fv_sInDivCd,dirty:dirty(),evaluationId:val(basics,0,'POF_PLNPP_VLT_SEQ'),evaluationDateEnabled:d.cal_wrtDt?.enable,saveTimeText:String(d.stc_saveTm?.text||'')});
 if(p.action==='inspect'){
  const result=snapshot();
  if(p.includeRecipientProfile===true){
   result.recipientProfile={sexCode:b.SEX||'',birthDate:b.BDAY||'',gradeCode:b.LTC_RCGT_GRADE_CD||''};
  }
  return result;
 }
 if(p.action==='read-server'){
  must(![...readSessions.values()].some(state=>!state.finished||state.pending.size),'PRIOR_NATIVE_READ_STILL_PENDING');
  must(p.readSessionId===undefined||typeof p.readSessionId==='string'&&/^[a-zA-Z0-9-]{10,80}$/.test(p.readSessionId),'READ_SESSION_ID_INVALID');
  const prefix='_ltEvalRead'+(p.readSessionId?.replaceAll('-','')||Date.now()+Math.random().toString(16).slice(2)),owned=[],callbacks=[],readId=p.readSessionId||prefix;
  must(!readSessions.has(readId),'READ_SESSION_ALREADY_USED');const state={context:JSON.stringify(context),before,pending:new Set(),finished:false,cleaned:false};
  const cleanup=()=>{if(state.cleaned)return;for(const cb of callbacks)delete f[cb];for(const id of owned.reverse()){const ds=f.removeChild(id);ds?.destroy();}state.cleaned=true;};state.cleanup=cleanup;readSessions.set(readId,state);
  const guard=()=>{must(user('USER_TYPE')==='20L'&&raw()===before,'SCREEN_CHANGED_DURING_READ');};
  const make=(name,source)=>{const ds=new nexacro.Dataset(prefix+name,f);ds.assign(source);f.addChild(ds.id,ds);owned.push(ds.id);return ds;};
  const set=(ds,k,v)=>{if(!ds.getColumnInfo(k))ds.addColumn(k,'STRING',256);if(!ds.getRowCount())ds.addRow();ds.setColumn(0,k,v);};
  const query=(url,input,outputs)=>new Promise((resolve,reject)=>{guard();must(typeof f.gfn_callService==='function','READ_SERVICE_UNAVAILABLE');const cb=prefix+'Cb'+callbacks.length;callbacks.push(cb);state.pending.add(cb);let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('READ_TIMEOUT_PENDING'));}},15000);f[cb]=(id,code)=>{state.pending.delete(cb);clearTimeout(timer);if(!done){done=true;try{must(code===0||code==='0','READ_FAILED');guard();resolve();}catch(e){reject(e);}}if(state.finished&&!state.pending.size){cleanup();readSessions.delete(readId);}};for(const[ds]of outputs)ds.clearData();try{f.gfn_callService(prefix+callbacks.length,url,'ds_cond='+input.id,outputs.map(([ds,name])=>ds.id+'='+name).join(' '),'',[],cb,true,false);}catch(e){done=true;clearTimeout(timer);reject(e);}});
  try{
   // The list's search range overlaps the evaluation PERIOD (not the evaluation day), so a single-day range misses periods that ended before the evaluation date.
   const dayOf=v=>String(v||'').replaceAll('-',''),evalDay=dayOf(p.evaluationDate),periodFrom=/^\d{8}$/.test(dayOf(p.period?.from))?dayOf(p.period.from):evalDay,periodTo=/^\d{8}$/.test(dayOf(p.period?.to))?dayOf(p.period.to):evalDay,searchFrom=[periodFrom,evalDay].sort()[0],searchTo=[periodTo,evalDay].sort().at(-1);
   const ci=make('Ci',f.ds_cond),list=make('List',f.ds_tbnpsb80);for(const[k,v]of Object.entries({LTC_ADMIN_SYM:context.orgId,LTC_MGMT_NO:context.recognitionNo,LTC_MGMT_NO_SEQ:context.recognitionSeq,FNM:b.PRS_NM,LTCP_CLSFC_CD:context.serviceCode,VLT_DT_FR:p.evaluationDate.replaceAll('-',''),VLT_DT_TO:p.evaluationDate.replaceAll('-',''),SRCH_FR_DT:searchFrom,SRCH_TO_DT:searchTo,WRTR_NM:'',POF_VLT_KIND_CD:'',PRETN_YN:'',WRTCST_YN:''}))set(ci,k,v);
   await query('/s/b/800/selectPofRsltVltList.do',ci,[[list,'ds_tbnpsb80']]);
   const matches=rows(list).filter(r=>r.LTC_MGMT_NO===context.recognitionNo&&r.LTC_MGMT_NO_SEQ===context.recognitionSeq&&r.POF_PLNPP_MGMT_NO===context.planId&&iso(r.WRT_DT)===p.evaluationDate);
   if(matches.length!==1)return{status:'complete',records:matches.map(r=>({evaluationId:r.POF_PLNPP_VLT_SEQ})),screenPreserved:true};
   const record=matches[0],input=make('Di',d.ds_cond),o80=make('O80',basics),o81=make('O81',goals),o82=make('O82',states);for(const k of ['LTC_ADMIN_SYM','LTC_MGMT_NO','LTC_MGMT_NO_SEQ','POF_PLNPP_MGMT_NO','UTIL_PLNPP_SEQ_NO','POF_PLNPP_VLT_SEQ'])set(input,k,record[k]);
   await query('/s/b/800/selectPofRsltVltDetail.do',input,[[o80,'ds_tbnpsb80'],[o81,'ds_tbnpsb81'],[o82,'ds_tbnpsb82']]);const detail=rows(o80);must(detail.length===1&&detail[0].LTC_MGMT_NO===context.recognitionNo&&detail[0].LTC_MGMT_NO_SEQ===context.recognitionSeq&&detail[0].POF_PLNPP_MGMT_NO===context.planId&&detail[0].POF_PLNPP_VLT_SEQ===record.POF_PLNPP_VLT_SEQ,'SERVER_DETAIL_IDENTITY_CHANGED');guard();
   return{status:'complete',records:[{evaluationId:record.POF_PLNPP_VLT_SEQ,submitted:record.PRETN_YN==='N'?false:record.PRETN_YN==='Y'?true:null,savedAt:detail[0].SYS_CHG_DTTM||detail[0].SYS_UPDT_DTTM||record.SYS_CHG_DTTM||record.SYS_UPDT_DTTM||detail[0].SYS_REG_DTTM||record.SYS_REG_DTTM||'',values:values(detail,rows(o81),rows(o82))}],screenPreserved:true};
  }catch(e){state.failed=true;return{status:'unconfirmed',code:e.message,pending:state.pending.size>0,readSessionId:readId,screenPreserved:raw()===before};}
  finally{state.finished=true;if(!state.pending.size){cleanup();readSessions.delete(readId);}}
 }
 must(p.expectedRaw===before,'USER_EDIT_OR_FRAME_CHANGED');
 if(p.action==='save-button'){const button=frame.form.div_functionButton?.form?.btn_save;must(button&&button.enable!==false&&typeof d.fn_preSavePofRsltVlt==='function','NORMAL_SAVE_BUTTON_UNSUPPORTED');const id=button.getElement()?.handle?.id;must(typeof id==='string'&&id,'SAVE_BUTTON_DOM_MISSING');return{buttonId:id};}
 if(p.action==='fill'){
  const spec=p.spec;must(spec&&(spec.operation==='create'?f.fv_sInDivCd==='INSERT':f.fv_sInDivCd==='UPDATE'&&b.POF_PLNPP_VLT_SEQ===spec.evaluationId),'DRAFT_OPERATION_CHANGED');
  if(spec.operation==='update')must(iso(b.WRT_DT)===spec.evaluationDate,'SAVED_DATE_IMMUTABLE');
  for(const[k,v]of Object.entries({ADPT_FR_DT:spec.period.from.replaceAll('-',''),ADPT_TO_DT:spec.period.to.replaceAll('-',''),WRT_DT:spec.evaluationDate.replaceAll('-',''),POF_VLT_KIND_CD:spec.evaluationKind}))basics.setColumn(0,k,v);
  if(v2){must(typeof spec.evaluationRound==='string'&&spec.evaluationRound&&spec.overallComment,'V2_SPEC_REQUIRED');const e={prevalue:roundControl.value||'',postvalue:spec.evaluationRound};roundControl.set_value(spec.evaluationRound);if(typeof d.edt_pofVltChasu_onchanged==='function')d.edt_pofVltChasu_onchanged(roundControl,e);if(val(basics,0,'POF_VLT_CHASU')!==spec.evaluationRound)basics.setColumn(0,'POF_VLT_CHASU',spec.evaluationRound);must(val(basics,0,'POF_VLT_CHASU')===spec.evaluationRound,'ROUND_BINDING_MISMATCH');if(d.cmb_pofVltKindCd?.set_value)d.cmb_pofVltKindCd.set_value(spec.evaluationKind);}
  for(let i=0;i<goals.getRowCount();i++){const goal=spec.goals.find(g=>g.key===val(goals,i,'NSST_CONTN_GROUP_NM'));must(goal,'GOAL_SCOPE_CHANGED');goals.setColumn(i,'NSST_CONTN_OFFR_YN',goal.provided?'1':'0');goals.setColumn(i,goal.provided?'NSST_CONTN_NOT_OFFR_RSN':'NSST_CONTN_OFFR_CFR_CONTN','');goals.setColumn(i,goal.provided?'NSST_CONTN_OFFR_CFR_CONTN':'NSST_CONTN_NOT_OFFR_RSN',goal.text);}
  for(const control of controls.filter(c=>c.kind==='checkbox')){const item=spec.observations.find(o=>o.key===control.key),c=tabs['tpage'+control.tab].form['cbx_'+control.key];must(item&&typeof d.cbx_onclick==='function','CHOICE_CONTROL_UNSUPPORTED');c.set_value(item.selected?1:0);d.cbx_onclick(c,{});}
  if(v2)for(const control of controls.filter(c=>c.reason)){const item=spec.observations.find(o=>o.key===control.key),edit=tabs['tpage'+control.tab].form[control.reason.control];if(item.selected){must(edit&&edit.enable!==false&&typeof d.edtX_change==='function','REASON_CONTROL_NOT_ENABLED:'+control.key);const e={prevalue:edit.value||'',postvalue:item.text};d.edtX_change(edit,e);edit.set_value(item.text);}}
  for(const control of [...controls.filter(c=>c.kind==='text'),{key:'X9900',tab:2}]){const item=control.key==='X9900'?spec.summary:spec.observations.find(o=>o.key===control.key),c=tabs['tpage'+control.tab].form['txt_'+control.key];must(item&&c&&typeof d.edtX_change==='function'&&typeof d.tpage2_content_onchanged==='function','TEXT_CONTROL_UNSUPPORTED');const e={prevalue:c.value||'',postvalue:item.text};d.edtX_change(c,e);c.set_value(item.text);d.tpage2_content_onchanged(c,e);}
  if(v2){const e={prevalue:overallControl.value||'',postvalue:spec.overallComment.text};overallControl.set_value(spec.overallComment.text);if(typeof d.content_onchanged==='function')d.content_onchanged(overallControl,e);must(val(basics,0,'RSLT_VLT_DESC')===spec.overallComment.text,'OVERALL_BINDING_MISMATCH');}else must(val(basics,0,'RSLT_VLT_DESC')===spec.summary.text,'SUMMARY_BINDING_MISMATCH');return snapshot();
 }
 throw Error('UNSUPPORTED_EVALUATION_ACTION');
}
module.exports={evaluationPage};
