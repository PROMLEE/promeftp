# PromeFTP 1.1.7 설계 · 개발/검증 인계서

- **기준 코드**: 1.1.6 (`source/` = 공개 ZIP, `package.json` 1.1.6). 줄 번호는 1.1.6 기준이다.
- **항목 형식**: 현상 → 원인(소스) → 설계(파일·함수 단위) → 검증
- **원인 표기**: ✅ 확정(코드·재현·사용자 확인) / 신규 = 기능 추가 / ⏸ 보류

## 0. 요약

| PR | ID | 항목 | 원인 | 우선 |
| --- | --- | --- | --- | --- |
| **PR-1** 에이전트 연결 복구 | D1 | 에이전트가 앱이 신뢰한 호스트 키를 모름 → 모든 연결 실패 | ✅ 사용자 환경 확정 | **P0** |
| | D2 | SFTP 루트가 심볼릭 링크면 모든 조회 거부 | ✅ 재현 | **P0** |
| **PR-2** 에이전트 진단·UX | D3 | 연결 실패 원인이 `CONNECTION_FAILED`로 뭉개지고 `REMOTE_CLOSED`로 덮어써짐 | ✅ 재현 | P0 |
| | C | 북마크 접근 필드가 이유 없이 전부 비활성 | ✅ | P0 |
| | F | "인증 요청" 섹션 의미 불명(빈 상태) | ✅ | P1 |
| **PR-3** UI 버그·다듬기 | B | 툴팁: 화면 밖으로 넘침, 안 닫힘, 너무 큼 | ✅ | P0 |
| | G | SFTP 폴더 트리·폴더 비교 아이콘이 같음 | ✅ | P1 |
| | H | 사이드바 "PAM" 버튼 이름 | ✅ | P1 |
| **PR-4** 기능 | S | 모든 단축키 재지정 + 키 진단 (기본값 현행 유지) | 신규 | P1 |
| | E | 에이전트 권한 프리셋("전체 허용" 포함) | 신규 | P1 |
| | I | 스니펫 창: 검색 결과 자동 선택 + 편집 시트 분리 | 신규 | P2 |
| | J | 인증 규칙·응답 목록 재디자인 | 신규 | P2 |
| — | K | 설정 창 열기 속도 | ⏸ 현재 정상 | — |

**해결되어 범위에서 제외**: ⌘P가 안 열리던 문제는 **다른 앱의 전역 단축키(⌘P)** 가 원인이었다(사용자 확인, 해제 후 정상). 재발 대비책은 S에 포함한다. 조사 기록은 부록 A에 있다.

---

# PR-1 · 에이전트 연결 복구

## D1. 에이전트가 앱이 신뢰한 호스트 키를 모른다 ✅

### 현상
에이전트가 `session open`을 하면 `connecting` 중 `session.error CONNECTION_FAILED` → `session.ended REMOTE_CLOSED`가 된다. PAM 계정, 일반 계정을 가리지 않고 **모든 북마크**가 실패한다. 같은 북마크로 앱에서 직접 연결하면 정상이다.

### 원인 (사용자 환경에서 확정)
에이전트와 같은 옵션으로 실행한 ssh의 결과는 다음과 같다.
```
No RSA host key is known for <host> and you have requested strict checking.
Host key verification failed.   (exit 255)
```
- **앱 일반 연결**: `StrictHostKeyChecking`을 지정하지 않으므로 OpenSSH 기본값 ask로 동작한다(`main.cjs:832`). 호스트 키 질문은 `showHostKeyPrompt()`(`main.cjs:857`)가 받는다. 지문은 **앱 자체 저장소 `state.trustedHostKeys['host:<host>']`**(profiles.json)에 기록하고, 이후 같은 지문이면 자동으로 수락한다("Verified saved host key").
- **에이전트 연결**: `openssh.start(..., strictHostKey='yes', ..., agent=true)`(`agent-transport.cjs` `connect()`)로 접속하고 **OpenSSH known_hosts만** 본다. 앱 저장소는 참조하지 않는다. ssh가 질문 없이 255로 종료하므로 `onEvent`의 `value.hostKey` 분기에도 도달하지 않는다.
- 이 사용자의 `~/.ssh/known_hosts`에는 해당 호스트의 RSA 키가 없다. **앱의 신뢰 기록과 known_hosts가 따로 관리**되고 있었다.
- `docs/AGENTS.md`의 "Destination and jump-host keys must already be trusted by OpenSSH; configure and verify them through a regular desktop connection first"는 실제 동작과 다르다. 앱에서 연결해도 known_hosts에 신뢰가 남는다는 보장이 없다.

### 설계: 에이전트도 앱의 지문 고정(pinning)을 사용
1. **공용 파서**: `showHostKeyPrompt`의 정규식(지문·호스트 추출, `accept` 값 결정)을 `openssh.cjs`의 `parseHostKeyPrompt(prompt) → { host, fingerprint, accept }`로 옮긴다. 앱 경로와 에이전트 경로가 같이 쓴다.
2. **에이전트 전용 known_hosts**: `connect()`에서 `knownHosts = userData/agent/known_hosts`(0600)를 넘긴다. `createTransport({ knownHosts })` 인자는 이미 있고(`agent-transport.cjs:32`), `openssh.cjs:186`이 `UserKnownHostsFile`로 반영한다. 사용자 `~/.ssh/known_hosts`는 읽지도 쓰지도 않는다.
   - 호환: 사용자 known_hosts에 이미 있는 호스트가 계속 통과하도록 `UserKnownHostsFile="<앱 전용 파일> ~/.ssh/known_hosts"` 순서로 둘 다 지정한다. 쓰기는 OpenSSH 규칙상 첫 파일에만 일어난다.
3. **`strictHostKey`를 `'yes'`에서 `'ask'`로**: 이제 모르는 호스트는 질문(`prompt`, `value.hostKey`)으로 들어온다.
4. **`value.hostKey` 처리 교체**(현재는 무조건 `HOST_KEY_REJECTED` + `'no'`)
   | 조건 | 응답 | 기록 |
   | --- | --- | --- |
   | `trustedHostKeys['host:'+host] === fingerprint` (legacy `authScope` 키도 조회) | `answer(id, accept)` | `hostkey.pinned` (detail: host, fingerprint) |
   | 저장된 지문 없음 | `'no'` | `session.error HOST_KEY_UNKNOWN` (detail: host, fingerprint) |
   | 저장된 지문과 다름 | `'no'` | `session.error HOST_KEY_CHANGED` (detail: 저장 지문, 수신 지문) + 앱 알림 |
   - **에이전트 경로에서는 절대 새 지문을 저장하지 않고 사용자에게 묻지도 않는다.** 신뢰는 사람이 앱에서만 부여한다.
   - ProxyJump: 점프 호스트의 키 질문도 같은 경로로 들어오므로 동일 규칙을 적용한다.
