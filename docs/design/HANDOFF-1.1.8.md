# PromeFTP 1.1.8 인계서: 1.1.7에서 이월한 항목

- **기준**: 1.1.7 출하 소스. 1.1.7의 "1.1.7 범위 결정" 표에서 이월한 항목과, 1.1.7 문서에서 아직 끝나지 않은 항목을 모은다.
- **형식**: 항목마다 *현재 상태*와 *완료 기준*만 적는다. 설계 세부는 1.1.7 인계서(`HANDOFF-1.1.7.md`)를 본다.

## 요약

| ID | 항목 | 현재 상태 | 완료 기준 요약 |
| --- | --- | --- | --- |
| F-1 | 인증 요청 강조 카드 | 요청이 있을 때만 섹션이 보이고 질문과 입력란을 표시한다. 카드 강조는 없다. | 탭 맨 위 카드, 남은 시간 표시, 120초 뒤 카드 제거와 `AUTH_TIMEOUT` 기록 |
| F-2 | Dock 배지와 macOS 알림 | 없음 | 요청 시 배지, 앱이 비활성이면 알림, 알림 클릭 시 설정 → 에이전트로 이동 |
| J-1 | 호스트별 그룹 헤더와 검색 | 행 목록, 편집 시트, 정규식 테스트, 삭제 후 실행 취소(전역 규칙)는 있다. 그룹과 검색은 없다. | 응답이 10개 이상이면 호스트별 그룹 헤더와 검색 필드, 20·30개 데이터에서 검증 |
| D1-1 | ssh-agent 키 옵션 | 에이전트 연결은 `IdentityAgent=none`, `IdentitiesOnly=yes`로 고정되어 있다. | 북마크별 "ssh-agent 키 사용" 옵션, 켰을 때 경고 문구 |
| D1-2 | ProxyJump 검증 | 미검증. `docs/AGENTS.md`에 미검증으로 적혀 있다. | 점프 호스트 테스트 환경에서 `HOST_KEY_UNKNOWN`(점프 호스트)과 `ready`를 확인 |
| D3-1 | CLI 사람용 출력 | `native/agent-cli.swift`는 바꾸지 않았다(Swift 미빌드). | `원인: <코드> (<단계>) — <안내>`와 로그 마지막 5줄, 종료 코드는 그대로 |
| D3-2 | 호스트 키 변경 앱 알림 | 없음 | `HOST_KEY_CHANGED`가 발생하면 앱 알림을 띄운다 |
| R1 | 인증 실패가 `CONNECTION_FAILED`로 분류됨 | 1.1.7 리뷰에서 지적. 수정 완료(아래 R1 절). | 실제 OpenSSH stderr 원문으로 시나리오 단위 테스트가 통과한다 |
| R2 | 별칭·HostName 북마크의 잘못된 미신뢰 배너 | `main.cjs:1788` `profileTrusted`가 `p.host`로 known_hosts를 찾는다. 실제 검사는 `HostName`·포트 기준이라 별칭 북마크에서 신뢰된 호스트가 미신뢰로 보인다. | `ssh -G`로 얻은 hostname·port로 키를 만들어 배너를 판단한다 |
| R3 | 진단 자동화 없음 | `HANDOFF-1.1.7.md`가 가리키는 `scripts/agent-diagnostics-test.mjs`가 저장소에 없다. D3 검증은 수동으로 했다. | 테스트 sshd를 띄우고 시나리오별 stderr를 캡처해 `test/fixtures/ssh-stderr`를 갱신하는 스크립트 |

## F-1. 인증 요청 강조 카드
- **현재 상태**: 에이전트 세션이 서버 질문에 답을 기다릴 때 "인증 요청" 섹션이 나타난다. 섹션은 요청이 없으면 숨겨진다. 카드 강조와 남은 시간은 없다.
- **완료 기준**
  - 요청이 있으면 에이전트 탭 맨 위에 강조 카드를 표시한다: 클라이언트, 북마크, 질문, 입력란, [보내기]·[거절].
  - 남은 시간을 표시한다(`authDeadline`, 120초).
  - 120초가 지나면 카드를 지우고 `AUTH_TIMEOUT`을 기록한다.
  - 검증: 저장된 응답이 없는 keyboard-interactive 계정으로 연결해 카드가 보이고, 응답하면 `ready`가 되며, 시간이 지나면 카드가 사라진다.

