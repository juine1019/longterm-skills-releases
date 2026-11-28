# LT 단독 실행 규칙

## 1-2 최종 일괄 확인 실행 (서버 기능 확인 필수)

사용자의 명시적 1-2 실행 지시가 있을 때 `lt-final-review-cli.js --execute`를 사용한다. `--origin`, `--org`, `--month`, 실제 지시 시각 `--approved-at`, 게시 원천 수집본이 있는 로컬 `--source-dir`, 개인 로컬 `--evidence-dir`, 설치본 `runtime/client`의 `--product-root`를 지정한다. 저장된 대상·시간·원복하지 않는 범위를 안내하고 추가 승인 질문 없이 진행한다. 사용자의 선택 저장은 대리하지 않는다.

서버의 `supportsDeferredFinalExecution`과 저장 선택·게시 원천 해시·완전한 로컬 수집본을 확인한다. 서버가 미지원이면 점유 전 중단하고 기존 경로로 자동 전환하지 않는다. 계약별 현재 일정을 읽은 뒤 날짜마다 취소·입력하고 전체 종료 후 대상 계약별 월 전체를 대조해 결과를 한 번에 기록한다. 취소 처리 완료는 내부적으로 확인한다. 전송이 끝난 불명 건은 해당 계약을 보류하고 다른 계약을 계속한다. 진행 중인 전송이나 서버 기록 불명은 점유 유지·자동 재전송 금지다. 인지활동형 관리자와 가족구분을 보존한다. 프로세스 중단 후 자동 복구는 아직 지원하지 않는다.

최신 기관 전체 태그·다른 대상 일정 재조회, 별도 Dry, 완료 후 전수 재게시는 하지 않는다. 그 사이 다른 대상·기관에서 발생한 충돌은 저장 거절 전 미리 발견하지 못할 수 있고 새 점검 항목은 다음 1-1에서 확인한다. 가상 검증과 실제 사이트·신규 Windows 설치 검증을 구분한다.

아래 「저장본 실행」「완료와 갱신」은 별도로 명시 요청된 구버전 계약별 경로이며 건별 경로에 추가하지 않는다.

[공통 실행 안내](../../../assets/runtime-guide.md)를 따른다. 제품 도구는 현재 버전 runtime/client에 있으며 제작자 저장소가 필요하지 않다. 실제 사이트는 현재 바인딩된 같은 기관 LT20A·업무데스크 관리자만 쓴다. 서버 기관 점유와 capability를 확인하고 SERVER_UPGRADE_REQUIRED이면 다른 API로 우회하지 않는다.

## 조회와 게시

지정 실행에서는 `LONGTERM_WORKSPACE`의 같은 기관 LT20A·업무데스크 binding을 사용한다. 첫 호출의 binding 지문·탭 ID를 고정하며 같은 역할의 다른 탭을 탐색하거나 자동 전환하지 않는다. 20L은 별도 역할이다. source 전체를 UTF-8 stdin으로 한 프로세스에 넘기고 길이·해시를 대조하며 전송 결과 불명은 재전송하지 않는다. 바인딩 변경·손실·기관/역할 변경은 브라우저 호출 전에 중단한다.

새 점검·추천 재계산·재게시에는 [추천과 실행 보류 분리](review-proposals.md)를 먼저 적용한다. 검토용 추천과 실제 변경 허가를 구분하고 오래된 조회본 제외를 사용자 확정 판단의 폐기로 해석하지 않는다.

review.ps1은 From/To·SortOrder·DeskOrigin·OrgName·새 OutputPrefix를 받는다. 공식 월별 전체 계약과 기간 겹침, 종료/재계약, 전체 계획과 태그를 별도 데이터셋으로 읽는다. 미저장 화면이 있으면 중단하고 원래 선택·월·일정을 복원한다. 성명은 표시이며 기관·계약·수급자ID가 결합 근거다. 태그 트랜잭션의 성공 callback·기간을 확인하고 성공한0건과 실패/미완료를 구분한다.

