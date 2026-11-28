const pickLtTab=async(tabs,role)=>{const main=tabs.filter(x=>/^https:\/\/(www\.)?longtermcare\.or\.kr\/npbs\/xui\/manage\.html([?#]|$)/.test(String(x.url||'')));for(const x of main){let type=null;try{await attachBrowserTab(x.targetId);type=await page.evaluate(()=>{try{const u=nexacro.getApplication().gds_userInfo;return u&&u.getRowCount()?String(u.getColumn(0,'USER_TYPE')||''):null}catch(e){return null}})}catch(e){type=null}if(type===role)return x;if(main.length===1&&!type)return x}return undefined};
var LTScheduleEngine = async function(P, workflow) {
const tabsL = await listBrowserTabs();
const t = (await pickLtTab(tabsL,'20A'));
if (!t) { console.log(JSON.stringify({ok: false, error: '롱텀 업무 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  if(workflow==='rfid')await page.evaluate(ltCognitiveCore);
  const started=await page.evaluate((a0) => { if(window.__ltJobBusy||window.__ltCollectionBusy||window.__ltTagReadBusy)return {status:'hold',reason:'이전 화면 작업이 아직 진행 중'};window.__ltJobRes = null; let owns = false; const run = async (a) => {
    if (!/^\d{6}$/.test(String(a.ym))) { return {prs: a.prs, phase: a.phase, status: 'hold', reason: 'ym 형식 오류(YYYYMM 6자리)'}; }
    const app = nexacro.getApplication(); const fw = app.mainframe.VFrameSet.HFrameSet.VFrameSetSub.framesetWork;
    let pf = null; for (const k in fw) { try { if (/^win/.test(k) && fw[k] && fw[k].npia107p01) { pf = fw[k].npia107p01; } } catch (e) {} }
    if (!pf) { return {prs: a.prs, phase: a.phase, status: 'fail', reason: '급여제공일 창이 열려 있지 않음'}; }
    if (window.__ltJobBusy || window.__ltCollectionBusy || window.__ltTagReadBusy) { return {prs: a.prs, phase: a.phase, status: 'fail', reason: '이전 화면 작업이 아직 진행 중'}; }
    owns = true; window.__ltJobBusy = true;
    const f = pf.form._div_bizFrameMain.form; const dm = f.div_main.form;
    const phase = a.phase; const apply = phase === 'cancel' || phase === 'add' || phase === 'batch';
    if (apply && a.approve !== 'GONGDAN-OK') { return {prs: a.prs, phase, status: 'fail', reason: 'cancel/add는 승인 값(approve) 필요'}; }
    const rfid = a.workflow === 'rfid';
    if (!rfid && (phase === 'dry' || apply)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.today || ''))) { return {prs: a.prs, ym: a.ym, phase, status: 'hold', reason: 'today 값 필요(YYYY-MM-DD)'}; }
      const days0 = String(a.cancels || '').split(';').concat(String(a.adds || '').split(';')).filter(Boolean).map((x) => Number(x.split('|')[0]));
      for (const d0 of days0) { const iso0 = a.ym.slice(0, 4) + '-' + a.ym.slice(4, 6) + '-' + String(d0).padStart(2, '0'); if (!(d0 >= 1 && d0 <= 31)) { return {prs: a.prs, ym: a.ym, phase, status: 'hold', reason: '날짜 형식 오류: ' + d0}; } if (iso0 < a.today) { return {prs: a.prs, ym: a.ym, phase, status: 'hold', reason: '지난 날짜 포함(오늘 이후만 처리): ' + d0 + '일'}; } }
    }
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const num = (v) => Number(v);
    if (!window.__ltInflOn) { window.__ltInflOn = true; window.__ltInfl = 0; const X0 = window.XMLHttpRequest; const sd0 = X0.prototype.send; X0.prototype.send = function () { window.__ltInfl++; this.addEventListener('loadend', () => { window.__ltInfl--; }); return sd0.apply(this, arguments); }; }
    const idle = async (maxMs) => { const t0 = Date.now(); let q = 0; while (Date.now() - t0 < maxMs) { await sleep(150); if (window.__ltInfl <= 0) { q += 150; } else { q = 0; } if (q >= 750) { return true; } } return false; };
    const log = {msgs: [], blocked: [], confirms: [], reqs: []};
    const X = window.XMLHttpRequest; const op = X.prototype.open; const sd = X.prototype.send; const wa = window.alert; const wc = window.confirm;
    X.prototype.open = function (m, u) { this.__fu = String(u || ''); return op.apply(this, arguments); };
    const cleanBody = (b) => String(b || '').replace(/<Parameters>[\s\S]*?<\/Parameters>/, '').replace(/<Dataset id=.gds_userInfo.>[\s\S]*?<\/Dataset>/, '').replace(/<ColumnInfo>[\s\S]*?<\/ColumnInfo>/g, '<CI/>').replace(/\s+/g, ' ').trim();
    X.prototype.send = function (b) { const self = this; const u = self.__fu.split('?')[0]; if (/save|cncl|delete|remove|insert/i.test(u)) { if (!apply) { log.blocked.push(u.slice(-40)); return; } const rec = {u: u.slice(-30), body: cleanBody(b).slice(0, 1800)}; log.reqs.push(rec); self.addEventListener('loadend', () => { rec.status = self.status; try { const rt = String(self.responseText || ''); const mc = rt.match(/ErrorCode.[^>]*>([^<]*)</); const mm = rt.match(/ErrorMsg.[^>]*>([^<]*)</); rec.resp = 'ErrorCode=' + (mc ? mc[1] : '') + ' ErrorMsg=' + (mm ? mm[1].slice(0, rfid&&a.recipientBatch==='true'?500:120) : ''); } catch (e) { rec.resp = '?'; } }); } return sd.apply(this, arguments); };
    window.alert = function (m) { log.msgs.push(String(m).replace(/\s+/g, ' ').slice(0, rfid&&a.recipientBatch==='true'?500:200)); if(rfid&&a.recipientBatch==='true'&&apply)return; return wa.apply(this, arguments); };
    let addingPgm=false;const cognitiveCore=window.__ltCognitiveCore;
    window.confirm = function (m) { const s = String(m).replace(/\s+/g, ' '); if (s.indexOf('인지활동형 방문요양으로 등록하시겠습니까') >= 0) { log.confirms.push(addingPgm?'인지활동형 확인창->확인':'인지활동형 확인창->취소(일반)'); return addingPgm; } log.confirms.push(s.slice(0, 80)); return wc.apply(this, arguments); };
    const restore = () => { try { const ifr = document.createElement('iframe'); ifr.style.display = 'none'; document.body.appendChild(ifr); const nx = ifr.contentWindow.XMLHttpRequest.prototype; XMLHttpRequest.prototype.open = nx.open; XMLHttpRequest.prototype.send = nx.send; window.alert = ifr.contentWindow.alert.bind(window); window.confirm = ifr.contentWindow.confirm.bind(window); document.body.removeChild(ifr); window.__ltInflOn = false; } catch (e) {} };
    const out = {prs: a.prs, ym: a.ym, phase, status: 'ok', transmissions: 0};
    const hold = (reason) => { out.status = 'hold'; out.reason = reason; return out; };
    const select = async (ctr) => { try { f.cmb_obj.set_value(ctr); } catch (e) {} f.fv_sLtcpOffrYyyymm = a.ym; f.fn_setChangObjInfo(ctr); const ok = await idle(15000); return ok && String(f.ds_objtr.getColumn(0, 'LTCP_CTR_NO')) === String(ctr) && String(f.cmb_obj.value) === String(ctr) && String(f.fv_sLtcpCtrNo) === String(ctr); };
    const parseOps = (s) => String(s || '').split(';').filter(Boolean).map((x) => { const p = x.split('|'); return {d: Number(p[0]), cg: p[1], fr: p[2], to: p[3]}; });
    const key = (r) => [r.d, r.cg, r.fr, r.to].join('|');
    const readLive = () => { const res = []; const pd = dm.ds_paymtDypr; for (let i = 0; i < pd.getRowCount(); i++) { for (let d = 1; d <= 31; d++) { if (String(pd.getColumn(i, 'DT' + d)) === '1') { res.push({d, row: i, cg: String(pd.getColumn(i, 'CHE_NM')), workerId:String(pd.getColumn(i,'CHE_HIPIN')||''),managerId:String(pd.getColumn(i,'PGM_MNGR_HIPIN')||''),managerName:String(pd.getColumn(i,'PGM_MNGR_NM')||''), fr: String(pd.getColumn(i, 'LTCP_OFFR_FR_TM')), to: String(pd.getColumn(i, 'LTCP_OFFR_TO_TM')), fam: String(pd.getColumn(i, 'FMLY_YN')), dmd: String(pd.getColumn(i, 'DT' + d + '_DMD_STATE')) === 'Y', pgm: ['1', 'Y'].indexOf(String(pd.getColumn(i, 'PGM_MNGR_YN'))) >= 0}); } } } return res; };
    const setEq = (x, y) => { const sx = new Set(x); const sy = new Set(y); if (sx.size !== sy.size) { return false; } for (const k of sx) { if (!sy.has(k)) { return false; } } return true; };
 const readOnlyCognitiveSequence=(ds,i,cols)=>{
  if(ds!==dm.ds_apprvCtrDtl||String(f.fv_sLtcRcgtGradeCd)!=='5'||cols.length!==1||cols[0]!=='AC_SEQ_NO')return false;
  if(String(ds.getColumn(i,'AC_SEQ_NO'))!=='0'||!/^\d+$/.test(String(ds.getOrgColumn(i,'AC_SEQ_NO'))))return false;
  if(String(ds.getColumn(i,'AC_YN'))!=='N'||String(ds.getOrgColumn(i,'AC_YN'))!=='N')return false;
  const native=String(dm.bfn_i_setAcYnForPct||''),callback=String(dm.fn_postSelectPaymtContnNtctBasicInfo||'');
  return /this\.ds_apprvCtrDtl\.setColumn\(\s*i\s*,\s*['"]AC_SEQ_NO['"]\s*,\s*0\s*\)/.test(native)&&/this\.ds_apprvCtrDtl\.setColumn\(\s*i\s*,\s*['"]AC_YN['"]\s*,\s*['"]N['"]\s*\)/.test(native)&&callback.includes('this.bfn_i_setAcYnForPct()');
 };
    const stats = (ctr) => { const ad = dm.ds_apprvCtrDtl; const pd = dm.ds_paymtDypr; let cncl = 0; let ins = 0; let wrong = 0; for (let i = 0; i < ad.getRowCount(); i++) { const ty = ad.getRowType(i); if (ty === 4 && String(ad.getColumn(i, 'CNCL_YN')) === 'Y') { cncl++; } if (ty === 2 || (ty === 4 && String(ad.getColumn(i, 'CNCL_YN')) !== 'Y' && !readOnlyCognitiveSequence(ad,i,Array.from({length:ad.getColCount()},(_,j)=>ad.getColID(j)).filter(c=>String(ad.getColumn(i,c))!==String(ad.getOrgColumn(i,c)))))) { ins++; } if (ty !== 1) { const v = String(ad.getColumn(i, 'LTCP_CTR_NO')); if (v !== '' && v !== String(ctr)) { wrong++; } } } for (let i = 0; i < pd.getRowCount(); i++) { const v = String(pd.getColumn(i, 'LTCP_CTR_NO')); if (v !== '' && v !== 'undefined' && v !== 'null' && v !== String(ctr)) { wrong++; } } return {cncl, ins, wrong, tot: String(f.ds_limitAmt.getColumn(0, 'MM_TOT_AMT')), lmt: String(f.ds_limitAmt.getColumn(0, 'MM_LMT_AMT')), freq: String(f.ds_limitAmt.getColumn(0, 'MM_FREQ')), excs: String(f.ds_limitAmt.getColumn(0, 'EXCS_YN'))}; };
    const saveAndWait = async () => { const start = log.msgs.length; f.btn_save_onclick(f.btn_save, {}); const t0 = Date.now(); while (Date.now() - t0 < 60000) { await sleep(300); if (log.msgs.slice(start).some((m) => m.indexOf('공단전송') >= 0 || m.indexOf('오류') >= 0 || m.indexOf('없') >= 0 || m.indexOf('불가') >= 0 || m.indexOf('초과') >= 0)) { break; } } await idle(20000); const msgs = log.msgs.slice(start); return {saved: msgs.some((m) => m.indexOf('공단전송을 완료') >= 0), msgs}; };
    const sendAndWaitTransport = async () => { const start=log.reqs.length;f.btn_save_onclick(f.btn_save,{});const t0=Date.now();while(Date.now()-t0<60000){const q=log.reqs.slice(start);if(q.length===1&&Number.isInteger(q[0].status))break;await sleep(300);}await idle(20000);return {msgs:[]}; };
    const doCancel = async (c) => { const hit = readLive().filter((x) => x.d === c.d && x.cg === c.cg && x.fr === c.fr && x.to === c.to); if (hit.length !== 1) { return {d: c.d, ok: false, reason: '현재 일정과 일치하는 항목 ' + hit.length + '개'}; } if (hit[0].pgm && !a.executionGroupKey) { return {d: c.d, ok: false, reason: '인지활동형 일정(사용자 직접 처리)'}; } if (hit[0].dmd) { return {d: c.d, ok: false, reason: '서비스내용 저장 상태 날짜'}; } dm.ds_paymtDypr.setColumn(hit[0].row, 'DT' + c.d, '0'); await sleep(150); if (String(dm.ds_paymtDypr.getColumn(hit[0].row, 'DT' + c.d)) !== '0') { return {d: c.d, ok: false, reason: '해제 거부(' + (log.msgs.slice(-1)[0] || '화면 검증') + ')'}; } return {d: c.d, ok: true}; };
    const addGroup = async (cg, fr, to, days) => {
      const res = {ok: false, added: [], reason: ''};
      const targets=days.map(d=>{const x=evidenceDecoded.find(e=>+e.date.slice(8)===d);return x&&(a.restore==='true'?x.old:x.next);});
      const intent=targets[0],pgm=!!(a.executionGroupKey&&intent?.pgm);
      if(a.executionGroupKey&&days.some((d,i)=>!targets[i]||!!targets[i].pgm!==pgm||pgm&&(targets[i].managerId!==intent.managerId||targets[i].managerName!==intent.managerName))){if(days.length===1){res.reason='인지활동형 재입력 근거 불일치';return res;}for(const d of days){const sub=await addGroup(cg,fr,to,[d]);res.added.push(...sub.added);if(!sub.ok){res.reason=sub.reason;return res;}}res.ok=true;return res;}
      const evidence=evidenceDecoded.find(e=>+e.date.slice(8)===days[0]);
      const reference=pgm?{managerId:intent.managerId,managerName:intent.managerName,workerId:evidence.workerId,workerName:cg}:null;
      let ri = -1; { const pd = dm.ds_paymtDypr; for (let i = 0; i < pd.getRowCount(); i++) { if (String(pd.getColumn(i, 'CHE_NM')) === cg && String(pd.getColumn(i, 'LTCP_OFFR_FR_TM')) === fr && String(pd.getColumn(i, 'LTCP_OFFR_TO_TM')) === to && (!a.executionGroupKey || ['1','Y'].includes(String(pd.getColumn(i,'PGM_MNGR_YN')))===pgm && (!pgm || String(pd.getColumn(i,'PGM_MNGR_HIPIN'))===reference.managerId))) { ri = i; } } }
      if (ri < 0) {
        addingPgm=pgm;const rowsBefore = dm.ds_paymtDypr.getRowCount(); dm.btn_addRow_onclick(dm.btn_addRow, {});
        let pp = null; for (let i = 0; i < 80; i++) { await sleep(150); try { if (pf.npia115p01) { pp = pf.npia115p01; break; } } catch (e) {} }
        if (!pp) { res.reason = '종사자검색 창이 열리지 않음(' + (log.msgs.slice(-1)[0] || '') + ')'; return res; }
        const pform = pp.form._div_bizFrameMain.form; await idle(15000);
        const dh = pform.ds_hdofcEggr; const idx = []; for (let i = 0; i < dh.getRowCount(); i++) { if (String(dh.getColumn(i, 'FNM')) === cg) { idx.push(i); } }
        if(pgm){try{cognitiveCore.selectManager(pform,reference);cognitiveCore.selectWorker(pform,reference);}catch(e){try{pform.btn_close_onclick(pform.btn_close,{});}catch(close){}res.reason=e.message;return res;}}
        if (!pgm && idx.length !== 1) { try { pform.btn_close_onclick(pform.btn_close, {}); } catch (e) {} await sleep(400); res.reason = '요양보호사 ' + cg + ' 일치 ' + idx.length + '명'; return res; }
        if(!pgm){dh.setColumn(idx[0], 'CHK', '1'); pform.btn_add_onclick(pform.btn_add, {}); await sleep(700);}
        const cd = pform.ds_choiceEggr; if (cd.getRowCount() !== 1) { try { pform.btn_close_onclick(pform.btn_close, {}); } catch (e) {} await sleep(400); res.reason = '요양보호사 선택 실패 ' + cg + '(' + (log.msgs.slice(-1)[0] || '') + ')'; return res; }
        cd.setColumn(0, 'LTCP_OFFR_FR_TM', fr); cd.setColumn(0, 'LTCP_OFFR_TO_TM', to); pform.btn_choice_onclick(pform.btn_choice, {}); await idle(15000); await sleep(900);
        let still = false; try { still = !!pf.npia115p01; } catch (e) {}
        if (still || dm.ds_paymtDypr.getRowCount() !== rowsBefore + 1) { res.reason = '입력 확정 실패 ' + cg + '(' + (log.msgs.slice(-1)[0] || '') + ')'; return res; }
        addingPgm=false;ri = dm.ds_paymtDypr.getRowCount() - 1;
        if(pgm&&(String(dm.ds_paymtDypr.getColumn(ri,'PGM_MNGR_HIPIN'))!==reference.managerId||!['1','Y'].includes(String(dm.ds_paymtDypr.getColumn(ri,'PGM_MNGR_YN'))))) {res.reason='관리자 선택 결과 불일치';return res;}
        if (String(dm.ds_paymtDypr.getColumn(ri, 'LTCP_OFFR_TMN')) === '') { res.reason = '제공시간 계산 실패 ' + cg; return res; }
      }
      if(a.executionGroupKey){const wanted=evidenceDecoded.find(x=>x.old.cg===cg)?.workerId;if(!wanted||String(dm.ds_paymtDypr.getColumn(ri,'CHE_HIPIN'))!==wanted){res.reason='요양보호사 원천 ID 불일치';return res;}}
      for (const d of days) { const nb = dm.ds_apprvCtrDtl.getRowCount(); dm.ds_paymtDypr.setColumn(ri, 'DT' + d, '1'); await sleep(120); if (dm.ds_apprvCtrDtl.getRowCount() !== nb + (pgm?2:1)) { await idle(8000); res.reason = d + '일 체크 거부(' + (log.msgs.slice(-1)[0] || '화면 검증') + ')'; return res; } res.added.push(d); }
      res.ok = true; return res;
    };
    let evidenceDecoded=[];let cleanupCtr = ''; let cleanupKeys = null;let originalCatalog=null;
    try {
      const last = new Date(Number(a.ym.slice(0, 4)), Number(a.ym.slice(4, 6)), 0).getDate(); const mStart = a.ym + '01'; const mEnd = a.ym + String(last);
      if(a.ctr&&!Array.from({length:f.ds_objList.getRowCount()},(_,i)=>String(f.ds_objList.getColumn(i,'LTCP_CTR_NO'))).includes(a.ctr)){const meta=JSON.parse(a.contractMeta||'null');if(!meta||String(meta.ctr)!==a.ctr||!meta.recipientId)return hold('기간 내 원천 계약 정보 필요');originalCatalog=f.ds_objList.saveXML();f.ds_objList.set_enableevent(false);try{const i=f.ds_objList.addRow();for(const [k,v] of Object.entries({LTCP_CTR_NO:meta.ctr,OBJTR:meta.prs,OBJTR_HIPIN:meta.recipientId,LTCP_CLSFC_CD:meta.clsfc,LTC_RCGT_GRADE_CD:meta.grade,CTR_FR_DT:String(meta.from).replace(/-/g,''),CTR_TO_DT:String(meta.to).replace(/-/g,'')}))f.ds_objList.setColumn(i,k,v);}finally{f.ds_objList.set_enableevent(true);}}
      const cands = []; const dl = f.ds_objList; for (let i = 0; i < dl.getRowCount(); i++) { const nm = String(dl.getColumn(i, 'OBJTR')).split('(')[0]; if (nm === a.prs && (!a.ctr || String(dl.getColumn(i, 'LTCP_CTR_NO')) === a.ctr)) { const fr = String(dl.getColumn(i, 'CTR_FR_DT')); const to = String(dl.getColumn(i, 'CTR_TO_DT')); if (fr <= mEnd && to >= mStart) { cands.push({ctr: String(dl.getColumn(i, 'LTCP_CTR_NO'))}); } } }
      if (cands.length !== 1) { return hold('이번 달과 겹치는 계약 ' + cands.length + '개(0개는 계약 없음, 2개 이상은 계약 교체 월이라 이 스킬에서 처리하지 않음)'); }
      const ctr = cands[0].ctr;
      const closeStale = async () => { try { if (pf.npia115p01) { const pf2 = pf.npia115p01.form._div_bizFrameMain.form; pf2.btn_close_onclick(pf2.btn_close, {}); } } catch (e) {} await sleep(400); };
      if (phase === 'dry' || phase === 'add') { await closeStale(); }
      if(a.reuseCurrent==='true'&&a.deferredFinal==='true'&&phase==='batch'){
        if(String(f.cmb_obj.value)!==ctr||String(f.fv_sLtcpCtrNo)!==ctr||String(f.ds_objtr.getColumn(0,'LTCP_CTR_NO'))!==ctr||String(f.cmb_ctrYm.value)!==a.ym||f.fv_sChgYn==='Y'||window.__ltInfl>0)return hold('재사용할 계약 화면 상태 확인 필요');
      }else if (!(await select(ctr))) { return hold('계약 전환 실패 ' + ctr); }
      out.ctr = ctr; out.name = String(f.ds_objtr.getColumn(0, 'FNM')); out.grade = String(f.ds_objtr.getColumn(0, 'LTC_RCGT_GRADE_CD')); out.dmtia = String(f.ds_objtr.getColumn(0, 'DMTIA_OBJTR_YN'));
      if (String(f.cmb_ctrYm.value) !== a.ym) { return hold('월 콤보가 ' + f.cmb_ctrYm.value); }
      if (num(f.ds_pofPlnppYn.getColumn(0, 'POF_PLNPP_YN')) !== 1 || num(f.ds_fstPofPlnppYn.getColumn(0, 'FST_POF_PLNPP_YN')) !== 1) { return hold('급여제공계획 미통보'); }
      if (phase !== 'read' && (a.executionGroupKey?['1','2','3','4','5']:['1','2','3','4']).indexOf(out.grade) < 0) { return hold('지원 범위 밖 등급 확인 필요'); }
      const before = readLive();
      const beforeKeys = before.map(key);
      cleanupCtr = ctr; cleanupKeys = beforeKeys;
      out.mg = String(f.ds_objtr.getColumn(0, 'LTC_MGMT_NO'));
      if(a.executionGroupKey){const u=app.gds_userInfo,source=String(u.getColumn(0,'LTC_ADMIN_SYM')||u.getColumn(0,'ADMIN_SYM')||'');if(String(u.getColumn(0,'USER_TYPE'))!=='20A'||String(u.getColumn(0,'USER_NM'))!==a.orgName||!source)return hold('LT 기관 불일치');if(a.unplanned==='true'&&(a.recipientBatch!=='true'||String(out.grade)==='5'))return hold('계획 없는 일정의 관리자 확인 필요');const month=a.ym.slice(0,4)+'-'+a.ym.slice(4),parts=a.unplanned==='true'?[source,'unplanned',out.mg,month]:[source,out.mg,ctr,String(f.fv_sLtcpClsfcCd),month];const digest=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts)));const group=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');if(group!==(a.executionContractGroupKey||a.executionGroupKey))return hold('서버 저장 원천 계약·월 불일치');}
      if (!rfid && a.mg && out.mg.replace(/\D/g, '') !== a.mg.replace(/\D/g, '')) return hold('LT 인정번호 불일치');
      if (!rfid && a.expectedLive && !setEq(beforeKeys, JSON.parse(a.expectedLive).map(key))) return hold('직전 조회 이후 LT 일정 변경');
      evidenceDecoded = [];
      if (rfid) {
        if (out.name !== a.prs || out.mg.replace(/\D/g, '') !== String(a.mg || '').replace(/\D/g, '')) { return hold('LT 수급자/인정번호 불일치'); }
        const kstToday = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        const policy = (0, eval)('(' + a.policySource + ')');
        try { evidenceDecoded = policy(a, before, kstToday); } catch (e) { out.noSaveRequested=true; return hold(e.message); }
        if(phase!=='read'&&(a.unplanned==='true'?!evidenceDecoded.every(x=>x.unplanned===true&&typeof x.initialAdd==='boolean'&&!x.old.pgm):a.mixedUnplanned==='true'?a.recipientBatch!=='true'||String(out.grade)==='5'&&evidenceDecoded.some(x=>x.unplanned===true)||evidenceDecoded.some(x=>x.unplanned===true&&(typeof x.initialAdd!=='boolean'||x.old.pgm||x.next&&x.next.pgm)):evidenceDecoded.some(x=>x.unplanned===true)))return hold('계획 없는 태그 범위 확인 필요');
        if(a.deferredFinal==='true'&&a.recipientBatch!=='true'&&evidenceDecoded.length!==1)return hold('최종 일괄 확인 모드는 한 날짜씩 전송해야 합니다');
        if(a.executionGroupKey&&phase!=='read'){for(const x of evidenceDecoded){if(!x.workerId||!x.sourceKey)return hold('요양보호사 원천 증빙 필요');const source=a.recipientBatch==='true'&&x.sourceOld?x.sourceOld:x.old;if(source.cg!==x.old.cg||String(source.fam)!==String(x.old.fam))return hold('원천 요양보호사·급여구분 불일치');const orgId=String(app.gds_userInfo.getColumn(0,'LTC_ADMIN_SYM')||app.gds_userInfo.getColumn(0,'ADMIN_SYM')),tagMin=v=>{const p=String(v||'').split(':');return p.length===3?Number(p[0])*60+Number(p[1])+Number(p[2])/60:null;},identity=x.unplanned===true?[orgId,'tag',out.mg,x.date.replace(/-/g,''),x.old.cg,tagMin(x.actual[0]?.start),tagMin(x.actual[0]?.end)]:[orgId,out.mg,ctr,String(f.fv_sLtcpClsfcCd),x.date,null,x.workerId,source.fr,source.to,String(source.fam)];const raw=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)));if(Array.from(new Uint8Array(raw),n=>n.toString(16).padStart(2,'0')).join('')!==x.sourceKey)return hold('요양보호사 원천 식별 불일치');const hit=before.filter(v=>v.d===+x.date.slice(8)&&(a.recipientBatch!=='true'||!x.old||v.cg===x.old.cg||x.next&&v.cg===x.next.cg));if(!hit.length&&a.restore!=='true'&&!(a.recipientBatch==='true'&&(x.initialAdd===true||a.retryAdd==='true'&&phase==='add'))||hit.some(v=>v.workerId!==x.workerId))return hold('요양보호사 원천 ID 변경');const pd=dm.ds_paymtDypr;for(let i=0;i<pd.getRowCount();i++)if(String(pd.getColumn(i,'CHE_NM'))===x.old.cg&&String(pd.getColumn(i,'CHE_HIPIN')||'')!==x.workerId)return hold('동일 성명 요양보호사 원천 ID가 다릅니다');}}
        if (phase !== 'read') {
          const pd = dm.ds_paymtDypr;
          for (const x of evidenceDecoded) { for (let i = 0; i < pd.getRowCount(); i++) { if (String(pd.getColumn(i, 'DT' + Number(x.date.slice(8)) + '_DMD_STATE')) === 'Y') { out.noSaveRequested=true; return hold('서비스내용저장됨: '+x.date); } } }
          const reasonExists = (ds, code) => { for (let i = 0; i < ds.getRowCount(); i++) { if (String(ds.getColumn(i, 'BASE_CD')) === code) return true; } return false; };
          if (!a.reasonNote || !reasonExists(dm.div_chgRsn.form.cmb_chgRsnCd1.getInnerDataset(), a.reasonCode) || (a.reasonCode === '04' && !reasonExists(dm.div_chgRsn.form.cmb_chgRsnCd2.getInnerDataset(), a.detailReasonCode))) { return hold('화면 수정사유 코드/사용자 사유 미확인'); }
          dm.btn_upd_onclick(dm.btn_upd, {});
          const rf = dm.div_chgRsn.form;
          rf.cmb_chgRsnCd1.set_value(a.reasonCode); dm.div_chgRsn_cmb_chgRsnCd1_onitemchanged(rf.cmb_chgRsnCd1, {});
          if (a.reasonCode === '04') rf.cmb_chgRsnCd2.set_value(a.detailReasonCode);
          dm.div_chgRsn_btn_conf_onclick(rf.btn_conf, {});
          if (f.fv_sChgYn !== 'Y' || f.fv_lastChgRsnCd1 !== a.reasonCode || (a.reasonCode === '04' && f.fv_lastChgRsnCd2 !== a.detailReasonCode)) { return hold('지난일정 수정/사유 선택 실패'); }
        }
      }
      const hasCognitive=a.executionGroupKey&&(before.some(v=>v.pgm)||evidenceDecoded.some(e=>e.old?.pgm));
      const verifyPairs=()=>!hasCognitive||cognitiveCore.verifyDetails(cognitiveCore.readDetails(dm.ds_apprvCtrDtl),cognitiveCore.detailsForVisits(readLive(),a.ym,ctr));
      if(phase!=='read'&&!verifyPairs())return hold('관리자·요양보호사 상세 내역 대조 불일치');
      const detailCount=(ops,add)=>ops.reduce((n,o)=>{const e=evidenceDecoded.find(e=>+e.date.slice(8)===o.d&&(!e.old||e.old.cg===o.cg||e.next&&e.next.cg===o.cg)),slot=e&&(add&&a.restore!=='true'?e.next:e.old);return n+(a.executionGroupKey&&slot?.pgm?2:1);},0);
      let discardKeys = beforeKeys;
      const stateProof=rows=>JSON.stringify(rows.map(v=>[key(v),v.workerId||'',String(v.fam),!!v.pgm,v.pgm?v.managerId:'',v.pgm?v.managerName:'']).sort());
      const discardAll = async () => { await closeStale(); return (await select(ctr)) && setEq(readLive().map(key), discardKeys) && (!a.executionGroupKey||stateProof(readLive())===stateProof(before.filter(v=>discardKeys.includes(key(v))))); };
      const holdDiscard = async (reason) => { try { out.discarded = await discardAll(); } catch (e) { out.discarded = false; } return hold(reason); };
      const familyCheck = () => { if (!rfid) return ''; for (const x of evidenceDecoded) { const s = a.restore === 'true' ? (a.recipientBatch === 'true' ? x.old : (x.next && x.old)) : x.next; if (!s || s.fam == null) continue; const hit = readLive().filter(z => z.d === Number(x.date.slice(8)) && z.cg === s.cg && z.fr === s.fr && z.to === s.to); if (hit.length !== 1 || hit[0].fam !== String(s.fam)) return '가족요양 구분/입력 대상 불일치: ' + x.date;if(a.executionGroupKey&&(!!hit[0].pgm!==!!s.pgm||s.pgm&&(hit[0].managerId!==s.managerId||hit[0].managerName!==s.managerName)||hit[0].workerId!==x.workerId))return '프로그램 관리자·요양보호사 입력 대상 불일치: '+x.date; } return ''; };
      const preSave = () => { if(!verifyPairs())return '저장 직전 관리자·요양보호사 상세 불일치'; const c = String(f.cmb_obj.value); const v = String(f.fv_sLtcpCtrNo); const d = String(f.ds_objtr.getColumn(0, 'LTCP_CTR_NO')); const y = String(f.cmb_ctrYm.value); if (rfid && (f.fv_sChgYn !== 'Y' || f.fv_lastChgRsnCd1 !== a.reasonCode || (a.reasonCode === '04' && f.fv_lastChgRsnCd2 !== a.detailReasonCode))) return '지난일정 수정사유 불일치'; return (c === String(ctr) && v === String(ctr) && d === String(ctr) && y === a.ym) ? '' : '저장 직전 계약 불일치(저장하지 않음): combo=' + c + ' fv=' + v + ' ds=' + d + ' ym=' + y; };
      if (phase === 'read') {
        out.live = before.map((x) => ({d: x.d, cg: x.cg, workerId:x.workerId, managerId:x.managerId,managerName:x.managerName, fr: x.fr, to: x.to, fam: x.fam, dmd: x.dmd, pgm: x.pgm}));
        out.noPending=window.__ltInflOn===true&&window.__ltInfl===0;
        const s = stats(ctr); out.tot = s.tot; out.lmt = s.lmt; out.freq = s.freq; out.excs = s.excs;
        return out;
      }
      if (phase === 'dry') {
        const cancels = parseOps(a.cancels); const adds = parseOps(a.adds);
        out.cancelResults = []; out.addResults = [];
        let simErr = null;
        try {
          for (const c of cancels) { out.cancelResults.push(await doCancel(c)); }
          const groups = {}; for (const x of adds) { const k = [x.cg, x.fr, x.to].join('|'); (groups[k] = groups[k] || []).push(x.d); }
          for (const k of Object.keys(groups)) { const [cg, fr, to] = k.split('|'); const days = groups[k]; const r = await addGroup(cg, fr, to, days); for (const d of days) { out.addResults.push(r.added.indexOf(d) >= 0 ? {d, ok: true} : {d, ok: false, reason: r.reason}); } }
          await idle(20000);
          out.sim = stats(ctr); out.sim.expectCancels = cancels.length; out.sim.expectAdds = adds.length;
          out.familyError = familyCheck();out.pairVerified=verifyPairs();
        } catch (e) { simErr = e; }
        out.alerts = log.msgs.slice(0, 12);
        try { out.discarded = await discardAll(); } catch (e) { out.discarded = false; if (!simErr) { simErr = e; } }
        if (simErr) { throw simErr; }
        const fails = out.cancelResults.concat(out.addResults).filter((x) => !x.ok);
        out.status = (fails.length === 0 && out.sim.cncl === detailCount(cancels,false) && out.sim.ins === detailCount(adds,true) && out.sim.wrong === 0 && out.sim.excs !== 'Y' && out.pairVerified && out.discarded && log.blocked.length === 0 && !out.familyError) ? 'dry-ok' : 'dry-fail';
        if (out.status === 'dry-fail' && fails.length === 0) { out.reason = '시뮬레이션 대조 불일치(cncl ' + out.sim.cncl + '/' + cancels.length + ', ins ' + out.sim.ins + '/' + adds.length + ', wrong ' + out.sim.wrong + ', excs ' + out.sim.excs + ', discarded ' + out.discarded + ')'; }
        return out;
      }
      if (phase === 'batch') {
        const cancels = parseOps(a.cancels), adds = parseOps(a.adds);
        if (!rfid || !cancels.length&&!(a.recipientBatch==='true'&&a.deferredFinal==='true'&&adds.length&&evidenceDecoded.every(x=>x.initialAdd===true)) || a.reasonCode !== '04' || a.detailReasonCode !== '18') return hold('일괄 지난일정/수급자 일정 임의변경 사유 확인 필요');
        out.cancelSaved = false; out.addSaveRequested = false;
        const acknowledged = sv => sv.saved && log.reqs.length > 0 && log.reqs.every(q => q.status === 200 && /^ErrorCode=0(?:\s|$)/.test(q.resp || ''));
        const armReason = () => { dm.btn_upd_onclick(dm.btn_upd, {}); const rf = dm.div_chgRsn.form; rf.cmb_chgRsnCd1.set_value(a.reasonCode); dm.div_chgRsn_cmb_chgRsnCd1_onitemchanged(rf.cmb_chgRsnCd1, {}); rf.cmb_chgRsnCd2.set_value(a.detailReasonCode); dm.div_chgRsn_btn_conf_onclick(rf.btn_conf, {}); };
        let pre;
        if(cancels.length){
        out.cancelResults = [];
        for (const c of cancels) out.cancelResults.push(await doCancel(c));
        const badCancel = out.cancelResults.find(x => !x.ok), cancelStats = stats(ctr);
        out.cancelValidation={...cancelStats,expectedDetails:detailCount(cancels,false)}; if (badCancel || cancelStats.cncl !== detailCount(cancels,false) || cancelStats.ins !== 0 || cancelStats.wrong) return await holdDiscard('일괄 취소 입력 검증 실패(저장하지 않음)');
        pre = preSave(); if (pre) return await holdDiscard(pre);
        const cancelSave = await saveAndWait();
        out.cancelAcknowledged = acknowledged(cancelSave); out.cancelSaveMsgs = cancelSave.msgs;
        if (!out.cancelAcknowledged) { if(a.deferredFinal==='true')out.noPending=window.__ltInflOn===true&&window.__ltInfl===0;out.status = 'fail'; out.reason = '취소 저장 성공 응답 미확인: 입력/재시도 중단'; return out; }
        out.cancelSaved = true; out.transmissions = 1;
        discardKeys = beforeKeys.filter(k => cancels.map(key).indexOf(k) < 0);
        if (!(await idle(20000))) { out.status = 'fail'; out.reason = '취소 저장 후 사이트 자동 갱신 미완료'; return out; }
        const ready = stats(ctr);
        if (ready.cncl || ready.ins || ready.wrong || String(f.cmb_obj.value) !== ctr || String(f.fv_sLtcpCtrNo) !== ctr || String(f.ds_objtr.getColumn(0, 'LTCP_CTR_NO')) !== ctr || String(f.cmb_ctrYm.value) !== a.ym) { out.status = 'fail'; out.reason = '취소 후 입력 화면/계약 준비 미확인'; return out; }
        }else{out.cancelSaved=true;}
        if (adds.length) {
          if(cancels.length)armReason(); pre = preSave(); if (pre) return await holdDiscard(pre);
          const groups = {}; for (const x of adds) { const k = [x.cg,x.fr,x.to].join('|'); (groups[k] = groups[k] || []).push(x.d); }
          out.addResults = [];
          try {
            for (const k of Object.keys(groups)) { const [cg,fr,to] = k.split('|'), days = groups[k], r = await addGroup(cg,fr,to,days); for (const d of days) out.addResults.push(r.added.indexOf(d) >= 0 ? {d,ok:true} : {d,ok:false,reason:r.reason}); }
            await idle(20000);
            const st = stats(ctr), bad = out.addResults.find(x => !x.ok), fe = familyCheck();
            if (bad || fe || st.ins !== detailCount(adds,true) || st.cncl || st.wrong || st.excs === 'Y') return await holdDiscard(fe || '일괄 신규 입력 검증 실패(추가 저장하지 않음)');
            pre = preSave(); if (pre) return await holdDiscard(pre);
          } catch (e) { out.discarded = await discardAll(); throw e; }
          out.addSaveRequested = true;
          const addRequestStart = log.reqs.length;
          const addSave = a.deferredFinal==='true'?await sendAndWaitTransport():await saveAndWait();
          out.addSaveMsgs = addSave.msgs;
          if(a.deferredFinal==='true'){
            const requests=log.reqs.slice(addRequestStart);
            if(requests.length!==1||requests[0].status!==200){out.unknown=true;out.noPending=window.__ltInflOn===true&&window.__ltInfl===0;out.status='fail';out.reason='추가 저장 전송 완료 미확인';return out;}
            if(a.recipientBatch==='true'&&/^ErrorCode=-[1-9]\d*(?:\s|$)/.test(requests[0].resp||'')){out.status='rejected';out.reason=String(requests[0].resp||'').slice(0,500);return out;}
            if(a.recipientBatch==='true'&&!/^ErrorCode=0(?:\s|$)/.test(requests[0].resp||'')){out.unknown=true;out.status='fail';out.reason='추가 저장 결과 불명';return out;}
          }else out.addAcknowledged = acknowledged(addSave);
          if (a.deferredFinal!=='true'&&!out.addAcknowledged) {
            const requests = log.reqs.slice(addRequestStart);
            const rejected = requests.length === 1 && requests[0].status === 200 && /^ErrorCode=-[1-9]\d*(?:\s|$)/.test(requests[0].resp || '');
            if (rejected) {
              try { out.discarded = await discardAll(); } catch (e) { out.discarded = false; }
              if (out.discarded) { out.addRejected = true; out.scheduleConflict = /SWIA0008/.test(requests[0].resp || ''); out.unknown = false; out.status = 'hold'; out.reason = '신규 입력 거절: 수동 확인 필요'; return out; }
            }
            out.status = 'fail'; out.reason = '추가 저장 성공 응답 미확인: 추가/원복 재시도 금지'; return out;
          }
          out.transmissions++;
        }
        if(a.deferredFinal==='true'){out.transportFinished=true;out.status='submitted';return out;}
        if (!(await select(ctr))) { out.status = 'fail'; out.reason = '최종 전체월 재조회 실패: 저장 재시도 금지'; return out; }
        const finalLive = readLive();
        out.verified = setEq(finalLive.map(key), discardKeys.concat(adds.map(key))) && !familyCheck() && verifyPairs();
        out.live = finalLive.map(x => ({d:x.d,cg:x.cg,workerId:x.workerId,managerId:x.managerId,managerName:x.managerName,fr:x.fr,to:x.to,fam:x.fam,dmd:x.dmd,pgm:x.pgm}));
        const finalStats = stats(ctr); out.tot = finalStats.tot; out.lmt = finalStats.lmt; out.freq = finalStats.freq; out.excs = finalStats.excs;
        out.saved = out.cancelSaved && (!adds.length || out.addAcknowledged);
        out.status = out.saved && out.verified ? 'saved' : 'fail';
        if (!out.verified) out.reason = '최종 월 일정/가족구분 불일치: 저장 재시도 금지';
        return out;
      }
      if (phase === 'cancel') {
        const cancels = parseOps(a.cancels); if (cancels.length === 0) { return hold('취소 항목 없음'); }
        out.cancelResults = [];
        try {
          for (const c of cancels) { out.cancelResults.push(await doCancel(c)); }
          const bad = out.cancelResults.filter((x) => !x.ok); const st = stats(ctr);
          if (bad.length > 0 || st.cncl !== detailCount(cancels,false) || st.ins !== 0 || st.wrong > 0) { return await holdDiscard('취소 단계 검증 실패(저장하지 않음): ' + (bad[0] ? bad[0].reason : 'cncl ' + st.cncl + '/' + cancels.length + ', ins ' + st.ins + ', wrong ' + st.wrong)); }
          const pre = preSave(); if (pre) { return await holdDiscard(pre); }
        } catch (e) { try { out.discarded = await discardAll(); } catch (e2) { out.discarded = false; } throw e; }
        const sv = await saveAndWait(); out.saved = sv.saved; out.saveMsgs = sv.msgs;
        if (!(await select(ctr))) { out.status = 'fail'; out.reason = '저장 후 재조회 실패'; return out; }
        const cancelKeys = cancels.map(key); const expected = beforeKeys.filter((k) => cancelKeys.indexOf(k) < 0);
        out.verified = setEq(readLive().map(key), expected) && verifyPairs(); out.tot2 = stats(ctr).tot; out.ctrRight = String(f.cmb_obj.value) === String(ctr);
        out.status = (out.saved && out.verified && out.ctrRight) ? 'saved' : 'fail'; if (out.status === 'fail') { out.reason = '취소 저장 확인 실패(saved=' + out.saved + ', verified=' + out.verified + ')'; }
        return out;
      }
      if (phase === 'add') {
        const adds = parseOps(a.adds); if (adds.length === 0) { return hold('추가 항목 없음'); }
        out.addResults = [];
        try {
          const groups = {}; for (const x of adds) { const k = [x.cg, x.fr, x.to].join('|'); (groups[k] = groups[k] || []).push(x.d); }
          for (const k of Object.keys(groups)) { const [cg, fr, to] = k.split('|'); const days = groups[k]; const r = await addGroup(cg, fr, to, days); for (const d of days) { out.addResults.push(r.added.indexOf(d) >= 0 ? {d, ok: true} : {d, ok: false, reason: r.reason}); } }
          await idle(20000);
          const bad = out.addResults.filter((x) => !x.ok); const st = stats(ctr); out.sim = st;
          const fe = familyCheck(); if (fe) return await holdDiscard(fe);
          if (bad.length > 0 || st.ins !== detailCount(adds,true) || st.cncl !== 0 || st.wrong > 0 || st.excs === 'Y') { return await holdDiscard('신규 입력 단계 검증 실패(저장하지 않음): ' + (bad[0] ? bad[0].reason : 'ins ' + st.ins + '/' + adds.length + ', cncl ' + st.cncl + ', wrong ' + st.wrong + ', excs ' + st.excs)); }
          const pre = preSave(); if (pre) { return await holdDiscard(pre); }
        } catch (e) { try { out.discarded = await discardAll(); } catch (e2) { out.discarded = false; } throw e; }
        if(a.recipientBatch==='true'&&a.retryAdd==='true'&&a.deferredFinal==='true'){
          const start=log.reqs.length;out.addSaveRequested=true;await sendAndWaitTransport();const requests=log.reqs.slice(start);
          if(requests.length!==1||requests[0].status!==200){out.unknown=true;out.status='fail';out.reason='재시도 전송 결과 불명';return out;}
          if(/^ErrorCode=-[1-9]\d*(?:\s|$)/.test(requests[0].resp||'')){out.status='rejected';out.reason=String(requests[0].resp||'').slice(0,500);return out;}
          if(!/^ErrorCode=0(?:\s|$)/.test(requests[0].resp||'')){out.unknown=true;out.status='fail';out.reason='재시도 저장 결과 불명';return out;}
          out.transmissions=1;out.transportFinished=true;out.status='submitted';return out;
        }
        const sv = await saveAndWait(); out.saved = sv.saved; out.saveMsgs = sv.msgs;
        if (!(await select(ctr))) { out.status = 'fail'; out.reason = '저장 후 재조회 실패'; return out; }
        const expected = beforeKeys.concat(adds.map(key));
        out.verified = setEq(readLive().map(key), expected) && verifyPairs(); out.tot2 = stats(ctr).tot; out.ctrRight = String(f.cmb_obj.value) === String(ctr);
        out.status = (out.saved && out.verified && out.ctrRight) ? 'saved' : 'fail'; if (out.status === 'fail') { out.reason = '신규 입력 저장 확인 실패(saved=' + out.saved + ', verified=' + out.verified + ')'; }
        return out;
      }
                   
      return hold('알 수 없는 phase: ' + phase);
    } catch (e) { out.status = 'fail'; out.reason = String(e && e.message ? e.message : e).slice(0, 160); return out; }
    finally { if(a.deferredFinal==='true')out.noPending=window.__ltInflOn===true&&window.__ltInfl===0; if (rfid && phase !== 'read' && !apply && cleanupKeys && out.discarded !== true) { try { out.discarded = (await select(cleanupCtr)) && setEq(readLive().map(key), cleanupKeys); } catch (e) { out.discarded = false; } } if (rfid && phase !== 'read' && (out.discarded === true || out.verified === true)) { try { dm.btn_close_onclick(dm.btn_close, {}); out.popupClosed = true; } catch (e) { out.popupClosed = false; } } if(originalCatalog){try{f.ds_objList.set_enableevent(false);f.ds_objList.loadXML(originalCatalog);f.ds_objList.set_enableevent(true);}catch(e){}} window.__ltJobBusy = false; out.log = {msgs: log.msgs.slice(-10), confirms: log.confirms.slice(0, 4), blocked: log.blocked, reqs: log.reqs.map((q) => ({u: q.u, status: q.status, resp: q.resp, bodyLen: String(q.body).length}))}; restore(); }
  }; run(a0).then((v) => { if (owns) { window.__ltJobBusy = false; } window.__ltJobRes = JSON.parse(JSON.stringify(v)); }).catch((e) => { if (owns) { window.__ltJobBusy = false; } window.__ltJobRes = {status: 'fail', reason: String(e && e.message ? e.message : e).slice(0, 160)}; }); return 'started'; }, {workflow, ctr:P.ctr||String(), contractMeta:P.contractMeta||String(), executionGroupKey:P.executionGroupKey||String(), executionContractGroupKey:P.executionContractGroupKey||String(), orgName:P.orgName||String(), policySource: workflow === 'rfid' ? LTRfidPolicy.toString() : '', phase: P.phase || 'read', ym: P.ym || '', prs: P.prs || '', cancels: P.cancels || '', adds: P.adds || '', approve: P.approve || '', today: P.today || '', mg: P.mg || '', evidence: P.evidence || '', expectedLive: P.expectedLive || '', validationOnly: P.validationOnly || '', userConfirmed: P.userConfirmed || '', reasonCode: P.reasonCode || '', detailReasonCode: P.detailReasonCode || '', reasonNote: P.reasonNote || '', restore: P.restore || '',restoreCancel:P.restoreCancel || '', deferredFinal:P.deferredFinal || '',recipientBatch:P.recipientBatch || '',unplanned:P.unplanned || '', mixedUnplanned:P.mixedUnplanned||String(),retryAdd:P.retryAdd || '',reuseCurrent:P.reuseCurrent || ''});
  if(started!=='started'){console.log(JSON.stringify({ok:false,r:started}));return;}
  let r = null; for (let i = 0; i < 105; i++) { await sleep(1000); try { r = await page.evaluate(() => window.__ltJobRes); } catch (e) { r = null; } if (r) { break; } }
  if (!r) { r = {prs: P.prs, phase:P.phase, status: 'fail', unknown:true, reason: '작업이 105초 안에 끝나지 않음(화면 작업은 계속 중일 수 있음, 상태를 읽어서 확인해야 함)'}; }
  console.log(JSON.stringify({ok: true, r}));
}
};
