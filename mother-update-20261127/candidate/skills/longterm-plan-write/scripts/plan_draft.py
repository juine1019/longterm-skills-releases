"""Render evidence-linked plan content without borrowing an institution's clinical defaults."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def read(path):
    with open(path, encoding='utf-8-sig') as handle:
        return json.load(handle)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def iso(value):
    try:
        return isinstance(value, str) and datetime.date.fromisoformat(value).isoformat() == value
    except (ValueError, TypeError):
        return False


def pointer(source, key):
    if not isinstance(key, str) or not key.startswith('/'):
        raise ValueError('Evidence JSON pointer required')
    value = source
    for part in key[1:].split('/'):
        part = part.replace('~1', '/').replace('~0', '~')
        value = value[int(part)] if isinstance(value, list) else value[part]
    if value is None or value == '' or value == []:
        raise ValueError('Empty evidence cannot support a plan assertion')
    return value


def utilization(content, spec, args):
    decision = content.get('differenceDecision') or ''
    if decision == 'SKIP':
        if not any(ref.get('kind') == 'user' and ref.get('source') and ref.get('message') for ref in (content.get('evidence') or {}).get('differenceDecision', [])):
            return ['util-plan: 실제 사용자의 비교 생략 결정이 필요합니다']
        return []
    try:
        if not decision or not args.util_plan_manifest:
            raise ValueError('비교한 PDF 취득 기록이 없습니다')
        manifest = read(args.util_plan_manifest)
        if manifest.get('status') != 'found' or manifest.get('ltc') != spec['ltcMgmtNo'] or not manifest.get('pdfs'):
            raise ValueError('해당 수급자의 확인된 PDF가 아닙니다')
        ids = []
        for item in manifest['pdfs']:
            if not item.get('id') or sha(item['pdf']).lower() != str(item.get('sha256') or '').lower():
                raise ValueError('PDF 파일 식별/해시가 다릅니다')
            ids.append(str(item['id']))
        if len(set(ids)) != len(ids) or (args.util_plan_file and args.util_plan_file not in ids) or (len(ids) > 1 and not args.util_plan_file):
            raise ValueError('비교한 PDF 파일을 정확히 지정해야 합니다')
        got = datetime.date.fromisoformat(str(manifest.get('collectedAt') or '')[:10])
        write = datetime.date.today() if args.existing_period else datetime.date.fromisoformat(spec['writeDate'])
        if not -1 <= (write - got).days <= 30:
            raise ValueError('PDF 취득일이 비교 기준일의 30일을 벗어났습니다')
        return []
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        return ['util-plan: ' + str(error)]


def assessment_status(recipient, write_date):
    problems, selected = [], {}
    raw = recipient.get('assess')
    assessments = raw if isinstance(raw, list) else []
    if not iso(write_date):
        return ['assessment: 평가 선택 기준 작성일이 확인되지 않았습니다'], selected
    written = datetime.date.fromisoformat(write_date)
    for category in ('fall', 'move', 'percept', 'req'):
        same = [a for a in assessments if isinstance(a, dict) and a.get('cat') == category]
        dated = []
        reason = '없음' if not same else ''
        for row in same:
            text = str(row.get('date') or '').strip()
            if re.fullmatch(r'[0-9]{8}', text):
                text = text[:4] + '-' + text[4:6] + '-' + text[6:]
            if not iso(text):
                reason = '날짜 형식 오류'
                break
            dated.append((datetime.date.fromisoformat(text), row))
        if not reason:
            past = [(day, row) for day, row in dated if day <= written]
            if not past:
                reason = '작성일 뒤에만 있음'
            else:
                latest = max(day for day, _ in past)
                top = [row for day, row in past if day == latest]
                if len(top) != 1:
                    reason = '최신 같은 날 여러 건'
                elif (written - latest).days > 330:
                    reason = '330일 초과'
                else:
                    selected[category] = latest.isoformat()
        if reason:
            problems.append('assessment-' + category + ': ' + reason)
    return problems, selected


def validate(content, source, args):
    rows = (source.get('r') or source).get('out', [])
    if len(rows) != 1 or not rows[0].get('name') or not rows[0].get('ltc'):
        raise ValueError('One identified source recipient required')
    recipient = rows[0]
    if source.get('ok') is False:
        raise ValueError('Failed source collection cannot support a draft')
    if content.get('schemaVersion') != 1 or content.get('sourceSha256') != sha(args.dump):
        raise ValueError('Draft source bytes changed')
    spec = dict(content.get('spec') or {})
    if content.get('orgName') != args.org_name or not args.org_name:
        raise ValueError('Configured source organization required')
    if spec.get('name') != recipient['name'] or spec.get('ltcMgmtNo') != recipient['ltc'] or spec.get('grade') != recipient.get('grade'):
        raise ValueError('Draft recipient/recognition/grade differs from source')
    if not args.writer or not args.job or spec.get('writer') != args.writer or spec.get('writerJob') != args.job:
        raise ValueError('Current institution operator required')
    if bool(content.get('newContract')) != bool(args.new_contract):
        raise ValueError('New-contract scope differs')
    if args.catalog:
        raise ValueError('Personal corpus input is not supported')
    if spec.get('version') != 2:
        raise ValueError('Current v2 plan content required')
    if args.existing_period:
        if not args.write_date or args.from_date or args.to_date or args.contract_end or args.new_contract:
            raise ValueError('Existing plan requires its original write date and period only')
        parts = [part.strip() for part in args.existing_period.split('~')]
        if len(parts) != 2 or not all(iso(part) for part in parts) or parts[1] < parts[0]:
            raise ValueError('ExistingPeriod must be YYYY-MM-DD~YYYY-MM-DD')
        if [spec.get('adptFr'), spec.get('adptTo')] != parts:
            raise ValueError('ExistingPeriod differs from the selected plan content')
    if set(spec) - {'version', 'name', 'grade', 'ltcMgmtNo', 'planNo', 'adptFr', 'adptTo', 'writeDate', 'reason', 'items', 'subGoals', 'goal', 'opinion', 'agree', 'writer', 'writerJob', 'confirmer', 'decisionNeeded', 'contractEnd', 'visits', 'unresolved', 'evidence', 'subGoalsMissing', 'planMode', 'periodBasis', 'newContract', 'creationIntent'}:
        raise ValueError('Unknown plan field')
    if spec.get('creationIntent'):
        refs = (content.get('evidence') or {}).get('creationIntent') or []
        if not any(r.get('kind') == 'user' and r.get('source') and r.get('message') == spec['creationIntent'].get('userInstruction') for r in refs):
            raise ValueError('Additional plan requires its actual user instruction evidence')
    if 'newContract' in spec and spec['newContract'] is not bool(args.new_contract):
        raise ValueError('Spec new-contract scope differs')
    spec['newContract'] = bool(args.new_contract)
    for requested, field in [(args.reason, 'reason'), (args.contract_end, 'contractEnd'), (args.visits, 'visits')]:
        if requested and requested != spec.get(field):
            raise ValueError('Requested current contract value differs: ' + field)
    for option, field in [(args.write_date, 'writeDate'), (args.from_date, 'adptFr'), (args.to_date, 'adptTo')]:
        if option and option != spec.get(field):
            raise ValueError('Requested date differs: ' + field)
    if args.plan_no:
        match = re.fullmatch(r'(\d{3})\s*[-(]\s*(\d{3})\)?', args.plan_no)
        if not match or spec.get('planNo') != {'ltcMgmtNoSeq': match[1], 'utilPlnppSeqNo': match[2]}:
            raise ValueError('Requested utilization plan sequence differs')
    if args.visits and content.get('visits') != args.visits:
        raise ValueError('Requested visit frequency differs')
    if args.diff and content.get('differenceDecision') != args.diff:
        raise ValueError('Requested comparison decision differs')
    items = spec.get('items')
    if not isinstance(items, list) or not items or len(items) > 78:
        raise ValueError('Explicit selected plan items required')
    definitions = read(Path(__file__).resolve().parents[3] / 'assets/static/lt-need-catalog.json')['items']
    known = {(r['name'], r['ftu']): r['payType'] for r in definitions}
    seen = set()
    for item in items:
        key = item.get('name')
        if key in seen or (key, item.get('ftu')) not in known or item.get('cycle') not in ('일', '필요시'):
            raise ValueError('Duplicate or unsupported plan item')
        if item.get('payType') != known[(key, item['ftu'])]:
            raise ValueError('Plan item service category differs from the selected definition')
        seen.add(key)
        if type(item.get('minutes')) is not int or not 1 <= item['minutes'] <= 1440 or type(item.get('count')) is not int:
            raise ValueError('Explicit item minutes/count required')
        if item['cycle'] == '일' and not 1 <= item['count'] <= 24 or item['cycle'] == '필요시' and item['count'] != 0:
            raise ValueError('Unsupported item cycle/count')
        if set(item) - {'name', 'ftu', 'payType', 'cycle', 'count', 'minutes'}:
            raise ValueError('Unknown selected item field')
    for field in ('goal', 'opinion'):
        if not isinstance(spec.get(field), str) or not spec[field].strip() or len(spec[field]) > 12000:
            raise ValueError('Explicit reviewed plan text required: ' + field)
    links = content.get('evidence') or {}
    required = ['goal', 'opinion', 'visits', 'contractEnd', 'differenceDecision'] + ['item:' + i['name'] for i in items] + ['subGoal:' + k for k in spec.get('subGoals', {})]
    if not args.existing_period:
        required.append('periodBasis')
        if not isinstance(spec.get('periodBasis'), dict):
            raise ValueError('Explicit initial/continuation/renewal period basis required')
    for field in required:
        refs = links.get(field)
        if not isinstance(refs, list) or not refs:
            raise ValueError('Evidence references required: ' + field)
        for ref in refs:
            if ref.get('kind') == 'source':
                pointer(source, ref.get('pointer'))
            elif ref.get('kind') == 'user':
                if not ref.get('source') or not isinstance(ref.get('message'), str) or not ref['message'].strip():
                    raise ValueError('Actual user statement/source required')
            else:
                raise ValueError('Unsupported evidence kind')
    for field in ('agree', 'confirmer'):
        for ref in links.get(field, []):
            if ref.get('kind') == 'source':
                pointer(source, ref.get('pointer'))
            elif ref.get('kind') != 'user' or not ref.get('source') or not str(ref.get('message') or '').strip():
                raise ValueError('Actual consent/confirmer evidence required')
    issues = list(spec.get('decisionNeeded') or [])
    if not all(isinstance(value, str) and value.strip() for value in issues):
        raise ValueError('Invalid pending decision')
    if spec.get('grade') not in ('1등급', '2등급', '3등급', '4등급', '5등급'):
        issues.append('현재 등급 확인 필요')
    if not isinstance(spec.get('reason'), str) or not spec['reason'].strip():
        issues.append('현재 계약과 재작성사유 확인 필요')
    for field in ('writeDate', 'adptFr', 'adptTo'):
        if not iso(spec.get(field)):
            issues.append('현재 근거로 날짜 확인 필요: ' + field)
    if iso(spec.get('adptFr')) and iso(spec.get('adptTo')) and spec['adptFr'] > spec['adptTo']:
        raise ValueError('Invalid application period')
    plan_no = spec.get('planNo') or {}
    if set(plan_no) != {'ltcMgmtNoSeq', 'utilPlnppSeqNo'} or not all(re.fullmatch(r'\d{3}', str(v)) for v in plan_no.values()):
        issues.append('이용계획서의 인정순번/이용계획서순번 확인 필요')
    groups = {i['ftu'] for i in items}
    subgoals = spec.get('subGoals') or {}
    if not isinstance(subgoals, dict) or not all(isinstance(v, str) for v in subgoals.values()):
        raise ValueError('Invalid subgoal text')
    if set(subgoals) != groups or not all(v.strip() for v in subgoals.values()):
        issues.append('선택된 그룹별 세부목표 확인 필요')
    agree = spec.get('agree') or {}
    if agree.get('method') != '직접동의(기존방식)' or agree.get('relation') != '본인' or agree.get('agreeName') != spec['name'] or not iso(agree.get('agreeDate')) or not re.fullmatch(r'\d{9,15}', re.sub(r'\D', '', str(agree.get('phone') or ''))):
        issues.append('현재 지원하는 직접동의/본인·실제 동의일·전화 확인 필요')
    if not links.get('agree') or not links.get('confirmer') or not spec.get('confirmer'):
        issues.append('동의정보·최종확인자의 실제 근거 확인 필요')
    if not content.get('differenceDecision'):
        issues.append('이용계획서 비교 또는 생략 결정 확인 필요')
    expected_mode = 'update' if args.existing_period else 'new'
    if spec.get('planMode', expected_mode) != expected_mode:
        raise ValueError('Requested new/update plan scope differs')
    spec['planMode'] = expected_mode
    spec['unresolved'] = spec.get('unresolved') or []
    if not isinstance(spec['unresolved'], list) or not all(isinstance(v, str) for v in spec['unresolved']):
        raise ValueError('Invalid unresolved contract facts')
    assessment_problems, selected_assessments = assessment_status(recipient, spec.get('writeDate'))
    spec['unresolved'] = list(dict.fromkeys(spec['unresolved'] + assessment_problems + utilization(content, spec, args)))
    spec['evidence'] = {'assessments': selected_assessments, 'content': links}
    spec['subGoalsMissing'] = sorted(groups - set(subgoals))
    check_module = importlib.util.spec_from_file_location('final_plan_check', Path(__file__).with_name('plan-spec-check.py'))
    checker = importlib.util.module_from_spec(check_module)
    check_module.loader.exec_module(checker)
    spec['decisionNeeded'] = list(dict.fromkeys(issues))
    issues.extend(checker.check(spec, 'update' if expected_mode == 'update' else 'all'))
    spec['decisionNeeded'] = list(dict.fromkeys(issues))
    return spec, recipient, links


def build(args):
    content, source = read(args.content), read(args.dump)
    spec, recipient, links = validate(content, source, args)
    token = sha(args.content)[:12]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    document = out / ('plan-draft-' + token + '.docx')
    spec_path = out / ('lt-plan-spec-' + token + '.json')
    proof = out / ('plan-content-proof-' + token + '.json')
    if any(path.exists() for path in (document, spec_path, proof)):
        raise FileExistsError('Existing draft/spec preserved; use a new output folder')
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.left_margin = section.right_margin = Cm(1.8)
    section.top_margin = section.bottom_margin = Cm(1.8)
    style = doc.styles['Normal']
    style.font.name, style.font.size = 'Malgun Gothic', Pt(10)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '맑은 고딕')
    doc.add_heading('급여제공계획서 검토 초안', 0)
    doc.add_paragraph('기관: ' + content['orgName'])
    doc.add_paragraph('수급자: ' + spec['name'] + ' / 인정번호: ' + spec['ltcMgmtNo'])
    doc.add_paragraph('작성자: ' + args.writer + ' (' + args.job + ')')
    doc.add_paragraph('작성일: ' + str(spec.get('writeDate') or '') + ' / 적용기간: ' + str(spec.get('adptFr') or '') + ' ~ ' + str(spec.get('adptTo') or ''))
    doc.add_heading('목표', 1)
    for line in spec['goal'].splitlines():
        doc.add_paragraph(line)
    doc.add_heading('종합의견', 1)
    for paragraph in spec['opinion'].splitlines():
        if paragraph.strip():
            doc.add_paragraph(paragraph)
    doc.add_heading('급여 항목', 1)
    table = doc.add_table(rows=1, cols=4)
    table.style, table.autofit = 'Table Grid', False
    widths = [Cm(8.2), Cm(3.2), Cm(3), Cm(3)]
    for column, width in zip(table.columns, widths):
        column.width = width
    for cell, value in zip(table.rows[0].cells, ['급여내용', '주기', '횟수', '시간(분)']):
        cell.text = value
    for item in spec['items']:
        row = table.add_row()
        for cell, value in zip(row.cells, [item['name'], item['cycle'], item['count'], item['minutes']]):
            cell.text = str(value)
        row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            cell.width = width
    table.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
    doc.add_heading('세부목표', 1)
    for key, text in (spec.get('subGoals') or {}).items():
        doc.add_paragraph(key + ': ' + text)
    if spec['decisionNeeded']:
        doc.add_heading('입력 전 확인', 1)
        for issue in spec['decisionNeeded']:
            doc.add_paragraph(issue)
    doc.add_page_break()
    doc.add_heading('검토용 근거 연결', 1)
    doc.add_paragraph('원천 SHA256: ' + content['sourceSha256'])
    for key, refs in links.items():
        doc.add_paragraph(key + ': ' + ', '.join(ref.get('pointer') or ref.get('source', '') for ref in refs))
    doc.save(document)
    ready = not spec['decisionNeeded']
    if ready:
        spec['specHash'] = hashlib.sha256(json.dumps(spec, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:16].upper()
        with spec_path.open('x', encoding='utf-8') as handle:
            json.dump(spec, handle, ensure_ascii=False, indent=1)
    with proof.open('x', encoding='utf-8') as handle:
        json.dump({'sourceSha256': content['sourceSha256'], 'contentSha256': sha(args.content), 'documentSha256': sha(document), 'inputReady': ready, 'evidence': links}, handle, ensure_ascii=False, indent=1)
    return {'file': str(document), 'notes': spec['decisionNeeded'], 'info': {'inputReady': ready, 'decisionNeeded': spec['decisionNeeded'], 'items': len(spec['items']), 'spec': str(spec_path) if ready else None, 'proof': str(proof)}}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    for name in ('dump', 'out', 'writer', 'job', 'content', 'org-name'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--write-date', default='')
    parser.add_argument('--from', dest='from_date', default='')
    parser.add_argument('--to', dest='to_date', default='')
    parser.add_argument('--visits', default='')
    parser.add_argument('--diff', default='')
    parser.add_argument('--catalog', default='')
    parser.add_argument('--plan-no', default='')
    parser.add_argument('--new-contract', action='store_true')
    parser.add_argument('--reason', default='')
    parser.add_argument('--contract-end', default='')
    parser.add_argument('--util-plan-manifest', default='')
    parser.add_argument('--util-plan-file', default='')
    parser.add_argument('--existing-period', default='')
    args = parser.parse_args()
    print(json.dumps(build(args), ensure_ascii=False))
