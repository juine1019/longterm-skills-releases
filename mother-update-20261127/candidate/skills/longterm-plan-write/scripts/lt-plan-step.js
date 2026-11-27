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
    let spec = null;
    try { spec = JSON.parse(await (async () => { const raw = Uint8Array.from(atob(a.spec.replace(/^gz:/, '')), (c) => c.charCodeAt(0)); if (a.spec.startsWith('gz:')) { return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); } return new TextDecoder().decode(raw); })()); } catch (e) { if (a.step !== 'read') { return {status: 'fail', reason: 'spec 해석 실패'}; } }
    const apply = a.mode === 'apply';
    if (apply && (!spec || a.approve !== spec.specHash)) { return {status: 'fail', reason: 'apply는 approve=spec 해시가 있어야 함'}; }
                                                  
    const allow = {needs: ['saveLtcpPofPlnppDescDtlNpba51'], cycle: ['saveNsstContnGroupCycl', 'saveDetailGoalTbnpba43'], final: ['saveLtcpPofPlnpp'], writer: [], select: [], read: []}[a.step] || [];
    if (!window.__ltInflOn) { window.__ltInflOn = true; window.__ltInfl = 0; const X0 = window.XMLHttpRequest; const sd0 = X0.prototype.send; X0.prototype.send = function () { window.__ltInfl++; this.addEventListener('loadend', () => { window.__ltInfl--; }); return sd0.apply(this, arguments); }; }
    const idle = async (maxMs) => { const t0 = Date.now(); let q = 0; while (Date.now() - t0 < maxMs) { await sleep(150); if (window.__ltInfl <= 0) { q += 150; } else { q = 0; } if (q >= 750) { return true; } } throw new Error('LT network idle timeout'); };
    const log = {blocked: [], sent: [], msgs: [], confirms: [], saveCalled: false};
    const X = window.XMLHttpRequest; const op = X.prototype.open; const sd = X.prototype.send; const wa = window.alert; const wc = window.confirm;
    X.prototype.open = function (m, u) { this.__fu = String(u || ''); return op.apply(this, arguments); };
    X.prototype.send = function (b) { const self = this; const u = self.__fu.split('?')[0]; const nm = u.split('/').pop().replace('.do', '');
      if (/send|delete|remove|cncl|insert|save|reg|update/i.test(nm)) { const ok = apply && allow.indexOf(nm) >= 0; if (!ok) { log.blocked.push(nm); return; } const rec = {u: nm}; log.sent.push(rec); self.addEventListener('loadend', () => { rec.status = self.status; try { rec.resp = String(self.responseText || '').replace(/<Parameters>[\s\S]*?<\/Parameters>/, '').replace(/\s+/g, ' ').slice(0, 300); } catch (e) { rec.resp = '?'; } }); }
      return sd.apply(this, arguments); };
    window.alert = function (m) { log.msgs.push(String(m).replace(/\s+/g, ' ').slice(0, 200)); };
    window.confirm = function (m) { const t0 = String(m).replace(/\s+/g, ' '); log.confirms.push(t0.slice(0, 100)); return apply && /저장하시겠습니까|등록하시겠습니까/.test(t0); };
    const restore = () => { try { const ifr = document.createElement('iframe'); ifr.style.display = 'none'; document.body.appendChild(ifr); const nx = ifr.contentWindow.XMLHttpRequest.prototype; XMLHttpRequest.prototype.open = nx.open; XMLHttpRequest.prototype.send = nx.send; window.alert = ifr.contentWindow.alert.bind(window); window.confirm = ifr.contentWindow.confirm.bind(window); document.body.removeChild(ifr); window.__ltInflOn = false; } catch (e) {} };
    const finish = (o) => { restore(); o.log = log; return o; };
    try {
      const dtl = f.ds_npba50Dtl; const planNo = col(dtl, 0, 'POF_PLNPP_MGMT_NO');
      if (a.step === 'needs' || a.step === 'cycle' || a.step === 'final') {
        const list = f.ds_pofPlnppList; let linked = -1;
        for (let i = 0; i < list.getRowCount(); i++) { if (col(list, i, 'POF_PLNPP_MGMT_NO') === planNo) { linked = i; break; } }
        if (!a.plan || linked < 0 || col(list, linked, 'LTC_MGMT_NO') !== spec.ltcMgmtNo) { return finish({status: 'fail', reason: 'Plan/recipient identity missing or changed'}); }
        if (spec.version === 2 && col(dtl, 0, 'WRT_DT') !== spec.writeDate.replace(/-/g, '')) { return finish({status: 'fail', reason: '선택된 계획서의 작성일이 확인되지 않거나 spec과 다름'}); }
      }
      if (a.step !== 'writer' && a.step !== 'read' && a.step !== 'select' && a.plan && planNo !== a.plan) { return finish({status: 'fail', reason: '선택된 계획서 ' + planNo + ' 가 지정한 ' + a.plan + ' 와 다름(이력 탭에서 해당 계획서를 선택해야 함)'}); }
      if (a.step !== 'read' && spec && a.step !== 'writer' && a.step !== 'select') {
        const row = (() => { const l = f.ds_pofPlnppList; for (let i = 0; i < l.getRowCount(); i++) { if (col(l, i, 'POF_PLNPP_MGMT_NO') === planNo) return i; } return -1; })();
        if (row >= 0) { const fr = col(f.ds_pofPlnppList, row, 'ADPT_FR_DT'), to = col(f.ds_pofPlnppList, row, 'ADPT_TO_DT'); if (fr !== spec.adptFr.replace(/-/g, '') || to !== spec.adptTo.replace(/-/g, '')) { return finish({status: 'fail', reason: '적용기간 불일치 ' + fr + '~' + to}); } }
        if (apply) { f.fn_selectDataTrsYn(); await idle(8000); if (col(f.ds_dataTrsYn, 0, 'DATA_TRS_YN') === 'Y') { return finish({status: 'fail', reason: '이미 통보(전송)된 계획서'}); } }
      }
      const sentOk = (nm) => log.sent.some((x) => x.u === nm && x.status === 200);
      const changedDs = [];
      const dirty = (d) => { try { for (let i = 0; i < d.getRowCount(); i++) { const t0 = d.getRowType(i); if (t0 === 2 || t0 === 4 || t0 === 8) return true; } return d.getDeletedRowCount() > 0; } catch (e) { return false; } };
                                                                           
      const reload = async () => { f.fn_selectLtcpPofPlnppDtl(); await sleep(500); await idle(15000); };
      const revert = async () => { await reload(); };
      const wrote = {};
                                                      
      if (a.step === 'select') {
        if (!a.plan) { return finish({status: 'fail', reason: 'select에는 plan(계획서 번호)이 필요함'}); }
        const l = f.ds_pofPlnppList; const find = () => { for (let i = 0; i < l.getRowCount(); i++) { if (col(l, i, 'POF_PLNPP_MGMT_NO') === a.plan) return i; } return -1; };
        f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(0); await sleep(700);
        let idx = find();
        if (idx < 0) { f.edt_fnm.set_value(spec.name); await sleep(200); f.btn_search_onclick(null, null); await sleep(600); await idle(15000); idx = find(); }
        if (idx < 0) { return finish({status: 'fail', reason: '목록에서 계획서 ' + a.plan + ' 를 찾지 못함'}); }
        if (col(l, idx, 'LTC_MGMT_NO') !== spec.ltcMgmtNo) { return finish({status: 'fail', reason: 'Selected plan belongs to a different recipient'}); }
        l.set_rowposition(idx); await sleep(300);
        f.tab_main.tpage1.form.grd_pofPlnppList_oncelldblclick(null, {row: idx, cell: 3});
        await sleep(800); await idle(15000);
        const d50 = f.ds_npba50; let r50 = -1; const find50 = () => { for (let i = 0; i < d50.getRowCount(); i++) { if (col(d50, i, 'POF_PLNPP_MGMT_NO') === a.plan) return i; } return -1; };
        r50 = find50(); if (r50 < 0) { f.fn_selectLtcpPofPlnppBasic(); await sleep(600); await idle(15000); r50 = find50(); }
        if (r50 < 0) { return finish({status: 'fail', reason: '계획서 이력에서 ' + a.plan + ' 를 찾지 못함', tab: f.tab_main.tabindex}); }
        for (let i = 0; i < d50.getRowCount(); i++) { d50.setColumn(i, 'CHK', i === r50 ? '1' : '0'); }
        d50.set_rowposition(r50);
        f.tab_main.tpage2.form.grd_npba50_oncellclick(f.tab_main.tpage2.form.grd_npba50, {row: r50, cell: 3});
        await sleep(300);
        if (col(f.ds_npba50Dtl, 0, 'POF_PLNPP_MGMT_NO') !== a.plan) { return finish({status: 'fail', reason: '계획 이력 행 선택과 상세번호가 일치하지 않음'}); }
        if (f.tab_main.tabindex !== 1) { return finish({status: 'fail', reason: '계획서 이력 탭으로 이동하지 못함', tab: f.tab_main.tabindex}); }
        f.btn_send_onclick(f.btn_send, null);
        await sleep(1000); await idle(20000); await sleep(500);
        const got = col(f.ds_npba50Dtl, 0, 'POF_PLNPP_MGMT_NO');
        return finish({status: got === a.plan ? 'ok' : 'fail', step: 'select', plan: got, tab: f.tab_main.tabindex, reason: got === a.plan ? '' : '상세가 ' + got + ' 로 열림'});
      }
                                 
      if (a.step === 'writer') {
        if (f.fv_fnm === spec.writer && f.fv_qlfNo) { return finish({status: 'ok', step: 'writer', writer: f.fv_fnm, note: '이미 선택됨'}); }
        let pop = null; try { pop = w.npba410p02 || null; } catch (e) {}
        if (!pop) { f.fn_wrtrChoiceSearch(); for (let i = 0; i < 40; i++) { await sleep(250); try { if (w.npba410p02) { pop = w.npba410p02; break; } } catch (e) {} } }
        if (!pop) { return finish({status: 'fail', reason: '작성자 팝업이 열리지 않음'}); }
        await sleep(1500);
        const pf = pop.form._div_bizFrameMain ? pop.form._div_bizFrameMain.form : pop.form; const ds = pf.ds_wkfcStusDtl;
        let idx = -1; for (let i = 0; i < ds.getRowCount(); i++) { if (col(ds, i, 'FNM') === spec.writer && String(col(ds, i, 'CLFY_CD_NM')).indexOf(spec.writerJob || '사회복지사') >= 0) { idx = i; break; } }
        if (idx < 0) { try { pop.form.close('CLOSEONLY'); } catch (e) {} return finish({status: 'fail', reason: '작성자 ' + spec.writer + ' (' + (spec.writerJob || '사회복지사') + ') 를 팝업에서 찾지 못함'}); }
        ds.set_rowposition(idx); await sleep(300); pf.fn_choice(); await sleep(1200);
        return finish({status: 'ok', step: 'writer', writer: f.fv_fnm, job: f.fv_clfyCdNm, kind: f.fv_eggrWkgTpNm, hasQlf: !!f.fv_qlfNo});
      }
                               
      if (a.step === 'read') { return finish({status: 'ok', step: 'read', plan: planNo, tab: f.tab_main.tabindex}); }
                                
      if (a.step === 'needs') {
        if (f.tab_main.tabindex !== 2) { f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(2); await sleep(600); await idle(10000); }
        if (!f.fv_fnm || !f.fv_qlfNo) { return finish({status: 'fail', reason: '작성자가 선택되지 않음(먼저 step=writer)'}); }
        if (dirty(f.ds_npba51)) { return finish({status: 'fail', reason: '화면에 저장하지 않은 필요내용 변경이 있음(사용자가 확인)'}); }
        const d51 = f.ds_npba51; const g51 = f.tab_main.tpage3.form.grd_npba51;
        const nameOf = (i) => String(g51.getCellText(i, 6) || '').trim();
        const want = new Set(spec.items.map((x) => x.name)); const have = []; const toSet = []; const missing = [];
        for (const nm of want) { let idx = -1; for (let i = 0; i < d51.getRowCount(); i++) { if (nameOf(i) === nm) { idx = i; break; } } if (idx < 0) { missing.push(nm); } else { const cur = col(d51, idx, 'PAY_CONTN_CHOICE_YN'); if (cur === '1') { have.push(nm); } else { toSet.push({idx, nm, cur}); } } }
        const extra = []; for (let i = 0; i < d51.getRowCount(); i++) { if (col(d51, i, 'PAY_CONTN_CHOICE_YN') === '1' && !want.has(nameOf(i))) { extra.push(nameOf(i)); } }
        if (missing.length) { return finish({status: 'fail', reason: '필요내용 목록에 없는 항목', missing}); }
        if (extra.length && a.allowRemove !== '1') { return finish({status: 'fail', reason: 'spec에 없는 필요내용이 이미 선택돼 있음(-AllowRemove로 해제 가능)', extra}); }
        for (const x of toSet) { if (x.cur !== '0') { d51.set_enableevent(false); d51.setColumn(x.idx, 'PAY_CONTN_CHOICE_YN', '0'); d51.set_enableevent(true); } d51.setColumn(x.idx, 'PAY_CONTN_CHOICE_YN', '1'); }
        const removed = []; if (extra.length) { for (let i = 0; i < d51.getRowCount(); i++) { if (col(d51, i, 'PAY_CONTN_CHOICE_YN') === '1' && !want.has(nameOf(i))) { d51.set_enableevent(false); d51.setColumn(i, 'PAY_CONTN_CHOICE_YN', '0'); d51.set_enableevent(true); removed.push(nameOf(i)); } } }
        changedDs.push(d51);
        const staged = toSet.map((x) => x.nm).concat(removed.map((n) => '-' + n));
        if (!apply) { await revert(); return finish({status: 'ok', mode: 'dry', step: 'needs', already: have.length, staged}); }
        if (staged.length === 0) { return finish({status: 'ok', mode: 'apply', step: 'needs', note: '변경 없음(저장 생략)', already: have.length}); }
        log.saveCalled = true; f.fn_saveLtcpPofPlnppDescDtlNpba51(); await sleep(500); await idle(20000);
        if (!sentOk('saveLtcpPofPlnppDescDtlNpba51')) { return finish({status: 'fail', reason: '필요내용 저장 요청이 전송되지 않음', staged}); }
        return finish({status: 'ok', mode: 'apply', step: 'needs', saved: staged});
      }
                                                           
      if (a.step === 'cycle') {
                                                           
        if (f.tab_main.tabindex !== 2) { f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(2); await sleep(800); await idle(12000); }
        const existing = {}; for (let i = 0; i < f.ds_npba43.getRowCount(); i++) { existing[col(f.ds_npba43, i, 'FTU_DETAIL_CONTN')] = col(f.ds_npba43, i, 'DETAIL_GOAL_CONTN'); }
        f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(3); await sleep(800); await idle(12000);
        const d52 = f.ds_npba52; const d43 = f.ds_npba43; const dg = f.ds_npba51Group;
        const p4 = f.tab_main.tpage4.form; const grid = p4.div_tbnpb52.form.grd_npba52;
        if (dirty(d52) || dirty(d43)) { return finish({status: 'fail', reason: '화면에 저장하지 않은 목표 주기·세부목표 변경이 있음(사용자가 확인)'}); }
        const byFtu = {}; for (let i = 0; i < d52.getRowCount(); i++) { const k = col(d52, i, 'FTU_DETAIL_CONTN'); (byFtu[k] = byFtu[k] || []).push(i); }
        const tok = (s0) => String(s0).replace(/[\s.,()]/g, '');
                                                                     
        const HINTS = [[/옷/, '옷갈아입기'], [/세면|세수/, '세면'], [/양치|틀니/, '양치'], [/몸씻기/, '몸씻기'], [/머리감기/, '머리감기']];
        const groupOf = (item) => { const rows = byFtu[item.ftu] || []; if (rows.length === 1) return rows[0]; if (item.ftu === 'A10') { for (const [re, key] of HINTS) { if (re.test(item.name)) { const hit = rows.find((i) => col(d52, i, 'NSST_CONTN_GROUP_NM').indexOf(key) >= 0); if (hit !== undefined) return hit; } } } let best = -1, sc = 0; for (const i of rows) { const gn = tok(col(d52, i, 'NSST_CONTN_GROUP_NM')); const inm = tok(item.name); let s1 = inm.indexOf(gn) >= 0 ? 100 + gn.length : 0; for (let k = 2; k <= gn.length; k++) { for (let q = 0; q + k <= gn.length; q++) { if (inm.indexOf(gn.substr(q, k)) >= 0) s1 = Math.max(s1, k); } } if (s1 > sc) { sc = s1; best = i; } } return sc >= 2 ? best : -1; };
        const groupItems = {}; const unmapped = [];
        for (const it of spec.items) { const g = groupOf(it); if (g < 0) { unmapped.push(it.name); } else { (groupItems[g] = groupItems[g] || []).push(it); } }
        if (unmapped.length) { return finish({status: 'fail', reason: '그룹을 찾지 못한 항목(사용자 지정 필요)', unmapped}); }
        const orphan = []; for (let i = 0; i < d52.getRowCount(); i++) { if (!groupItems[i]) { orphan.push(col(d52, i, 'NSST_CONTN_GROUP_NM')); } }
        if (orphan.length) { return finish({status: 'fail', reason: 'spec에 없는 그룹이 롱텀에 있음', orphan}); }
        const forceMissing = String(a.forceMissing || '').split(',').filter(Boolean);
        const adm = col(f.ds_npba50, 0, 'LTC_ADMIN_SYM') || f.fv_sLtcAdminSym;
                                                                  
        const stagedS = []; const needFix = [];
        for (const ftu of Object.keys(spec.subGoals)) {
          const want = spec.subGoals[ftu]; const have = forceMissing.indexOf(ftu) >= 0 ? undefined : existing[ftu];
          if (have === undefined) {
            const pay = (spec.items.find((x) => x.ftu === ftu) || {}).payType || '';
            const n = d43.addRow(); d43.setColumn(n, 'POF_PLNPP_MGMT_NO', planNo); d43.setColumn(n, 'MNTR_SEQ_NO', 1); d43.setColumn(n, 'PAYMT_TYPE_NM', pay); d43.setColumn(n, 'FTU_DETAIL_CONTN', ftu); d43.setColumn(n, 'LTC_ADMIN_SYM', adm); d43.setColumn(n, 'DETAIL_GOAL_CONTN', want);
            stagedS.push({ftu, add: want});
          } else if (have !== want) { needFix.push(ftu); }
        }
                             
        const stagedG = [];
        for (const gi of Object.keys(groupItems)) {
          const items = groupItems[gi]; const daily = items.filter((x) => x.cycle === '일');
          const wantCyc = daily.length ? '3' : '4'; const wantCnt = daily.length ? String(Math.max(...daily.map((x) => x.count || 1))) : ''; const wantMin = daily.length ? String(daily.reduce((s2, x) => s2 + x.minutes, 0)) : String(Math.max(30, ...items.map((x) => x.minutes || 0)));
          const i = Number(gi); const cur = [col(d52, i, 'HLT_MGMT_CYCL_TYPE'), col(d52, i, 'WRK_CYCL_VL'), col(d52, i, 'NEED_TMN')].join('|');
          if (cur !== [wantCyc, wantCnt, wantMin].join('|')) { d52.setColumn(i, 'HLT_MGMT_CYCL_TYPE', wantCyc); d52.setColumn(i, 'WRK_CYCL_VL', wantCnt); d52.setColumn(i, 'NEED_TMN', wantMin); stagedG.push({group: col(d52, i, 'NSST_CONTN_GROUP_NM'), from: cur, to: [wantCyc, wantCnt, wantMin].join('|')}); }
        }
        if (needFix.length) { return finish({status: 'fail', reason: '기존 세부목표 문구가 spec과 다름(수정은 사용자가 확인)', needFix, existing}); }
                                                                    
        const reloadAll = async () => { f.fn_selectLtcpPofPlnppDtl(); await sleep(500); await idle(15000); f.fn_selectNsstContnGroupCyclList(); await sleep(500); await idle(15000); };
        if (!apply) { const sum = {groups: stagedG, subGoals: stagedS, groupCount: d52.getRowCount(), subGoalRowsStaged: d43.getRowCount()}; await reloadAll(); return finish({status: 'ok', mode: 'dry', step: 'cycle', ...sum}); }
        if (stagedG.length === 0 && stagedS.length === 0) { return finish({status: 'ok', mode: 'apply', step: 'cycle', note: '변경 없음(저장 생략)'}); }
        const n0 = log.sent.filter((x) => x.u === 'saveNsstContnGroupCycl' && x.status === 200).length;
        log.saveCalled = true; try { f.fn_saveNsstContnGroupCycl(); } catch (e) { return finish({status: 'fail', reason: '목표 주기 저장 중 화면 예외: ' + String(e.message).slice(0, 100), groups: stagedG, subGoals: stagedS}); }
        await sleep(500); await idle(25000);
        const n1 = log.sent.filter((x) => x.u === 'saveNsstContnGroupCycl' && x.status === 200).length;
        if (n1 - n0 !== 1) { return finish({status: 'fail', reason: '목표 주기 저장 요청이 1회 전송되지 않음(' + (n1 - n0) + '회)', groups: stagedG, subGoals: stagedS}); }
        return finish({status: 'ok', mode: 'apply', step: 'cycle', saved: {groups: stagedG.length, subGoals: stagedS.length, requests: n1 - n0}});
      }
                                
      if (a.step === 'final') {
        if (f.tab_main.tabindex !== 4) { f.fv_tabFlag = 'Y'; f.tab_main.set_tabindex(4); await sleep(800); await idle(12000); }
        if (!f.fv_fnm || !f.fv_qlfNo) { return finish({status: 'fail', reason: '작성자가 선택되지 않음(먼저 step=writer)'}); }
        if (dirty(dtl)) { return finish({status: 'fail', reason: '화면에 저장하지 않은 계획서 변경이 있음(사용자가 확인)'}); }
        if (spec.decisionNeeded && spec.decisionNeeded.length) { return finish({status: 'fail', reason: '종합의견 결정이 필요함: ' + spec.decisionNeeded[0].slice(0, 80)}); }
        const tp = f.tab_main.tpage5.form; const agreeDate = String(spec.agree && spec.agree.agreeDate || '').replace(/-/g, '');
        if (!/^\d{8}$/.test(agreeDate) || f.fv_fnm !== spec.confirmer) { return finish({status: 'fail', reason: '확정 동의일 또는 선택된 최종확인자가 명세와 다름'}); }
        const phone = String(a.phone || '').replace(/\D/g, ''); if (phone.length < 9) { return finish({status: 'fail', reason: '전화번호가 필요함(phone)'}); }
        const snapIds = ['GOAL_CONTN', 'OVR_OPIN_CONTN', 'AAS_FNM', 'AGRE_DT', 'PRS_AGRE_YN', 'AAS_TEL_NO', 'PRS_REL_CD', 'AGRE_MTH_CD', 'LAST_CFRP_NM', 'LAST_CFRP_EMP_NO']; const snap = {}; for (const id of snapIds) { snap[id] = col(dtl, 0, id); }
        const before = {goal: col(dtl, 0, 'GOAL_CONTN').length, opin: col(dtl, 0, 'OVR_OPIN_CONTN').length, agre: col(dtl, 0, 'AGRE_DT'), name: col(dtl, 0, 'AAS_FNM')};
        tp.cmb_agreMth.set_value('00'); tp.cboPrsRelCd.set_value('00'); tp.edt_AasFnm.set_value(spec.agree.agreeName); tp.edt_AasTelNo.set_value(phone);
        tp.cal_AgreDt.set_value(agreeDate); tp.cbx_PrsAgreYn.set_value('Y');
        tp.txa_goalContn.set_value(spec.goal); tp.txa_ovrOpinContn.set_value(spec.opinion);
        dtl.setColumn(0, 'LAST_CFRP_NM', f.fv_fnm); dtl.setColumn(0, 'LAST_CFRP_EMP_NO', f.fv_qlfNo);
        await sleep(300);
                                                                 
        const ensure = (id, v) => { if (col(dtl, 0, id) !== v) { dtl.setColumn(0, id, v); } };
        ensure('GOAL_CONTN', spec.goal); ensure('OVR_OPIN_CONTN', spec.opinion); ensure('AAS_FNM', spec.agree.agreeName); ensure('AGRE_DT', agreeDate); ensure('PRS_AGRE_YN', 'Y');
        changedDs.push(dtl);
        const now = {goal: col(dtl, 0, 'GOAL_CONTN') === spec.goal, opin: col(dtl, 0, 'OVR_OPIN_CONTN') === spec.opinion, name: col(dtl, 0, 'AAS_FNM'), agre: col(dtl, 0, 'AGRE_DT'), yn: col(dtl, 0, 'PRS_AGRE_YN'), lastCfrp: col(dtl, 0, 'LAST_CFRP_NM')};
        const telCols = []; for (let c = 0; c < dtl.getColCount(); c++) { const id = dtl.getColID(c); if (/TEL|REL|MTH/.test(id)) telCols.push(id + '=' + col(dtl, 0, id)); }
        if (!apply) { for (const id of snapIds) { dtl.setColumn(0, id, snap[id]); } try { dtl.applyChange(); } catch (e) {} return finish({status: 'ok', mode: 'dry', step: 'final', before, now, telCols}); }
        if (!now.goal || !now.opin) { return finish({status: 'fail', reason: '목표/종합의견이 데이터셋에 반영되지 않음', now}); }
        log.saveCalled = true; f.fn_saveLtcpPofPlnpp(); await sleep(500); await idle(20000);
        if (!sentOk('saveLtcpPofPlnpp')) { return finish({status: 'fail', reason: '계획서 저장 요청이 전송되지 않음', now}); }
        return finish({status: 'ok', mode: 'apply', step: 'final', now, telCols});
      }
      return finish({status: 'fail', reason: '알 수 없는 step ' + a.step});
    } catch (e) { log.uncertain = true; return finish({status: 'fail', reason: '예외: ' + String(e && e.message ? e.message : e).slice(0, 160)}); }
  }, P);
  console.log(JSON.stringify({ok: r.status === 'ok', r}));
}
