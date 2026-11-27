import argparse
import sys
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
import random
import re
import zipfile

from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def digest(value):
    return hashlib.sha256(value).hexdigest()


def timestamp(value):
    digits = re.sub(r'\D', '', value)
    return dt.datetime.strptime(digits, '%Y%m%d%H%M%S')


def new_document():
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin = section.bottom_margin = Cm(1.8)
    section.left_margin = section.right_margin = Cm(2)
    for name in ['Normal', 'Title']:
        style = doc.styles[name]
        style.font.name = 'Malgun Gothic'
        style.element.rPr.rFonts.set(qn('w:eastAsia'), 'Malgun Gothic')
        style.font.size = Pt(10 if name == 'Normal' else 19)
        style.font.color.rgb = RGBColor(0, 0, 0)
        fonts = style.element.rPr.rFonts
        for key in list(fonts.attrib):
            if 'theme' in key.lower():
                del fonts.attrib[key]
        for border in style.element.xpath('./w:pPr/w:pBdr'):
            border.getparent().remove(border)
    doc.styles['Normal'].paragraph_format.space_after = Pt(6)
    return doc


def add_form(doc, event, org, example):
    doc.add_paragraph('급여제공직원 변경 모니터링', 'Title')
    doc.add_paragraph('상담 확인 전 초안')
    doc.add_paragraph(org)
    table = doc.add_table(rows=0, cols=2)
    table.style = 'Table Grid'
    table.autofit = False
    table.columns[0].width, table.columns[1].width = Cm(4.3), Cm(12.7)
    rows = [
        ('수급자명', event['name']), ('생년월일', ''),
        ('직원 변경 관측일', event['date']),
        ('변경 전 종사자', event['before']), ('변경 후 종사자', event['after']),
        ('변경사유 예시', example[0]),
        ('상담 대상자명 및 관계', event['name'] + ' / 본인'),
        ('상담 예정일시', event['plannedDate'] + '  ' + event['plannedTime']),
        ('상담 예정방법', '유선상담'), ('상담직원 성명 및 직책', ''),
        ('상담내용 및\n상담 대상자 의견 예시', example[1]),
        ('확인사항', '변경사유·상담 실시·상담 결과 확인 필요. 생년월일 원천 미확인. ' + ' '.join(event['warnings'])),
    ]
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].text, cells[1].text = label, value
        properties = cells[0]._tc.get_or_add_tcPr()
        shade = OxmlElement('w:shd')
        shade.set(qn('w:fill'), 'F1F3F5')
        properties.append(shade)
        for cell in cells:
            for p in cell.paragraphs:
                p.paragraph_format.space_before = Pt(5)
                p.paragraph_format.space_after = Pt(5)
        row_properties = cells[0]._tc.getparent().get_or_add_trPr()
        row_properties.append(OxmlElement('w:cantSplit'))
    doc.add_paragraph('관측 근거  ' + event['previousDate'] + ' → ' + event['date'])
    doc.add_paragraph('서술란은 무작위로 선택한 가상 예시이며 실제 상담 확인 후 수정하는 작성용 초안입니다.')
    doc.add_paragraph('문서 식별번호  ' + event['key'][:12])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if sys.flags.optimize:
        raise RuntimeError('OPTIMIZED_PYTHON_NOT_SUPPORTED')
    settings = json.loads((args.workspace / 'longterm.workspace.json').read_text('utf-8-sig'))
    org = settings['organization']
    org_key = digest(org['id'].encode())[:32]
    base = args.workspace / 'state' / 'organizations' / org_key
    allowed_output = (base / 'worker-change-monitoring').resolve()
    resolved_output = args.output.resolve()
    if resolved_output == allowed_output or not resolved_output.is_relative_to(allowed_output):
        raise RuntimeError('OUTPUT_OUTSIDE_ORGANIZATION')
    args.output = resolved_output
    store = base / 'worker-notes'
    index = json.loads((store / 'index.json').read_text('utf-8'))
    groups = collections.defaultdict(list)
    excluded = collections.Counter()
    snapshots = {}
    for month, entry in sorted(index['months'].items()):
        ref = entry['snapshot']
        source_path = (store / ref['file']).resolve()
        assert source_path.is_relative_to(store.resolve())
        raw = source_path.read_bytes()
        assert digest(raw) == ref['sha256']
        snapshot = json.loads(raw)
        assert snapshot['organization']['id'] == org['id'] and snapshot['month'] == month
        records_bytes = json.dumps(snapshot['records'], ensure_ascii=False, separators=(',', ':')).encode()
        assert digest(records_bytes) == ref['recordsHash'] == snapshot['recordsHash']
        assert entry['complete'] is True
        snapshots[month] = {'hash': ref['sha256'], 'state': entry['state']}
        for row in snapshot['records']:
            h, d = row['header'], row['detail']
            if h['USE_YN'] != 'Y' or h['DEL_YN'] != 'N' or d['DEL_YN'] != 'N':
                excluded['unusedOrDeleted'] += 1
                continue
            try:
                start, end = timestamp(h['LTCP_FR_DTHMS']), timestamp(h['LTCP_TO_DTHMS'])
                assert end > start and start.strftime('%Y%m%d') == h['LTCP_FR_DT']
                assert h['RECU_SFF_NM'].strip() and h['LTC_MGMT_NO'].strip()
            except (ValueError, AssertionError):
                excluded['invalidTimeOrIdentity'] += 1
                continue
            groups[h['LTC_MGMT_NO'], h['LTCP_CLSFC_CD']].append({
                'start': start, 'end': end, 'row': row, 'month': month,
                'snapshot': ref['sha256']})
    example_path = Path(__file__).resolve().parents[1] / 'references/examples.md'
    examples = []
    for line in example_path.read_text('utf-8').splitlines():
        parts = [p.strip() for p in line.split('|')]
        if len(parts) == 5 and parts[1].isdigit():
            examples.append((parts[2], parts[3]))
    assert len(examples) == 10
    events = []
    for (recipient, service), records in sorted(groups.items()):
        records.sort(key=lambda r: (r['start'], r['end'], r['row']['sourceId']))
        unique = []
        seen = set()
        for record in records:
            identity = (record['start'], record['end'], record['row']['header']['RECU_SFF_NM'])
            if identity in seen:
                excluded['duplicate'] += 1
                continue
            seen.add(identity)
            unique.append(record)
        for previous, current in zip(unique, unique[1:]):
            before = previous['row']['header']['RECU_SFF_NM']
            after = current['row']['header']['RECU_SFF_NM']
            if before == after:
                continue
            raw_key = [org['id'], recipient, service, current['start'].isoformat(), before, after,
                       previous['row']['sourceId'], current['row']['sourceId']]
            key = digest(json.dumps(raw_key, ensure_ascii=False).encode())
            rng = random.Random(int(key, 16))
            minute = rng.randrange(51)
            example_index = rng.randrange(10)
            warnings = ['직원명 기준 관측으로 직원 고유번호 대조 필요.']
            if current['start'].date() == previous['start'].date():
                warnings.append('같은 날 직원 변경으로 교대 여부 확인 필요.')
            if current['start'] < previous['end']:
                warnings.append('제공시간 중복으로 변경 순서 확인 필요.')
            event = {
                'key': key, 'recipientId': recipient, 'service': service,
                'name': current['row']['header']['FNM'], 'before': before, 'after': after,
                'date': current['start'].date().isoformat(),
                'previousDate': previous['start'].date().isoformat(),
                'plannedDate': (current['start'].date() + dt.timedelta(days=1)).isoformat(),
                'plannedTime': f'17:{minute:02d} ~ {17 + (minute + 10) // 60:02d}:{(minute + 10) % 60:02d}',
                'example': example_index + 1, 'warnings': warnings,
                'sources': [{k: r[k] for k in ['month', 'snapshot']} | {'sourceId': r['row']['sourceId']}
                            for r in [previous, current]],
                'status': 'consultation-unconfirmed-example',
            }
            events.append(event)
    events.sort(key=lambda e: (e['date'], e['name'], e['key']))
    args.output.mkdir(parents=True, exist_ok=False)
    docs = args.output / 'documents'
    docs.mkdir()
    combined = new_document()
    for i, event in enumerate(events):
        filename = f'{i+1:03d}_{event["date"]}_{event["name"]}_{event["key"][:8]}.docx'
        doc = new_document()
        add_form(doc, event, org['name'], examples[event['example'] - 1])
        doc.save(docs / filename)
        event['file'] = str(docs / filename)
        if i:
            combined.add_page_break()
        add_form(combined, event, org['name'], examples[event['example'] - 1])
    combined.save(args.output / '전체_모니터링_초안.docx')
    manifest = {'organization': org, 'snapshots': snapshots, 'excluded': dict(excluded), 'events': events}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), 'utf-8')
    with zipfile.ZipFile(args.output / '건별_DOCX.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(docs.glob('*.docx')):
            archive.write(file, file.name)
    print(json.dumps({'output': str(args.output), 'documents': len(events), 'excluded': dict(excluded)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
