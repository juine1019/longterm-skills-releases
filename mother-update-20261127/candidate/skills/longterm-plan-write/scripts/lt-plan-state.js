const pickLtTab=async(tabs,role)=>{const main=tabs.filter(x=>/^https:\/\/(www\.)?longtermcare\.or\.kr\/npbs\/xui\/manage\.html([?#]|$)/.test(String(x.url||'')));for(const x of main){let type=null;try{await attachBrowserTab(x.targetId);type=await page.evaluate(()=>{try{const u=nexacro.getApplication().gds_userInfo;return u&&u.getRowCount()?String(u.getColumn(0,'USER_TYPE')||''):null}catch(e){return null}})}catch(e){type=null}if(type===role)return x;if(main.length===1&&!type)return x}return undefined};
                                                                            
                                                                                                         
                                                                            
const P = __P__;
const tabsL = await listBrowserTabs();
const t = (await pickLtTab(tabsL,'20A'));
if (!t) { console.log(JSON.stringify({ok: false, error: '롱텀 업무 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  const r = await page.evaluate(async (a) => {
    const app = nexacro.getApplication(); const fw = app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;
    const user = app.gds_userInfo; const institutionId = String(user.getColumn(0, 'LTC_ADMIN_SYM') || user.getColumn(0, 'ADMIN_SYM') || '');
    let w = null; for (const k in fw) { try { if (/^win/.test(k) && fw[k] && fw[k].form && fw[k].form._div_bizFrameMain && fw[k].form._div_bizFrameMain.form.ds_npba52 && fw[k].form._div_bizFrameMain.form.ds_pofPlnppList) { w = fw[k]; } } catch (e) {} }
    if (!w) { return {error: '급여제공계획서 화면이 열려 있지 않음'}; }
    const f = w.form._div_bizFrameMain.form;
    const col = (d, r, id) => { try { const v = d.getColumn(r, id); return v === null || v === undefined ? '' : String(v); } catch (e) { return ''; } };
    const res = {screen: String(w.form.sta_bizTitleid ? w.form.sta_bizTitleid.text : ''), institutionId, plans: [], needs: [], groups: [], subGoals: [], dtl: {}};
    const dl = f.ds_pofPlnppList;
    for (let i = 0; i < dl.getRowCount(); i++) { res.plans.push({no: col(dl, i, 'POF_PLNPP_MGMT_NO'), from: col(dl, i, 'ADPT_FR_DT'), to: col(dl, i, 'ADPT_TO_DT'), seq: col(dl, i, 'LTC_MGMT_NO_SEQ') + '-' + col(dl, i, 'UTIL_PLNPP_SEQ_NO'), agree: col(dl, i, 'PRS_AGRE_YN'), trs: col(dl, i, 'DATA_TRS_DT'), providerConfirmedAt: col(dl, i, 'LTCO_CFR_DT'), reason: col(dl, i, 'RE_WRT_RSN_CD')}); }
    const d = f.ds_npba50Dtl;
    const identity = {ltc: col(d, 0, 'LTC_MGMT_NO'), phone: col(d, 0, 'AAS_TEL_NO'), relation: col(d, 0, 'PRS_REL_CD'), method: col(d, 0, 'AGRE_MTH_CD'), writer: col(d, 0, 'WRTR_NM'), selectedWriter: String(f.fv_fnm || ''), confirmer: col(d, 0, 'LAST_CFRP_NM')};
    if (d.getRowCount() > 0) { res.dtl = {no: col(d, 0, 'POF_PLNPP_MGMT_NO'), goal: col(d, 0, 'GOAL_CONTN'), opinion: col(d, 0, 'OVR_OPIN_CONTN'), wrtDt: col(d, 0, 'WRT_DT'), agreDt: col(d, 0, 'AGRE_DT'), agreName: col(d, 0, 'AAS_FNM'), agreYn: col(d, 0, 'PRS_AGRE_YN'), reason: col(d, 0, 'RE_WRT_RSN_CD'), trs: col(d, 0, 'DATA_TRS_DT'), ltcoYn: col(d, 0, 'LTCO_YN'), ltcoDt: col(d, 0, 'LTCO_CFR_DT')}; }
    Object.assign(res.dtl, identity);
    if (!res.dtl.ltc) { for (let i = 0; i < dl.getRowCount(); i++) { if (col(dl, i, 'POF_PLNPP_MGMT_NO') === res.dtl.no) { res.dtl.ltc = col(dl, i, 'LTC_MGMT_NO'); } } }
                                                                    
    let g51 = null; try { g51 = f.tab_main.tpage3.form.grd_npba51; } catch (e) {}
    const d51 = f.ds_npba51;
    for (let i = 0; i < d51.getRowCount(); i++) { const chosen = col(d51, i, 'PAY_CONTN_CHOICE_YN'); if (chosen === '1' || chosen === 'Y') { let nm = ''; try { nm = g51 ? String(g51.getCellText(i, 6) || '').trim() : ''; } catch (e) {} res.needs.push({row: i, code: col(d51, i, 'LTCP_CONTN_CD'), ftu: col(d51, i, 'FTU_DETAIL_CONTN'), name: nm}); } }
    res.need78 = d51.getRowCount();
    const d52 = f.ds_npba52;
    const cyc = {'3': '일', '4': '필요시'};
    for (let i = 0; i < d52.getRowCount(); i++) { res.groups.push({code: col(d52, i, 'NSST_CONTN_GROUP_CD'), name: col(d52, i, 'NSST_CONTN_GROUP_NM'), ftu: col(d52, i, 'FTU_DETAIL_CONTN'), cycle: cyc[col(d52, i, 'HLT_MGMT_CYCL_TYPE')] || col(d52, i, 'HLT_MGMT_CYCL_TYPE'), count: col(d52, i, 'WRK_CYCL_VL'), min: col(d52, i, 'NEED_TMN'), writer: col(d52, i, 'WRTR_NM')}); }
    const d43 = f.ds_npba43;
    for (let i = 0; i < d43.getRowCount(); i++) { res.subGoals.push({ftu: col(d43, i, 'FTU_DETAIL_CONTN'), pay: col(d43, i, 'PAYMT_TYPE_NM'), text: col(d43, i, 'DETAIL_GOAL_CONTN')}); }
                                                                                                                                        
    if (f.tab_main.tabindex !== 3) { f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(3); await new Promise((res2) => setTimeout(res2, 3000)); }
    res.groups = []; for (let i = 0; i < d52.getRowCount(); i++) { res.groups.push({code: col(d52, i, 'NSST_CONTN_GROUP_CD'), name: col(d52, i, 'NSST_CONTN_GROUP_NM'), ftu: col(d52, i, 'FTU_DETAIL_CONTN'), cycle: cyc[col(d52, i, 'HLT_MGMT_CYCL_TYPE')] || col(d52, i, 'HLT_MGMT_CYCL_TYPE'), count: col(d52, i, 'WRK_CYCL_VL'), min: col(d52, i, 'NEED_TMN'), writer: col(d52, i, 'WRTR_NM')}); }
    return res;
  }, P);
  console.log(JSON.stringify({ok: !r.error, r}));
}
