"""Render a validated evaluation specification. This module does not generate clinical claims."""
import argparse
import json
import os
from datetime import date
from docx import Document
from docx.shared import Cm, Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def render(spec_path, bundle_path, proof_path, output):
    def read(file):
        with open(file, encoding='utf-8-sig') as handle:
            return json.load(handle)
    spec, bundle, proof = read(spec_path), read(bundle_path), read(proof_path)
    if proof.get('ok') is not True:
        raise ValueError('Validated specification required')
    if os.path.exists(output):
        raise FileExistsError('New review document path required')
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin = section.bottom_margin = Cm(1.8)
    section.left_margin = section.right_margin = Cm(1.8)
    style = doc.styles['Normal']
    style.font.name = 'Malgun Gothic'
    style.font.size = Pt(10)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '맑은 고딕')
    style.paragraph_format.space_after = Pt(6)
    doc.add_heading('급여제공 결과평가 검토 초안', 0)
    doc.add_paragraph('기관과 작성자가 검토할 문서입니다. 사이트 저장 결과는 별도로 확인합니다.')
    context = spec['context']
    for label, value in [('기관 식별자', context['orgId']), ('대상 식별자', context['recipientId']),
                         ('인정번호 / 순번', context['recognitionNo'] + ' / ' + context['recognitionSeq']),
                         ('계획서', context['planId']), ('작성자', context['workerName']),
                         ('평가일', spec['evaluationDate']),
                         ('평가기간', spec['period']['from'] + ' ~ ' + spec['period']['to'])]:
        doc.add_paragraph(label + ': ' + value)
    if spec.get('evaluationRound'):
        doc.add_paragraph('평가 차수: ' + str(spec['evaluationRound']))
    profile = bundle.get('recipientProfile')
    if profile:
        birth_date = profile.get('birthDate')
        age = None
        if birth_date:
            birth, evaluated = date.fromisoformat(birth_date), date.fromisoformat(spec['evaluationDate'])
            if evaluated >= birth:
                age = evaluated.year - birth.year - ((evaluated.month, evaluated.day) < (birth.month, birth.day))
        values = [profile.get('sex'), birth_date, None if age is None else f'만 {age}세', profile.get('grade')]
        table = doc.add_table(rows=2, cols=4)
        table.style = 'Table Grid'
        for cell, label in zip(table.rows[0].cells, ['성별', '생년월일', '나이', '장기요양등급']):
            cell.text = label
        for cell, value in zip(table.rows[1].cells, values):
            cell.text = value or ''
    doc.add_heading('계획 항목별 평가', 1)
    table = doc.add_table(rows=1, cols=3)
    table.style = 'Table Grid'
    table.autofit = False
    widths = [Cm(4), Cm(2), Cm(11.4)]
    for column, width in zip(table.columns, widths):
        column.width = width
    for cell, label in zip(table.rows[0].cells, ['계획 항목', '제공 여부', '평가 내용']):
        cell.text = label
    for goal in spec['goals']:
        row = table.add_row()
        for cell, text in zip(row.cells, [goal['key'], '제공' if goal['provided'] else '미제공', goal['text']]):
            cell.text = text
        properties = row._tr.get_or_add_trPr()
        properties.append(OxmlElement('w:cantSplit'))
    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            cell.width = width
    header = OxmlElement('w:tblHeader')
    table.rows[0]._tr.get_or_add_trPr().append(header)
    doc.add_heading('상태 · 욕구 · 향후계획', 1)
    labels = proof.get('stateLabels', {})
    for item in spec['observations']:
        if item['text'] or item['selected']:
            label = labels.get(item['key'], item['key'])
            doc.add_paragraph(label + ': ' + (item['text'] or '선택'))
    if spec.get('overallComment'):
        doc.add_heading('총평', 1)
        doc.add_paragraph(spec['overallComment']['text'])
        doc.add_heading('기타 및 종합의견', 1)
        doc.add_paragraph(spec['summary']['text'])
    else:
        doc.add_heading('총평', 1)
        doc.add_paragraph(spec['summary']['text'])
    doc.add_page_break()
    doc.add_heading('검토용 근거 연결', 1)
    doc.add_paragraph('아래 연결은 검토용입니다. 평가 본문에 근거 점검 문구를 덧붙이지 않습니다.')
    for goal in spec['goals']:
        doc.add_paragraph(goal['key'] + ' → ' + ', '.join(goal['evidenceIds']))
    for key, read_result in bundle['reads'].items():
        doc.add_heading(key, 2)
        doc.add_paragraph('조회 상태: ' + read_result['status'] + ' / 조회일시: ' + read_result['collectedAt'])
        for item in read_result.get('coverage', []):
            difference = item.get('totalDifference')
            if difference:
                doc.add_paragraph(item['month'] + ': 화면 합계 ' + str(difference['total']) + '건, 목록 ' + str(difference['rows']) + '건 (차이 확인 필요)')
        for record in read_result['records']:
            doc.add_paragraph(record['id'] + ' | ' + record.get('date', '') + ' | SHA256 ' + record['contentHash'])
    doc.add_paragraph('명세 SHA256: ' + proof['specHash'])
    doc.save(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['spec', 'bundle', 'proof', 'out']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    render(args.spec, args.bundle, args.proof, args.out)
