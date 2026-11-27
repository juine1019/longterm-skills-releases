# 초안 재사용·실행 기록

사용자가 기존본을 보존한 새 작성을 명시하면 동일 적용기간을 허용하는 `creationIntent`를 근거와 함께 생성한다. 요청ID는 해당 지시 동안 고정하고 보존할 기존번호 집합을 등록 직전에 대조한다. 일반 중복 방지, 같은 요청 성공 이력과 결과불명 차단은 유지한다. 신규 등록이 반환한 새 번호로만 다음 단계를 실행하고 기존본 보존을 독립 대조한다.

실행 인자와 중단 복구를 다룰 때 읽는다. 개발/검토 요청만으로 실제 계획서를 실행하지 않는다.

## 초안과 이용계획서

`plan-draft.ps1 -Name <대상> -OrgName <직접 확인한 기관명> -ContractEnd <계약 종료일> -Visits '<급여이용계획 횟수·시간>' -PlanNo '<번호>' -OutDir <Git 제외 폴더> [-Diff <문장|NONE|SKIP> -UtilPlanManifest <pdf-manifest.json>] ...`는 매번 고유 draft 폴더에 source.json·evidence.json·docx·spec·generation.json을 보관한다. OrgName은 새 초안에도 필수다. 생성 입력/기준·출력 해시와 시각을 남긴다. Python 생성기를 직접 호출해도 같은 이름의 docx/spec이 있으면 덮어쓰지 않는다.

spec v2는 `visits`·`contractEnd`·`unresolved`(미해결 사유)·`evidence`(사용한 평가 날짜, 이용계획서 PDF ID·해시 또는 SKIP 결정)를 담는다. 근거가 빠진 값은 기본값으로 채우지 않고 `unresolved`에 남기며 초안 검토 메모 맨 앞에 ★미해결로 보인다. 해결하려면 근거를 확인해 인자를 주고 초안을 다시 만든다(새 spec 해시). 케어매니저 평가 조회에는 작성일(today)을 넘겨 연도 범위를 정하고 evidence.json에 남긴다. `-DumpFile` 재사용은 같은 작성일에서만 허용한다(다른 작성일이면 새 평가를 놓칠 수 있어 다시 수집). 이용계획서 PDF가 여러 개면 비교한 파일을 `-UtilPlanFile <ID>`로 지정하고, 작성일 기준 30일 안에 받은 자료만 차이점 근거로 쓴다. 취득 실패·다른 대상·해시 불일치는 차이점 문장을 쓰지 않고 미해결로 남긴다. 계약 종료일이 없는 계약은 `-ContractEnd NONE`으로 확인값을 준다.

동일 초안을 로컬에서 수정하려면 `-DumpFile <기존 source.json> [-ManifestFile <evidence.json>] -OrgName <동일 기관명>`을 추가한다. 대상/인정번호·기관·원천 해시·기준/코드/카탈로그 해시를 확인하고 사이트 조회 없이 새 폴더에 재생성한다. 기존 초안은 보존한다. 기준이 달라지거나 명세가 없는 자료를 강제로 재사용하지 않는다.

CM 화면에는 기관명을 자동 확정할 근거가 부족하다. evidence의 orgBasis는 `operator-confirmed-not-browser-verified`이며, OrgName은 작업자가 직접 확인한 기관이다. 원천 시각도 그대로 유지한다. 이는 로컬 문서 재생성용이지 현재 기관·계약·작성 승인 증명이 아니다. 새 실제 입력은 현재 LT 기관/인정번호·계약/인정기간·중복/통보 상태를 다시 확인한다.

`util-plan.ps1 -Name <대상> -OutDir <폴더>`는 PDF 후보가 여러 개면 `selection-required`와 파일 목록만 돌려준다. 대상·기간·문서 종류를 확인해 `-FileIds 'ID1,ID2'`로 필요한 자료를 받는다. 임의 앞3개·파일명만으로 최신 문서를 확정하지 않는다. 자료 선택은 추가 승인 질문이 아니며 판단이 불명확할 때만 사용자에게 확인한다. 목록 범위는 기존 올해·작년 기본서류다. 해당 범위에 없음을 모든 과거 자료 부재로 단정하지 않는다.

