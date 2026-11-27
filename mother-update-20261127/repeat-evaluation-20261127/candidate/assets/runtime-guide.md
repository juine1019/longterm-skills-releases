# 독립 설치본의 실행·자료·승인

이 안내는 Windows·Codex용 현재 공통 스킬과 공용 실행기에 적용한다. 삭제된 2·9·13번은 메뉴에 연결하지 않는다. 업무별 세부 절차는 선택한 스킬만 읽는다.

여러 배포PC의 오류 처리·중앙 수정/배포·서버 변경 경계는 [배포PC 공통 운영 기준](deployment-pc-policy.md)을 함께 따른다. 배포PC의 오류를 이유로 운영 서버를 자동 수정하지 않는다.

## 롱텀 업무 공통 작성 문체

모든 롱텀 스킬의 서술형 업무 문장은 확인된 사실과 필요한 도움을 구체적으로 담아 자연스러운 업무 기록체로 작성한다. 본문에는 특정 날짜와 출처를 설명하는 문구(예: 업무수행일지에는, 기록됨)를 쓰지 않는다. 실제 직접 관찰하지 않은 사실이나 인과를 꾸며 쓰지 않는다. 내부 근거에는 출처·기록일·시점 차이와 상충 사항을 보존하며, 필수 날짜 입력란·일정·기록 식별 정보와 사용자 또는 서식이 명시적으로 요구한 날짜·출처는 유지한다.

## 경로와 초기 설정

`<설치폴더>`는 사용자가 정한 작업 폴더다. 그 안의 `control.cjs`가 `active.json`을 읽어 현재 버전의 코드/지침을 찾는다. 실행 전에 `node control.cjs doctor`, 업무 선택 시 `node control.cjs skill <스킬ID>`를 사용한다. `doctor`는 설치 파일·도구만 보고 브라우저는 확인하지 않는다(`browserChecked:false`). 4번은 시작 전 `node control.cjs doctor-task --task care-visit-review`로 지정 LT20A·같은 기관 업무데스크 창만 읽기 전용으로 확인한다(다른 창 탐색·쓰기 없음, `realSiteWritesVerified:false`). 지원 업무는 4번뿐이다.

Windows PowerShell 5.1은 **스크립트 파일 경로가 260자 이상이면 실행 자체를 하지 못한다.** 8번은 업무 데이터·임시 파일의 긴 경로를 지원하지만 이 한계는 남아 있으므로 설치 업무 폴더 경로는 짧게(대략 170자 이하) 둔다. `.agents/skills`는 진입 문서이며 실제 스크립트 폴더가 아니다.

기관 ID와 업무데스크 기관 ID·기관명, 현재 담당자, 필요한 개원일과 기관 정책은 이 설치본의 `longterm.workspace.json`에서 확인한다. 최초 설치는 검증된 마더 1.0.0 기본 기준으로 시작하며 기관 수정·추가는 별도로 기록하고 채택한다. 값이 없으면 원래 제작자의 기관 정보를 넣지 않는다. 정책 채택은 기관의 운영/작성 기준을 정하는 것이며 개별 실제 저장 승인을 대신하지 않는다. 인증서·비밀번호·쿠키·토큰은 이 파일에 넣지 않는다.

CLI는 로컬 Aside에 연결한다. 여러 프로필이면 `aside host profiles --host local`의 실제 연결된 프로필ID를 확인해 설정의 선택 항목 browser에 host=local·profileId를 기록한다. 기본 프로필/앱 설정을 바꾸지 않고 해당 호출에만 명시한다. 프로필 변경은 설정 해시를 바꾸므로 현재 탭·기관·역할을 다시 바인딩한다. 대상 탭이 없는 다른 프로필로 자동 이동하지 않는다.

실제 개인 원천·초안·사용자 지시·완료/불명 이력은 `state/organizations/<기관키>` 아래에 둔다. 코드 버전의 각 스킬 `data`/`output`은 현재 기관의 해당 자료 폴더를 가리키는 설치본 관리 junction이다. 임의로 다른 기관 폴더에 연결하거나 일반 폴더로 바꾸지 않는다. 다른 기관으로 전환하면 기존 자료와 완료/불명 이력을 보존한다.

업무별 문서에서 `<현재버전>`은 활성 release 폴더, `<스킬루트>`는 그 안의 `skills` 폴더, `<기관별 업무폴더>`는 위의 현재 기관 자료 폴더를 뜻한다. 제품 브리지가 필요한 절차는 현재 버전의 `runtime/client`를 사용하며 제품 저장소·배포/DB 키를 요구하지 않는다.

