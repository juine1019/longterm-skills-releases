"""롱텀에 저장된 급여제공계획서(lt-plan-state.js 출력)가 승인된 spec과 같은지 대조한다. 읽기 전용.
사용: python -I lt-plan-verify.py --state <state.json 또는 run.ps1 출력 파일> --spec <spec.json> [--plan L...0002]
출력: JSON {ok, mismatches[]}. 불일치가 있으면 종료 코드 1.
"""
import argparse, json, re, sys


def load_state(path):
    with open(path, encoding='utf-8-sig') as source:
        raw = source.read()
    envelopes = []
    offset = 0
    decoder = json.JSONDecoder()
    while offset < len(raw):
        start = raw.find('{', offset)
        if start < 0:
            break
        try:
            obj, length = decoder.raw_decode(raw[start:])
        except ValueError:
            raise ValueError('Malformed state JSON') from None
        offset = start + length
        if isinstance(obj, dict) and 'ok' in obj:
            envelopes.append(obj)
    if len(envelopes) != 1 or envelopes[0].get('ok') is not True:
        raise ValueError('Expected one successful state response')
    return envelopes[0]['r']


def norm(s):
    return re.sub(r'[ \t]+\n', '\n', re.sub(r'\r', '', s or '')).strip()


def verify(st, sp, plan='', expected=None):
    expected = expected or {}
    mm = []
    dtl = st.get('dtl') or {}
    if not plan or dtl.get('no') != plan: mm.append('지정 계획서 번호 불일치/누락')
    dates = lambda value: str(value or '').replace('-', '')
    rows = [p for p in st.get('plans', []) if p.get('no') == plan]
    if len(rows) != 1:
        mm.append('계획서 목록에서 대상이 정확히 1건 아님')
    else:
        row = rows[0]
        for field, spec_field in [('from', 'adptFr'), ('to', 'adptTo')]:
            if not row.get(field) or dates(row[field]) != dates(sp.get(spec_field)):
                mm.append('적용기간 불일치: ' + field)
        if 'trs' not in row: mm.append('목록의 전송일 조회값 누락')
        elif row.get('trs'): mm.append('목록에서 통보/전송 이력 확인')
    if sp.get('planMode') == 'new':
        seq = sp.get('planNo') or {}
        expected_seq = f"{seq.get('ltcMgmtNoSeq', '')}-{seq.get('utilPlnppSeqNo', '')}"
        if not re.fullmatch(r'\d{3}-\d{3}', expected_seq) or len(rows) != 1 or rows[0].get('seq') != expected_seq:
            mm.append('개인별장기요양이용계획서번호 불일치/누락')
    if not dtl.get('ltc') or dtl['ltc'] != sp.get('ltcMgmtNo'): mm.append('수급자 인정번호 불일치/누락')
    if not dtl.get('wrtDt') or dates(dtl['wrtDt']) != dates(sp.get('writeDate')): mm.append('작성일 불일치/누락')
    got = sorted(n['name'] for n in st['needs']); want = sorted(i['name'] for i in sp['items'])
    if got != want:
        mm.append({'필요내용_없음': sorted(set(want) - set(got)), '필요내용_추가됨': sorted(set(got) - set(want))})
    ftus = {n['ftu'] for n in st['needs']}; stale = [g['name'] for g in st['groups'] if g.get('ftu') and g['ftu'] not in ftus and g['cycle']]
    st = dict(st, groups=[g for g in st['groups'] if not g.get('ftu') or g['ftu'] in ftus])
    mapped = {i: [] for i in range(len(st['groups']))}
    hints = [(r'옷', '옷갈아입기'), (r'세면|세수', '세면'), (r'양치|틀니', '양치'), (r'몸씻기', '몸씻기'), (r'머리감기', '머리감기')]
    token = lambda text: re.sub(r'[\s.,()]', '', text)
    for item in sp['items']:
        choices = [i for i, g in enumerate(st['groups']) if g.get('ftu') == item['ftu']]
        if len(choices) > 1 and item['ftu'] == 'A10':
            for pattern, hint in hints:
                if re.search(pattern, item['name']):
                    choices = [i for i in choices if hint in st['groups'][i]['name']]
                    break
        if len(choices) > 1:
            scores = []
            for i in choices:
                gn, name = token(st['groups'][i]['name']), token(item['name'])
                score = 100 + len(gn) if gn and gn in name else 0
                for size in range(2, len(gn) + 1):
                    if any(gn[pos:pos + size] in name for pos in range(len(gn) - size + 1)):
                        score = max(score, size)
                scores.append((score, i))
            best = max(score for score, _ in scores)
            choices = [i for score, i in scores if score == best and score >= 2]
        if len(choices) != 1:
            mm.append('그룹 대응 불명확: ' + item['name'])
        else:
            mapped[choices[0]].append(item)
    for index, group in enumerate(st['groups']):
        items = mapped[index]
        if not items:
            mm.append('대응 항목 없는 그룹: ' + group['name'])
            continue
        daily = [item for item in items if item['cycle'] == '일']
        want = ('일', max(item.get('count') or 1 for item in daily), sum(item['minutes'] for item in daily)) if daily else ('필요시', '', max([30] + [item.get('minutes') or 0 for item in items]))
        actual_count = int(group.get('count') or 0) if daily else str(group.get('count') or '')
        actual = (group.get('cycle'), actual_count, int(group.get('min') or 0))
        if want != actual: mm.append('그룹 주기/횟수/시간 불일치: ' + group['name'])
    want_daily = sum(i['minutes'] for i in sp['items'] if i['cycle'] == '일')
    got_daily = sum(int(g['min'] or 0) * int(g['count'] or 1) for g in st['groups'] if g['cycle'] == '일')
    if want_daily != got_daily: mm.append(f'일 단위 합계: spec {want_daily}분 / 롱텀 {got_daily}분')
    want_need = len({i['name'] for i in sp['items'] if i['cycle'] == '필요시'})
    got_need = len([g for g in st['groups'] if g['cycle'] == '필요시'])
    if want_need and got_need == 0: mm.append('필요시 그룹이 롱텀에 없음')
    got_sub = {s['ftu']: s['text'] for s in st['subGoals']}
    for k, v in sp['subGoals'].items():
        if got_sub.get(k) != v: mm.append(f"세부목표 {k}: spec '{v}' / 롱텀 '{got_sub.get(k)}'")
    if norm(dtl.get('goal')) != norm(sp['goal']): mm.append({'목표': '불일치', 'spec_len': len(norm(sp['goal'])), '롱텀_len': len(norm(dtl.get('goal')))})
    if norm(dtl.get('opinion')) != norm(sp['opinion']):
        import difflib
        sm = difflib.SequenceMatcher(None, norm(sp['opinion']), norm(dtl.get('opinion')))
        diffs = [(t, norm(sp['opinion'])[i1:i2][:40], norm(dtl.get('opinion'))[j1:j2][:40]) for t, i1, i2, j1, j2 in sm.get_opcodes() if t != 'equal']
        mm.append({'종합의견': '불일치', 'spec_len': len(norm(sp['opinion'])), '롱텀_len': len(norm(dtl.get('opinion'))), '차이': diffs[:12]})
    ag = sp['agree']
    if dtl.get('agreName') != ag['agreeName']: mm.append(f"동의자 {dtl.get('agreName')} / spec {ag['agreeName']}")
    if dtl.get('agreYn') != 'Y': mm.append('수급자(그 가족)확인여부가 Y가 아님')
    agree_date = expected.get('agreeDate') if ag.get('agreeDate') == 'TODAY' else ag.get('agreeDate')
    if not agree_date or dates(dtl.get('agreDt')) != dates(agree_date): mm.append('동의일 기대값 누락/불일치')
    phone = re.sub(r'\D', '', str(expected.get('phone') or ag.get('phone') or ''))
    if len(phone) < 9 or re.sub(r'\D', '', dtl.get('phone') or '') != phone: mm.append('전화번호 기대값 누락/불일치')
    if not sp.get('writer') or (dtl.get('writer') != sp['writer'] if dtl.get('writer') else not st['groups'] or any(g.get('writer') != sp['writer'] for g in st['groups'])):
        mm.append('서버 작성자 불일치/누락')
    if not sp.get('confirmer') or dtl.get('confirmer') != sp['confirmer']: mm.append('최종확인자 불일치/누락')
    if dtl.get('relation') != '00' or dtl.get('method') != '00': mm.append('동의방법/관계 불일치')
    if not expected.get('institutionId') or st.get('institutionId') != expected['institutionId']: mm.append('기관 기대값 누락/불일치')
    # LTCO_YN / LTCO_CFR_DT are institution confirmation fields populated on ordinary save.
    # The send service is separate; DATA_TRS_DT is the transmission history, in list and detail.
    if 'trs' not in dtl: mm.append('상세의 전송일 조회값 누락')
    elif dtl.get('trs'): mm.append('통보/전송 이력 있음')
    return {'ok': not mm, 'plan': dtl.get('no'), 'specHash': sp.get('specHash'), 'mismatches': mm, 'staleHiddenGroups': stale}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--state', required=True); ap.add_argument('--spec', required=True); ap.add_argument('--plan', required=True)
    ap.add_argument('--expected', help='Private execution context: fixed agreeDate, phone, institutionId')
    a = ap.parse_args()
    expected = {}
    if a.expected:
        with open(a.expected, encoding='utf-8-sig') as source:
            expected = json.load(source)
    with open(a.spec, encoding='utf-8-sig') as source:
        sp = json.load(source)
    result = verify(load_state(a.state), sp, a.plan, expected)
    print(json.dumps(result, ensure_ascii=False, indent=1))
    sys.exit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
