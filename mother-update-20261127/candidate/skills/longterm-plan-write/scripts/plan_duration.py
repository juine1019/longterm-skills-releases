"""방문요양 1회 제공시간 해석과 일 단위 항목 합계 검사(V038, 2026-11-17).

초안 생성기(plan_draft.py)와 쓰기 전 검사(plan-spec-check.py)가 같은 규칙을 쓴다.
확인한 계약 방문시간(-Visits)과 종합의견 제공시간이 등급 자동 시간(180/240분)보다 우선하며,
한 값으로 정할 수 없는 표기(범위·대략·여러 값·소수·시각)는 추정하지 않고 미해결로 둔다.
아는 표기(횟수·시간·요일 묶음·허용 조사)만 확정하고, 그 밖의 글자가 하나라도 남으면 미해결이다."""
import re
import unicodedata

UNSURE = re.compile(r'미확인|미정|추정|모름|확인\s*(?:필요|불가|중)')
APPROX = re.compile(r'약\s*\d|정도|내외|이상|이하|이내|미만|초과|가량|쯤|안팎|전후|최대|최소|또는|혹은')
RANGE = re.compile(r'\d\s*(?:시간|분)?\s*(?:[~∼〜～\-－–]|부터|에서)\s*\d')
CLOCK = re.compile(r'\d\s*:\s*\d')
DECIMAL = re.compile(r'\d\s*\.\s*\d')
COUNT = re.compile(r'(?<![0-9])[1-9][0-9]*\s*회')
TIME = re.compile(r'(?<![0-9])([0-9]+)\s*시간(?:\s*(반)|\s*([0-9]+)\s*분)?|(?<![0-9])([0-9]+)\s*분')
FREQUENCY = re.compile(r'(?:매주|주|매월|매일|하루|1일)?\s*[1-9][0-9]*\s*회(?:당|씩)?')
WEEKDAYS = re.compile(r'[월화수목금토일](?:요일)?(?:\s*[~,·]?\s*[월화수목금토일](?:요일)?)+')
FILLER = re.compile(r'방문요양|방문|매회|씩|[\s,·()]')
MAX_VISIT_MINUTES = 480   # 1회 8시간을 넘는 값은 표기 오류로 보고 확정하지 않는다
PROVISION = re.compile(r'방문요양\s+([^.\n]+?)\s*서비스를\s*제공할\s*예정')


def visit_minutes(text):
    """방문 1회 제공시간(분)을 돌려준다. 반환 (분, '') 또는 (None, 사유)."""
    text = unicodedata.normalize('NFKC', str(text or '')).strip()   # 전각 숫자·기호를 같은 글자로 읽는다
    if not text:
        return None, '값 없음'
    if UNSURE.search(text):
        return None, '미확인 표기'
    if CLOCK.search(text):
        return None, '시각 표기(분으로 확정 필요)'
    if RANGE.search(text):
        return None, '범위 표기'
    if APPROX.search(text):
        return None, '대략·한도 표기'
    if DECIMAL.search(text):
        return None, '소수 표기'
    values = []
    for m in TIME.finditer(text):
        if m.group(4) is not None:
            values.append(int(m.group(4)))
            continue
        extra = 30 if m.group(2) else int(m.group(3) or 0)
        if extra >= 60:
            return None, '분이 60 이상인 시간 표기'
        values.append(int(m.group(1)) * 60 + extra)
    if not values:
        return None, '시간 표기 없음'
    if len(set(values)) > 1:
        return None, '서로 다른 시간 ' + '·'.join(f'{v}분' for v in values)
    if values[0] <= 0:
        return None, '0분'
    rest = FILLER.sub('', WEEKDAYS.sub('', FREQUENCY.sub('', TIME.sub(' ', text))))
    if rest:
        return None, f'해석하지 못한 표기 「{rest}」'
    if values[0] > MAX_VISIT_MINUTES:
        return None, f'1회 {MAX_VISIT_MINUTES}분 초과'
    return values[0], ''


def valid_visits(text):
    """횟수와 한 값으로 정해지는 시간이 함께 있어야 확인된 방문 횟수·시간이다. 작업자 표기는 그대로 둔다."""
    return bool(text and COUNT.search(text) and visit_minutes(text)[0] is not None)


def daily_total(items):
    """spec 항목 중 주기 '일' 항목 시간 합계(분). 숫자가 아닌 시간이 있으면 None."""
    total = 0
    for item in items or []:
        if item.get('cycle') != '일':
            continue
        try:
            total += int(item.get('minutes'))
        except (TypeError, ValueError):
            return None
    return total


def opinion_times(opinion):
    """종합의견의 제공방법 문장에서 횟수·시간 부분을 모두 돌려준다(숫자가 있는 것만)."""
    return [m.group(1).strip() for m in PROVISION.finditer(str(opinion or '')) if re.search(r'\d', m.group(1))]


def duration_problems(visits, opinion, items):
    """계약 방문시간·종합의견 제공시간·일 단위 항목 합계가 한 값으로 일치하지 않으면 'duration: 설명' 목록을 돌려준다."""
    contract, reason = visit_minutes(visits)
    if contract is None:
        return [f'duration: 계약 방문시간을 한 값으로 확인하지 못했습니다({reason}). 케어매니저 계약관리 급여이용계획의 시간을 -Visits로 주세요']
    problems = []
    times = opinion_times(opinion)
    if not times:
        problems.append('duration: 종합의견에 방문요양 제공시간 문장이 없습니다')
    for text in times:
        minutes, why = visit_minutes(text)
        if minutes is None:
            problems.append(f'duration: 종합의견 제공시간 「{text}」을 한 값으로 해석할 수 없습니다({why})')
        elif minutes != contract:
            problems.append(f'duration: 계약 방문시간 {contract}분과 종합의견 제공시간 {minutes}분(「{text}」)이 다릅니다')
    total = daily_total(items)
    if total is None:
        problems.append('duration: 일 단위 항목 시간에 숫자가 아닌 값이 있습니다')
    elif total != contract:
        problems.append(f'duration: 일 단위 항목 합계 {total}분이 계약 방문시간 {contract}분과 다릅니다(서비스를 임의로 빼거나 계약 시간을 바꾸지 않고 확인 필요)')
    return problems