## 업무 명령

기관 설정/브라우저 바인딩을 확인한 뒤 실제 명령은 제어기로 호출한다.

```text
node control.cjs call --skill <스킬ID> --entry scripts/<실행파일> --input <현재 기관 자료 폴더의 요청.json>
```

요청 JSON의 `parameters`는 해당 스크립트의 인자다. PowerShell switch는 문자열이 아닌 JSON boolean을 쓴다. 기존 문서의 스크립트 명령 예시는 인자·입출력을 설명하는 자료이며 설치본의 실제 실행은 위 제어 경로를 사용한다. `ProductRoot`/`repo-root`는 제어기가 현재 버전의 클라이언트 폴더로 고정한다. 작성자와 개원일은 해당 기관 설정에서 주입한다. 직접 스크립트를 실행해 이 확인을 우회하지 않는다.

제어기의 `client-call`은4번 원문/점검 의견과1-1 점검 게시용 register-worker-notes.js, register-worker-note-reviews.js, register-schedule-review.js를 지원한다.3번 next-month-desk.js는 읽기만 허용하며 게시에는 `call --skill caremanager-next-month --entry scripts/desk-publish-prepared.js`를 사용한다. 4번 여러 달 실행은 `call --skill care-visit-review --entry scripts/monthly-four.cjs`다. 그 밖의 Node 진입은 실제 브라우저를 사용하지 않는 로컬 가공으로 제한하고 검증된 PowerShell 절차를 따른다.

실제 쓰기 요청에는 사용자 발언의 출처·대상/인자 내용 해시·기관 ID와 입력 파일 해시를 기록한다. 이 기록이나 승인 문자열을 에이전트가 만드는 것만으로 실제 승인 발언이 생기지는 않는다. 이미 받은 같은 범위의 승인은 반복해서 묻지 않고 각 업무의 저장/제출 경계를 따른다.

## 브라우저와 상태

기본은 Aside CLI다. 현재 프로필/호스트에서 사용자가 로그인한 탭을 관찰해 실제 targetId·기관·역할로 바인딩한다. 탭 주소·이름 첫 행만으로 계정/대상을 확정하지 않는다. LT20A와20L을 구분하며6번은 현재 종사자 이름도 확인한다. 기관·계정·프로필 변경 시 재확인하고 미저장 화면을 초기화하지 않는다.

OUT은 로그인 화면 근거가 있는 경우, UNKNOWN은 무응답/시간초과/불확실 화면이다. UNKNOWN을 로그아웃으로 단정하지 않는다. 로그인은 사용자가 한다. 새 감시/예약은 이 설치본을 설치하거나 스킬을 선택했다는 이유만으로 시작하지 않는다. 기관에서 명시적으로 요청한 감시만 소유 기록을 남겨 관리한다.

MCP 연결이 별도로 있어도 롱텀의 쓰기 경로는 검증된 CLI를 유지한다. MCP 읽기 보조 기능은 해당 버전의 기관 확인/공통 점유 연결이 검증된 경우만 사용한다. 같은 탭을 동시에 조작하지 않으며 연결을 바꾸어 저장을 재시도하지 않는다.

## 완료와 복구

실행 전 대상·기간·내용·기관/서버 점유·현재 버전과 각 업무의 승인 근거를 확인한다. 원문과 전체 결과는 개인 파일에 보존하고 채팅에는 필요한 근거·요약·불일치·파일 경로만 전달한다. 개인 명부 캐시는 후보 표시용이며 저장 직전의 현재 화면/계약/직원/금액 확인을 대신하지 않는다.

저장 응답이 불명확하면 이력/잠금을 유지하고 서버 재조회부터 한다. 새 폴더·새 실행명·다른 연결·코드 복구로 완료/불명 이력을 우회하지 않는다. 조회 실패를0건으로 바꾸거나 다른 업무 방식으로 자동 전환하지 않는다. 설치본의 로컬 잠금이 다른 PC 전체를 차단한다고 가정하지 않는다.

업데이트는 수동 실행하며 설정·자료·추가 스킬·사용자 수정/완료 이력을 보존한다. 양쪽 코드 변경이 충돌하면 덮어쓰지 않는다. rollback은 코드 선택을 되돌리는 것이며 실제 사이트 저장의 원복이 아니다. 소유가 확인된 실행만 정리하고 사용자 브라우저/로그인·다른 작업의 프로세스를 보존한다.

## 독립 Node 진입