텍스트 페이지는 text, 이미지 페이지는 png로 반환하고 pdf-manifest.json에 파일 ID/원본 해시/판독 입력 경로를 기록한다. 텍스트가 있더라도 표·유효기간·일부 이미지가 불명확하면 원본 PDF를 추가 확인한다. 같은 PDF 해시에 대해 이전 판독 근거를 재사용할 수 있지만 자동 판독 캐시는 아직 없다. 변환 실패·잘못된 PDF·PNG 누락은 error이며 found로 진행하지 않는다. `found`는 자료 확보를 뜻하며 유효 문서 선택/내용 판독 완료가 아니다.

## 단계 실행과 최종 대조

`lt-plan-write.ps1`은 기존 단계·gzip 전달·허용 저장 주소를 유지한다. Apply에는 spec 내용 해시와 `-Approve <specHash> -InstitutionId <현재 LT 기관기호>`가 모두 필요하다. 기관기호는 추측하지 않고 현재 LT gds_userInfo의 LTC_ADMIN_SYM/ADMIN_SYM을 읽어 확인한다. 별도 승인 문장을 다시 받는 옵션이 아니다.

각 단계는 기본 spec 옆 execution-<specHash> 폴더에 결과 전문과 작은 summary를 분리한다. `-RunDir`로 지정할 수 있으며 모든 단계에 같은 폴더를 쓴다. 콘솔에는 log/telCols 전문을 내보내지 않는다. 결과 전문·expected.json에는 개인정보가 포함될 수 있으므로 Git 제외 로컬 경로만 사용한다.

쓰기 단계 전에 `plan-spec-check.py <spec> --write-step <register|needs|cycle|final|update|all>`가 해시·생성 기록·규칙을 검사한다.
- 생성 기록: 같은 폴더 generation.json의 출력 해시와 spec 파일이 같아야 하고, 기록된 생성기 해시도 현재 코드와 같아야 한다. 이전 생성기의 v2 초안도 다시 만든다. 생성 뒤 spec만 고치면(해시를 다시 계산해도) 쓰지 못한다. generation.json까지 고치는 의도적 위조는 파일 검사로 막지 못하므로 금지 사항으로 둔다. 고칠 내용은 plan-draft.ps1로 다시 만든다.
- 규칙: spec v2, 시작일은 periodBasis의 신규 최초 제공(initial)·기존 계획 연속(continuation)·인정 갱신(renewal)으로 산정한다. 신규는 실제 계약·제공 시작일, 연속은 이전 종료일 다음 날, 갱신은 갱신 인정 시작일이다. 작성일은 실제 작성일로 별도 보존한다. 종료≤시작+364일·계약 종료일이며 적용기간 전체가 계약·인정기간 안이어야 한다. 근거 구분과 newContract가 맞아야 하고, 단계에 걸리는 미해결 사유가 없어야 한다. register는 이용계획서번호 3자리-3자리·작성사유·계약 종료일, cycle은 세부목표, final은 종합의견 결정·방문 횟수(종합의견 문장과 같아야 함).
- 미해결 사유의 범위: 이용계획서번호·계약 종료일은 register만, 방문 횟수·이용계획서 근거는 final만, 평가 관련은 모든 쓰기를 막는다.
- 단계 실행기의 드라이런은 spec 내용 해시를 확인하고 쓰기 규칙·생성 기록 검사 없이 허용한다. 전체 실행기는 드라이런도 이번 실행 범위(새 계획 all, `-Plan` update)를 검사한다.
- 기존 계획서 수정: `plan-draft.ps1 -ExistingPeriod 'YYYY-MM-DD~YYYY-MM-DD' -WriteDate <원래 작성일>`이 planMode=update spec을 만든다. 적용기간은 서버 값 그대로이며 등록할 수 없고 `lt-plan-run.ps1 -Plan <번호>`로만 실행한다.

