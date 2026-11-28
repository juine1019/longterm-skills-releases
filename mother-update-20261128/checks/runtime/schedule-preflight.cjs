'use strict';
// Also embedded verbatim in the browser callback; keep this function dependency-free.
function schedulePreflight(request, form, detail) {
 const expected=String(request.ctr||'');
 if(!/^[A-Za-z0-9_-]+$/.test(expected))return 'EXPLICIT_SELECTED_CONTRACT_REQUIRED';
 if(!/^\d{6}$/.test(String(request.ym||'')))return 'EXPLICIT_SELECTED_MONTH_REQUIRED';
 try {
  if(String(form.cmb_obj.value)!==expected||String(form.fv_sLtcpCtrNo)!==expected||String(form.ds_objtr.getColumn(0,'LTCP_CTR_NO'))!==expected)return 'SELECTED_CONTRACT_MISMATCH';
  if(String(form.cmb_ctrYm.value)!==String(request.ym))return 'SELECTED_MONTH_MISMATCH';
  for(const dataset of [detail.ds_apprvCtrDtl,detail.ds_paymtDypr]) {
   if(!dataset||typeof dataset.getRowCount!=='function'||typeof dataset.getRowType!=='function'||typeof dataset.getDeletedRowCount!=='function')return 'EDIT_STATE_SCHEMA_UNCONFIRMED';
   if(dataset.getDeletedRowCount()!==0)return 'UNSAVED_SCHEDULE_EDITS';
   for(let i=0;i<dataset.getRowCount();i++)if(dataset.getRowType(i)!==1)return 'UNSAVED_SCHEDULE_EDITS';
  }
  return '';
 }catch(e){return 'SELECTED_SCHEDULE_CONTEXT_UNCONFIRMED';}
}
module.exports={schedulePreflight};
