"""Validate the spec content hash and, for a writing step, its provenance and the plan rules before any browser operation.

Both runners (lt-plan-write.ps1 and lt-plan-run.ps1) call this file. Writing steps accept only a spec written by
plan-draft.ps1 (its generation.json records the output hash), so a hand-edited spec cannot drop unresolved reasons.
Exit 0 prints the hash; any other exit means the browser must not be called.
Usage: python -I plan-spec-check.py <spec.json> [--write-step register|needs|cycle|final|update|all]
  update = needs+cycle+final on an existing plan (-Plan); all = register+update.
"""
import datetime
import hashlib
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_dur = importlib.util.spec_from_file_location('plan_duration', os.path.join(HERE, 'plan_duration.py'))
DUR = importlib.util.module_from_spec(_dur)
_dur.loader.exec_module(DUR)

WRITE_STEPS = ('register', 'needs', 'cycle', 'final', 'update', 'all')
COVERS = {'register': {'register'}, 'needs': {'needs'}, 'cycle': {'cycle'}, 'final': {'final'},
          'update': {'needs', 'cycle', 'final'}, 'all': {'register', 'needs', 'cycle', 'final'}}
TIME_STEPS = {'needs', 'cycle', 'final'}
BLOCKS = {'plan-no': {'register'}, 'contract-end': {'register'}, 'visits': TIME_STEPS, 'duration': TIME_STEPS, 'util-plan': {'final'}}
PERIOD_DAYS = 364   # 적용 시작일부터 365일
GENERATORS = ('plan_draft.py', 'plan_duration.py')


def spec_hash(spec):
    body = {k: v for k, v in spec.items() if k != 'specHash'}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:16].upper()


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        return None


def period_problems(spec, write, start, end):
    """새 레코드 등록과 최초 계약을 구분하고 실제 기간 근거로 시작일을 검증한다."""
    basis = spec.get('periodBasis')
    if not basis:
        # Older generated specs keep their original restriction; no silent exemption.
        return ['period: 적용일 산정 근거가 없습니다. 신규·연속·갱신 구분으로 다시 생성하세요'] if start != write else []
    if not isinstance(basis, dict) or basis.get('type') not in ('initial', 'continuation', 'renewal'):
        return ['period: 신규·연속·갱신 적용일 산정 구분이 올바르지 않습니다']
    dates = {k: _date(basis.get(k)) for k in ('contractStart', 'contractEnd', 'recognitionStart', 'recognitionEnd')}
    if not all(dates.values()):
        return ['period: 계약기간과 인정유효기간의 실제 날짜가 필요합니다']
    problems = []
    if dates['contractStart'] > dates['contractEnd'] or dates['recognitionStart'] > dates['recognitionEnd']:
        problems.append('period: 계약기간 또는 인정유효기간이 역전되었습니다')
    if basis['contractEnd'] != spec.get('contractEnd'):
        problems.append('period: 적용일 근거의 계약 종료일이 명세와 다릅니다')
    if not (dates['contractStart'] <= start <= end <= dates['contractEnd']):
        problems.append('period: 적용기간이 계약기간 밖입니다')
    if not (dates['recognitionStart'] <= start <= end <= dates['recognitionEnd']):
        problems.append('period: 적용기간이 인정유효기간 밖입니다')
    if type(spec.get('newContract')) is not bool or spec['newContract'] != (basis['type'] == 'initial'):
        problems.append('period: 최초 계약 여부와 적용일 산정 구분이 다릅니다')
    expected = None
    if basis['type'] == 'initial':
        expected = dates['contractStart']
    elif basis['type'] == 'renewal':
        expected = dates['recognitionStart']
    else:
        previous = _date(basis.get('previousEnd'))
        if not previous or not basis.get('previousPlanNo'):
            problems.append('period: 연속 작성의 이전 계획서 번호·종료일이 필요합니다')
        elif previous == datetime.date.max:
            problems.append('period: 이전 종료일 다음 날을 계산할 수 없습니다')
        else:
            expected = previous + datetime.timedelta(days=1)
    if expected and start != expected:
        problems.append('period: 적용 시작일이 신규·연속·갱신의 확인된 기준일과 다릅니다')
    return problems