## F-2. Dock 배지와 macOS 알림
- **현재 상태**: 없음. 요청은 설정 창 안에서만 보인다.
- **완료 기준**
  - 요청이 대기 중이면 Dock 배지에 개수를 표시하고, 요청이 끝나면 지운다.
  - 앱이 비활성이면 macOS 알림을 보낸다. 알림을 누르면 설정 → 에이전트로 이동한다.
  - 검증: 앱을 다른 창 뒤에 두고 요청을 만들었을 때 배지와 알림이 나오고, 알림 클릭 후 설정 → 에이전트가 열린다.

## J-1. 호스트별 그룹 헤더와 검색 필드
- **현재 상태**: 규칙과 응답 목록은 행 목록이다. 편집은 시트에서 하고, 정규식은 시트에서 테스트한다. 삭제 후 실행 취소는 전역 규칙에만 있다.
- **완료 기준**
  - 호스트별 응답이 10개 이상이면 호스트별 그룹 헤더를 보여 준다.
  - 같은 조건에서 검색 필드를 보여 준다. 질문과 호스트를 함께 검색한다.
  - 검증: 규칙 20개, 응답 30개(호스트 5개) 데이터에서 스크롤, 검색, 편집, 삭제, 실행 취소, 키보드만으로 모든 동작을 확인한다.

## D1-1. ssh-agent 키 옵션
- **현재 상태**: 에이전트 연결은 `IdentityAgent=none`, `IdentitiesOnly=yes`, `UseKeychain=no`로 접속한다. ssh-agent, 1Password, Secretive, Keychain에만 있는 키는 쓸 수 없다.
- **완료 기준**
  - 북마크 권한에 `useSshAgent`(boolean, 기본 꺼짐)를 추가하고 `validateGrant`에서 검증한다.
  - 켜면 `IdentityAgent`와 `IdentitiesOnly`를 기본값으로 둔다. 화면에 "에이전트 연결이 ssh-agent의 모든 키를 사용할 수 있습니다."를 경고로 표시한다.
  - 검증: ssh-agent에만 키가 있는 북마크에서 옵션을 끄면 `AUTH_FAILED`, 켜면 `ready`.

## D1-2. ProxyJump 검증
- **현재 상태**: 미검증. 테스트 환경에 점프 호스트가 없다. `docs/AGENTS.md`에 미검증으로 적었다.
- **완료 기준**
  - 점프 호스트와 목적지 호스트를 가진 테스트 환경을 만든다. 점프 호스트만 미신뢰인 경우와 둘 다 신뢰인 경우를 비교한다.
  - 점프 호스트만 미신뢰이면 `HOST_KEY_UNKNOWN`이고 `hostname`은 점프 호스트다. 둘 다 신뢰이면 `ready`다.
  - 검증 뒤 `docs/AGENTS.md`의 미검증 문구를 지운다.

## D3-1. CLI 사람용 출력
- **현재 상태**: `native/agent-cli.swift`는 1.1.7에서 바꾸지 않았다. Swift를 빌드하지 않았다.
- **완료 기준**
  - 사람용 출력은 `원인: <코드> (<단계>) — <안내>`와 로그 마지막 5줄을 보여 준다. 로그는 앱이 정한 줄 수 안에서만 보여 준다.
  - `--json` 출력과 종료 코드는 그대로 둔다.
  - 검증: 1.1.6 CLI가 1.1.8 앱 응답을 정상으로 파싱하고, 1.1.8 CLI가 1.1.7 앱 응답을 정상으로 파싱한다.

## D3-2. 호스트 키 변경 앱 알림
- **현재 상태**: 없음. `HOST_KEY_CHANGED`는 활동 기록과 `session status`에만 남는다.
- **완료 기준**
  - `HOST_KEY_CHANGED`가 발생하면 앱 알림을 띄운다. 알림에는 호스트와 두 지문을 표시하고, 로그는 넣지 않는다.
  - 검증: 서버 키를 바꾼 뒤 에이전트 연결을 시도하면 알림이 한 번 뜬다.
