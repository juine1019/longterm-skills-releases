const pickLtTab=async(tabs,role)=>{const main=tabs.filter(x=>/^https:\/\/(www\.)?longtermcare\.or\.kr\/npbs\/xui\/manage\.html([?#]|$)/.test(String(x.url||'')));for(const x of main){let type=null;try{await attachBrowserTab(x.targetId);type=await page.evaluate(()=>{try{const u=nexacro.getApplication().gds_userInfo;return u&&u.getRowCount()?String(u.getColumn(0,'USER_TYPE')||''):null}catch(e){return null}})}catch(e){type=null}if(type===role)return x;if(main.length===1&&!type)return x}return undefined};
                                                                                                          
                                                                        
const P = __P__;
const tabsL = await listBrowserTabs();
const t = (await pickLtTab(tabsL,'20A'));
if (!t) { console.log(JSON.stringify({ok: false, error: '롱텀 업무 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  const r = await page.evaluate(async (a) => {
    const app = nexacro.getApplication(); const fw = app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;
    let w = null; for (const k in fw) { try { if (/^win/.test(k) && fw[k] && fw[k].form && fw[k].form._div_bizFrameMain && fw[k].form._div_bizFrameMain.form.ds_npba52 && fw[k].form._div_bizFrameMain.form.ds_pofPlnppList) { w = fw[k]; } } catch (e) {} }
    if (!w) { return {status: 'fail', reason: '급여제공계획서 화면이 열려 있지 않음'}; }
    const f = w.form._div_bizFrameMain.form; const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const planNo = String(f.ds_npba50Dtl.getColumn(0, 'POF_PLNPP_MGMT_NO') || '');
    for (const ds of [f.ds_npba50Dtl, f.ds_npba51, f.ds_npba52, f.ds_npba43]) {
      if (!ds) { continue; }
      if (ds.getDeletedRowCount() > 0) { return {status: 'fail', reason: 'Unsaved changes: park stopped'}; }
      for (let i = 0; i < ds.getRowCount(); i++) { if ([2, 4, 8].includes(ds.getRowType(i))) { return {status: 'fail', reason: 'Unsaved changes: park stopped'}; } }
    }
    if (a.plan && planNo !== a.plan) { return {status: 'fail', reason: '선택된 계획서 ' + planNo + ' 가 ' + a.plan + ' 와 다름'}; }
    app.afn_setSeparatesize('WORK'); w.setFocus(); await sleep(500);
    const names = ['npba410p02', 'nptz001p03', 'npba410p10', 'npba410p01'];
    const closed = []; const closeAll = async () => { for (const nm of names) { try { if (w[nm]) { w[nm].form.close('CLOSEONLY'); closed.push(nm); await sleep(500); } } catch (e) {} } };
    await closeAll();
    if (f.tab_main.tabindex !== 4) { f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(4); await sleep(1200); }
    await closeAll();
    const open = names.filter((nm) => { try { return !!w[nm]; } catch (e) { return false; } });
    return {status: (f.tab_main.tabindex === 4 && open.length === 0 && Number(w.height) > 0) ? 'ok' : 'fail', plan: planNo, tab: f.tab_main.tabindex, visibleHeight: w.height, closed, stillOpen: open, sendButton: String(f.btn_send.text)};
  }, P);
  console.log(JSON.stringify({ok: r.status === 'ok', r}));
}