쓰기 시도 원장(`plan-common.ps1`): register/needs/cycle/final 직전에 사용자 원장 `%LOCALAPPDATA%\longterm-plan-write\attempts\<수급자 해시>\<대상 해시>\<specHash>-<n>.json`을 CreateNew로 만든다. 대상은 등록이면 수급자, 그 밖은 계획서+단계다. 실행 폴더에도 같은 시도를 `<단계>-attempt-<...>.json`으로 남긴다. 결과는 `.outcome.json`으로 기록한다. 같은 PC·프로필에서는 수급자별 배타 잠금으로 쓰기와 결과 기록이 겹치지 않게 한다.
- `ok`: 단계 성공. 같은 승인 내용(spec 해시)은 이 대상에 다시 쓰지 않는다.
- `not-sent`: 저장 함수를 부르지 않았고, 예외가 없고, 감시한 저장 요청이 0건인 실패다. 같은 내용으로 사용자가 다시 시도할 수 있다. 저장 함수를 호출했다면 요청 0건이어도 실패는 불명으로 남는다.
- 결과 기록 없음(unknown): 응답 유실·타임아웃·예외·저장 요청 후 실패. 결과 기록이 비었거나 읽을 수 없어도 unknown이다. 같은 수급자의 모든 쓰기를 spec과 무관하게 막는다(다른 단계, 작성일을 바꾼 새 초안의 재등록 포함).
- 해결: 롱텀 계획서 화면에서 대상 계획서를 선택하고 `run.ps1 -Script lt-plan-state.js`로 서버 상태를 읽어 파일로 저장한다(`lt-plan-write.ps1 -Step read`는 상태를 돌려주지 않는다). 대조한 뒤 `lt-plan-resolve.ps1 -Spec <spec> [-Plan <번호>] -Step <단계> -Outcome applied|not-applied -StateFile <읽은 상태>`로 기록한다. 상태 파일은 lt-plan-state.js 형식이며 쓰기 시도의 기관·수급자·계획서와 일치하고 시도보다 나중이어야 한다. 같은 승인본·단계에서 불명 시도가 하나일 때만 기록한다. 기관이 기록되지 않은 이전 시도나 손상된 기존 결과는 보존하고 이 명령으로 닫지 않는다. not-applied면 다시 시도할 수 있고 applied면 같은 내용은 다시 쓰지 않는다. 브라우저를 부르지 않고 기록을 지우지 않는다. 대조 판단 자체는 작업자 몫이다.
- 원장·시도 기록을 지우거나 `LOCALAPPDATA`를 바꿔 실행하는 것은 보호 우회이므로 하지 않는다. 시험만 임시 폴더로 바꾼다.
- 전체 실행기도 Apply 전에 이번 실행이 할 쓰기 단계(새 계획은 등록, `-Plan`은 needs·cycle·final)의 원장을 확인한다. 실행 중 결과 불명 단계가 있으면 workflow 상태는 unknown이며 뒤 단계로 넘어가지 않는다. 전체 실행기의 실행 폴더는 실행마다 `apply-<시각>-<id>`·`dry-<시각>-<id>`로 새로 만든다(기록용이며 재실행 보호는 원장이 맡는다).
- 이용계획서 PDF 30일 기준은 오래된 다운로드 재사용을 막으려고 정한 보수적 기준이다(규칙 원문에 날짜 기준은 없음). 기존 계획서 수정은 생성일 기준으로 본다. 비교한 PDF가 spec의 이용계획서번호와 같은 문서인지는 작업자가 확인한다. 저장 후 응답 성공은 `step-ok-needs-independent-verification`이며 전체 완료가 아니다. 오류/중단은 unknown으로 보존하고 자동 재저장하지 않는다. 시도 기록은 서버 도달 증명이 아니며 서버 내용과 대조해야 한다. 파일 삭제나 새 RunDir로 보호를 우회하지 않는다. 이미 등록된 계획서는 register로 다시 만들지 않는다.