5. **권한 저장 시 사전 점검**: 북마크의 유효 호스트(`ssh -G` 결과의 hostname, 점프 호스트 포함) 각각에 대해 `trustedHostKeys` 또는 known_hosts 항목이 있는지 확인한다. 없으면 ③ 권한 상단에 배너를 띄운다: "이 서버의 호스트 키를 아직 신뢰하지 않았습니다. 앱에서 한 번 연결하세요." + [지금 연결] 버튼(일반 SFTP 탭 열기). 저장 자체는 막지 않는다.
6. **문서**: `docs/AGENTS.md` 해당 문단을 "앱에서 한 번 연결해 확인한 호스트 키(지문)를 에이전트 연결도 그대로 사용합니다. 키가 바뀌면 에이전트 연결은 거부됩니다."로 바꾼다.

### 보안
- 지문 고정은 known_hosts 엄격 검사와 동등 이상이다. 사람이 확인한 정확한 지문만 허용하고, 다르면 거부한다.
- 자동 수락은 감사 기록(`hostkey.pinned`)에 남는다.
- 사용자 known_hosts는 변경하지 않는다.

### 검증
| 시나리오 | 기대 결과 |
| --- | --- |
| 앱에서 신뢰, known_hosts에 없음 (**현재 사용자 상황**) | `ready`, `hostkey.pinned` |
| 앱에서 한 번도 연결 안 함 | `HOST_KEY_UNKNOWN`, 사용자 known_hosts 불변 |
| 서버 호스트 키 교체 | `HOST_KEY_CHANGED`, 연결 거부, 앱 알림 |
| known_hosts에만 있음 | 질문 없이 `ready` |
| ProxyJump, 점프 호스트만 미신뢰 | `HOST_KEY_UNKNOWN` (host=점프 호스트) |
| 배너 | 미신뢰 북마크를 선택하면 배너, [지금 연결]로 신뢰 후 배너 사라짐 |

### 출시 전 사용자 임시 우회
터미널에서 `ssh <호스트>`로 한 번 접속한다. 표시된 지문이 앱에서 확인한 값과 같으면 `yes`로 known_hosts에 추가한다. 이렇게 하면 1.1.6 에이전트로도 연결된다.

## D2. SFTP 루트가 심볼릭 링크면 모든 조회 거부 ✅ (재현)

### 현상
루트를 `/tmp`(macOS에서는 `/private/tmp`로 가는 링크)로 저장한다. 세션은 `ready`인데 `sftp list --path /tmp`가 `PATH_NOT_ALLOWED`로 거부된다. Linux에서도 `/home`→`/data/home`, `/var/www`→`/srv/www` 같은 구성에서 똑같이 발생한다.

### 원인 (`agent-service.cjs` `checkedPath()`)
- `realpath(target) !== target`이면 거부한다.
- 경로 구성 요소 중 심볼릭 링크가 있으면 거부한다.
- 권한 저장(`grant()`) 시에는 루트를 서버에서 확인하지 않으므로, 저장은 되지만 사용할 수 없는 루트가 생긴다.

### 설계
1. **세션 ready 직후** 루트를 `realpath`로 정규화해 `s.root`에 보관한다. 원래 값과 다르면 `session.root` 이벤트(`detail={configured, resolved}`)를 남긴다. 권한 저장 시에는 서버를 확인하지 않는다(오프라인 저장 유지).
2. `checkedPath`: 입력이 설정 루트 아래면 그 접두를 `s.root`로 치환한 뒤 검사한다. **루트 아래**의 심볼릭 링크 거부(탈출 방지)는 유지한다.
3. 거부 사유를 구분한다: `PATH_OUTSIDE_ROOT` / `PATH_SYMLINK`(detail에 링크 위치) / `PATH_NOT_FOUND`. 응답은 `error:'PATH_NOT_ALLOWED', reason:<세부>`로 해서 기존 호환을 지킨다.
4. 루트 입력란 ⓘ: "심볼릭 링크 루트는 실제 경로로 바뀌어 적용됩니다."

### 검증
- 루트 `/tmp`(macOS)에서 `list /tmp`가 성공한다.
- 루트 밖으로 가는 링크는 `PATH_SYMLINK`로 거부된다. 루트 밖 경로는 `PATH_OUTSIDE_ROOT`로 거부된다.
- 이벤트 `session.root`가 남는다.

---

# PR-2 · 에이전트 진단·UX

## D3. 연결 실패 원인이 전달되지 않음 ✅ (재현)

### 현상 (재현: 1.1.6 공개 빌드, 격리 프로필, 로컬 테스트 sshd)
- 직접 입력 북마크로 `session open --mode sftp`를 실행하면 `session.error CONNECTION_FAILED`(`detail:null`) → `session.ended REMOTE_CLOSED`가 된다.
- 실제 원인(`Host key verification failed`)은 어디에도 남지 않는다.

### 원인 (소스)
1. `agent-transport.cjs:77` `if (event === 'error') { notify(event, 'CONNECTION_FAILED'); return; }`: 원문 메시지를 버린다.
2. 진짜 원인은 OpenSSH stderr(PTY)에 있다. 그런데 에이전트 모드는 PTY `data`를 무시하고(보안 원칙: PTY를 클라이언트로 스트리밍하지 않음), `openssh.cjs:152`는 "OpenSSH exited (255). See terminal output."만 보낸다.
3. `agent-service.cjs:171–172`: error 뒤에 `closed`가 오면 `end(s,'REMOTE_CLOSED')`가 최종 사유가 된다. 연결 실패가 "원격 종료"로 기록된다.
4. `note(s,'session.error','failed',reason)`에 `detail`을 넘기지 않는다.

### 설계
1. **진단 버퍼**(`openssh.cjs`, `agent=true` 전용): PTY `data`를 메인 프로세스의 ring buffer(4KB, 줄 단위)에만 쌓는다.
   - 스크럽: 제어문자 제거, `password|passcode|otp|token|secret` 뒤를 `***` 처리, 최근 20줄, 줄당 200자.
   - 비밀 응답은 askpass 채널로 가므로 원래 버퍼에 들어오지 않는다. 스크럽은 방어용이다.