배치 실패·잘림·미완료가 있으면 부분 성공을 합쳐 전체로 게시하지 않는다. SampleContracts는 시험용 complete=false로 게시할 수 없다. BatchSize 기본5, 허용1~10이며 브라우저 병렬 조작은 하지 않는다. 큰 묶음 실패를 자동 재실행하지 않는다. 기관 점유 확인을 묶음 사이에도 유지한다.

동일 전체 checkFile을 재사용하면 기관·기간·조회 시각·sourceHash·건수가 일치해야 한다. 보고서 생성 시각을 새 조회 시각으로 표시하지 않는다. sourceKey/groupKey/evidenceHash만 서버로 보내며 실제 원천ID는 개인 증빙에 보존한다. 요약의 phaseMs·guardCalls는 시간/호출 지표이며 토큰 지표가 아니다.

## 저장본 실행

runtime/client/scripts/schedule-review-execution.js로 서버의 같은 월 선택·버전·해시를 읽어 새 plan을 만든다. 실제 사용자 승인과 origin/orgName/month/selectionVersion/selectionHash/approvalHash·approvedAt·restoreOnFailure를 연결한다. 같은 승인으로 claim해 새 manifest를 만들며 점유는 자동 만료시키지 않는다.

lt-only-run.ps1의 ManifestFile·Mode Plan으로 검사하고 필요할 때만 별도 Dry를 한다. Apply 내부의 최신 전수 수집과 묶음별 Dry는 항상 유지한다. Mode Apply는 실제 승인과 ExpectedPlanHash가 일치해야 하며 사전 승인된 원복만 RestoreOnFailure로 한다. Apply에 과거 CollectionFile을 최신 증빙 대신 넣지 않는다. 수동 RequestFile은 서버 저장 선택을 대체하지 않는다.

저장 직전 기관·계약·인정번호·등급·태그·전체월·종사자 원천ID·최종 시간·충돌·한도·선택 해시를 재확인한다. 올림/내림을 최종 시간에 반영한다. 이미 목표면0회, 순수 삭제1회, 변경은 취소1→입력1이다. 확정된 실패만 승인된 원복 범위에서 복구한다. 부분 저장/응답 불명은 unknown으로 점유를 유지한다.

## 완료와 갱신

LT verified/already-goal 이력을 서버에 기록한 뒤 동일 승인 기간을 완전 재조회한다. schedule-review-follow-up.js로 원래 snapshotVersion CAS·기관·기간·최신 시각을 대조해0건도 게시하고 독립 GET한다. 새 발견 항목을 기존 승인 선택에 추가하지 않는다. LT 완료 후 서버 기록/목록 갱신 실패는 LT 재저장 사유가 아니다. 게시 응답 불명은 현재 GET부터 확인한다. 화면의 snapshot/selection/execution/meta는 같은 버전이어야 한다.

## 삭제 전용 범위

서버 저장본이 삭제만 담은 경우 `lt-only-run.ps1 -DeleteScope`로 대상 수급자 계약만 수집할 수 있다. 이 범위는 `scope`와 `completeness.scopedComplete`로 구분하고 `complete=false`이므로 전체 검토 게시나 시간 변경에 사용할 수 없다. 태그는 기관 전체로 읽고 조회 조건을 검증한다. 삭제 후 목록은 전체 수집으로 갱신한다. 삭제에는 미제공 확인(`provided=false`, `not-provided=true`)이 필요하며 태그 누락 사유를 요구하지 않는다. 사용자 직접 승인·기관 점유·중복 및 불명 보호는 유지한다.


## 인지활동형 조회 후 순번 보정 (2026-11-28 로컬 테스트)

사이트의 조회 callback과 원래 인지활동 합산 함수가 확인되고 등급5인 화면에서, 기존 상세행의 AC_YN=N이 그대로인 채 숫자 합산순번만 0으로 바뀐 경우는 해당 사이트 조회의 자동 보정으로 구분한다. 그 외 상세열 변경·행 추가/삭제·미저장 플래그는 계속 중단한다. 데이터셋에 applyChange/reset을 호출하지 않고 저장·통보도 하지 않는다. 이미 사용자가 저장한 일정을 과거 조회본으로 원복하지 않는다.