`lt-plan-run.ps1 -Spec <spec> -Phone <CM 등록 전화> -InstitutionId <확인 기관기호> -Apply -Approve <specHash>`는 승인된 전체 작성 요청에만 사용한다. register→select→writer→needs→cycle→final→새 select/writer→state/verify→park를 연결한다. 기존 계획서 수정이 명시적으로 승인된 경우에만 `-Plan <번호>`로 register를 생략한다. AllowRemove는 전체 실행기에 자동 전달하지 않는다. 필요내용 해제는 별도 지시 범위와 개별 단계에서 처리한다.

기본은 드라이런이며 고유 dry 하위 폴더를 사용하므로 검토 뒤 실제 Apply 실행을 막지 않는다. 새 계획서 번호가 없는 드라이런은 register 검토와 park까지만 한다. 실제 등록 없이 뒤 단계를 성공했다고 표시하지 않는다. 계획서 번호가 있는 드라이런은 기존 변경 복원 절차를 유지한다. 전체 실행기는 자동 재개 기능이 아니다. 실제 workflow-start/단계 시도가 있으면 반복하지 않는다.

expected.json에는 실행 시작 시 고정한 agreeDate·CM phone·institutionId를 저장한다. 개별 실행을 조합할 때도 이를 만들고 `python -I lt-plan-verify.py --state <새 상태 파일> --spec <spec> --plan <번호> --expected <expected.json>`으로 대조한다. 동의일 TODAY·전화 기대값이 없으면 검증 성공으로 처리하지 않는다.

최종 검증은 대상/계획서·신규 등록의 이용계획서번호·적용기간·작성일·그룹별 주기/횟수/시간·세부목표·목표/종합의견·동의자/동의일/전화/관계/방식·작성자/최종확인자·기관·미통보를 비교한다. 그룹 대응이 모호하면 중단한다. 화면의 숨은 해제 그룹은 경고로 분리한다. 동일 총시간이나 HTTP200만으로 완료로 보지 않는다. 자격번호 전체의 동등성 검증은 추가하지 않았다.

통보 판정은 목록·상세의 DATA_TRS_DT를 각각 확인하며 필드 조회 누락도 실패로 처리한다. 일반 저장 시 채워지는 기관 확인 필드 LTCO_YN·LTCO_CFR_DT를 공단 통보로 오인하지 않는다. 저장 요청 기록과 별도 sendLtcpPofPlnpp 통보 경로도 구분한다. 저장 후 내용은 일치하나 검증기 판정에 문제가 있었으면 원래 실패 기록을 보존한 채 원인을 확인하고 재저장하지 않는다. `lt-plan-audit.ps1 -Spec <spec> -Plan <번호> -Phone <확인 전화> -InstitutionId <기관기호> -OutDir <개인폴더>`는 같은 제어기 경로에서 select→writer→독립 state/verify→park만 수행하는 읽기 전용 대조다. 쓰기 이력·불명 점유를 이 명령으로 자동 삭제하지 않는다.

최종 화면은 팝업 없는 계획 통보서 탭(park)이어야 한다. 실패 때도 가능한 정리를 시도하고 정리 실패를 summary에 표시한다. unknown·불일치·사용자 미저장 변경이 있으면 저장 재시도 없이 서버/화면 상태를 먼저 확인한다. 부분 저장을 자동 삭제하지 않는다. 통보(sendLtcpPofPlnpp)·삭제는 계속 차단한다.

## 아직 줄이지 않은 것

고정 대기시간·단계마다 open 확인·저장 후 독립 재조회는 유지한다. idle 시간초과는 명시적 실패로 바꿨다. 실제 준비 완료 신호와 지연/운영 무저장 검증 없이 대기를 단축하지 않는다. 기관·계약 실조회, 자동 PDF 판독 캐시, 사람별 이력 축소, 프로세스/탭 연결 재사용 및 실제 토큰/시간 절감률 측정은 이번 구현에 포함하지 않았다.
