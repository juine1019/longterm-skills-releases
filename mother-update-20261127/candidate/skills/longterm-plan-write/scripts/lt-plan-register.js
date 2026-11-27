const pickLtTab=async(tabs,role)=>{const main=tabs.filter(x=>/^https:\/\/(www\.)?longtermcare\.or\.kr\/npbs\/xui\/manage\.html([?#]|$)/.test(String(x.url||'')));for(const x of main){let type=null;try{await attachBrowserTab(x.targetId);type=await page.evaluate(()=>{try{const u=nexacro.getApplication().gds_userInfo;return u&&u.getRowCount()?String(u.getColumn(0,'USER_TYPE')||''):null}catch(e){return null}})}catch(e){type=null}if(type===role)return x;if(main.length===1&&!type)return x}return undefined};
                                                                                         
                                                                                                  
                                                                                                                                                              
                                                                        
const P = __P__;
const tabsL = await listBrowserTabs();
const t = (await pickLtTab(tabsL,'20A'));
if (!t) { console.log(JSON.stringify({ok: false, error: '롱텀 업무 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  const r = await page.evaluate(async (a) => {
    const app = nexacro.getApplication(); const fw = app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;
    const u = app.gds_userInfo; const org = String(u.getColumn(0, 'LTC_ADMIN_SYM') || u.getColumn(0, 'ADMIN_SYM') || '');
    if (a.mode === 'apply' && (!a.institutionId || org !== a.institutionId || String(u.getColumn(0, 'USER_TYPE')) !== '20A')) { return {status: 'fail', reason: 'LT institution mismatch'}; }
    let w = null; for (const k in fw) { try { if (/^win/.test(k) && fw[k] && fw[k].form && fw[k].form._div_bizFrameMain && fw[k].form._div_bizFrameMain.form.ds_npba52 && fw[k].form._div_bizFrameMain.form.ds_pofPlnppList) { w = fw[k]; } } catch (e) {} }
    if (!w) { return {status: 'fail', reason: '급여제공계획서 화면이 열려 있지 않음'}; }
    const f = w.form._div_bizFrameMain.form;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const col = (d, r, id) => { try { const v = d.getColumn(r, id); return v === null || v === undefined ? '' : String(v); } catch (e) { return ''; } };
    // CONTRACT_SELECTION_BEGIN
    function choosePlanContract(rows, spec, frDt, toDt) {
      const basis = spec.periodBasis;
      const matches = rows.filter(x => x.fnm === spec.name && x.cls === '001' && x.mgmt === spec.ltcMgmtNo &&
        x.seq === spec.planNo.ltcMgmtNoSeq && /^\d{8}$/.test(x.ctrFr) && /^\d{8}$/.test(x.ctrTo) &&
        x.ctrFr <= frDt && toDt <= x.ctrTo && (!basis || x.ctrFr === basis.contractStart.replace(/-/g, '') && x.ctrTo === basis.contractEnd.replace(/-/g, '')));
      if (!matches.length || matches.some(x => !x.ctr) || new Set(matches.map(x => x.ctr)).size !== 1) return null;
      return matches.find(x => !x.no) || matches[0];
    }
    // CONTRACT_SELECTION_END
    // ADDITIONAL_PLAN_BEGIN
    function additionalPlanProblem(rows, intent) {
      if (!rows.length) return null;
      if (!intent || intent.type !== 'additional' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.requestId || '') ||
          !Array.isArray(intent.preservePlanNos) || !intent.userInstruction || !intent.requestedAt) return '동일·중복기간 새 작성의 사용자 지시와 보존 대상이 필요함';
      const actual = [...new Set(rows.map(x => x.no))].sort();
      const preserved = [...new Set(intent.preservePlanNos)].sort();
      if (actual.length !== preserved.length || actual.some((x, i) => x !== preserved[i])) return '기존 계획서 목록이 새 작성 요청의 보존 대상과 다름';
      return null;
    }
    // ADDITIONAL_PLAN_END
    let spec = null; try { spec = JSON.parse(await (async () => { const raw = Uint8Array.from(atob(a.spec.replace(/^gz:/, '')), (c) => c.charCodeAt(0)); if (a.spec.startsWith('gz:')) { return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); } return new TextDecoder().decode(raw); })()); } catch (e) { return {status: 'fail', reason: 'spec 해석 실패'}; }
    const apply = a.mode === 'apply';
    if (apply && a.approve !== spec.specHash) { return {status: 'fail', reason: 'apply는 approve=spec 해시가 있어야 함'}; }
    if (!window.__ltInflOn) { window.__ltInflOn = true; window.__ltInfl = 0; const X0 = window.XMLHttpRequest; const sd0 = X0.prototype.send; X0.prototype.send = function () { window.__ltInfl++; this.addEventListener('loadend', () => { window.__ltInfl--; }); return sd0.apply(this, arguments); }; }
    const idle = async (maxMs) => { const t0 = Date.now(); let q = 0; while (Date.now() - t0 < maxMs) { await sleep(150); if (window.__ltInfl <= 0) { q += 150; } else { q = 0; } if (q >= 750) { return true; } } throw new Error('LT network idle timeout'); };
    const log = {blocked: [], sent: [], msgs: [], confirms: [], saveCalled: false};
    const X = window.XMLHttpRequest; const op = X.prototype.open; const sd = X.prototype.send;
    X.prototype.open = function (m, u) { this.__fu = String(u || ''); return op.apply(this, arguments); };
    X.prototype.send = function (b) { const self = this; const nm = self.__fu.split('?')[0].split('/').pop().replace('.do', '');
      if (/send|delete|remove|cncl|insert|save|reg|update/i.test(nm)) { const ok = apply && nm === 'saveLtcpPofPlnppDesc'; if (!ok) { log.blocked.push(nm); return; } const rec = {u: nm}; log.sent.push(rec); self.addEventListener('loadend', () => { rec.status = self.status; try { rec.resp = String(self.responseText || '').replace(/<Parameters>[\s\S]*?<\/Parameters>/, '').replace(/\s+/g, ' ').slice(0, 300); } catch (e) { rec.resp = '?'; } }); }
      return sd.apply(this, arguments); };
    const restore = () => { try { const ifr = document.createElement('iframe'); ifr.style.display = 'none'; document.body.appendChild(ifr); const nx = ifr.contentWindow.XMLHttpRequest.prototype; XMLHttpRequest.prototype.open = nx.open; XMLHttpRequest.prototype.send = nx.send; document.body.removeChild(ifr); window.__ltInflOn = false; } catch (e) {} };
    const l = f.ds_pofPlnppList; const keep = [];
    let pop = null; let pf = null; let origMsg = null;
    const cleanup = async () => { try { if (pop) { pop.form.close('CLOSEONLY'); await sleep(500); } } catch (e) {} try { if (pf && origMsg === 'own') { delete pf.gfn_msgShow; } } catch (e) {} try { for (let i = 0; i < keep.length; i++) { l.setColumn(i, 'CHK', keep[i]); } f.ds_pofPlnppListCopy.clearData(); } catch (e) {} };
    const finish = async (o) => { await cleanup(); restore(); o.log = log; return o; };
    try {
      const frDt = spec.adptFr.replace(/-/g, ''); const toDt = spec.adptTo.replace(/-/g, '');
      const pn = spec.planNo; if (!pn || pn.confirm || !/^\d{3}$/.test(String(pn.ltcMgmtNoSeq)) || !/^\d{3}$/.test(String(pn.utilPlnppSeqNo))) { return await finish({status: 'fail', reason: '개인별장기요양이용계획서번호가 확인되지 않음(추정값으로 등록하지 않음)'}); }
              
      f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(0); await sleep(700);
      f.edt_fnm.set_value(spec.name); await sleep(200);
      f.btn_search_onclick(null, null); await sleep(600); await idle(15000);
      const rows = []; for (let i = 0; i < l.getRowCount(); i++) { rows.push({i, no: col(l, i, 'POF_PLNPP_MGMT_NO'), fnm: col(l, i, 'FNM'), cls: col(l, i, 'LTCP_CLSFC_CD'), mgmt: col(l, i, 'LTC_MGMT_NO'), seq: col(l, i, 'LTC_MGMT_NO_SEQ'), fr: col(l, i, 'ADPT_FR_DT'), to: col(l, i, 'ADPT_TO_DT'), ctr: col(l, i, 'LTCP_CTR_NO'), ctrFr: col(l, i, 'CTR_FR_DT'), ctrTo: col(l, i, 'CTR_TO_DT')}); keep.push(col(l, i, 'CHK')); }
      const mine = rows.filter((x) => x.fnm === spec.name && x.cls === '001' && x.mgmt === spec.ltcMgmtNo);
      if (mine.length === 0) { return await finish({status: 'fail', reason: '검색 결과에 ' + spec.name + ' 방문요양 계약이 없음(인정번호 ' + spec.ltcMgmtNo + ')', rows: rows.length}); }
      const dup = mine.filter((x) => x.fr === frDt && x.to === toDt);
      const before = mine.map((x) => x.no).filter(Boolean);
      const overlap = mine.filter(x => x.no && x.fr && x.to && x.fr <= toDt && frDt <= x.to);
      const additionalProblem = additionalPlanProblem(overlap, spec.creationIntent);
      if (additionalProblem) { return await finish({status: 'fail', reason: additionalProblem, plans: overlap.map(x => x.no)}); }
      const chosen = choosePlanContract(rows, spec, frDt, toDt);
      if (!chosen) { return await finish({status: 'fail', reason: '인정순번·계약기간이 일치하는 계약을 하나로 확정하지 못함'}); }
      if (spec.periodBasis && spec.periodBasis.type === 'continuation' && !mine.some(x => x.no === spec.periodBasis.previousPlanNo && x.to === spec.periodBasis.previousEnd.replace(/-/g, ''))) { return await finish({status: 'fail', reason: '서버의 이전 계획서 번호·종료일이 연속 작성 근거와 다름'}); }
                               
      for (let i = 0; i < l.getRowCount(); i++) { l.setColumn(i, 'CHK', i === chosen.i ? '1' : '0'); }
      f.fn_pofPlnppListChk(); await sleep(800);
      if (!f.btn_ins.enable) { return await finish({status: 'fail', reason: '등록 버튼이 활성화되지 않음(행 선택 실패)'}); }
                 
      f.btn_ins_onclick(null, null);
      for (let i = 0; i < 40; i++) { await sleep(250); try { if (w.npba410p01) { pop = w.npba410p01; break; } } catch (e) {} }
      if (!pop) { return await finish({status: 'fail', reason: '등록 팝업이 열리지 않음'}); }
      await sleep(2000); await idle(10000);
      pf = pop.form._div_bizFrameMain ? pop.form._div_bizFrameMain.form : pop.form;
      if (String(pf.medt_ltcMgmtNo.value) !== spec.ltcMgmtNo) { return await finish({status: 'fail', reason: '팝업의 인정번호가 spec과 다름 ' + pf.medt_ltcMgmtNo.value}); }
                                                     
      const origFn = pf.gfn_msgShow;
      pf.gfn_msgShow = function (obj, code, args) { const txt = String(code) + ' ' + (args || []).join(' ').replace(/\s+/g, ' ').slice(0, 160); if (code === 'XCTZ0051') { log.confirms.push(txt); return true; } log.msgs.push(txt); return false; };
      origMsg = 'own';
                                                       
      pf.medt_LtcMgmtNoSeq.set_value(spec.planNo.ltcMgmtNoSeq); pf.medt_UtilPlnppSeqNo.set_value(spec.planNo.utilPlnppSeqNo); await sleep(300);
      pf.fn_selectTbnpba10List(); await sleep(600); await idle(15000);
      const temp = pf.ds_tbnpba10Temp; const info = {tempRows: temp.getRowCount(), eda: col(temp, 0, 'RCGT_EDA_FR_DT') + '~' + col(temp, 0, 'RCGT_EDA_TO_DT'), pblt: col(temp, 0, 'PBLTN_DT'), cnt: col(temp, 0, 'CNT'), newChk: col(temp, 0, 'NEW_CHK'), cplt: col(temp, 0, 'CPLT_COUNT')};
                                                                                                                    
      if (temp.getRowCount() === 0) { return await finish({status: 'fail', reason: '이용계획서 번호로 유효기간을 찾지 못함(번호 확인 필요)', info}); }
      const edaFr = col(temp, 0, 'RCGT_EDA_FR_DT').replace(/\D/g, ''); const edaTo = col(temp, 0, 'RCGT_EDA_TO_DT').replace(/\D/g, '');
      if (edaFr.length !== 8 || edaTo.length !== 8 || frDt < edaFr || toDt > edaTo) { return await finish({status: 'fail', reason: '적용기간 ' + frDt + '~' + toDt + '이 인정유효기간(' + edaFr + '~' + edaTo + ') 밖이거나 확인되지 않음', info}); }
      if (spec.periodBasis && (edaFr !== spec.periodBasis.recognitionStart.replace(/-/g, '') || edaTo !== spec.periodBasis.recognitionEnd.replace(/-/g, '') || spec.periodBasis.type === 'renewal' && frDt !== edaFr)) { return await finish({status: 'fail', reason: '서버 인정기간 또는 갱신 적용 시작일이 확인한 근거와 다름', info}); }
      if (spec.creationIntent && spec.creationIntent.type === 'additional') { pf.cal_WrtDt.set_value(String(spec.writeDate || '').replace(/-/g, '')); }
      const popupWrtDt = String(pf.cal_WrtDt.value || '').replace(/\D/g, '').slice(0, 8);
      if (popupWrtDt !== String(spec.writeDate || '').replace(/-/g, '')) { return await finish({status: 'fail', reason: '롱텀 등록 화면의 작성일(' + popupWrtDt + ')이 spec 작성일과 다름', info}); }
      const d55 = pf.ds_npba55; if (d55.getRowCount() === 0) { d55.addRow(); }
      d55.setColumn(0, 'ADPT_FR_DT', frDt); d55.setColumn(0, 'ADPT_TO_DT', toDt);
                
      const rsn = pf.cmb_rsn; let rIdx = -1; try { const ids = rsn.getInnerDataset(); for (let i = 0; i < ids.getRowCount(); i++) { if (String(ids.getColumn(i, rsn.datacolumn)).trim() === spec.reason) { rIdx = i; } } } catch (e) {}
      if (rIdx < 0) { return await finish({status: 'fail', reason: '작성사유 "' + spec.reason + '" 를 콤보에서 찾지 못함', info}); }
      rsn.set_index(rIdx); await sleep(200);
      // The reviewed spec supplies the needs; do not seed a new plan with unrelated utilization-plan defaults.
      const autoOff = String(pf.chk_AutoCre.falsevalue);
      if (!['N', '0', 'false'].includes(autoOff)) { return await finish({status: 'fail', reason: '필요내용 자동생성 해제 값을 확인하지 못함'}); }
      pf.chk_AutoCre.set_value(autoOff);
                                                           
      d55.setColumn(0, 'RE_WRT_RSN_CD', String(rsn.value));
      const staged = {planNo: pf.medt_LtcMgmtNoSeq.value + '-' + pf.medt_UtilPlnppSeqNo.value, adpt: col(d55, 0, 'ADPT_FR_DT') + '~' + col(d55, 0, 'ADPT_TO_DT'), reason: String(rsn.text) + '(' + String(rsn.value) + ')', wrtDt: String(pf.cal_WrtDt.value), cls: String(pf.cmb_ltcpClsfcCd.value), autoCre: String(pf.chk_AutoCre.value)};
      if (staged.planNo !== spec.planNo.ltcMgmtNoSeq + '-' + spec.planNo.utilPlnppSeqNo) { return await finish({status: 'fail', reason: '번호 입력 불일치', staged}); }
                               
      log.saveCalled = apply; pf.btn_ins_onclick(null, null); await sleep(1500); await idle(25000); await sleep(800);
      const ds50 = pf.ds_npba50; const save50 = (ds50 && ds50.getRowCount()) ? {no: col(ds50, 0, 'LTC_MGMT_NO') + col(ds50, 0, 'LTC_MGMT_NO_SEQ') + '-' + col(ds50, 0, 'UTIL_PLNPP_SEQ_NO'), fr: col(ds50, 0, 'ADPT_FR_DT'), to: col(ds50, 0, 'ADPT_TO_DT'), rsn: col(ds50, 0, 'RE_WRT_RSN_CD'), cls: col(ds50, 0, 'LTCP_CLSFC_CD'), wrt: col(ds50, 0, 'WRT_DT')} : null;
      if (!apply) { return await finish({status: 'ok', mode: 'dry', step: 'register', info, staged, wouldSave: save50, duplicates: dup.map((x) => x.no)}); }
                                     
      await sleep(1500); f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(0); await sleep(700); f.btn_search_onclick(null, null); await sleep(600); await idle(15000);
      const after = []; for (let i = 0; i < l.getRowCount(); i++) { if (col(l, i, 'FNM') === spec.name && col(l, i, 'LTCP_CLSFC_CD') === '001' && col(l, i, 'LTC_MGMT_NO') === spec.ltcMgmtNo && col(l, i, 'ADPT_FR_DT') === frDt && col(l, i, 'ADPT_TO_DT') === toDt && col(l, i, 'LTC_MGMT_NO_SEQ') === pn.ltcMgmtNoSeq && col(l, i, 'UTIL_PLNPP_SEQ_NO') === pn.utilPlnppSeqNo) { after.push(col(l, i, 'POF_PLNPP_MGMT_NO')); } }
      const created = after.filter((x) => x && before.indexOf(x) < 0);
      const remaining = []; for (let i = 0; i < l.getRowCount(); i++) { const no = col(l, i, 'POF_PLNPP_MGMT_NO'); if (no) remaining.push(no); }
      const preserved = before.every(no => remaining.includes(no));
      return await finish({status: created.length === 1 && preserved ? 'ok' : 'fail', mode: 'apply', step: 'register', created, before, after, preserved, requestId: spec.creationIntent ? spec.creationIntent.requestId : '', reason: !preserved ? '기존 계획서 번호 보존 대조 실패' : created.length === 1 ? '' : '새 계획서 번호를 하나로 확정하지 못함'});
    } catch (e) { log.uncertain = true; return await finish({status: 'fail', reason: '예외: ' + String(e && e.message ? e.message : e).slice(0, 160)}); }
  }, P);
  console.log(JSON.stringify({ok: r.status === 'ok', r}));
}