2. **분류기** `classifySshFailure(lines, exitCode, stage)`(`agent-transport.cjs`, 순수 함수 + 단위 테스트)
   | 코드 | 매칭 | 안내 |
   | --- | --- | --- |
   | `DNS_FAILED` | `Could not resolve hostname` | 호스트 이름 확인 |
   | `HOST_UNREACHABLE` | `No route to host`, `Network is unreachable` | 네트워크·VPN 확인 |
   | `CONNECT_TIMEOUT` | `Connection timed out`, `Operation timed out` | 방화벽·포트 확인 |
   | `CONNECTION_REFUSED` | `Connection refused` | sshd·포트 확인 |
   | `AUTH_FAILED` | `Permission denied \(`, `Too many authentication failures` | 키·비밀번호·PAM 응답 확인 |
   | `HOST_KEY_UNKNOWN` | `Host key verification failed`, `No .* host key is known` (+ D1 판정) | 앱에서 한 번 연결해 신뢰 |
   | `HOST_KEY_CHANGED` | `REMOTE HOST IDENTIFICATION HAS CHANGED` (+ D1 판정) | 서버 키 교체 여부 확인 |
   | `PROXY_FAILED` | `kex_exchange_identification`, `Connection closed by UNKNOWN`, ProxyCommand 오류 | ProxyJump·ProxyCommand 확인 |
   | `SFTP_SUBSYSTEM_FAILED` | `subsystem request failed`, `Received message too long` | sftp-server 설정, 로그인 셸 출력(.bashrc echo) 확인 |
   | `SSH_CONFIG_CHANGED` | 기존 route 불일치 | 권한 다시 저장 |
   | `CONNECTION_FAILED` | 그 외 | 로그 참조 |
3. **이벤트**(필드 추가만, 하위 호환)
   - `session.error`: `reason=<코드>`, `detail=JSON{stage, exit, hint, log}`. `stage`는 `resolve|connect|hostkey|auth|subsystem` 중 하나다.
   - **최종 사유 보존**: 에러를 받으면 `s.failure`에 기록하고, 이어서 오는 `closed`는 `end(s, s.failure ? 'CONNECT_FAILED' : 'REMOTE_CLOSED')`로 처리한다. ready 이후의 종료만 `REMOTE_CLOSED`가 된다.
4. **API**
   - `session.status`(종료 세션 포함, `agent-service.cjs:251`): `{status:'closed', reason, error:{code, stage, hint, log}}`.
   - `events.list`: 기존 `detail` 문자열에 더해 파싱한 `error` 필드를 함께 준다.
5. **CLI**(`native/agent-cli.swift`): `--json`은 그대로 둔다. 사람용 출력은 `원인: <코드> (<단계>) — <안내>`와 로그 마지막 5줄이다. 종료 코드는 기존을 유지한다.
6. **스킬 문서**: "연결 실패 시 `session status --json`의 `error.code`·`error.hint`·`error.log`를 사용자에게 보고한다"를 추가한다.
7. **앱 UI**: 활동 기록의 `session.error` 행에 [상세] 펼침(코드·단계·안내·로그)과 [복사] 버튼을 둔다.
8. **[연결 테스트] 버튼**(북마크 접근): 현재 권한으로 `open → ready → close`를 실행하고 결과 코드를 배너로 보여 준다. 감사 기록 `client=app-test`.

### 보안
- 로그는 세션을 연 클라이언트에게만 반환한다(기존 client 조건).
- 보존 기간 정책(1–90일)을 따르고, 내보내기에서 "Include paths"가 꺼져 있으면 `log`를 제외한다.
- 실시간 PTY 스트리밍은 계속 금지하고, 종료 후 스크럽된 요약만 제공한다.

### 검증 (테스트 sshd 자동화: `scripts/agent-diagnostics-test.mjs`)
- 하네스는 에이전트용 known_hosts(D1)를 테스트 디렉터리로 지정해 사용자 파일을 건드리지 않는다.

| 시나리오 | 기대 code / stage |
| --- | --- |
| 없는 호스트 | DNS_FAILED / connect |
| 닫힌 포트 | CONNECTION_REFUSED / connect |
| 방화벽 drop | CONNECT_TIMEOUT / connect |
| 틀린 키 | AUTH_FAILED / auth |
| 미신뢰 호스트 | HOST_KEY_UNKNOWN / hostkey |
| `Subsystem sftp` 제거 | SFTP_SUBSYSTEM_FAILED / subsystem |
| `.bashrc` echo | SFTP_SUBSYSTEM_FAILED / subsystem |
| ready 후 서버 재시작 | `session.ended REMOTE_CLOSED` |
- 모든 경우 로그에 비밀번호·OTP가 없다(오답 비밀번호로 확인).
- 1.1.6 CLI가 1.1.7 앱 응답을 정상 파싱한다.

### 선택 옵션: ssh-agent 키 사용
에이전트 연결은 `IdentityAgent=none`, `IdentitiesOnly=yes`, `UseKeychain=no`(`openssh.cjs:184–186`)로 접속한다. ssh-agent·1Password·Secretive·Keychain에만 있는 키는 쓸 수 없다.
- 북마크 접근에 "ssh-agent 키 사용"(기본 끔)을 추가한다. grant 필드는 `useSshAgent:true`이고, `validateGrant`에서 boolean으로 검증한다.
- 켜면 `IdentityAgent`와 `IdentitiesOnly`를 기본값으로 둔다. 경고: "에이전트 연결이 ssh-agent의 모든 키를 사용할 수 있습니다."
- 검증: ssh-agent에만 키가 있는 북마크에서 옵션을 끄면 `AUTH_FAILED`, 켜면 `ready`.

## C. 북마크 접근 필드가 이유 없이 전부 비활성 ✅

### 원인 (`agent-preferences.js` `showAgentGrant`)
```js
agentElement('grant-fields').disabled = !client || !p?.eligible;
agentElement('save-grant').disabled  = !client || !p?.eligible;
```
클라이언트를 고르지 않으면 북마크를 골라도 전부 비활성이고, 그 이유가 표시되지 않는다. 클라이언트 select의 기본값은 빈 값이다.

### 설계
1. 섹션 구조를 "① 클라이언트 → ② 북마크 → ③ 권한"으로 바꾸고, ③ 상단에 배너 슬롯 `#agent-grant-blocker`를 둔다.
2. 배너(우선순위 순서로 하나만 표시)
   | 조건 | 문구 | 버튼 |
   | --- | --- | --- |
   | 에이전트 꺼짐 | 로컬 에이전트 접근이 꺼져 있습니다. | [켜기] |
   | 클라이언트 0개 | 먼저 에이전트 클라이언트를 등록하세요. | [클라이언트 등록]으로 이동 |
   | 클라이언트 미선택 | 권한을 줄 클라이언트를 선택하세요. | select 포커스 |
   | 북마크 미선택 | 북마크를 선택하세요. | select 포커스 |
   | 북마크 부적격 | `p.reason`(현지화) | [북마크 편집] |
   | 호스트 키 미신뢰 (D1-5) | 이 서버의 호스트 키를 아직 신뢰하지 않았습니다. | [지금 연결] |
