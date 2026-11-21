# 롱텀 스킬 — Codex로 설치

**기본 설치는 공개 ZIP을 배포 PC의 Codex가 받아 설치하는 방식입니다. GitHub 로그인은 필요하지 않습니다.**

## 바로 시작

1. 배포 PC에 Codex와 Aside 앱·CLI를 준비합니다.
2. [Codex에 전달할 설치 문구](https://github.com/juine1019/longterm-skills-releases/blob/main/install-codex.txt)를 전체 복사해 그 PC의 Codex 채팅창에 붙여 넣습니다.
3. Codex가 필요한 도구·공개 파일 해시·기존 스킬/자료를 확인하고 설치합니다. 기관 로그인은 사용자가 직접 합니다.

업무데스크에서는 **설정 → 롱텀 스킬 설치 → Codex 설치 문구 복사**로 같은 문구를 받을 수 있습니다.

- [공개 ZIP 직접 받기](https://github.com/juine1019/longterm-skills-releases/releases/download/v1.1.2/longterm-skills-1.1.2.zip)
- [1.1.2 배포 파일 목록](https://github.com/juine1019/longterm-skills-releases/releases/tag/v1.1.2)

자체 EXE 설치 도우미를 실행하지 않는 흐름입니다. 기존 EXE 자산은 보존되어 있습니다. 조직 정책이 PowerShell/Node/Python 실행을 차단하면 관리자 확인이 필요합니다. 보안 정책 우회나 보안 기능 전체 해제는 하지 않습니다.

## 1.1.2 검증 값

- ZIP 크기: 1,079,231 bytes
- ZIP SHA-256: `30fde81c825422d663e543cb45b870f7be2801ae7b38d5581ea5efcaf6f5ad76`
- manifest SHA-256: `704176ecfdc80914d58ec7ef1ef896e21c5efaab57f45d002f40a1e00e83300d`
- update-source.json SHA-256: `5570fa44f5660626c21bef6fc0aab0a5323e9892a8984a994bff65af6c69143b`
- install-codex.txt SHA-256 (UTF-8/LF): `6c3ffc17d5eef780862c9b65a884af7700bdf04de3cb82c071533b7ed631c502`

공개 ZIP에는 기존 `runtime/installer.cjs`가 들어 있습니다. 설치 문구에는 위 해시와 실행 순서가 포함됩니다. 공개 자료는 코드와 안내뿐이며 기관 원문·인증정보·발행 개인키는 넣지 않습니다.

## 보존·검증 범위

- 기존 자체 스킬·기관 설정·업무자료를 보존합니다. 같은 버전은 재설치하지 않으며, 충돌·진행 중/미확인 점유는 지우지 않습니다. 미등록 베타/전역 스킬 충돌은 이전 방안을 먼저 확인합니다.
- 기관 정책 채택·로그인은 사용자 확인으로 진행합니다. 설치 지시는 실제 업무 체크·승인·조회 수집·게시·저장·전송·통보를 포함하지 않습니다.
- 공개 ZIP을 기존 설치기로 직접 설치하는 흐름은 마더 PC의 별도 폴더에서 12스킬·메뉴 확인을 통과했습니다. 실제 새 PC·실제 기관 업무 검증은 별도로 남습니다.
- 현재 1.1.2는 **설치 확인용 Pre-release**입니다. stable 자동 업데이트 feed는 아직 발행하지 않았습니다.
- 기존 Windows EXE 서명과 Ed25519 업데이트 서명은 서로 다릅니다. 이 설치 경로는 자체 EXE 없이 기존 Node 설치기를 사용합니다.
