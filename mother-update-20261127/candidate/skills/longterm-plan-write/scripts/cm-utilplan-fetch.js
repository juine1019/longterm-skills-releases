                                                                                     
                                                                 
                                                                                                                                
const P = __P__;
const tabsL = await listBrowserTabs();
let t = tabsL.find(x => x.url.includes('care-m.co.kr/longterm/prs/list')); if (!t) { await openTab('https://www.care-m.co.kr/longterm/prs/list'); t = (await listBrowserTabs()).find(x => x.url.includes('care-m.co.kr/longterm/prs/list')); }
if (!t) { console.log(JSON.stringify({ok: false, error: '케어매니저 수급자 관리 탭 없음'})); } else {
  await attachBrowserTab(t.targetId);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {status: 'error'};
  try {
    await page.reload(); await sleep(4500);
    await page.fill('#search_name', P.name); await page.click('.InputBox button'); await sleep(3000);
    const sel = await page.evaluate((nm) => { const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.display !== 'none' && b.width > 0 && b.height > 0; }; const rs = [...document.querySelectorAll('tr')].filter(vis).filter((x) => { const em = x.querySelector('em.sup_name'); return em && em.innerText.trim() === nm; }); return {n: rs.length, ltc: rs.length === 1 ? ((rs[0].querySelector('input.ag_ck') || {}).value || '') : ''}; }, P.name);
    if (sel.n !== 1 || !sel.ltc) { out.reason = '수급자 목록에서 ' + P.name + ' 를 정확히 1명 찾지 못함(' + sel.n + ')'; console.log(JSON.stringify({ok: false, out})); }
    else {
      const r = await page.evaluate(async (ltc0) => {
        const ltc = ltc0;
        const csrf = (document.cookie.match(/csrf_cookie_name=([^;]+)/) || [])[1] || (document.querySelector('input[name=csrf_test_name]') || {}).value || '';
        const res = {ltc, files: [], pdfs: []};
        if (!ltc || !csrf) { throw new Error('CM identity/CSRF unavailable'); }
        const yr = new Date().getFullYear();
        for (const year of [String(yr), String(yr - 1)]) {
          const body = new URLSearchParams({csrf_test_name: csrf, LTC_MGMT_NO: ltc, year, lpf_category: 'basic'});
          const j = await (await fetch('/longterm/prs/getFileList', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString(), credentials: 'include'})).json();
          for (const f of (j.fileList || [])) { res.files.push({id: f.lpf_id, name: f.lpf_originname, year}); }
        }
        const cand = res.files.filter((f) => /\.pdf$/i.test(f.name) && /계획서|인정서/.test(f.name));
        const ids = String(__P__.fileIds || '').split(',').filter(Boolean);
        if (ids.length !== new Set(ids).size || ids.some((id) => !cand.some((f) => String(f.id) === id))) { throw new Error('Selected PDF IDs changed or missing'); }
        res.selectionRequired = !ids.length && cand.length > 1;
        const picked = ids.length ? cand.filter((f) => ids.includes(String(f.id))) : (cand.length === 1 ? cand : []);
        for (const f of picked) {
          const buf = new Uint8Array(await (await fetch('/longterm/prs/download/' + f.id, {credentials: 'include'})).arrayBuffer());
          let s = ''; for (let i = 0; i < buf.length; i += 32768) { s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); }
          res.pdfs.push({id: f.id, name: f.name, year: f.year, b64: btoa(s)});
        }
        return res;
      }, sel.ltc);
      out.ltc = r.ltc; out.files = r.files; out.pdfs = r.pdfs; out.status = r.selectionRequired ? 'selection-required' : (r.pdfs.length ? 'found' : 'missing');
      if (!r.ltc) { out.status = 'error'; out.reason = '인정번호를 읽지 못함(수급자 선택 실패)'; }
      console.log(JSON.stringify({ok: out.status !== 'error', out}));
    }
  } catch (e) { out.reason = String(e && e.message ? e.message : e).slice(0, 160); console.log(JSON.stringify({ok: false, out})); }
}