3. 클라이언트가 1개면 자동 선택한다. 마지막 선택은 `sessionStorage`로 기억한다.
4. 비활성 필드에는 `title`로 같은 사유를 보여 준다.

### 검증
- 클라이언트 0개, 1개, 2개 이상과 북마크 적격·부적격·미신뢰 조합에서 배너와 버튼 동작이 맞다.
- 클라이언트가 1개면 북마크만 골라도 바로 편집할 수 있다.
- 저장 후 다시 열면 값이 유지된다.

## F. "인증 요청" 섹션 ✅
- **의미**: 에이전트 세션이 서버 질문(비밀번호·OTP)을 받았는데 저장된 응답이 없을 때, **사용자 입력을 기다리는 요청**이 표시된다(`renderAgentPrompts`, 이벤트 `auth.prompt`). 평소에는 비어 있는 게 정상이다.
- **설계**
  - 요청이 0건이면 섹션을 숨긴다.
  - 요청이 오면 에이전트 탭 최상단에 카드로 보여 준다: 클라이언트 · 북마크 · 질문 · 입력 · [보내기]/[거절] · 남은 시간(`authDeadline` 120초).
  - 사이드바 "인증"(H) 버튼에 배지를 단다. 앱이 비활성이면 macOS 알림을 보내고, 클릭하면 설정 → 에이전트로 이동한다.
  - 제목 옆 ⓘ: "에이전트 연결이 서버 질문에 답을 기다릴 때 표시됩니다."
- **검증**: 저장된 응답이 없는 keyboard-interactive 계정으로 연결한다. 카드·배지·알림이 표시되고, 응답하면 `ready`가 된다. 120초가 지나면 카드가 사라지고 `AUTH_TIMEOUT`이 기록된다.

---

# PR-3 · UI 버그·다듬기

## B. 툴팁(ⓘ) 전면 정리 ✅
> 대상: `preferences.html`의 `data-tip` 19개(47·60·64·71·72·82·92·93·94·98·104·106·108·113·114·121·122·123·139행), `ui-controls.js` `infoTip()`·`attachInfoTips()`, `style.css:667–673, 803`

### 원인
| 증상 | 원인 |
| --- | --- |
| 오른쪽 밖으로 나가고 가로 스크롤바가 생김(예: "승인 후 SSH 명령 허용"), 마우스를 떼면 사라져 읽을 수 없음 | 말풍선이 `position:absolute; left:0; width:max-content; max-width:260px`로 ⓘ 왼쪽 기준으로만 펼쳐진다(`style.css:670`). 화면 경계 보정이 없다. |
| 스크롤백 툴팁이 안 닫힘 | `data-tip`이 "무제한" 라디오 `<label>` 안(47행)에 있어 ⓘ가 세그먼트 버튼 내부에 들어간다. 클릭하면 `.open`이 고정되고, 클릭 위치에 따라 라디오가 바뀔 위험도 있다. |
| 크기가 큼 | 15×15px, 테두리, 배경, serif 이탤릭 `i`(`style.css:669`) |
| 닫힘 규칙 제각각 | hover / `:focus-visible` / `.open`이 따로 놀고, 스크롤·창 blur·다른 툴팁에서 닫히지 않는다. |

### 설계
1. **단일 레이어**: `<div id="tooltip-layer" role="tooltip" popover="manual">` 하나에 활성 툴팁 텍스트만 채운다. Popover top-layer에 그려지므로 부모 overflow에 갇히지 않는다. **가로 스크롤을 원천 차단**한다.
2. **위치 계산** `placeTooltip(anchorRect, size, viewport)`
   - 기본은 아래쪽 가운데, 공간이 부족하면 위쪽이다.
   - 좌우는 `clamp(8, x, vw - w - 8)`로 화면 안에 가둔다. 화살표는 ⓘ 중심을 따라간다.
   - `max-width: min(280px, vw - 16px)`. 스크롤·리사이즈 시 다시 계산한다.
3. **열고 닫기**(동시에 하나만)
   - hover: 120ms 뒤 열리고, 벗어나면 150ms 뒤 닫힌다. 말풍선 위로 옮기면 유지된다.
   - focus로 열리고 blur로 닫힌다.
   - 클릭하면 고정되고, 바깥 클릭·Esc·다른 ⓘ·창 blur로 닫힌다.
   - 접근성: `aria-describedby`, `aria-label="도움말: {항목}"`, 고정 시 `aria-expanded=true`.
4. **배치 규칙**(`attachInfoTips`)
   - 라디오 레이블 안의 `data-tip`은 금지한다(개발 모드 경고).
   - 스크롤백 ⓘ는 `<h3>` 옆으로 옮긴다.
   - ⓘ 클릭은 레이블 컨트롤을 토글하지 않는다(테스트 추가).
5. **스타일**
   - 12×12 `info.circle` 선 SVG, 배경과 테두리 없음.
   - 투명도: 평소 .35, 레이블 hover .6, 버튼 hover·focus·고정 1.
   - 히트 영역 20×20. 말풍선은 12px/1.45, 패딩 8×10, 반경 8.
6. **문구**: 1–2문장, 한국어 70자 이내. 넘는 항목(60·113·121행)은 줄인다.

### 검증
- 설정 창 650px 폭에서 19개 ⓘ 모두 가로 스크롤이 생기지 않고, 말풍선 전체가 보인다.
- 말풍선 위로 이동해도 유지되고, 벗어나면 닫힌다. 스크롤백 ⓘ를 클릭해도 라디오가 바뀌지 않는다.
- 4개 언어와 라이트·다크 모드를 확인하고, VoiceOver가 툴팁을 읽는다.

## G. SFTP 폴더 트리·폴더 비교 아이콘이 같음 ✅
- **원인**: 둘 다 `iconButton('tree', …)`를 쓴다. 폴더 비교는 `renderer.js:2236`, 트리 전환은 `renderer.js:2801`이다.
- **설계**(`ui-controls.js` `icons`)
  - `tree`는 트리 전환 전용으로 둔다. `aria-pressed`일 때 배경을 강조한다.
  - 신규 `compare`(두 패널과 양방향 화살표)를 추가한다:
    `'M3 5h7v14H3z M14 5h7v14h-7z M10 9h4m-1.5-1.5L14 9l-1.5 1.5M14 15h-4m1.5-1.5L10 15l1.5 1.5'`
  - 원격 패널 도구막대 순서: `[이동] [활동] [전송] | [폴더 비교]`.