- **판정 기준 (R1 후속 3)**: `HOST_KEY_CHANGED` 알림은 `hostKeyDecision`의 결과(`code`)로 판정한다. 배너나 stderr 텍스트로 판정하지 않는다. 서버 배너는 `Host key verification failed.` 같은 문구를 흉내 낼 수 있기 때문이다(R1 잔여 위험). 실제 확인: E2E에서 키 지문 불일치는 `hostKeyDecision`이 `HOST_KEY_CHANGED`로 막았다.

## R1. 인증 실패 분류 (1.1.7 차단 결함) ✅ 수정, 검증 완료
- **원인**: `agent-transport.cjs`의 `sshOwnLine`이 OpenSSH의 `user@host: Permission denied (...)`와 `Received disconnect from ...: Too many authentication failures` 줄을 통과시키지 않았다. 그래서 `AUTH_FAILED` 규칙이 적용되지 않고 `CONNECTION_FAILED`가 되었다.
- **수정**
  - `sshOwnLine`에 `^[^\s:]+@[^\s:]+: Permission denied \(`를 추가했다. `Received disconnect from <host> port <n>:<k>: `와 `Disconnected from `도 추가했다. 맨 앞 일반 문구(`Connection refused` 등)는 여전히 무시한다.
  - `Too many authentication failures`는 기존 `AUTH_FAILED` 규칙이 그대로 잡는다.
- **테스트**: `npm test`(`test/classify-ssh-failure.test.cjs`). 입력은 `test/fixtures/ssh-stderr/`의 실제 캡처 원문이다. 캡처 환경은 `test/fixtures/ssh-stderr/README.md`에 적었다.
- **시나리오별 결과 (수정 전 → 수정 후)**

| 시나리오 | 캡처 | 수정 전 | 수정 후 | 판정 |
| --- | --- | --- | --- | --- |
| 인증 실패 (OpenSSH sshd) | `auth-failed-openssh` | `CONNECTION_FAILED` | `AUTH_FAILED` / auth | 통과 |
| 인증 실패 (테스트 sshd) | `auth-failed` | `CONNECTION_FAILED` | `AUTH_FAILED` / auth | 통과 |
| 인증 실패 · 시도 횟수 초과 | `too-many-auth` | `CONNECTION_FAILED` | `AUTH_FAILED` / auth | 통과 |
| 호스트 키 불일치 | `hostkey-changed` | `HOST_KEY_CHANGED` | `HOST_KEY_CHANGED` / hostkey | 통과 |
| 미신뢰 호스트 키 | `hostkey-unknown` | `HOST_KEY_UNKNOWN` | `HOST_KEY_UNKNOWN` / hostkey | 통과 |
| 연결 거부 | `refused` | `CONNECTION_REFUSED` | `CONNECTION_REFUSED` / connect | 통과 |
| DNS 실패 | `dns` | `DNS_FAILED` | `DNS_FAILED` / connect | 통과 |
| 연결 끊김 (handshake 중 reset) | `drop-handshake` | `PROXY_FAILED` | `CONNECTION_FAILED` / connect (핸드셰이크 전용 힌트) | 통과 (후속 1) |
| 배너 위조 방어 (배너에 `Connection refused`) | `banner-plain` | `CONNECTION_FAILED` | `AUTH_FAILED` / auth | 통과 (`CONNECTION_REFUSED` 아님) |
| 비밀번호 프롬프트 (오답 3회) | `password-prompt` | `CONNECTION_FAILED` | `AUTH_FAILED` / auth | 통과 |