```text
node control.cjs client-call --skill care-visit-review --entry scripts/register-worker-notes.js --input <현재기관state의 입력.json>
node control.cjs client-call --skill care-worker-note-review --entry scripts/register-worker-note-reviews.js --input <현재기관state의 입력.json>
node control.cjs client-call --skill longterm-past-schedule --entry scripts/register-schedule-review.js --input <현재기관state의 입력.json>
node control.cjs client-call --skill caremanager-next-month --entry scripts/next-month-desk.js --input <현재기관state의 읽기입력.json>
node control.cjs call --skill caremanager-next-month --entry scripts/desk-publish-prepared.js --input <현재기관state의 게시입력.json>
node control.cjs call --skill care-visit-review --entry scripts/monthly-four.cjs --input <현재기관state의 입력.json>
node control.cjs doctor-task --task care-visit-review
```

client-call 입력의 parameters는 file/approval/apply와 선택 out만 기본으로 사용한다. apply는 실제 boolean이어야 하며 생략하면 사전조회다. 다음 달 읽기에는 action=read와 month를 사용한다. 기관/주소/target은 현재 설정과 바인딩에서 고정하며 다른 값을 주면 중단한다. 출력은 새 개인 파일만 허용한다. 원천/approval과 입출력은 모두 현재기관 state의 실제 경로여야 한다.

실제 쓰기에는 해당 지시의 instruction.action=write, organizationId, 실제 사용자 발언 message, scopeHash, 모든 원천/승인 파일의 SHA256 files가 필요하다. client-call의 scopeHash는 {skill,entry:"client/"+entry,parameters}를 control.cjs의 hash로 계산하고 일반 call은 {skill,entry,parameters}다. 해시가 사용자 지시를 대신하지 않는다. 모듈 자체의 출처 확인·버전/기관/CAS 승인도 유지한다. 결과가 불명이면 점유와 개인 증빙을 남기고 자동 재게시하지 않는다.

4번 정식 진입의 parameters는 `{Mode:'run'|'resume'|'status', RequestFile, ResumeFile?}`이며 요청 파일은 현재기관 state의 `monthly-four-requests/<묶음>/<요청>.json`이다. `status`는 쓰기 없이 상태와 요청 작성용 `expected`만 돌려준다. `run`·`resume`은 쓰기 가능 실행이라 위 instruction과 `files`의 `RequestFile`·`ResumeFile` SHA256이 필요하다. 이어하기는 사용자가 지시했을 때만 하며 자동 재개는 없다. 결과 불명으로 남은 점유는 같은 runId의 명시 이어하기만 이어받고, 이어하기는 쓰기 전에 서버 대조부터 한다. 대상 일부 지정·업무수행일지 자동 수집·초안 자동 작성은 하지 않는다. 형식·보류 코드는 [4번 통합 절차](../skills/care-visit-review/references/monthly-workflow.md) 6절을 따른다. 가상 시험만 거쳤으며 실제 브라우저·기관 화면 검증은 아직 없다.

준비본 게시 parameters는 source/public/local과 선택 review/resolved, month/version/out을 쓴다. 검토한 원천·가격·공개본/로컬본의 관계를 먼저 검증하고 같은 바이트의 내부 준비본만 게시한다. 브라우저 사전조회 중 원본이 바뀌면 게시 전에 중단한다. 증빙을 갖춘 쓰기 전 중단은 점유를 해제하고, 게시 요청 뒤 불명은 유지한다. 정상 수신기관 실사이트/공용 서버 호환은 가상 검사와 별도로 확인한다.

6번은 lt=20L, ltRfid=20A를 각각 관찰된 정확한 origin에 바인딩한다. 결과평가 근거는 롱텀 전용이며 케어매니저 로그인을 요구하지 않는다. 다른 작업에서 작성 중인 화면은 보존하고 계정전환/새로고침으로 초기화하지 않는다.

## 12번 기관별 기록 내용 준비

care-record-policy-template / care-record-prepare / care-record-server-check는 기관의 실제 정책과 날짜별 서비스·시간·특이사항 근거를 로컬에서 검증하는 진입이다. 기능/형식은 [기관 정책·기록 근거](care-record-evidence.md)를 따른다. 정책 초안은 미채택이며 기본 임상 문구나 분배를 넣지 않는다. 준비와 호환 GET은 실제 게시/출력을 활성화하지 않는다.


## 반복 결과평가

같은 계획에 대한 결과평가는 서비스기간의 시작일/종료일이 같거나 서로 겹친다는 이유만으로 차단하지 않는다. 검토완료본의 서비스기간과 평가일을 그대로 유지하고 현재 이력의 동일 평가일 중복·다음 차수·미확인 저장을 별도로 확인한다.