- **검증**: 16px에서 두 아이콘이 구별된다(라이트·다크). 툴팁 문구가 기능과 일치한다.

## H. 사이드바 "PAM" 버튼 ✅
- **원인**: `index.html:56` `<button id="rail-pam">PAM</button>`. 1.1.6에서 설정 쪽 문구만 바꿨다.
- **설계**
  - 레이블은 "인증"(EN Auth / JA 認証 / ZH 认证), 신규 `key` 아이콘, `title`은 "인증 설정".
  - `index.html:109` "PAM rule" 버튼은 "인증 응답 규칙"으로 바꾼다.
  - F의 배지를 이 버튼에 단다. `localization.js`에 4개 언어를 추가한다.
- **검증**: 사용자에게 보이는 레이블에 "PAM" 단독 표기가 없다(설명문의 기술 용어는 허용).

---

# PR-4 · 기능

## S. 모든 단축키 재지정 + 키 진단 (기본값 현행 유지)

### 현황
- 메뉴: `main.cjs` `fileShortcuts`(1578), `terminalShortcuts`(1583), `preferencesShortcut`이 하드코딩되어 있고, `command(label, accelerator, id)`로 만든다. 메뉴 accelerator는 `registerAccelerator=true`라 macOS 메뉴 key-equivalent로도 처리된다.
- 별도 처리 경로: `before-input-event`(`main.cjs:1803`, ⌘P·⌘⇧P·⌘=/-/0), xterm `attachCustomKeyEventHandler`(`renderer.js:1976`, ⌘P·⌘C·⌘V, ⌥⌘↑↓).
- 설정 → 단축키(`renderShortcutPreferences`)는 보기 전용이다.

### 데이터 모델
```js
// main.cjs
const shortcutCatalog = [ // 기본값 = 현행
  { id: 'new-host',    default: 'CmdOrCtrl+N',        scope: 'app',      menu: 'File' },
  { id: 'local',       default: 'CmdOrCtrl+T',        scope: 'app',      menu: 'File' },
  { id: 'close-tab',   default: 'CmdOrCtrl+W',        scope: 'app',      menu: 'File' },
  { id: 'preferences', default: 'CmdOrCtrl+,',        scope: 'app',      menu: 'App' },
  { id: 'snippets',    default: 'CmdOrCtrl+P',        scope: 'terminal', menu: 'Terminal' },
  { id: 'snippets-alt',default: 'CmdOrCtrl+Shift+P',  scope: 'terminal' },
  { id: 'triggers',    default: '',                   scope: 'terminal', menu: 'Terminal' },
  { id: 'find',        default: 'CmdOrCtrl+F',        scope: 'terminal', menu: 'Terminal' },
  { id: 'split',       default: 'CmdOrCtrl+D',        scope: 'terminal', menu: 'Terminal' },
  { id: 'split-down',  default: 'CmdOrCtrl+Shift+D',  scope: 'terminal', menu: 'Terminal' },
  { id: 'clear',       default: 'CmdOrCtrl+K',        scope: 'terminal', menu: 'Terminal' },
  { id: 'zoom-in',     default: 'CmdOrCtrl+=',        scope: 'terminal', menu: 'Terminal' },
  { id: 'zoom-out',    default: 'CmdOrCtrl+-',        scope: 'terminal', menu: 'Terminal' },
  { id: 'zoom-reset',  default: 'CmdOrCtrl+0',        scope: 'terminal', menu: 'Terminal' },
  { id: 'prompt-prev', default: 'CmdOrCtrl+Alt+Up',   scope: 'terminal' },
  { id: 'prompt-next', default: 'CmdOrCtrl+Alt+Down', scope: 'terminal' },
];
// 고정(표시만): ⌘C ⌘V ⌘X ⌘Z ⌘⇧Z ⌘A, ⌘Q ⌘H ⌥⌘H ⌘M
state.shortcuts = { /* 바꾼 것만 저장. '' = 해제 */ };
```
- `effectiveShortcut(id) = state.shortcuts[id] ?? default`. 마이그레이션은 필요 없다.
- 공용 매처 `matchAccelerator(input, accel)`: 영문 key 우선, 비라틴 입력이면 물리 `code`로 대체한다(1.1.6 규칙 유지). 단위 테스트를 둔다.

### 처리 경로 단일화
- 메뉴 항목은 `accelerator: effectiveShortcut(id)`, **`registerAccelerator: false`**로 표시만 한다.
- `before-input-event`만 `shortcutCatalog`를 순회해 일치하면 `preventDefault` 후 `send('command', id)`를 보낸다.
- 렌더러의 ⌘P 분기(`renderer.js:1976`)는 제거한다. ⌘C/⌘V(고정)와 프롬프트 이동은 IPC로 받은 `shortcuts` 맵으로 판정한다.
- 변경 즉시 `buildApplicationMenu()`를 다시 만들고 렌더러에 `shortcuts-changed`를 보낸다.