- **연결 끊김 분류 (후속 1)**: `kex_exchange_identification`과 `Connection closed by UNKNOWN`은 `CONNECTION_FAILED`로 분류하고, 규칙별 힌트를 준다. 힌트는 영어 원문 상수로 두며 앱은 번역하지 않는다: "The server closed the connection during the handshake. Check the port, access limits, and firewall, and ProxyJump if you use it." `PROXY_FAILED`는 `ProxyCommand`·`ProxyJump` 문구가 있을 때만 쓴다. 구조 변경은 없었다. 규칙 표가 코드별 힌트를 이미 지원한다.
- **PROXY_FAILED 도달성 (Reviewer 판단 필요)**: 실제 OpenSSH 출력에서 프록시 실패는 `Connection closed by UNKNOWN port 65535`만 남고 `ProxyCommand`·`ProxyJump` 문구가 나오지 않았다(캡처 `proxy-command-silent`, `proxy-jump-refused`). 프록시 프로그램이 직접 쓴 `ProxyCommand: ...` 줄(캡처 `proxy-command`)은 OpenSSH 줄 형식이 아니어서 세지 않는다. 그래서 현재 `PROXY_FAILED`는 실제 출력으로는 나오지 않는다. 프록시 프로그램 출력을 OpenSSH 줄로 인정할지는 보안 판단이므로 Reviewer가 정한다.
- **E2E (실제 앱, `session.open` 경로, 키 인증만 허용한 테스트 sshd)**: 서버는 `publickey`만 제안하고 비밀번호·keyboard-interactive를 거부한다(`srv/server-keyonly.cjs`, 서버 로그에는 `auth publickey`만 남음). 틀린 키로 `session.open --mode sftp`를 실행했다.
  - 결과: 이벤트 `session.error` reason=`AUTH_FAILED`, `session.status` `error.code`=`AUTH_FAILED`, `error.stage`=`auth`, `error.hint`=`Check the key, password, or PAM answers.`, exit 255, 종료 사유 `CONNECT_FAILED`.
  - 사용자 `~/.ssh/known_hosts`는 변경되지 않았다.
  - 참고: 하네스의 `fp.txt`가 현재 서버 키와 달라 처음 실행은 `HOST_KEY_CHANGED`로 끝났다(`hostKeyDecision`이 맞게 막은 결과). 서버 실제 지문(`SHA256:62x15k5…`)을 넣어 다시 실행해 위 결과를 얻었다.
- **잔여 위험(배너 위조)**: 서버 배너는 OpenSSH 줄과 같은 모양으로 출력된다. 그래서 `user@host: Permission denied (`를 흉내 낸 배너는 `AUTH_FAILED`로 표시될 수 있다. `Host key verification failed.`를 흉내 낸 배너는 `HOST_KEY_UNKNOWN`으로 표시될 수 있다(코드만 읽어 판단했고 캡처하지 않았다). 신뢰 판정은 텍스트가 아니라 ssh 프롬프트와 `hostKeyDecision`으로 하므로 이 위험은 표시 코드에만 해당한다. D3-2 알림을 만들 때 `HOST_KEY_CHANGED`를 텍스트가 아니라 `hostKeyDecision`의 결과로 판단해야 한다.

## R2. 별칭·HostName 북마크의 잘못된 미신뢰 배너
- **현재 상태**: `main.cjs:1788` `profileTrusted`가 `p.host`(별칭 또는 입력한 이름)와 포트로 known_hosts를 찾는다. 실제 연결의 호스트 키 검사는 `ssh -G`가 돌려주는 `hostname`·`port`를 기준으로 한다. 그래서 별칭 북마크나 `HostName`이 있는 북마크는 키가 신뢰되어 있어도 미신뢰로 보일 수 있다.
- **완료 기준**
  - `ssh -G <alias>`로 얻은 `hostname`과 `port`로 키 이름(`[host]:port`)을 만들어 신뢰 여부를 판단한다.
  - 검증: `HostName`이 다른 별칭 북마크를 만들고, 키를 신뢰한 뒤 배너가 "신뢰됨"으로 나오는지 확인한다. 미신뢰 상태에서는 "미신뢰"로 나오는지도 확인한다.

## R3. 진단 자동화 스크립트 없음
- **현재 상태**: `HANDOFF-1.1.7.md`는 `scripts/agent-diagnostics-test.mjs`로 D3 시나리오를 자동화한다고 적었지만 저장소에 없다. 이번 캡처는 수동 명령으로 했다.
- **완료 기준**
  - 테스트 sshd(격리 키·known_hosts, 사용자 파일 불변)를 띄우고 시나리오별 stderr를 캡처해 `test/fixtures/ssh-stderr`를 갱신하는 스크립트를 만든다.
  - 캡처 뒤 `npm test`가 통과해야 한다. 1.1.7 문서의 자동화 참조는 이 스크립트 이름으로 고친다.

## 1.1.8 전체 검증 조건
- 1.1.7에서 쓰는 실제 앱과 실제 테스트 서버로 확인한다. 로직 테스트만으로는 완료로 보지 않는다.
- 한글 입력 상태의 ⌘P는 사용자가 직접 확인한다.
- 커밋과 버전 올리기는 1.1.8 릴리스 때 한다.
