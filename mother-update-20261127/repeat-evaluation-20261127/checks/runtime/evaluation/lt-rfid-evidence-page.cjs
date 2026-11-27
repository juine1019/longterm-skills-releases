'use strict';
// Institution RFID reads only. Never calls a mutation service and never edits the screen's own datasets.
// The list is read from temporary datasets (searched by recipient name, filtered by recognition number and
// checked against the screen's own month total: an empty list with a positive total, or more rows than the total, is a
// failed read; fewer rows than the total is read but the difference is reported). The specific-content detail is read only inside the screen's own
// detail popup (npfc624p21): the site rejects a direct call of the detail service from the list form.
async function ltRfidEvidencePage(p){
 const must=(v,c)=>{if(!v)throw Error(c);},str=v=>String(v??''),app=typeof nexacro!=='undefined'&&nexacro.getApplication();must(app?.gds_userInfo,'RFID_LOGIN_UNCONFIRMED');
 const user=k=>str(app.gds_userInfo.getColumn(0,k));must(user('USER_TYPE')==='20A'&&user('LTC_ADMIN_SYM')===p.context.orgId,'RFID_INSTITUTION_LOGIN_REQUIRED');
 const work=app.mainframe?.VFrameSet?.HFrameSet?.VFrameSetSub?.framesetWork,frame=work?.winnp00000000097,f=frame?.form?._div_bizFrameMain?.form||frame?.form;
 const sessions=window.__longtermRfidEvidenceSessions||(window.__longtermRfidEvidenceSessions=new Map()),current=()=>JSON.stringify(['USER_TYPE','USER_ID','LTC_ADMIN_SYM'].map(user)),prior=sessions.get(p.sessionId);
 const popupFrames=()=>Array.from(nexacro.getPopupFrames?.()||[]),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 if(['check','close'].includes(p.action)&&prior&&prior.frame!==frame&&prior.frame._is_alive===false&&prior.f._is_alive===false){must(prior.context===JSON.stringify(p.context)&&current()===JSON.parse(prior.baseline).identity,'RFID_READ_SESSION_CHANGED');if(p.action==='close')sessions.delete(p.sessionId);return{ok:true,pending:false,contextMatched:true,screenPreserved:null,retiredByNormalUI:true,writes:0};}
 must(f?.ds_cond&&f.ds_rfidServiceList,'OPEN_RFID_TRANSMISSION_IN_NORMAL_UI');
 const datasets=()=>Object.keys(f).filter(k=>f[k]&&typeof f[k].saveXML==='function'&&typeof f[k].getDeletedRowCount==='function').map(k=>[k,f[k]]);
 const screen=s=>JSON.stringify({identity:current(),data:s.watched.map(([k,ds])=>[k,ds.saveXML(),ds.rowposition,Array.from({length:ds.getRowCount()},(_,i)=>ds.getRowType(i)),ds.getDeletedRowCount()])});
 if(p.action==='capture'){must(/^[a-zA-Z0-9-]{10,80}$/.test(p.sessionId)&&!sessions.has(p.sessionId),'RFID_READ_SESSION_REQUIRED');must(!popupFrames().length,'CLOSE_RFID_POPUP_BEFORE_COLLECTION');const s={frame,f,watched:datasets(),context:JSON.stringify(p.context),pending:new Set(),groups:new Set(),counter:0};s.baseline=screen(s);sessions.set(p.sessionId,s);return{ok:true,sessionId:p.sessionId,writes:0};}
 const s=sessions.get(p.sessionId);if(!s&&['check','close'].includes(p.action))return{ok:true,found:false,pending:[...sessions.values()].some(v=>v.pending.size>0),contextMatched:true,screenPreserved:null,writes:0};must(s&&s.context===JSON.stringify(p.context),'RFID_READ_SESSION_CHANGED');
 const preserved=()=>{try{return work.winnp00000000097===s.frame&&screen(s)===s.baseline;}catch{return false;}};
 // ---- detail popup helpers -------------------------------------------------------------------------------
 const popupAlive=g=>!!g.popup&&popupFrames().includes(g.popup);
 const requestPopupClose=g=>{if(!popupAlive(g)||g.closeRequested)return;g.closeRequested=true;const form=g.popup.form?._div_bizFrameMain?.form||g.popup.form;if(typeof form?.btn_close_onclick==='function')form.btn_close_onclick(form.btn_close,{});};
 const closePopup=async g=>{if(!g.popup)return true;requestPopupClose(g);for(let i=0;i<30&&popupAlive(g);i++)await wait(100);return !popupAlive(g);};
 const dismissNotices=async()=>{let n=0;for(let i=0;i<5;i++){const notice=popupFrames().find(x=>x.id==='detailShowMsg');if(!notice)break;const form=notice.form?._div_bizFrameMain?.form||notice.form;if(typeof form?.btn_cofirm_onclick!=='function')break;form.btn_cofirm_onclick(form.btn_cofirm,{});n++;await wait(100);}return n;};
 // ---- cleanup of one read group (datasets, callbacks and popups live on their own owner form) ---------------
 const cleanup=g=>{for(const [owner,wrapper,original]of (g.terminalCallbacks||[]).reverse())if(owner._gfn_callBack===wrapper)owner._gfn_callBack=original;for(const [owner,cb]of g.callbacks)delete owner[cb];for(const [owner,id]of g.datasets.reverse()){const ds=owner.removeChild(id);ds?.destroy();}g.datasets=[];g.callbacks=[];g.terminalCallbacks=[];requestPopupClose(g);s.groups.delete(g);};
 const stuck=()=>[...s.groups].some(g=>g.popup&&popupAlive(g));
 if(p.action==='check')return{ok:true,pending:s.pending.size>0||stuck(),contextMatched:current()===JSON.parse(s.baseline).identity,screenPreserved:preserved(),writes:0};
 if(p.action==='close'){if(s.pending.size)return{ok:false,code:'RFID_READ_STILL_PENDING',pending:true,screenPreserved:preserved(),writes:0};for(const g of [...s.groups])if(!(await closePopup(g)))return{ok:false,code:'RFID_POPUP_CLOSE_UNCONFIRMED',pending:true,screenPreserved:preserved(),writes:0};const unchanged=preserved();for(const g of [...s.groups])cleanup(g);sessions.delete(p.sessionId);return{ok:true,screenPreserved:unchanged,writes:0};}
 const guard=()=>must(preserved(),'SCREEN_CHANGED_DURING_RFID_READ');guard();must(!s.pending.size,'PREVIOUS_RFID_READ_PENDING');
 const g={callbacks:[],terminalCallbacks:[],datasets:[],pending:new Set(),finished:false,popup:null,closeRequested:false,noticeDismissed:false};s.groups.add(g);const prefix='_ltRfid'+p.sessionId.replaceAll('-','')+'_'+(++s.counter)+'_';let serial=0;
 const make=(source,owner=f)=>{const ds=new nexacro.Dataset(prefix+(++serial),owner);if(source)ds.assign(source);owner.addChild(ds.id,ds);g.datasets.push([owner,ds.id]);return ds;};
 const put=(ds,values)=>{if(!ds.getRowCount())ds.addRow();for(const[k,v]of Object.entries(values)){if(!ds.getColumnInfo(k))ds.addColumn(k,'STRING',32767);ds.setColumn(0,k,v);}return ds;};
 const rows=ds=>{must(ds.getRowCount()<=10000&&ds.getColCount()<=500,'RFID_RESPONSE_TOO_LARGE');return Array.from({length:ds.getRowCount()},(_,i)=>Object.fromEntries(Array.from({length:ds.getColCount()},(_,j)=>{const k=ds.getColID(j);return[k,str(ds.getColumn(i,k))];})));};
 const query=(url,input,outputs,owner=f)=>new Promise((resolve,reject)=>{guard();must(['/f/c/624/selectRfidServiceList.do','/f/c/624/selectRfidDetail.do'].includes(url),'RFID_READ_ENDPOINT_REQUIRED');must(typeof owner.gfn_callService==='function','RFID_READ_SERVICE_UNAVAILABLE');const cb=prefix+'Cb'+(++serial);g.callbacks.push([owner,cb]);g.pending.add(cb);s.pending.add(cb);let settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;reject(Error('RFID_READ_TIMEOUT_PENDING'));}},15000);owner[cb]=(id,code)=>{g.pending.delete(cb);s.pending.delete(cb);clearTimeout(timer);if(!settled){settled=true;try{must(code===0||code==='0','RFID_READ_FAILED');guard();resolve();}catch(e){reject(e);}}if(g.finished&&!g.pending.size)cleanup(g);};
  // The site's native dispatcher returns early on SQL errors without the named callback.
  // Observe its real terminal error for this exact read and delegate all native handling.
  if(typeof owner._gfn_callBack==='function'){const original=owner._gfn_callBack,wrapper=function(id,code){let own=false;try{own=JSON.parse(id).callback===cb;}catch{}try{return original.apply(this,arguments);}finally{if(own&&Number(code)<0&&g.pending.has(cb))owner[cb]?.(id,code);}};g.terminalCallbacks.push([owner,wrapper,original]);owner._gfn_callBack=wrapper;}
  for(const[ds]of outputs)ds.clearData();try{owner.gfn_callService(prefix+'Read'+serial,url,'ds_cond='+input.id,outputs.map(([ds,name])=>ds.id+'='+name).join(' '),'',[],cb,true,false);}catch(e){settled=true;clearTimeout(timer);reject(e);}});
 const identity=row=>{must(row.LTC_MGMT_NO===p.context.recognitionNo&&row.LTCP_CLSFC_CD===p.context.serviceCode,'RFID_RECIPIENT_CHANGED');if(row.ORI_LTC_ADMIN_SYM)must(row.ORI_LTC_ADMIN_SYM===p.context.orgId,'RFID_SOURCE_INSTITUTION_CHANGED');};
 const listKeys=['FNM','LTC_MGMT_NO','RECU_SFF_NM','LTCP_CLSFC_CD','LTCP_FR_DT','LTCP_OFFR_YYYYMM','RFID_ADM_NO','TAG_ID','READER_NO','LTCP_FR_DTHMS','LTCP_TO_DTHMS','SVC_TRANS_TYPE_CD','SVC_CONTN_SAVE_YN','LTCP_CONTN_SAVE_YN','USE_YN','DEL_YN','STED_TM','WORK_PROC_NM','PCT_ACTION_YN','LTC_RCGT_GRADE_CD'];
 const detailKeys=['LTC_MGMT_NO','LTC_MGMT_NO_SEQ','ORI_LTC_ADMIN_SYM','LTCP_CLSFC_CD','LTCP_FR_DT','LTCP_OFFR_YYYYMM','RFID_ADM_NO','TAG_ID','READER_NO','LTCP_FR_DTHMS','LTCP_TO_DTHMS','PCLR_COMT_CONTN','BDY_FUNC_ALTR_STAT_CD','EAT_FUNC_ALTR_STAT_CD','PCT_FUNC_ALTR_STAT_CD','DUN_MSK_FREQ','URI_MSK_FREQ','FMLY_YN','FMLY_REL_YN','SVC_TRANS_TYPE_CD','DEL_YN',...Array.from({length:8},(_,i)=>'LTCP_ITEM_OFFR_TM'+(i+1))];
 let out;
 try{let result;
  if(p.action==='month'){
   must(/^20\d{2}(0[1-9]|1[0-2])$/.test(p.month),'RFID_MONTH_REQUIRED');must(typeof p.recipientName==='string'&&p.recipientName.trim(),'RFID_RECIPIENT_NAME_REQUIRED');
   const end=p.month+String(new Date(Number(p.month.slice(0,4)),Number(p.month.slice(4)),0).getDate()).padStart(2,'0'),from=[p.month+'01',p.period.from.replaceAll('-','')].sort().at(-1),to=[end,p.period.to.replaceAll('-','')].sort()[0];must(from<=to,'RFID_MONTH_OUTSIDE_PERIOD');
   // Search by recipient name (the screen's reliable search); the recognition-number search silently dropped whole months.
   const input=put(make(f.ds_cond),{LTC_ADMIN_SYM:p.context.orgId,SEARCH_FR_DT:from,SEARCH_TO_DT:to,SEARCH_GBN:'2',SEARCH_VALUE:p.recipientName.trim(),LTCP_CLSFC_CD:p.context.serviceCode,SVC_TRANS_TYPE_CD:'',SVC_CONTN_SAVE_YN:'',SVC_PROC:''}),output=make(f.ds_rfidServiceList),percent=make(f.ds_autoPercent);await query('/f/c/624/selectRfidServiceList.do',input,[[output,'ds_rfidServiceList'],[percent,'ds_autoPercent']]);
   const listed=rows(output),totals=rows(percent)[0];must(totals&&/^\d+$/.test(str(totals.TOT_TRANS)),'RFID_LIST_TOTAL_UNCONFIRMED');const total=Number(totals.TOT_TRANS);must(listed.length<=total&&!(listed.length===0&&total>0),'RFID_LIST_TOTAL_MISMATCH');
   const all=listed.filter(row=>row.LTC_MGMT_NO===p.context.recognitionNo),keys=new Set();
   for(const row of all){identity(row);must(/^20\d{6}$/.test(row.LTCP_FR_DT)&&row.LTCP_FR_DT>=from&&row.LTCP_FR_DT<=to&&row.LTCP_OFFR_YYYYMM===p.month,'RFID_DATE_OUTSIDE_QUERY');must(row.RFID_ADM_NO&&row.TAG_ID,'RFID_RECORD_ID_MISSING');const key=[row.LTCP_OFFR_YYYYMM,row.RFID_ADM_NO,row.TAG_ID,row.READER_NO||''].join('|');must(!keys.has(key),'DUPLICATE_RFID_RECORD');keys.add(key);}
   result={headers:all.map(row=>Object.fromEntries(listKeys.map(k=>[k,row[k]||'']))),month:p.month,listTotal:{rows:listed.length,total}};
  }else if(p.action==='details'){
   must(Array.isArray(p.headers)&&p.headers.length>0&&p.headers.length<=6,'RFID_DETAIL_BATCH_REQUIRED');must(!popupFrames().length,'RFID_POPUP_ALREADY_OPEN');
   for(const header of p.headers){identity(header);must(header.RFID_ADM_NO&&header.TAG_ID&&header.LTCP_FR_DT>=p.period.from.replaceAll('-','')&&header.LTCP_FR_DT<=p.period.to.replaceAll('-',''),'RFID_DETAIL_SCOPE_REQUIRED');must(header.LTCP_CLSFC_CD==='001'&&header.LTCP_FR_DT>='20200116','RFID_DETAIL_POPUP_UNSUPPORTED');}
   // Open the screen's own detail popup exactly as its confirm/modify button does (same arguments), without touching the list datasets.
   must(typeof f.gfn_showPopupByID==='function','RFID_DETAIL_POPUP_UNAVAILABLE');const first=p.headers[0];
   f.gfn_showPopupByID(f,'npfc624p21','npfc624p21',{argLtcpFrDt:first.LTCP_FR_DT,argLtcpOffrYyyymm:first.LTCP_OFFR_YYYYMM,argLtcpClsfcCd:first.LTCP_CLSFC_CD,argPclrComtContnLen:0,argTagId:first.TAG_ID,argReaderNo:first.READER_NO,argRfidAdmNo:first.RFID_ADM_NO,argFnm:first.FNM,argLtcpContnSaveYn:first.LTCP_CONTN_SAVE_YN,argStedTm:first.STED_TM,argWorkProcNm:first.WORK_PROC_NM,argRecuSffNm:first.RECU_SFF_NM,argPctActionYn:first.PCT_ACTION_YN,argLtcRcgtGradeCd:first.LTC_RCGT_GRADE_CD},true,452,710);
   for(let i=0;i<60&&!g.popup;i++){g.popup=popupFrames().find(x=>x.id==='npfc624p21')||null;if(!g.popup)await wait(150);}must(g.popup,'RFID_DETAIL_POPUP_NOT_OPENED');
   const form=g.popup.form?._div_bizFrameMain?.form||g.popup.form;for(let i=0;i<60&&!(form?.ds_cond&&form.ds_rfidDetail&&typeof form.gfn_callService==='function');i++)await wait(150);must(form?.ds_cond&&form.ds_rfidDetail&&typeof form.gfn_callService==='function','RFID_DETAIL_POPUP_NOT_READY');
   const records=[];
   for(const header of p.headers){const input=put(make(form.ds_cond,form),Object.fromEntries(['LTCP_OFFR_YYYYMM','TAG_ID','READER_NO','RFID_ADM_NO'].map(k=>[k,header[k]||null]))),output=make(form.ds_rfidDetail,form);await query('/f/c/624/selectRfidDetail.do',input,[[output,'ds_rfidDetail']],form);const all=rows(output);must(all.length===1,'RFID_DETAIL_UNCONFIRMED');const row=all[0];must(Object.hasOwn(row,'PCLR_COMT_CONTN'),'RFID_DETAIL_NARRATIVE_FIELD_MISSING');identity(row);for(const k of ['LTCP_OFFR_YYYYMM','TAG_ID','RFID_ADM_NO','LTCP_FR_DT'])must(row[k]===header[k],'RFID_DETAIL_ID_CHANGED:'+k);if(row.LTC_MGMT_NO_SEQ)must(row.LTC_MGMT_NO_SEQ===p.context.recognitionSeq,'RFID_RECOGNITION_SEQUENCE_CHANGED');
    records.push({header,detail:Object.fromEntries(detailKeys.map(k=>[k,row[k]||'']))});}
   result={records};
  }else throw Error('UNSUPPORTED_RFID_READ_ACTION');
  guard();out={ok:true,...result,screenPreserved:true,writes:0};
 }catch(e){const notices=await dismissNotices();if(notices)g.noticeDismissed=true;out={ok:false,code:e.message,pending:s.pending.size>0,screenPreserved:preserved(),writes:0,...(g.noticeDismissed?{errorNoticeDismissed:true}:{})};}
 g.finished=true;
 if(!g.pending.size){const closed=await closePopup(g);cleanup(g);if(!closed){g.popup=g.popup;s.groups.add(g);out={ok:false,code:'RFID_POPUP_CLOSE_UNCONFIRMED',pending:true,screenPreserved:preserved(),writes:0};}}
 return out;
}
module.exports={ltRfidEvidencePage};