### 설정 → 단축키 UI
- 그룹(앱 / 터미널) 표. 행 형식은 `[동작] [키 칩] [변경] [↺]`이고, 고정 항목은 회색에 자물쇠를 단다.
- [변경]을 누르면 "키를 누르세요… (Esc 취소, ⌫ 해제)" 상태가 된다. 그 동안 `before-input-event` 처리를 멈춘다(IPC `shortcut-capture`).
- 검사 규칙
  - modifier 1개 이상 필요. F1–F19는 예외.
  - 같은 범위에서 충돌하면 "{동작}에 이미 쓰는 키입니다" + [바꾸기](기존 항목 해제)/[취소].
  - macOS 예약 키는 거부: ⌘Q ⌘H ⌘M ⌘Tab ⌘Space ⌃Space ⌘` ⌘⇧3/4/5.
  - 편집 단축키 덮어쓰기는 경고 후 허용: ⌘C ⌘V ⌘X ⌘Z ⌘A ⌘S.
- 하단에 [모두 기본값으로]와 **키 진단** 토글을 둔다.
- 안내문: "단축키가 동작하지 않으면 다른 앱의 전역 단축키와 겹치는지 확인하세요. 키 진단을 켜면 키가 PromeFTP에 도착하는지 볼 수 있습니다." 앱은 다른 앱의 전역 단축키를 감지할 수 없다.

### 키 진단
- 설정의 토글 또는 `PROMEFTP_DEBUG_KEYS=1`로 켠다.
- `before-input-event`에서 ⌘/⌃ 조합의 `{key, code, meta, shift, alt, control, isAutoRepeat}`를 `userData/logs/keys.log`에 기록한다(최근 200줄).
- 설정에 [로그 보기]/[복사]를 둔다.
- 기록이 없으면 "키가 앱에 도착하지 않음", 즉 다른 앱이 가로챈 것이다(이번 ⌘P 사례).

### 문서
`docs/TROUBLESHOOTING.md`에 "단축키가 안 될 때" 항목을 추가한다. 내용은 다른 앱의 전역 단축키, Karabiner 등 키 재매핑 도구, 키 진단 사용법이다.

### 검증
- 재지정 가능한 16개를 모두 바꾸면 메뉴 표시와 실제 동작이 일치하고, 재시작 후에도 유지된다.
- 충돌·예약·경고 규칙을 각각 확인한다. Esc는 취소, ⌫는 해제, 캡처 중에는 앱 단축키가 실행되지 않는다.
- [모두 기본값으로] 후 1.1.6과 동일하게 동작한다(회귀: ⌘N ⌘T ⌘W ⌘, ⌘P ⌘⇧P ⌘F ⌘D ⌘⇧D ⌘K ⌘= ⌘- ⌘0 ⌥⌘↑↓).
- 한글 입력 상태에서도 재지정한 키가 동작한다(물리 키 대체).
- 키 진단을 켜면 로그가 생성된다.
- **실제 키보드로만 판정한다.** CDP와 `sendInputEvent`는 macOS 메뉴·IME 경로를 우회한다.

## E. 에이전트 권한 프리셋 ("전체 허용" 포함)

### 현황
권한은 북마크마다 항목별로 켠다. `validateGrant`(`agent-transport.cjs:41`)가 허용하는 최대치는 다음과 같다.
- SFTP 탐색(루트 필수, `/` 가능), 다운로드(16 MiB/파일), 저장된 인증
- 승인 후 임의 명령, 무승인 고정 작업 1개, PAM 규칙·트리거 선택

**SFTP 쓰기(업로드·삭제)와 승인 없는 임의 명령은 API에 없으므로 프리셋으로도 열 수 없다**(TODO의 서버 정책 항목).

### 설계
1. ③ 권한 상단에 `[권한 프리셋 ▾]`를 둔다.
   | 프리셋 | SFTP 루트 | 다운로드 | 승인 후 명령 | 저장된 인증 | PAM 규칙 | 트리거 |
   | --- | --- | --- | --- | --- | --- | --- |
   | 읽기 전용 | `/` | 끔 | 끔 | 끔 | 없음 | 없음 |
   | 운영 보조 | `/` | 켬 | 켬 | 켬 | 없음 | 없음 |
   | 전체 허용 | `/` | 켬 | 켬 | 켬 | 전체 | 전체 |
   - 프리셋은 **폼만 채운다.** 사용자는 저장 전에 수정할 수 있고, 저장은 [접근 저장]으로 한다.
2. **전체 허용 경고 시트**(저장 시)
   - 제목: "이 클라이언트에 {북마크}의 전체 권한을 줍니다".
   - 허용 항목 목록을 보여 준다. 명령은 매번 승인이 필요하다고 명시한다.
   - "위험을 이해했습니다"를 체크해야 [전체 허용 저장]이 활성화된다. 기본 포커스는 [취소]다.
3. **모든 북마크에 적용**(프리셋 메뉴 하단)
   - 적격 북마크 전체에 저장한다. 경고 시트에 개수를 표시하고, 결과로 성공·건너뜀 목록을 보여 준다.
   - IPC `agent-grant-bulk(client, profileIds, grant)`를 신설한다. 서비스에서 북마크별로 `grant()`를 호출하고 결과 배열을 반환한다.
4. 클라이언트 옆에 권한 요약 배지를 단다(예: `3개 북마크 · 명령 승인`).

### 검증
- 프리셋별 필드 값이 표와 일치하고, 저장 전에 수정할 수 있다.
- 전체 허용은 체크 전에는 저장할 수 없고, 취소하면 아무것도 저장되지 않는다.
- 일괄 적용 결과 수가 맞고, 감사 기록에 북마크별 `grant.set`이 남는다.
- 전체 허용이어도 임의 명령은 매번 승인 창이 뜨고, SFTP 쓰기는 거부된다.

## I. 스니펫 창: 자동 선택 + 편집 시트 분리
- **현황**: `filterSnippets()`(`renderer.js:3798`)는 행을 숨기기만 한다. 편집 폼(`#snippet-form`)이 목록 아래에 붙어 있다.
- **설계**
  1. 포커스는 검색창에 유지하고, `aria-activedescendant`로 **가장 유사한 행을 강조**한다. 실제 포커스를 옮기면 이어서 입력할 수 없다.
  2. 점수: 이름 접두 100 > 이름 단어 접두 80 > 이름 포함 60 > 명령 포함 30. 동점이면 `lastUsedAt` 최신 순. 결과를 정렬해서 표시한다.
  3. 키: `Enter` 붙여 넣기(터미널 연결 시, 아니면 편집), `↑↓` 이동, `⌘Enter` 편집, `Esc` 닫기. `keyboardChoices()`(`renderer.js:3797`)를 대체한다.
  4. 편집은 `#snippet-editor-dialog` 시트로 분리한다. 헤더 `+`와 행 편집 버튼으로 열고, 닫으면 목록과 검색어를 유지한다.
  5. 붙여 넣을 때 `api['touch-snippet'](id)`로 `lastUsedAt`을 기록한다.
- **검증**: ⌘P → `dep` 입력 → 첫 행 강조 → Enter → 붙여 넣고 터미널로 포커스 복귀. 입력 중에도 커서는 검색창에 있다. VoiceOver가 강조된 항목을 읽는다.

## J. 인증 규칙·응답 목록 재디자인
- **현황**: `globalAuthEditor()`, `renderSavedAuthReplies()`(`preferences.js`)가 `<details>` 아코디언을 쓴다. 펼치면 입력란이 세로로 쌓이고, 일치 방식은 "Regex · " 접두어로만 구분된다.
- **설계**(macOS 설정 앱의 그룹 목록)
  - 행: `[정확|정규식 배지] 질문(한 줄) · 호스트(호스트별) · ●●●● [편집] [⋯]`.
  - 편집 시트: 일치 방식, 질문 또는 패턴, 응답(보기 토글). 정규식이면 "테스트할 질문"과 일치 여부를 실시간으로 표시한다(`matchesGlobalPattern` 재사용).
  - `⋯` 메뉴: 모든 호스트로 이동(호스트별 응답만), 삭제. 삭제 후 5초 실행 취소 토스트.
  - 하단에 `+ 추가`, 빈 상태 안내 문구, 10개 이상이면 검색과 호스트별 그룹 헤더.