def check(spec, step):
    """쓰기 단계 전에 지켜야 할 규칙 위반 목록('종류: 설명')을 돌려준다. 빈 목록이면 통과."""
    steps = COVERS[step]
    update = spec.get('planMode') == 'update'
    problems = []
    intent = spec.get('creationIntent')
    if intent is not None:
        if (not isinstance(intent, dict) or intent.get('type') != 'additional' or
                not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', str(intent.get('requestId', ''))) or
                not isinstance(intent.get('preservePlanNos'), list) or not intent['preservePlanNos'] or
                any(not isinstance(no, str) or not no for no in intent['preservePlanNos']) or
                len(set(intent['preservePlanNos'])) != len(intent['preservePlanNos']) or
                not intent.get('requestedAt') or not intent.get('userInstruction')):
            problems.append('creation-intent: 동일기간 추가 작성의 요청 ID·사용자 지시·보존 대상이 필요합니다')
        if update:
            problems.append('creation-intent: 추가 작성 요청을 기존 계획서 수정에 사용할 수 없습니다')
    if spec.get('version') != 2:
        problems.append('version: 현재 생성기(v2)가 만든 spec이 아닙니다. plan-draft.ps1로 다시 만드세요')
    if not spec.get('name') or not spec.get('ltcMgmtNo'):
        problems.append('recipient: 수급자 이름·인정번호가 없습니다')
    write, start, end = (_date(spec.get(k)) for k in ('writeDate', 'adptFr', 'adptTo'))
    if not (write and start and end):
        problems.append('period: 작성일·적용기간 날짜 형식(YYYY-MM-DD)이 올바르지 않습니다')
    elif end < start:
        problems.append('period: 적용 종료일이 시작일보다 빠릅니다')
    elif not update:
        problems.extend(period_problems(spec, write, start, end))
        if (end - start).days > PERIOD_DAYS:
            problems.append('period: 적용 종료일은 시작일부터 365일 이내여야 합니다')
        contract = spec.get('contractEnd')
        if contract and contract != 'NONE' and (not _date(contract) or end > _date(contract)):
            problems.append('period: 적용 종료일이 계약 종료일보다 늦습니다')
    blocking = [u for u in spec.get('unresolved') or [] if BLOCKS.get(str(u).split(':', 1)[0], COVERS['all']) & steps]
    if blocking:
        problems.append('unresolved: 미해결 사유가 있습니다 — ' + ' / '.join(str(u) for u in blocking))
    if 'register' in steps:
        if update:
            problems.append('mode: 기존 계획서 수정용 spec(planMode=update)은 등록할 수 없습니다(-Plan으로 실행)')
        plan = spec.get('planNo')
        if not isinstance(plan, dict) or plan.get('confirm') or not all(re.fullmatch(r'\d{3}', str(plan.get(k, ''))) for k in ('ltcMgmtNoSeq', 'utilPlnppSeqNo')):
            problems.append('plan-no: 개인별장기요양이용계획서번호가 확인되지 않았습니다(추정값 불가)')
        if not spec.get('reason'):
            problems.append('reason: 작성사유가 선택되지 않았습니다')
        if not spec.get('contractEnd'):
            problems.append('contract-end: 계약 종료일 확인값이 없습니다')
    if TIME_STEPS & steps:
        problems.extend(DUR.duration_problems(spec.get('visits'), spec.get('opinion'), spec.get('items')))
    if 'cycle' in steps and spec.get('subGoalsMissing'):
        problems.append('sub-goals: 세부목표 문구가 정해지지 않은 그룹이 있습니다 — ' + ', '.join(spec['subGoalsMissing']))
    if 'final' in steps:
        if spec.get('decisionNeeded'):
            problems.append('decision: 종합의견 결정이 필요합니다')
        visits = str(spec.get('visits') or '')
        if not DUR.valid_visits(visits):
            problems.append('visits: 방문요양 횟수·시간 근거가 없습니다')
        elif '방문요양 ' + visits.replace('·', ', ').replace('~', '-').replace(',  ', ', ') not in str(spec.get('opinion') or ''):   # 생성기 lt_clean과 같은 정제
            problems.append('visits: 종합의견의 방문요양 횟수·시간 문장이 visits 값과 다릅니다')
    return problems


def provenance(path):
    """쓰기 단계는 plan-draft.ps1이 만든 spec만 받는다: 같은 폴더 generation.json의 출력 해시와 파일 해시가 같아야 한다."""
    folder, name = os.path.split(os.path.abspath(path))
    record = os.path.join(folder, 'generation.json')
    try:
        with open(record, encoding='utf-8-sig') as source:
            generation = json.load(source)
        outputs = generation.get('outputs') or {}
        rules = generation.get('rules') or {}
        if not isinstance(outputs, dict) or not isinstance(rules, dict):
            raise ValueError('invalid generation record')
        with open(path, 'rb') as source:
            actual = hashlib.sha256(source.read()).hexdigest().upper()
        generators = {}
        for filename in GENERATORS:
            with open(os.path.join(HERE, filename), 'rb') as source:
                generators['scripts/' + filename] = hashlib.sha256(source.read()).hexdigest().upper()
    except (OSError, ValueError, AttributeError):
        return ['provenance: plan-draft.ps1의 생성 기록(generation.json)이 없습니다. 손으로 만들거나 고친 spec은 쓰기 단계에 쓸 수 없습니다']
    if str(outputs.get(name, '')).upper() != actual:
        return ['provenance: spec 파일이 생성 기록의 출력 해시와 다릅니다(생성 뒤 수정됨). plan-draft.ps1로 다시 만드세요']
    recorded = {key.replace('\\', '/'): value for key, value in rules.items()}
    if any(str(recorded.get(key, '')).upper() != value for key, value in generators.items()):
        return ['provenance: 현재 초안 생성기로 만든 spec이 아닙니다. plan-draft.ps1로 다시 만드세요']
    return []


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8')   # PowerShell 실행기가 UTF-8로 읽는다(-I는 PYTHONIOENCODING을 무시)
    argv = sys.argv[1:]
    step = ''
    if '--write-step' in argv:
        index = argv.index('--write-step')
        step = argv[index + 1] if index + 1 < len(argv) else ''
        del argv[index:index + 2]
        if step not in WRITE_STEPS:
            raise SystemExit('Unknown write step')
    with open(argv[0], encoding='utf-8-sig') as source:
        spec = json.load(source)
    if spec.get('specHash', '') != spec_hash(spec):
        raise SystemExit('Spec content/hash mismatch')
    if step:
        found = provenance(argv[0]) + check(spec, step)
        if found:
            sys.stderr.write('\n'.join(found) + '\n')
            raise SystemExit(2)
    print(spec['specHash'])
