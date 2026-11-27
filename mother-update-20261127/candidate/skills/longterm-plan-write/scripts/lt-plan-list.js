const pickLtTab=async(tabs,role)=>{const main=tabs.filter(x=>/^https:\/\/(www\.)?longtermcare\.or\.kr\/npbs\/xui\/manage\.html([?#]|$)/.test(String(x.url||'')));for(const x of main){let type=null;try{await attachBrowserTab(x.targetId);type=await page.evaluate(()=>{try{const u=nexacro.getApplication().gds_userInfo;return u&&u.getRowCount()?String(u.getColumn(0,'USER_TYPE')||''):null}catch(e){return null}})}catch(e){type=null}if(type===role)return x;if(main.length===1&&!type)return x}return undefined};
                                                                                                         
const P = __P__;
const tabsL = await listBrowserTabs();
const t = (await pickLtTab(tabsL,'20A'));
if (!t) { console.log(JSON.stringify({ok: false, error: '롱텀 업무 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  const r = await page.evaluate(async (a) => {
    const app = nexacro.getApplication(); const fw = app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;
    let w = null; for (const k in fw) { try { if (/^win/.test(k) && fw[k] && fw[k].form && fw[k].form._div_bizFrameMain && fw[k].form._div_bizFrameMain.form.ds_npba52 && fw[k].form._div_bizFrameMain.form.ds_pofPlnppList) { w = fw[k]; } } catch (e) {} }
    if (!w) { return {error: '급여제공계획서 화면이 열려 있지 않음'}; }
    const f = w.form._div_bizFrameMain.form; const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    if (!window.__ltInflOn) { window.__ltInflOn = true; window.__ltInfl = 0; const X0 = window.XMLHttpRequest; const sd0 = X0.prototype.send; X0.prototype.send = function () { window.__ltInfl++; this.addEventListener('loadend', () => { window.__ltInfl--; }); return sd0.apply(this, arguments); }; }
    const idle = async (maxMs) => { const t0 = Date.now(); let q = 0; while (Date.now() - t0 < maxMs) { await sleep(150); if (window.__ltInfl <= 0) { q += 150; } else { q = 0; } if (q >= 750) { return true; } } return false; };
    const col = (d, r0, id) => { try { const v = d.getColumn(r0, id); return v === null || v === undefined ? '' : String(v); } catch (e) { return ''; } };
    f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(0); await sleep(700);
    if (a.name) { f.edt_fnm.set_value(a.name); await sleep(200); }
    f.btn_search_onclick(null, null); await sleep(600); await idle(15000);
    const l = f.ds_pofPlnppList; const rows = [];
    for (let i = 0; i < l.getRowCount(); i++) { rows.push({no: col(l, i, 'POF_PLNPP_MGMT_NO'), fnm: col(l, i, 'FNM'), cls: col(l, i, 'LTCP_CLSFC_CD'), seq: col(l, i, 'LTC_MGMT_NO_SEQ') + '-' + col(l, i, 'UTIL_PLNPP_SEQ_NO'), fr: col(l, i, 'ADPT_FR_DT'), to: col(l, i, 'ADPT_TO_DT'), agree: col(l, i, 'PRS_AGRE_YN'), trs: col(l, i, 'DATA_TRS_DT'), wrt: col(l, i, 'WRT_DT'), rsn: col(l, i, 'RE_WRT_RSN_CD')}); }
    return {rows};
  }, P);
  console.log(JSON.stringify({ok: !r.error, r}));
}