- **검증**: 규칙 20개, 응답 30개(호스트 5개)로 스크롤·검색·편집·삭제·실행 취소를 확인한다. 키보드만으로 모든 동작이 가능하다.

---

## 공통 컴포넌트
| 컴포넌트 | 위치 | 사용처 |
| --- | --- | --- |
| `tooltipLayer` + `placeTooltip` | `ui-controls.js` | B, 모든 ⓘ |
| `sheet(dialog)` (모달 시트, 포커스 트랩) | `ui-controls.js` | E, I, J |
| `matchAccelerator` / `shortcutCatalog` | `main.cjs` | S |
| `parseHostKeyPrompt` | `openssh.cjs` | D1, 앱 호스트 키 프롬프트 |
| `classifySshFailure` | `agent-transport.cjs` | D3 (앱 연결 오류 문구에도 재사용 가능) |

## 검증자 공통 체크리스트
- 한·영·일·중 4개 언어, 라이트·다크 모드, 설정 창 최소 650×510에서 잘림이나 가로 스크롤이 없다.
- 1.1.6 프로필에서 업그레이드해도 스니펫·규칙·응답·에이전트 권한·신뢰 호스트 키가 보존된다.
- 단축키(S)는 실제 키보드로, 에이전트(D1·D2·D3)는 실제 SSH 테스트 서버로 판정한다.
- 에이전트 로그·이벤트·내보내기에 비밀번호·OTP·토큰이 없다.
- 사용자 `~/.ssh/known_hosts`가 에이전트 연결로 변경되지 않는다.

---

## 부록 A. 조사 기록 요약
- **⌘P**: 영문 입력과 왼쪽 ⌘에서도 실패했다. Karabiner(`right_command→f18`, `left_command+i/j/k/l→방향키`), 한글 IME, Snipaste, NSUserKeyEquivalents는 모두 원인이 아니었다. **다른 앱의 전역 ⌘P 단축키를 해제하자 해결**되었다(사용자 확인). 참고로 이 Mac에서 Karabiner 규칙 때문에 ⌘K는 ↓로 바뀐다(S의 재지정으로 대응 가능).
- **에이전트 연결**: 격리 프로필과 로컬 테스트 sshd(127.0.0.1:2222)로 재현했다. alias 북마크는 `ready`, 직접 입력 북마크는 `CONNECTION_FAILED → REMOTE_CLOSED`(detail 없음)였다. sshd에는 "closed … [preauth] without attempting authentication"이 남았다. 사용자 환경에서는 같은 옵션의 ssh가 `No RSA host key is known … Host key verification failed`를 냈다 → D1 확정.
- **SFTP 루트**: 같은 재현 환경에서 루트 `/tmp`의 `list /tmp`가 `PATH_NOT_ALLOWED`였다 → D2.
- **설정 창 속도(K)**: 빈 프로필에서 1.1.5는 94–214ms, 1.1.6은 103–161ms였다. 사용자 확인 결과 현재 정상이라 보류한다. 재발하면 단계별 계측 → 창 재사용 → 폰트 목록 캐시 순서로 진행한다.

---

## 구현 기록 (1.1.7 작업)

기준: 1.1.6 + 커밋되지 않은 H(사이드바 "Auth")·스니펫 창 변경. 이번 커밋에는 전체 구현이 포함된다.

### 항목별 상태
| ID | 상태 | 검증 | 남은 것 |
| --- | --- | --- | --- |
| D1 | 구현 | 격리 테스트 sshd: 미신뢰(`HOST_KEY_UNKNOWN`), 신뢰(`ready`), 키 교체(`HOST_KEY_CHANGED`). 사용자 `known_hosts` 불변 확인. 공백 경로 `UserKnownHostsFile` 확인 | ProxyJump 시나리오, ssh-agent 키 옵션 |
| D2 | 구현 | 루트 `realpath` 매핑 후 `list`가 성공. 링크 `PATH_SYMLINK`, 루트 밖 `PATH_OUTSIDE_ROOT`, 없음 `PATH_NOT_FOUND` | 루트 입력란 ⓘ 문구 |
| D3 | 구현 | 미신뢰·거부 포트·DNS 실패가 `session.error`로 분류되고 종료 사유 `CONNECT_FAILED`. 로그는 API에 없음 | CLI 사람용 출력(Swift 미빌드), 활동 기록 행 펼침 UI, 앱 알림 |
| C | 구현 | 배너 우선순위, 클라이언트 자동 선택, 선택 기억(`sessionStorage`), 비활성 사유 `title` | 화면 캡처 확인 |
| F | 부분 | 요청이 없으면 섹션 숨김. 요청이 오면 표시 | 카드 강조, Dock 배지, macOS 알림, 남은 시간 |
| B | 구현 | 공용 레이어(`popover`, 최상위 계층), hover·focus·클릭 고정, Esc·바깥 클릭·스크롤·blur로 닫힘 | 19개 ⓘ 시각 확인(라이트·다크) |
| G | 구현 | 폴더 비교 아이콘을 `compare`로 분리 | 16px 시각 확인 |
| H | 구현 | "Auth" 라벨과 열쇠 아이콘, 호스트 편집기 "Auth response rule" | 사이드바 시각 확인 |
| S | 구현 | 카탈로그 14개, 하나의 매처, 캡처 중 처리 중단, 충돌·예약·경고, 키 진단 로그, 기본값 복귀 | 실제 키보드 검증(영문·한글·Caps Lock). 고정 항목 ⌥⌘↑↓ 은 렌더러에서 처리 |
| E | 구현 | 프리셋 4개, 최대 허용 경고 시트(체크 전 저장 불가, 기본 포커스 취소), 일괄 적용 IPC(설정 창 전용, 북마크마다 재검증) | 화면 확인 |
| I | 구현 | 가장 유사한 행 강조(`aria-activedescendant`), Enter 붙여넣기(조합 중 제외), ⌘Enter 편집, ↑↓, 편집 시트 분리, `lastUsedAt` 저장 | 실제 포커스·VoiceOver 확인 |
| J | 구현 | 행 목록, 편집 시트와 정규식 테스트, ⋯ 메뉴, 빈 상태, 삭제 후 5초 실행 취소(전역 규칙만) | 20/30개 데이터 스크롤·검색은 미확인, 호스트별 그룹 헤더·검색 필드는 미구현 |
| K | 보류 | — | — |

