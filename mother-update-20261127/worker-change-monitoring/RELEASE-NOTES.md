# 급여제공직원 변경 모니터링 — 별도 스킬 전달본

다른 배포 PC의 Codex에서 공개 ZIP을 내려받아 설치하는 0.1.0-preview.1 prerelease입니다. 기관 자료·결과 문서·인증정보는 포함하지 않습니다.

**롱텀 공식 서명 업데이트와 별도입니다. stable feed 및 기존 1.1.2 자산은 변경하지 않습니다.**

- [설치 ZIP](https://github.com/juine1019/longterm-skills-releases/releases/download/worker-change-monitoring-v0.1.0-preview.1/care-worker-change-monitoring-0.1.0-preview.1.zip)
- SHA256: `56a7fe7b7c883b33e63e8cef3e55cd6f34fb20ba988e50ffe78b7ddc14e88fa0`
- 함께 올린 install-codex-worker-change.txt 전체를 대상 PC의 Codex 채팅에 붙여 넣으세요. 공개 자산 다운로드에는 GitHub 로그인이 필요하지 않습니다.
- 자동 생성 Source code ZIP이 아닌 위 업로드 ZIP을 사용하세요. 스킬 소스·설치기·안내·가상시험은 업로드 ZIP 안에 있습니다.

## 검증

가상자료에서 월 경계·임시대체·복귀·초안 표시·기존 출력 보호·기관 외 출력 차단·Python 최적화 실행 차단·예정값 재현·손상 원천 차단을 확인했습니다. 별도 시험 폴더에서 파일 해시 검사·신규 설치·재설치·기존 사용자 수정본 보존을 확인했습니다. skill-creator 형식 검사 통과.

실제 기관 실행, 다른 배포 PC의 실행환경, DOCX→PDF/PNG 시각 검증은 미검증입니다. 설치 후 대상 PC에서 확인하세요.

## 구현 한계

보관월 전체에서 상담 확인 전 예시 초안을 생성합니다. 기간/대상 필터·기존 manifest 자동 재사용·실제 상담내용 자동 반영은 미구현입니다. 직원명 기반 관측이며 공동제공·중복시간·동명이인은 검토 대상입니다. 완전하지 않은 보관월이나 해시/기관 불일치는 중단합니다. 자세한 범위는 ZIP의 LIMITATIONS.md 참조.

Python 및 문서 변환 도구는 포함하지 않습니다. 코드와 가상시험만 공개하며 대상 PC는 자기 기관 자료를 사용합니다. 설치 지시는 실제 업무 실행/게시/저장/통보를 포함하지 않습니다.
