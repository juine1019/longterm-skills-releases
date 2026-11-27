# 직원변경 모니터링 0.1.0 설치

공개 ZIP에서 스킬과 가상시험만 설치한다. 기관 자료/결과 문서/설정/인증/발행키는 포함하지 않는다.

1. 다운로드 ZIP의 SHA256을 배포 페이지 또는 전달 문구의 값과 비교한다.
2. 새 임시 폴더에 풀고 이 문서와 LIMITATIONS.md, install.ps1을 읽는다.
3. PowerShell에서 `& ./install.ps1 -VerifyOnly`로 내부 파일 해시를 검사한다.
4. `& ./install.ps1`로 현재 사용자의 CODEX_HOME/skills 또는 ~/.codex/skills에 설치한다. 동명 폴더가 다르면 중단한다. 기존본은 다른 위치에 보존하고 사용자와 교체 범위를 확인한다. 강제 덮어쓰기 옵션은 없다.
5. Python 3.10 이상 환경에서 `python -m pip install -r requirements.txt`를 수행한다. 기존 관리 환경이 있으면 이를 우선하고 필요하면 별도 venv를 사용한다. 조직 실행 정책을 우회하거나 시스템 설정을 바꾸지 않는다.
6. `python ./care-worker-change-monitoring/scripts/self_test.py`로 가상자료 시험을 한다. 시험은 임시 폴더에서만 실행한다.
7. 필요하면 Codex 새 채팅에서 `$care-worker-change-monitoring`을 호출해 인식 여부를 확인한다. 새 채팅 호출은 사용자가 한다.

실제 업무 사용 전: 현재 PC의 작업공간과 기관, 원천 저장 구조, 기존 출력 이력, Aside 공통 지침, 렌더 도구/한글 글꼴을 확인한다. 이번 설치 지시는 실제 자료 수집/생성/게시/저장/통보 승인이 아니다.

실행 형식(기관별 실제 경로로 대체):
`python <skill>/scripts/create_documents.py --workspace <workspace> --output <workspace>/state/organizations/<기관키>/worker-change-monitoring/<새작업ID>`

복구: 설치 영수증에 표시된 새 스킬 폴더만 확인 후 제거하면 된다. 기존 동명 폴더에는 쓰지 않으므로 자동 복귀/백업 삭제를 수행하지 않는다. 롱텀 release/state/설정은 설치기가 변경하지 않는다.