### 검토 의견 반영
1. **S 캡처와 설정 창 ⌘W**: 모든 창의 키 처리가 공용 매처를 쓰고, 캡처 중에는 메인·설정 창 모두 처리를 멈춘다. 설정 창의 앱 단축키(⌘N, ⌘T, ⌘W 등)는 메인 창으로 전달한다. 설정 창의 ⌘W는 설정 창만 닫는다.
2. **D1 따옴표**: `UserKnownHostsFile`에 두 경로를 모두 따옴표로 감쌌다(`"<앱 파일>" "~/.ssh/known_hosts"`). 공백이 들어간 앱 데이터 경로로 테스트했다.
3. **오류 코드 이름**: 일반 실패는 `CONNECTION_FAILED`로 통일했다. `CONNECT_FAILED`는 세션 종료 사유(`session.ended`)에만 쓴다. 두 값은 용도가 다르다.
4. **기준선**: 위 "기준" 줄을 참고한다.
5. **원문 로그**: API(`session.status`, `events.list`)는 코드·단계·안내·종료 코드만 준다. 원문 로그는 메모리에만 두고 설정 창 IPC(`agent-diagnostic`, 설정 창 전용)로만 보여 준다.
6. **오래된 에이전트 키**: 앱에서 새 지문을 신뢰하면 에이전트 파일의 해당 호스트 항목을 지운다(`forgetKnownHost`). 함수는 단위 테스트를 거쳤다. 앱 신뢰 흐름 전체는 UI로 확인하지 않았다.
7. **D2 검사 순서**: 루트 밖 경로는 텍스트만으로 먼저 거절하고, 서버에 묻지 않는다. 사유는 항상 `PATH_OUTSIDE_ROOT`다.
8. **E 이름과 기본값**: "전체 허용"을 "Maximum allowed (review first)"로 바꾸고 경고 시트를 붙였다. "운영 보조"의 저장된 인증은 기본으로 끈다. 일괄 적용은 설정 창에서만 호출되고, 북마크마다 서버 쪽 검사를 다시 한다.
9. **B 레이어**: 툴팁은 최상위 계층(popover)에 그려서 모달 대화상자 안에서도 입력을 받는다.

### 이름 변경
- 문서의 `touch-snippet`은 구현에서 `use-snippet`이다.

### 2차 검토 반영 (수정 필수 1–5, 권장 6–8)
1. **설정 창 ⌘W**: 설정 창에서는 ⌘W가 항상 설정 창만 닫는다. Close Tab은 설정 창에서 메인 창으로 전달하지 않는다(키를 바꿔도 같다).
2. **단축키 캡처**: 설정 창이 닫히면 캡처를 끈다. 새 "변경"을 누르면 이전 캡처를 먼저 취소한다. 키 하나는 한 항목에만 저장된다.
3. **충돌 검사**: 범위와 무관하게 전체 카탈로그를 비교한다. 고정 키(⌘C, ⌘V, ⌘⌥↑/↓)는 거절한다. 편집 키(⌘C ⌘V ⌘X ⌘Z ⌘A ⌘S)는 main에서도 `allowEditing` 확인 없이는 거절한다.
4. **권한 프리셋**: 폼 채우기(`loadAgentGrantForm`)와 상태 갱신(`refreshAgentGrantState`)을 나눴다. 프리셋을 고르면 상태만 갱신한다. 저장된 북마크와 없는 북마크 모두 프리셋 값이 폼과 저장 결과에 맞는다(검증 완료).
5. **사이드바 "인증"**: 아이콘만 두고 `title`과 `aria-label`로 이름을 준다. 다른 아이콘 버튼과 같은 규격이다(화면 확인 완료).
6. **일괄 적용**: 서버(`grantMany`)가 북마크마다 허용되는 PAM·트리거 id만 남기고, 나머지는 `skipped`로 보고한다. 결과 안내에 북마크별 이유를 보여 준다(검증 완료: 트리거 1개 제외, PAM 규칙 적용).
7. **known_hosts**: 조회와 삭제를 `ssh-keygen -F` / `-R`로 한다. 해시된 항목(`HashKnownHosts yes`)도 지운다(검증 완료). 백업 파일 `.old`는 지운다.
8. **오류 분류**: ssh 출력의 마지막 5줄만 분류한다. 인증 전 서버 배너는 분류 대상이 아니다(단위 검증 완료).

### 1.1.7 범위 결정
| 항목 | 결정 | 이유 |
| --- | --- | --- |
| F 강조 카드·Dock 배지·macOS 알림·남은 시간 | **1.1.8로 이월** | 실제 질문 흐름을 서버와 함께 검증해야 한다. 1.1.7의 섹션은 요청이 있을 때만 보이고 질문 내용을 그대로 보여 준다. |
| J 호스트별 그룹 헤더·검색 | **1.1.8로 이월** | 10개 이상일 때만 필요하다. 1.1.7의 목록은 행 목록과 편집 시트, 정규식 테스트, 삭제 후 실행 취소까지 갖는다. |
| D1 ssh-agent 키 옵션 | **1.1.8로 이월** | 키 사용 범위가 커지는 기능이라 별도 검토가 필요하다. |
| D1 ProxyJump 검증 | **1.1.7에서 검증하지 않음으로 명시** | 테스트 환경에 점프 호스트가 없다. `docs/AGENTS.md`에 미검증 사항으로 적는다. |
| 스킬 문서(`skills/promeftp/SKILL.md`) 실패 보고 규칙 | **1.1.7에 포함(완료)** | 릴리스 때 서명된 스킬 manifest를 다시 만들어야 한다. |

### 2차 검증 요약
- 설정 창 ⌘W: 설정 창만 닫히고 메인 창에는 명령이 가지 않는다. 메인 창의 ⌘W는 `close-tab`을 보낸다(대조군).
- 캡처: "변경"을 연달아 누른 뒤 ⌘⇧L → `local`에만 저장되고 `new-host`는 그대로다. 캡처 중 설정 창을 닫은 뒤 ⌘N은 메인 창에 도달한다.
- 충돌: 터미널 항목에 ⌘N → `CONFLICT:new-host`. ⌘C와 ⌘⌥↑ → `FIXED`. ⌘S → `EDITING`(확인 후 허용). 대체 저장 시 기존 항목이 비워진다.
- 프리셋: 저장된 북마크 A는 저장값이 아니라 "둘러보기·다운로드" 프리셋이 폼과 저장 결과에 반영된다. 저장값이 없는 B는 "명령 승인" 프리셋이 반영된다.
- 일괄 적용: 없는 트리거 id는 두 북마크 모두에서 제외되고 보고된다. PAM 규칙은 두 북마크에 저장된다.
- 사이드바: 아이콘 버튼 규격이 나머지와 같다.
- 한글 입력 상태의 ⌘P와 실제 키보드 검증은 아직 하지 않았다.
