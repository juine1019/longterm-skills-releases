                                                                                     
                                                                                                         
const tabsL = await listBrowserTabs();
const t = tabsL.find(x => /care-m\.co\.kr\/(longterm|guide|rfid)/.test(x.url));
if (!t) { console.log(JSON.stringify({ok: false, error: '케어매니저 업무 탭 없음(로그인·홈 화면 확인)'})); } else {
  const pg = await attachBrowserTab(t.targetId);
  const P = __P__;
  const r = await pg.evaluate(async (a) => {
    const inp = document.querySelector('input[name=csrf_test_name]'); const m = document.cookie.match(/csrf_cookie_name=([^;]+)/); const tok = (inp && inp.value) || (m && m[1]) || '';
    if (!tok) { return {error: 'csrf 토큰 없음(로그인 확인)'}; }
    const post = async (u, body) => { const res = await fetch(u, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'}, body: 'csrf_test_name=' + encodeURIComponent(tok) + '&' + body, credentials: 'same-origin'}); return res.text(); };
    const jp = (tx) => { try { return JSON.parse(tx); } catch (e) { return {}; } };
    let list = (jp(await post('/longterm/prs/getPrsList', '')).prsList || []);
    if (a.name) { list = list.filter(x => x.FNM === a.name); }
    const from = a.name ? 0 : Number(a.from); const cnt = a.name ? 99 : Number(a.cnt); const out = [];
    for (let i = from; i < Math.min(list.length, from + cnt); i++) {
      const p = list[i];
      const q = encodeURIComponent(JSON.stringify({id: Number(p.lpi_id), LTC_MGMT_NO: p.LTC_MGMT_NO, year_begin: '2020', year_end: String(a.today).slice(0, 4), investigate_date: '', category: ''}));
      const j = jp(await post('/longterm/Prs/get_investigationList', 'questionData=' + q));
      const plans = [];
      for (const x of (j.investigate_history || [])) {
        if (!x.lpp_id) { continue; }
        const d = (jp(await post('/longterm/prs/getPofPlnppDetail', 'lpp_id=' + x.lpp_id + '&_ts=' + Date.now())).detail || {});
        plans.push({lpp: x.lpp_id, clsfc: d.LTCP_CLSFC_NM, mgmt: d.POF_PLNPP_MGMT_NO, writeDate: d.writeDate, notifyDate: d.notifyDate, adptFr: d.adptFr, adptTo: d.adptTo, goal: d.GOAL_CONTN, opinion: d.OVR_OPIN_CONTN, items: d.ftu_details, itemCount: d.item_count, writer: d.WRTR_NM, grade: d.GRADE_NM, note: d.NOTE_CONTN});
      }
      const assess = (j.investigate_reqs || []).map(x => ({cat: x.category, date: x.investigate_date, score: x.score, worker: x.worker, grade: x.grade, height: x.height, weight: x.weight, gender: x.gender, birthdate: x.birthdate, rows: x.data_json}));
      out.push({i, name: p.FNM, st: p.STATUS || '', grade: p.LTC_RCGT_GRADE_NM || '', bday: p.BDAY || '', ltc: p.LTC_MGMT_NO, plans, assess});
    }
    return {total: list.length, out};
  }, {from: P.from, cnt: P.cnt, name: P.name || '', today: P.today});
  console.log(JSON.stringify({ok: !r.error, r}));
}
