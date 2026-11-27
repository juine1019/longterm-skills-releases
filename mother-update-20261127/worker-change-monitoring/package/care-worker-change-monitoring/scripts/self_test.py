"""Synthetic data only. Run beside create_documents.py after installing python-docx."""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def hashed(raw):
    return hashlib.sha256(raw).hexdigest()


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def main():
    script = Path(__file__).with_name('create_documents.py')
    with tempfile.TemporaryDirectory(prefix='worker-change-synthetic-') as temporary:
        workspace = Path(temporary)
        org = {'id': 'SYNTHETIC-ORG', 'name': '가상 시험 기관'}
        (workspace / 'longterm.workspace.json').write_bytes(packed({'organization': org}))
        base = workspace / 'state/organizations' / hashed(org['id'].encode())[:32]
        store = base / 'worker-notes'
        store.mkdir(parents=True)
        months = {}
        for month, visits in [('2026-10', [('20261031', '가상직원A')]),
                              ('2026-11', [('20261101', '가상직원B'), ('20261102', '가상직원A')])]:
            records = []
            for day, worker in visits:
                records.append({'sourceId': day, 'header': {
                    'USE_YN': 'Y', 'DEL_YN': 'N', 'LTCP_FR_DT': day,
                    'LTCP_FR_DTHMS': day + '090000', 'LTCP_TO_DTHMS': day + '100000',
                    'RECU_SFF_NM': worker, 'LTC_MGMT_NO': 'SYNTHETIC-PERSON',
                    'LTCP_CLSFC_CD': 'SYNTHETIC-SERVICE', 'FNM': '가상수급자'},
                    'detail': {'DEL_YN': 'N'}})
            records_hash = hashed(packed(records))
            raw = packed({'organization': org, 'month': month, 'records': records, 'recordsHash': records_hash})
            filename = month + '.json'
            (store / filename).write_bytes(raw)
            months[month] = {'complete': True, 'state': 'synthetic', 'snapshot': {
                'file': filename, 'sha256': hashed(raw), 'recordsHash': records_hash}}
        (store / 'index.json').write_bytes(packed({'months': months}))
        output = base / 'worker-change-monitoring/run-one'

        def run(destination, optimized=False):
            args = [sys.executable, '-X', 'utf8'] + (['-O'] if optimized else [])
            return subprocess.run(args + [str(script), '--workspace', str(workspace), '--output', str(destination)],
                                  capture_output=True, text=True, encoding='utf-8')

        result = run(output)
        if result.returncode:
            raise RuntimeError(result.stderr)
        manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
        events = manifest['events']
        if len(events) != 2 or [e['after'] for e in events] != ['가상직원B', '가상직원A']:
            raise RuntimeError('TRANSITION_OR_BOUNDARY_FAILED')
        from docx import Document
        for event in events:
            doc = Document(event['file'])
            if '상담 확인 전 초안' not in [p.text for p in doc.paragraphs]:
                raise RuntimeError('DRAFT_LABEL_MISSING')
        if run(output).returncode == 0:
            raise RuntimeError('EXISTING_OUTPUT_NOT_PROTECTED')
        outside = workspace / 'outside'
        if run(outside).returncode == 0 or outside.exists():
            raise RuntimeError('OUTPUT_BOUNDARY_FAILED')
        if run(base / 'worker-change-monitoring/optimized', True).returncode == 0:
            raise RuntimeError('OPTIMIZED_EXECUTION_NOT_REJECTED')
        second = base / 'worker-change-monitoring/run-two'
        if run(second).returncode:
            raise RuntimeError('SECOND_RUN_FAILED')
        repeated = json.loads((second / 'manifest.json').read_text(encoding='utf-8'))['events']
        if [(e['key'], e['plannedTime'], e['example']) for e in events] != [(e['key'], e['plannedTime'], e['example']) for e in repeated]:
            raise RuntimeError('DETERMINISTIC_VALUES_FAILED')
        # A corrupt snapshot must fail before producing an output directory.
        (store / '2026-10.json').write_text('{}', encoding='utf-8')
        bad = base / 'worker-change-monitoring/corrupt'
        if run(bad).returncode == 0 or bad.exists():
            raise RuntimeError('CORRUPTION_NOT_REJECTED')
    print('PASS: monthly boundary, temporary replacement, return, draft labels, output protection, optimized-run rejection, deterministic values, corrupt-input rejection')


if __name__ == '__main__':
    main()
