const pickLtTab=async(tabs,role)=>{const main=tabs.filter(x=>/^https:\/\/(www\.)?longtermcare\.or\.kr\/npbs\/xui\/manage\.html([?#]|$)/.test(String(x.url||'')));for(const x of main){let type=null;try{await attachBrowserTab(x.targetId);type=await page.evaluate(()=>{try{const u=nexacro.getApplication().gds_userInfo;return u&&u.getRowCount()?String(u.getColumn(0,'USER_TYPE')||''):null}catch(e){return null}})}catch(e){type=null}if(type===role)return x;if(main.length===1&&!type)return x}return undefined};
                                                                         
                                                         
const P = __P__;
const tabsL = await listBrowserTabs();
const t = (await pickLtTab(tabsL,'20A'));
if (!t) { console.log(JSON.stringify({ok: false, error: '롱텀 업무 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  const r = await page.evaluate(async () => {
    const app = nexacro.getApplication(); const fw = app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;
    const u = app.gds_userInfo; const institutionId = String(u.getColumn(0, 'LTC_ADMIN_SYM') || u.getColumn(0, 'ADMIN_SYM') || '');
    if (String(u.getColumn(0, 'USER_TYPE')) !== '20A' || !institutionId) { return {error: 'LT institution login required'}; }
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const find = () => { for (const k in fw) { try { if (/^win/.test(k) && fw[k] && fw[k].form && fw[k].form._div_bizFrameMain && fw[k].form._div_bizFrameMain.form.ds_npba52 && fw[k].form._div_bizFrameMain.form.ds_pofPlnppList) { return k; } } catch (e) {} } return null; };
    let k = find(); if (k) { app.afn_setSeparatesize('WORK'); fw[k].setFocus(); return {already: true, frame: k, institutionId}; }
    let top = null; try { top = app.mainframe.VFrameSet.frameTop; } catch (e) {} if (!top) { try { top = app.mainframe.VFrameSet.HFrameSet.frameTop; } catch (e) {} }
    if (!top) { return {error: '메뉴 프레임(frameTop)을 찾지 못함'}; }
    try { top.form.fn_menuOpen('np00000000119'); } catch (e) { return {error: '메뉴 열기 실패: ' + String(e && e.message ? e.message : e).slice(0, 80)}; }
    for (let i = 0; i < 100; i++) { await sleep(200); k = find(); if (k) { break; } }
    if (!k) { return {error: '급여제공계획서 화면을 메뉴로 열지 못함'}; }
    await sleep(2500);
    return {opened: true, frame: k, institutionId};
  });
  console.log(JSON.stringify({ok: !r.error, r}));
}
