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
    const planNo = String(f.ds_npba50Dtl.getColumn(0, 'POF_PLNPP_MGMT_NO') || '');
    if (a.plan && planNo !== a.plan) { return {error: '선택된 계획서 ' + planNo + ' 가 ' + a.plan + ' 와 다름'}; }
    const X = window.XMLHttpRequest; const op = X.prototype.open; const sd = X.prototype.send; const blocked = []; const sent = [];
    X.prototype.open = function (m, u) { this.__fu = String(u || ''); return op.apply(this, arguments); };
    X.prototype.send = function (b) { const nm = this.__fu.split('?')[0].split('/').pop().replace('.do', ''); if (/send|delete|remove|cncl|insert|save|update/i.test(nm)) { blocked.push(nm); return; } if (/Print/i.test(nm)) { sent.push(nm); } return sd.apply(this, arguments); };
    const out = {plan: planNo};
    try {
      let pop = null; try { pop = w.nptz001p03 || null; } catch (e) {}
      if (!pop) { f.btn_plnppPrint_onclick(null, null); for (let i = 0; i < 40; i++) { await sleep(250); try { if (w.nptz001p03) { pop = w.nptz001p03; break; } } catch (e) {} } }
      if (!pop) { out.error = '열람 사유 팝업이 열리지 않음'; }
      else {
        let pf = null; for (let i = 0; i < 30; i++) { await sleep(250); const c1 = pop.form; const c2 = pop.form._div_bizFrameMain ? pop.form._div_bizFrameMain.form : null; if (c1 && c1.cmb_rdnRsn) { pf = c1; break; } if (c2 && c2.cmb_rdnRsn) { pf = c2; break; } }
        if (!pf) { out.error = '열람 사유 콤보를 찾지 못함'; } else { await sleep(500); pf.cmb_rdnRsn.set_index(0); await sleep(300); out.reason = String(pf.cmb_rdnRsn.text);
        pf.btn_choice_onclick(null, null); await sleep(3500); }
        out.viewer = false; for (const k in w) { try { if (/npb_a_npba410r01/.test(k) && w[k]) { out.viewer = true; } } catch (e) {} }
      }
    } catch (e) { out.error = '예외: ' + String(e && e.message ? e.message : e).slice(0, 120); }
    X.prototype.send = sd; X.prototype.open = op; out.blocked = blocked; out.sent = sent;
    return out;
  }, P);
  console.log(JSON.stringify({ok: !r.error, r}));
}
