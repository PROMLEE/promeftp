# 에이전트 자율 접속 설계 (저장 인증 일치 + 호스트 키 변경 처리)

## 목표
에이전트(외부 CLI/LLM)가 북마크 권한(grant)으로 허용된 범위 안에서는 앱을 직접 조작하지 않고 스스로 접속을 끝내게 한다.
1) 앱이 저장 정보로 자동 응답할 수 있는 인증 질문이면 `grant.savedAuth` 허용 시 에이전트도 같은 판정으로 자동 응답한다.
2) `~/.ssh/known_hosts` 의 낡은 키 때문에 에이전트가 막히지 않게 하되, 사람이 확인하지 않은 새 키는 수락하지 않는다(MITM 방지).
3) 실패 응답에 에이전트가 할 수 있는 다음 행동(`next`)을 구조화해 준다.

## 범위
포함
- 저장 응답 판정 로직을 순수 모듈 `saved-auth.cjs` 로 빼서 `main.cjs`(앱)와 `agent-transport.cjs`(에이전트)가 같이 쓴다.
- 에이전트 접속에서 인증 키/스코프 계산을 앱과 똑같이 맞춘다(프로필 정규화, legacy grant의 endpoint).
- 자동 응답을 못 했을 때 그 이유(`savedAuth` 사유 코드)를 `auth.prompt` 이벤트 detail에 남긴다(비밀값 없이).
- 에이전트 ssh의 `UserKnownHostsFile` 을 에이전트 전용 파일만으로 바꾸고, `~/.ssh/known_hosts` 는 읽기 전용 신뢰 근거로만 쓴다.
- 신뢰되지 않은 키(새 키·바뀐 키)를 만나면 앱이 네이티브 확인 다이얼로그를 띄운다.
- 실패 응답에 `next` 배열을 추가한다.
- `docs/TROUBLESHOOTING.md`, `skills/promeftp` 문서, `llms*.txt` 의 에러 코드 설명 갱신.

제외(하지 말 것)
- 사용자 `~/.ssh/known_hosts`, `~/.ssh/config` 를 수정하지 않는다(읽기만). `ssh-keygen -R` 은 에이전트 파일에만 쓴다.
- (1.1.8 범위) 자동 수락 옵션은 1.1.9 섹션에서 다룬다.
- 비밀값(응답, 비밀번호)을 에이전트 클라이언트로 보내거나 로그에 남기지 않는다.
- 새 npm 의존성 금지. 테스트에서 실제 `~/.ssh`, `~/Library/Application Support/PromeFTP` 접근 금지(임시 디렉터리만 사용).
- 앱(사람) 접속 경로의 동작은 바꾸지 않는다. 공용 함수로 옮겨도 결과가 같아야 한다.

## 원인 분석

### 문제 1: savedAuth 허용인데 에이전트에게 `auth.prompt` 가 넘어옴
앱 경로와 에이전트 경로를 대조한 결과, 아래 차이가 있다. 영향이 큰 순서.

| # | 차이 | 앱 | 에이전트 | 결과 |
|---|---|---|---|---|
| C1 | 인증 수단 자체가 다름 | `openssh.start(..., state.useOpenSSHKeychain === true, ...)` (`main.cjs:773-774`), ssh-agent·모든 기본 키 사용 | `-o IdentitiesOnly=yes -o IdentityAgent=none` (`openssh.cjs:221-222`), `useKeychain=false` → `-o UseKeychain=no` (`openssh.cjs:212`, 호출 `agent-transport.cjs:188-189`) | 앱은 ssh-agent/키체인 키로 **질문 없이** 로그인 → 저장된 응답이 애초에 없음. 에이전트는 키 인증을 못 해 password/keyboard-interactive 또는 `Enter passphrase for key` 질문을 받음. 저장 정보가 없으니 savedAuth로 해결 불가 → `auth.prompt`. "앱은 자동인데 에이전트는 실패"의 가장 유력한 원인. |
| C2 | 전역 PAM 규칙 적용 범위 | 전역 규칙 **전부** 자동 사용 (`record.globalAuth`, `main.cjs:728`, 매칭 `main.cjs:906-911`) | `grant.pam` 에 고른 규칙만 (`agent-transport.cjs:151`) | 사용자가 "저장된 인증 사용"만 켜고 전역 규칙을 고르지 않으면, 앱은 전역 규칙으로 자동 응답하지만 에이전트는 질문을 넘김. |
| C3 | legacy grant의 endpoint | `openssh.effective(config)` — 기본 `~/.ssh/config`, `/etc/ssh/ssh_config` 반영 (`main.cjs:698`) | `grant.route` 가 없으면 `resolve(p, true)` 가 `configPath:'/dev/null'` 로 `ssh -G` (`agent-transport.cjs:96-98,104-105`) | `Host *` 에 `IdentityAgent`, `User`, `Port`, `UserKnownHostsFile` 등 `authEndpoint` 화이트리스트 항목(`openssh.cjs:109`)이 있으면 endpoint 문자열이 달라짐 → `authScope`(`main.cjs:523-527`)와 응답 키 digest가 모두 달라짐 → `authReplies[key]`, `sshPasswords[scope]` 둘 다 못 찾음. |
| C4 | 프로필 정규화 | `profile(input)` = `stateRules.profile` 로 `keyPath`/`configPath` 를 `''`·홈 확장으로 정규화 (`main.cjs:24`, `state-rules.cjs:8-22`) | `state().profiles` 원본 `p` 를 그대로 사용, scope는 `authScope({...config, configPath: p.configPath || ''})` (`agent-transport.cjs:107-108`), key는 `keyPath || ''` (`agent-transport.cjs:149`) | 저장 시점에 정규화된 프로필(`main.cjs:155`)이면 같음. 하지만 필드가 없는 예전/가져온 프로필은 `keyPath: undefined` → JSON `null` 이 되어 scope가 앱(`""`)과 달라짐. `~/` 로 저장된 `configPath` 도 달라짐. |
| C5 | 판정 조건 중복 구현 | `autoSavedReply(entry)` = `useSavedRepliesAutomatically !== false && (answer||ciphertext) && entry.scope` 그리고 `current.scope === record.strictAuthScope` (`main.cjs:617-619, 722-725, 898-900`) | `saved?.scope === scope` + `useSavedRepliesAutomatically` 검사 (`agent-transport.cjs:150-154, 158-159`) | 현재는 결과가 같지만 두 곳이 따로 진화하면 다시 어긋남. 공용 함수로 묶는다. |
| C6 | 진단 불가 | — | 자동 응답 실패 시 이유 없이 `notify('prompt')` (`agent-transport.cjs:171-173`), `auth.prompt` 이벤트 detail 없음 (`agent-service.cjs:162-166`) | 다른 PC에서 C1~C4 중 무엇인지 알 수 없음. |

일치 확인된 부분(원인 아님): 질문 정규화 `^\(...\) ` 제거(`auth-rules.cjs:16-18` 와 `agent-transport.cjs:148` 동일), `canRemember` ⊂ `targetProcess`(`askpass.cjs:64`), 비밀번호 자동 전송 조건(`askpass.cjs:57`, 앱·에이전트 공통), 응답 키에 쓰는 `value.prompt` 원문.

### 문제 2: HOST_KEY_CHANGED
- 에이전트 ssh 인자: `UserKnownHostsFile="<userData>/agent/known_hosts" "~/.ssh/known_hosts"` (`openssh.cjs:223`). OpenSSH는 모든 파일을 검사하여, 어느 파일에도 일치하는 키가 없고 한 파일에라도 **다른** 키가 있으면 "REMOTE HOST IDENTIFICATION HAS CHANGED" 로 즉시 중단한다(질문을 띄우지 않음). 그래서 `hostKeyDecision`(`agent-transport.cjs:72-80`)까지 가지도 못하고 `failureRules` 의 `HOST_KEY_CHANGED`(`agent-transport.cjs:17`)로 끝난다.
- 앱에서 새 키를 신뢰하면 `trustedHostKeys['host:<host>']` 가 갱신되고 에이전트 파일의 낡은 키만 지운다(`main.cjs:815-818`). `~/.ssh/known_hosts` 의 낡은 키는 원칙상 건드리지 않으므로, 앱이 신뢰한 새 키가 있어도 에이전트는 계속 막힌다.
- `profileTrusted`(`main.cjs:1710-1715`)도 `~/.ssh/known_hosts` 존재만 보고 "신뢰됨"으로 표시하므로 낡은 키를 신뢰로 오인한다.

## 구조
| 파일 | 변경 | 책임 |
|---|---|---|
| `saved-auth.cjs` (신규, 루트) | 생성 | Electron 의존 없는 순수 함수: 응답 키·스코프 digest, 저장 응답 판정, 전역 규칙 매칭, 사유 코드. |
| `main.cjs` | 수정 | `authScope`, `autoSavedReply`, 전역 규칙 매칭을 `saved-auth.cjs` 호출로 교체(동작 동일). `createTransport` 에 `profile`, `confirmHostKey`, `userKnownHosts` 주입. `profileTrusted` 를 지문 비교로 수정. 호스트 키 확인 다이얼로그 함수 `confirmAgentHostKey` 추가. |
| `agent-transport.cjs` | 수정 | 프로필 정규화, 앱 기준 endpoint 계산, `saved-auth.cjs` 사용, 사유 코드 전달, 비동기 `hostKeyDecision`, 에이전트 파일 정리, 실패에 `next` 부착. `createTransport` 에 `ssh` 의존성 주입(테스트용, 기본값 `require('./openssh.cjs')`). |
| `openssh.cjs` | 수정 | `start` 의 에이전트 `UserKnownHostsFile` 을 에이전트 파일 하나로. `knownHostFingerprints(file, host)` 추가. |
| `agent-service.cjs` | 수정 | `auth.prompt` 이벤트 detail에 `{ savedAuth: <사유> }`, `session.error` detail과 `failureOf` 응답에 `next` 포함. |
| `agent-preferences.js`, `preferences.html`, `localization.js` | 수정 | D1·D2 반영 grant UI 문구/체크박스(아래 D 참고). |
| `test/saved-auth.test.cjs` (신규) | 생성 | 판정 함수 단위 테스트, 앱·에이전트 키 일치 테스트. |
| `test/agent-transport.test.cjs` (신규) | 생성 | 주입한 가짜 `ssh` 로 connect 흐름 테스트. |
| `test/openssh.test.cjs` | 수정 | `knownHostFingerprints` 출력 파서 테스트, 에이전트 인자 테스트. |
| `docs/TROUBLESHOOTING.md`, `skills/promeftp/*`, `llms.txt`, `llms-full.txt` | 수정 | 새 `next` 필드와 사유 코드 설명. `test/doc-links.test.cjs` 통과 유지. |

## 데이터·인터페이스

### saved-auth.cjs
```js
// 모두 순수 함수. createHash 만 사용.
function authIdentity(config) // -> { host, configPath, keyPath } ; configPath/keyPath 가 falsy면 ''
function authScope(config, endpoint) // sha256(JSON.stringify([host, configPath, keyPath, endpoint])) — authIdentity 로 정규화 후 계산.
function replyKey(config, endpoint, prompt) // sha256(JSON.stringify([host, configPath, keyPath, endpoint, prompt]))
function autoSavedReply(state, entry) // 기존 main.cjs:617 와 동일 규칙
function findGlobalRule(rules, prompt, matchesGlobalPattern)
  // 순서: rule.match!=='regex' && rule.prompt===prompt → rule.match!=='regex' && rule.prompt===question → regex 매칭
function savedAuthDecision({ state, config, endpoint, scope, prompt, canRemember, answered, allowSaved, allowedRuleIds, matchesGlobalPattern })
  // -> { entry, source: 'saved'|'global', used, key, reason }
  // entry 가 없으면 reason 은 아래 사유 코드 중 하나.
```
중요: `authScope` 정규화는 기존 저장값과 호환되어야 한다. 기존 앱은 `profile()` 결과(항상 문자열)로 계산했으므로 `''` 정규화는 기존 키를 바꾸지 않는다. `undefined`→`''` 로 바뀌는 것은 에이전트 쪽뿐이다.

사유 코드 (`reason`, 에이전트에 노출 가능, 비밀 아님):
| 코드 | 의미 |
|---|---|
| `not_granted` | grant.savedAuth 꺼짐, 그리고 매칭되는 허용 전역 규칙 없음 |
| `disabled` | `useStoredAuthOnConnect === false` 또는 `useSavedRepliesAutomatically === false` |
| `not_rememberable` | `canRemember` 가 false(호스트 외 프로세스, hint 있음 등) |
| `no_endpoint` | `ssh -G` 실패로 endpoint 없음 |
| `no_saved_reply` | 이 키로 저장된 응답 없음 (C1의 전형) |
| `scope_mismatch` | 저장 응답은 있으나 `entry.scope !== scope` |
| `global_rule_not_granted` | savedAuth=false 이고 grant.pam 밖의 전역 규칙만 매칭 |
| `already_used` | 같은 질문/규칙에 이미 한 번 답함(반복 질문 = 저장값이 틀림) |
| `read_failed` | 키체인/복호화 실패 또는 `validAuthAnswer` 실패 |

### createTransport 의존성 (agent-transport.cjs)
```js
createTransport({ state, readAnswer, validAuthAnswer, matchesGlobalPattern, snippetScope, directory, approve,
  knownHosts,            // 에이전트 known_hosts 경로 (기존)
  userKnownHosts,        // 신규: path.join(os.homedir(), '.ssh', 'known_hosts') — 읽기 전용
  profile,               // 신규: main.cjs 의 profile (stateRules.profile)
  confirmHostKey,        // 신규: async ({ profile, host, fingerprint, previous, endpoint, signal }) => boolean
  ssh = require('./openssh.cjs'), // 신규: 테스트 주입용
})
```
`authScope` 주입 인자는 제거하고 `saved-auth.cjs` 것을 직접 쓴다.

### openssh.cjs
```js
async function knownHostFingerprints(file, host) // -> string[] (SHA256:...); 파일 없음/항목 없음 → []
  // 구현: execute('/usr/bin/ssh-keygen', ['-l', '-F', host, '-f', file]); exit 1 → []; 각 줄에서 /SHA256:[A-Za-z0-9+/]+={0,2}/ 추출, '#' 줄 무시.
function parseKeygenFingerprints(stdout) // 위 파싱만 분리(테스트 대상)
```
`start(..., agent=true)` 일 때 인자: `-o UserKnownHostsFile=<quoted agent file>` 하나만. `GlobalKnownHostsFile` 은 기본값 유지.

### 실패 응답 `next`
`failureOf` 반환: `{ error: { code, stage, hint, exit?, next: Next[] } }`
```ts
type Next = { action: 'retry' | 'ask_user' | 'check_input' | 'refresh_grant', message: string }
```
| code | next |
|---|---|
| `HOST_KEY_UNKNOWN` | `ask_user`: "Ask the user to confirm the host key in the PromeFTP dialog, or connect once in PromeFTP." , `retry` |
| `HOST_KEY_CHANGED` | `ask_user`: "The server key differs from the trusted one. Ask the user to verify the new fingerprint; do not retry automatically." |
| `HOST_KEY_UNCONFIRMED` (신규) | `ask_user`: "The user declined or did not answer the host key dialog." |
| `AUTH_FAILED` | `ask_user`: "Saved credentials were rejected. Ask the user to update them in PromeFTP." |
| `SSH_CONFIG_CHANGED` | `refresh_grant`: "Ask the user to re-save this bookmark's agent permission." |
| `DNS_FAILED`,`HOST_UNREACHABLE`,`CONNECT_TIMEOUT`,`CONNECTION_REFUSED`,`PROXY_FAILED`,`CONNECTION_FAILED` | `retry` (1회), `check_input` |
| `SFTP_SUBSYSTEM_FAILED` | `ask_user` |
매핑은 `agent-transport.cjs` 의 `failureRules` 옆에 `nextSteps` 상수로 둔다. `message` 는 영어 고정 문자열(에이전트용, 비지역화).

세션 이벤트 `auth.prompt` 의 detail: `JSON.stringify({ savedAuth: reason })`.

## 동작 흐름

### 인증 (에이전트 connect)
1. `p = profile(state().profiles 의 원본)` 로 정규화. 실패 시 `PROFILE_NOT_ELIGIBLE`.
2. 접속용 config: 기존과 같음(legacy면 `-F /dev/null`).
3. 인증 식별용 endpoint `authEndpointForApp`: 항상 `resolve(p, false)` 의 endpoint(앱과 같은 방식). legacy이고 접속용 endpoint와 `hostname/user/port/proxyjump/proxycommand` 줄이 하나라도 다르면 저장 인증을 쓰지 않는다(사유 `scope_mismatch`, 접속은 계속). 같으면 앱 기준 endpoint로 key/scope 계산.
4. `scope = authScope(p, endpoint)` (saved-auth). 저장 비밀번호: `grant.savedAuth && sshPasswords[scope]` (기존 로직 유지).
5. 프롬프트 수신 시 `savedAuthDecision(...)`:
   - `allowSaved = grant.savedAuth`
   - `allowedRuleIds` = savedAuth ? 전역 규칙 전부 : `grant.pam` (D1)
   - entry 있으면 `readAnswer` → 최신값 재확인(기존 `latest === entry` 검사 유지) → `answer`. 성공 시 `auth.rule` 감사 기록.
   - 실패/없음이면 `notify('prompt', { ...value, savedAuth: reason })`.
6. C1 대응은 "확정된 결정" D2.

### 호스트 키 (에이전트)
1. 접속 전 정리: endpoint의 `hostname`/`port` 로 known_hosts 이름 `host` 또는 `[host]:port` 를 만든다. 에이전트 파일의 그 호스트 지문 중 `trusted`(아래 정의)에 없는 것이 있으면 `ssh.forgetKnownHost(agentFile, name)` (앱 소유 파일이므로 허용).
2. ssh는 에이전트 파일만 보므로 낡은 `~/.ssh` 키 때문에 중단되지 않고 "authenticity ... can't be established" 질문이 온다.
3. `hostKeyDecision` (async):
   - `trusted` = `trustedHostKeys['host:'+info.host]`, `trustedHostKeys[scope]` (기존) ∪ `knownHostFingerprints(userKnownHosts, info.host)`
   - 단, app 신뢰값이 있으면 그것이 우선: app 값이 있고 지문이 같으면 수락. app 값이 있고 다르면 → 변경.
   - app 값이 없고 `~/.ssh` 지문 중 하나와 같으면 수락(기존 신뢰 근거 유지).
   - app 값 없음 + `~/.ssh` 에 다른 키만 있음 → 변경. 아무것도 없음 → 미확인.
   - 수락: `answer(info.accept)`, `hostkey.pinned` 감사. ssh가 에이전트 파일에 기록.
4. 변경/미확인일 때: `confirmHostKey` 호출 → 앱 네이티브 다이얼로그(`approveAgentCommand` 와 같은 스타일, `main.cjs:1674-1688`). 내용: 북마크 이름, 실제 대상, 새 지문, 이전 지문(있으면), 출처(`PromeFTP` / `~/.ssh/known_hosts`), 버튼 `[취소, 신뢰하고 연결]`, 기본=취소. 승인 → `trustedHostKeys['host:'+host] = fingerprint` 저장 후 수락. 거부/세션 중단(signal)/60초 무응답 → `answer('no')`, 오류 `HOST_KEY_UNCONFIRMED`. 다이얼로그 동시 1개(호스트별 큐), 같은 호스트 대기 중 요청은 같은 결과를 공유.
   - `confirmHostKey` 가 주입되지 않은 경우(테스트)만 기존처럼 `HOST_KEY_CHANGED`/`HOST_KEY_UNKNOWN` 오류 + `next`.
5. 오류 detail은 기존대로 `{ host, fingerprint, trusted?, source }` (`source: 'app'|'user_known_hosts'`).

### profileTrusted (main.cjs)
`trustedHostKeys['host:'+key]` 가 있으면 true. 없으면 에이전트 파일 지문 존재 또는 `~/.ssh` 지문 존재로 true(현행과 같지만 공용 함수 `knownHostFingerprints` 사용). 지문 충돌 판단은 접속 시점에만 한다(UI 표시는 변경 없음).

## 확정된 결정
- D1=A: `allowedRuleIds = grant.savedAuth ? (state.globalAuthRules||[]).map(r=>r.id) : grant.pam`. 사유 `global_rule_not_granted` 는 savedAuth=false이고 grant.pam 밖의 전역 규칙이 매칭될 때만 쓴다. grant UI "저장된 인증 사용" 설명에 "전역 인증 규칙 포함" 문구 추가.
- D2=A: `grant.savedAuth && state.useOpenSSHKeychain === true` 이면 에이전트 `ssh.start` 7번째 인자 `useKeychain=true`. `IdentityAgent=none`, `IdentitiesOnly=yes` 유지. 사유가 `no_saved_reply` 이고 질문 마지막 줄이 `/password|passphrase/i` 면 prompt 값에 `next: [{action:'ask_user', message: NO_PROMPT_IN_APP}]` 추가. `NO_PROMPT_IN_APP = 'PromeFTP signed in without a prompt (likely ssh-agent). Save the password/answer once in PromeFTP or set an identity file on this bookmark.'`
- D3=A: 미신뢰/변경 키에 네이티브 확인 다이얼로그(기본=취소, 60초).
- D4: 1.1.8에서는 자동 수락 옵션이 없었다. 1.1.9에서 사용자 결정으로 grant 옵션 `hostKeyTrust` 를 추가한다(아래 "1.1.9" 섹션).

## 구현 체크리스트
각 항목 끝의 "확인"을 만족해야 완료. 순서대로 진행.
- [ ] I1: `saved-auth.cjs` 생성. export `{ authIdentity, authScope, replyKey, autoSavedReply, findGlobalRule, savedAuthDecision, SAVED_AUTH_REASONS }`. require는 `node:crypto` 와 `./auth-rules.cjs`(normalizedAuthQuestion)만. `savedAuthDecision` 판정 순서: (1) `useStoredAuthOnConnect===false`→`disabled` (2) `!canRemember`→`not_rememberable` (3) `!endpoint`→`no_endpoint` (4) allowSaved && `useSavedRepliesAutomatically!==false` 일 때 `authReplies[replyKey]` 확인: 없음→후보 사유 `no_saved_reply`, `entry.scope!==scope`→`scope_mismatch`, 문자열 entry→`no_saved_reply`, `answered` 에 질문 또는 key→`already_used`, 아니면 `{entry, source:'saved', used:key}` 반환 (5) `findGlobalRule` 을 allowedRuleIds 로 거른 목록에서 찾고 있으면 `{entry:rule, source:'global', used:rule.id}` (answered 검사 동일) (6) 없으면 앞 후보 사유, 후보가 없으면 allowSaved ? `no_saved_reply` : `not_granted`. `read_failed` 는 호출자가 readAnswer 실패 시 설정. 확인: `test/saved-auth.test.cjs` 통과.
- [ ] I2: `main.cjs` — `authScope` 함수 본문(523-527)을 `require('./saved-auth.cjs').authScope` 위임으로, `autoSavedReply`(617-619)를 `savedAuth.autoSavedReply(state, entry)` 로, `showAuthPrompt` 의 createHash 키 계산(866-868)을 `replyKey(config, endpoint, value.prompt)` 로, 전역 규칙 3단 find(906-909)를 `findGlobalRule(rules, value.prompt, matchesGlobalPattern)` 로 교체. 확인: `grep -n "createHash" main.cjs` 결과에 auth 키 계산 없음, `npm test` 통과.
- [ ] I3: `agent-transport.cjs` `createTransport` 인자에 `profile, userKnownHosts, confirmHostKey, ssh = openssh` 추가, `authScope` 인자 제거. 파일 내 `openssh.xxx(` 호출을 모두 `ssh.xxx(` 로(모듈 최상위 함수가 쓰는 경우 제외 없음). `main.cjs` `initializeAgent`(1695-1698) 호출부에 `profile, userKnownHosts: path.join(os.homedir(), '.ssh', 'known_hosts'), confirmHostKey: confirmAgentHostKey` 전달. 확인: `grep -n "openssh\." agent-transport.cjs` 가 require 줄과 기본값 외 0건.
- [ ] I4: `connect` 수정. 맨 앞 `p = profile(p)` (원본 id 보존: `{...profile(p), id: p.id}`). `resolve` 를 `connection = await resolve(p, !grant.route)` 와 `identity = grant.route ? connection : await resolve(p, false)` 로 둘. 새 헬퍼 `sameTarget(a, b)` = endpoint 문자열에서 `hostname|user|port|proxyjump|proxycommand` 줄만 비교. `authEndpoint = sameTarget(connection.endpoint, identity.endpoint) ? identity.endpoint : ''`, 불일치면 `mismatch=true`(사유 `scope_mismatch` 강제). `scope = authEndpoint && authScope(p, authEndpoint)`. 프롬프트 처리부(146-170)를 `savedAuthDecision` 호출로 교체, readAnswer 실패/invalid → `read_failed`. 자동응답 실패 시 `notify('prompt', { ...value, savedAuth: reason, ...(next && { next }) })`. 확인: `test/agent-transport.test.cjs` 의 auth 케이스 통과.
- [ ] I5: `agent-service.cjs` prompt 처리(162-166): `note(s, 'auth.prompt', 'waiting_for_user', null, JSON.stringify({ savedAuth, next }))` — `savedAuth` 는 `SAVED_AUTH_REASONS` 에 있을 때만, `next` 는 배열일 때만. `note` 시그니처는 기존 182행 사용과 같게. 확인: agent-transport 테스트에서 notify 값 검사.
- [ ] I6: D1·D2 반영(위 "확정된 결정"). `agent-preferences.js` 의 saved-auth 라벨 문구와 `localization.js` 키 추가(`test/i18n-keys.test.cjs` 통과하도록 ko 포함). 확인: `npm test`.
- [ ] I7: `openssh.cjs` 에 `parseKeygenFingerprints(stdout)`, `knownHostFingerprints(file, host)` 추가 후 `module.exports` 에 포함. 223행 `UserKnownHostsFile` 값을 `sshQuote(config.knownHosts)` 하나로. 인자 조립을 순수 함수 `agentRestrictedOptions(config)` 로 빼서 export. 확인: `test/openssh.test.cjs` 신규 케이스.
- [ ] I8: `hostKeyDecision(prompt, scope)` 을 async로. 규칙은 "동작 흐름/호스트 키 3". 반환 `{answer, host, fingerprint}` 또는 `{code, detail:{host, fingerprint, trusted?, source}}`. 접속 전 정리 함수 `pruneAgentKnownHosts(endpoint)` 추가: 이름 = `port` 가 22가 아니면 `[hostname]:port` 아니면 `hostname`(소문자); `ssh.knownHostFingerprints(knownHosts, name)` 중 app 신뢰값과 다른 것이 있으면 `ssh.forgetKnownHost(knownHosts, name)`. app 신뢰값이 없으면 지우지 않음. `connect` 에서 `ssh.start` 직전 await(오류 무시). 확인: 테스트에서 forgetKnownHost 첫 인자가 항상 knownHosts.
- [ ] I9: `main.cjs` 에 `async function confirmAgentHostKey({ profile, host, fingerprint, previous, source, endpoint, signal })` 추가. `dialog.showMessageBox(preferencesWindow || window, { type:'warning', message: localized(previous ? 'The server host key changed' : 'Verify SSH host key'), detail: [Bookmark, SSH target, New fingerprint, Previous fingerprint(있으면)+source].join('\n'), buttons:[localized('Cancel'), localized('Trust and Connect')], defaultId:0, cancelId:0, noLink:true, signal })`. 60초 `AbortSignal.any([signal, AbortSignal.timeout(60000)])`. 승인 시 `updateState(next => (next.trustedHostKeys ??= {})['host:'+host] = fingerprint)` 후 true. 같은 host 동시 요청은 `Map<host, Promise>` 로 공유. agent-transport에서 변경/미확인 시 호출, false/throw면 `answer(id,'no')` 와 notify error `{code:'HOST_KEY_UNCONFIRMED', stage:'hostkey', hint:'The user did not confirm the host key.', exit:null, detail}`. 확인: 테스트 및 수동 확인(다이얼로그).
- [ ] I10: `agent-transport.cjs` 에 `const nextSteps = { CODE: Next[] }` (데이터·인터페이스 표 그대로)와 `withNext(failure)` 추가, 모든 `notify('error', ...)` 직전에 적용(`classifySshFailure` 는 변경하지 않음). export에 `nextSteps` 추가. `agent-service.cjs` 182행 note detail에 `next: failure.next` 추가, `failureOf`(236-242)가 `detail.next` 배열이면 응답에 포함. 확인: 수용 기준 8.
- [ ] I11: `main.cjs` `profileTrusted` 를 `knownHostFingerprints(...).length > 0` 로 교체. 확인: 기존 동작 동일.
- [ ] I12: `docs/TROUBLESHOOTING.md`, `skills/promeftp/` 내 에러 코드 문서, `llms.txt`, `llms-full.txt` 에 `next`, `savedAuth` 사유 표, `HOST_KEY_UNCONFIRMED` 추가. 확인: `test/doc-links.test.cjs` 통과.
- [ ] I13: 테스트 파일 작성(테스트 계획의 이름 그대로), `npm test` 전체 통과.

## 테스트 계획
모두 `node:test` + `node:assert/strict`, 기존 파일 스타일(`test/openssh.test.cjs:1-4`). 파일 시스템은 `fs.mkdtemp(os.tmpdir())` 임시 디렉터리만. 실제 ssh/ssh-keygen 실행 안 함(가짜 `ssh` 주입). 해시 값은 상수로 쓰지 말고 함수로 계산해서 비교.

목데이터
```js
const endpointApp = 'hostname example.invalid\nuser alice\nport 22\nidentityagent ~/.1password/agent.sock';
const endpointLegacy = 'hostname example.invalid\nuser alice\nport 22';
const p = { id: 'b1', host: 'example.invalid', username: 'alice', port: null, keyPath: '', configPath: '' };
const pOld = { id: 'b1', host: 'example.invalid', username: 'alice' }; // keyPath/configPath 없음
const prompt = '(alice@example.invalid) Verification code: ';
```

`test/saved-auth.test.cjs`
- 정상: `authScope(p, e) === authScope(pOld, e)` (C4 재현: 정규화 전 에이전트 식 `{...pOld, configPath: ''}` 로 계산하면 다르다는 것도 assert).
- 정상: `replyKey` 가 앱 식 `[host, configPath, keyPath, endpoint, prompt]` 과 같은 값.
- 정상: 저장 응답 `{ answer:'1', scope }` → `{ source:'saved' }`.
- 경계: `useSavedRepliesAutomatically:false` → `reason:'disabled'`; `entry.scope` 다름 → `scope_mismatch`; `answered` 에 질문 존재 → `already_used`.
- 비정상: 문자열(구형 ciphertext) entry → 자동 응답 안 함(앱 `autoSavedReply` 와 같음).
- 빈 값: `authReplies` 없음 → `no_saved_reply`; endpoint '' → `no_endpoint`.
- 전역 규칙: 정확 일치 > 정규화 질문 일치 > regex 순서; savedAuth=true면 pam 비어도 전역 규칙 사용; savedAuth=false·pam 비어 있음 → `global_rule_not_granted`.

`test/agent-transport.test.cjs` (가짜 `ssh`: `effectiveOutput` 은 configPath가 '/dev/null' 이면 legacy 출력, 아니면 app 출력; `start` 는 onEvent를 저장하고 `answer(id, v)` 호출을 기록)
- C3 재현: grant.route 없음, legacy와 app endpoint의 hostname/user/port 동일, 저장 응답은 app endpoint 기준 → 프롬프트에 자동 응답(answer 기록 1회, notify('prompt') 없음).
- legacy와 app의 `user` 가 다름 → 자동 응답 안 함, prompt detail `savedAuth:'scope_mismatch'`.
- C4 재현: `state.profiles=[pOld]`, 저장 비밀번호 `sshPasswords[authScope(profile(pOld), endpointApp)]` → `start` 의 password 인자에 값 전달.
- savedAuth=false → `savedAuth:'not_granted'`.
- D2: savedAuth=true, `useOpenSSHKeychain:true` → `start` 7번째 인자 true; false면 false. `Password:` 질문 + 저장 없음 → prompt 값 `next[0].action==='ask_user'`.
- 에이전트 인자: `agentRestrictedOptions({configPath:'', knownHosts:'/x/k'})` 에 `~/.ssh/known_hosts` 문자열 없음, `UserKnownHostsFile="/x/k"` 포함 (openssh.test.cjs).
- 호스트 키: app 신뢰 지문 == 프롬프트 지문 → 수락. `~/.ssh` 가짜 지문만 일치 → 수락. app 신뢰 있고 다름 → `confirmHostKey` 1회 호출(인자 previous=app 지문), true면 수락, false면 `answer('no')` + `HOST_KEY_UNCONFIRMED`; confirmHostKey 미주입이면 `HOST_KEY_CHANGED`. 동시 2요청 공유는 main 쪽이라 수동 확인.
- 문제 2 재현: `~/.ssh` 가짜 파일에 다른 지문, app 신뢰 = 새 지문 → 수락(이전에는 HOST_KEY_CHANGED).
- 에이전트 파일에 app 신뢰와 다른 지문 → 접속 전 `forgetKnownHost(agentFile, 'example.invalid')` 호출; 비표준 포트면 `'[example.invalid]:2222'`.
- 실패 이벤트 `HOST_KEY_CHANGED` 의 notify 값에 `next[0].action === 'ask_user'`.

`test/openssh.test.cjs`
- `parseKeygenFingerprints`: 실제 `ssh-keygen -l -F` 형식 문자열(`# Host example.invalid found: line 3` + `256 SHA256:abc example.invalid (ED25519)`) → `['SHA256:abc']`; 빈 문자열 → `[]`; 해시 호스트 줄도 지문 추출.

기존 테스트: `test/classify-ssh-failure.test.cjs` 는 `classifySshFailure` 반환에 `next` 를 추가해도 깨지지 않게, `next` 는 `classifySshFailure` 가 아니라 notify 직전에 붙인다.

## 수용 기준
1. `npm test` 전체 통과, 기존 테스트 파일은 수정 없이(또는 `openssh.test.cjs` 추가 케이스만) 통과.
2. `main.cjs` 와 `agent-transport.cjs` 어디에도 응답 키/스코프 digest를 직접 만드는 코드가 없다 (`grep -n "createHash" agent-transport.cjs` 에 인증 키 계산이 없음, `main.cjs` 의 `authScope` 는 `saved-auth.cjs` 위임).
3. 테스트로: 같은 프로필·endpoint·질문에 대해 앱 판정과 에이전트 판정(savedAuth=true)이 같은 entry를 고른다(C3, C4 케이스 포함).
4. 테스트로: 자동 응답 못 한 모든 경우 prompt 이벤트에 사유 코드가 있고, 사유 문자열에 응답/비밀번호 값이 포함되지 않는다.
5. 에이전트 ssh 인자에 `~/.ssh/known_hosts` 가 `UserKnownHostsFile` 로 포함되지 않는다(테스트로 인자 배열 검사).
6. 테스트로: 사람 확인(app 신뢰, `~/.ssh` 일치, 다이얼로그 승인) 없이 미신뢰 지문이 수락되는 경로가 없다.
7. 어떤 코드도 `~/.ssh` 아래 파일에 쓰지 않는다(`forgetKnownHost` 호출 인자는 항상 에이전트 파일 — 테스트로 검사).
8. `failureOf` 응답에 `next` 배열이 있고, 표의 모든 코드가 매핑을 가진다(누락 시 `[{action:'ask_user', ...}]` 기본값).
9. 앱(사람) 접속의 자동 응답·호스트 키 다이얼로그 동작이 변하지 않는다(I2 리팩터 후 같은 입력에 같은 결과 — saved-auth 테스트로 확인).

## 결정 필요
(없음)


---

# 1.1.9: 호스트 키 자동 신뢰 옵션과 사전 중단 제거
기준: 1.1.8 출시본(HEAD `7a4d711`). 위 1.1.8 설계는 구현 완료 상태다.

## 9.목표
- 사용자가 북마크별로 허용하면, 에이전트 접속이 호스트 키 확인 다이얼로그 없이 끝나게 한다. 기본은 꺼짐이고, 켤 때 위험을 경고해 사용자 책임을 분명히 한다.
- 앱 신뢰값이 없는데 에이전트 파일이나 시스템 known_hosts의 낡은 키 때문에 OpenSSH가 질문 전에 중단하는 문제를 없앤다. 모든 키 판정이 PromeFTP의 판정 함수를 거치게 한다.

## 9.범위
포함: grant 필드 `hostKeyTrust`, 자동 수락 로직, 감사·이벤트 `hostkey.autotrusted`, 설정 UI(경고 문구, 강한 확인 다이얼로그, 4개 언어), 접속별 임시 known_hosts, 문서(AGENTS.md, TROUBLESHOOTING.md, skills/promeftp/SKILL.md, llms.txt, llms-full.txt).
제외: `~/.ssh`, `/etc/ssh` 아래 어떤 파일에도 쓰지 않는다. 앱(사람) 접속의 호스트 키 다이얼로그 동작은 바꾸지 않는다. 자동 신뢰값은 에이전트 전용 `state.agent.trustedHostKeys` 에만 저장하므로 앱 접속에 영향이 없다. 에이전트 확인 다이얼로그에서 승인하면 1.1.8처럼 앱 `trustedHostKeys` 에 저장한다(변경 없음). 새 의존성 없음. `ssh-keyscan` 은 쓰지 않는다(9.원인 비교 참고).

## 9.원인: 1.1.8에 남은 사전 중단
- 1.1.8 에이전트 ssh 인자는 `UserKnownHostsFile=<agent file>` 이고 `GlobalKnownHostsFile` 은 기본값이다 (`openssh.cjs:72-77`).
- `pruneAgentKnownHosts` 는 신뢰 집합 `trustOf` 에 **있는** 키를 에이전트 파일에 남긴다 (`agent-transport.cjs:117, 138-145`). 이 키가 서버의 새 키와 다르면 OpenSSH는 질문 없이 "REMOTE HOST IDENTIFICATION HAS CHANGED" 로 중단한다. 그래서 `hostKeyDecision`(`agent-transport.cjs:119-136`)이 실행되지 않는다. 경우는 셋이다.
  1. 앱 신뢰값 없음. `~/.ssh` 에 예전 키 K_old가 있고, 과거에 `~/.ssh` 신뢰로 수락한 K_old가 에이전트 파일에도 남아 있음. 서버는 지금 K_new를 쓴다.
  2. 앱 신뢰값 K_app이 에이전트 파일에 있고 서버 키가 바뀌었다. 1.1.8은 이 경우도 다이얼로그 없이 `HOST_KEY_CHANGED` 로 끝난다.
  3. `/etc/ssh/ssh_known_hosts`(시스템 전역 파일)에 낡은 키가 있다.

### 새 지문을 얻는 방법 비교
| 방법 | 장점 | 단점 |
|---|---|---|
| A. **접속마다 빈 임시 known_hosts + `GlobalKnownHostsFile=/dev/null`** (추천) | OpenSSH가 항상 "authenticity can't be established" 질문을 보내므로 실제 접속 경로(ProxyJump/ProxyCommand 포함)로 협상한 키의 지문을 얻는다. 재시도가 필요 없다. 판정은 모두 `hostKeyDecision` 이 한다. | 매 접속마다 askpass 왕복이 1회 생긴다(수 ms). OpenSSH가 "아는 키 종류"를 우선하는 알고리즘 순서 조정을 잃는다. 그래서 `~/.ssh` 에 RSA 키만 있고 서버가 ED25519를 협상하면 "바뀐 키"로 보일 수 있다(아래 종류 규칙으로 처리). |
| B. `ssh-keyscan` 으로 지문 수집 | 구현이 단순해 보인다. | ProxyJump/ProxyCommand를 따르지 않는다(다른 경로의 키를 볼 수 있음). 여러 키 종류 중 실제 협상될 키를 고를 수 없다. 별도 연결이 하나 더 생긴다. |
| C. 중단을 감지한 뒤 대체 known_hosts로 1회 재접속 | 평소 경로는 변경 없음. | `connect` 가 이미 반환한 connection을 바꿔야 해서 agent-service 세션 구조를 고쳐야 한다. 실패 로그와 이벤트가 두 번 생긴다. |

결정: A. 에이전트 파일 `userData/agent/known_hosts` 는 더 이상 읽거나 쓰지 않는다. 남아 있는 파일은 지운다(I9-9).

### 키 종류 규칙
`~/.ssh` 근거는 질문에 나온 키 종류(`ED25519 key fingerprint is` 의 첫 단어)와 같은 종류의 항목만 비교한다. `ssh-keygen -l` 출력의 `(ED25519)` 를 쓴다.
- 같은 종류 항목이 있고 지문이 다르면 "바뀐 키"다.
- 다른 종류만 있으면 "새 종류 키"다. "처음 보는 키"로 취급하지 않고 "바뀐 키" 쪽으로 엄격하게 분류한다(`new` 모드에서 자동 수락하지 않음).

앱 신뢰값(`trustedHostKeys`)과 에이전트 전용 신뢰값(`state.agent.trustedHostKeys`)은 종류를 저장하지 않으므로 지문만 비교한다. 시스템 근거는 `~/.ssh/known_hosts` 와 `/etc/ssh/ssh_known_hosts` 를 합친 목록이다(둘 다 읽기 전용).

## 9.데이터·인터페이스
grant 필드 (`agent-transport.cjs` `validateGrant`):
```js
hostKeyTrust: 'off' | 'new' | 'changed'   // 기본 'off'. 다른 값 → problem('INVALID_REQUEST'). 없는(예전) grant → 'off'.
```
- `off`: 1.1.8과 같다. 신뢰된 키가 아니면 확인 다이얼로그를 띄운다.
- `new`: 처음 보는 키(앱 신뢰값 없음, `~/.ssh` 에 그 호스트 항목이 전혀 없음)는 자동 수락한다. 바뀐 키와 새 종류 키는 다이얼로그.
- `changed`: 처음 보는 키, 바뀐 키, 새 종류 키를 모두 자동 수락한다.

판정 결과 (`hostKeyDecision` 반환 확장):
```js
{ answer, host, fingerprint }                                    // 신뢰된 키 → 기존 hostkey.pinned
{ answer, host, fingerprint, auto: true, previous?, source?, kind: 'new'|'changed' } // 자동 수락
{ code, detail }                                                 // 오류 (기존)
```
분류 함수(순수, export):
```js
function classifyHostKey({ fingerprint, keyType, app /*string[]*/, agent /*string[]*/, user /*[{fingerprint,type}]*/ })
// -> { kind: 'trusted'|'new'|'changed', previous?, source?: 'app'|'agent'|'user_known_hosts' }
// 우선순위: app → agent → user(~/.ssh + /etc). 비어 있지 않은 첫 근거만 본다(뒤 근거는 무시).
// app 있음: 포함 → trusted, 아니면 changed(previous=app[0], source 'app').
// app 없고 agent 있음: 포함 → trusted, 아니면 changed(previous=agent[0], source 'agent').
// 둘 다 없음: user 중 같은 종류 항목에 일치 → trusted. user 비어 있음 → new. 그 외 → changed(previous=같은 종류 항목 또는 user[0], source 'user_known_hosts').
function autoTrustAllowed(mode, kind) // mode==='changed' ? kind!=='trusted' : mode==='new' ? kind==='new' : false
```
`openssh.cjs`:
- `parseKeygenFingerprints(stdout)` 는 그대로 둔다(문자열 배열).
- `parseKeygenEntries(stdout) -> [{ fingerprint, type }]` 를 추가한다. 줄 형식은 `256 SHA256:x host (ED25519)` 이고, type은 대문자 괄호 안 값이다.
- `knownHostEntries(file, host)` 를 추가한다. `knownHostFingerprints` 와 같은 실행이고 entries를 반환한다. 기존 함수 `knownHostEntries(line)`(`openssh.cjs:25`)와 이름이 겹치므로 새 함수 이름은 **`knownHostKeyEntries`** 로 한다.
- `parseHostKeyPrompt` 반환에 `keyType` 을 추가한다(`/^([\w-]+) key fingerprint is/m` 의 1번 그룹을 대문자로, 없으면 `''`). 기존 테스트의 `deepEqual` 3건(`test/openssh.test.cjs:9-21`)은 `keyType` 필드를 넣어 기대값을 고친다.
- `agentRestrictedOptions(config)`: `UserKnownHostsFile=` + `sshQuote(config.knownHosts)` 다음에 `'-o', 'GlobalKnownHostsFile=/dev/null'` 을 추가한다.
- `start` 에서 에이전트이면 `config.knownHosts` 를 접속 임시 디렉터리(`directory`, 이미 `fs.mkdtemp('/tmp/promeftp-')`) 안의 `known_hosts` 로 덮어쓴다. 즉 `agent` 일 때 `agentRestrictedOptions({ ...config, knownHosts: path.join(directory, 'known_hosts') })`. 파일은 만들지 않는다(OpenSSH가 없는 파일을 빈 파일로 취급). `close()` 의 `fs.rm(directory)` 가 정리한다.

주입 의존성 (`createTransport`):
- `trustHostKey: async (host, fingerprint) => void` 를 추가한다. main.cjs 구현은 `updateState(next => (((next.agent ??= {}).trustedHostKeys ??= {})['host:' + host] = fingerprint))` 다. 앱 `trustedHostKeys` 에는 쓰지 않는다.
- `systemKnownHosts` 를 추가한다(기본 `'/etc/ssh/ssh_known_hosts'`, 테스트에서 교체).
- `knownHosts` 인자는 제거한다.

상태: `state.agent.trustedHostKeys: { ['host:'+host]: fingerprint }`. 이 객체는 앱 설정 UI에서 편집하지 않는다. 에이전트 확인 다이얼로그 승인(`confirmAgentHostKey`)이 앱 `trustedHostKeys` 에 저장되면 판정 우선순위상 그 값이 이 객체보다 우선한다.

이벤트·감사:
- transport notify: `notify('hostkey.autotrusted', { host, fingerprint, previous: previous || null, source: source || null, kind, mode })`.
- agent-service: `if (event === 'hostkey.autotrusted') audit(base(s, event, 'success', null, JSON.stringify(value)))`. `sessionEvents` 의 `operation IN (...)`(`agent-service.cjs:255`)에 `'hostkey.pinned'`, `'hostkey.autotrusted'` 를 추가한다. 에이전트가 `events list` 로 볼 수 있다.
- 설정의 활동 기록(Preferences → Agents)에서 `hostkey.autotrusted` 행을 경고 색으로 표시하고, detail에서 host, 이전/새 지문을 보여 준다(`preferences.js` 의 활동 렌더링에 operation 라벨 추가).

## 9.동작 흐름
1. `connect`: `pruneAgentKnownHosts` 호출과 함수 자체를 삭제한다. ssh는 접속별 빈 임시 파일과 `GlobalKnownHostsFile=/dev/null` 로 실행되므로 항상 질문한다.
2. 질문 수신 → `hostKeyDecision(prompt, { scope, profile, endpoint, signal, mode: grant.hostKeyTrust || 'off' })`:
   1. `info = ssh.parseHostKeyPrompt(prompt)`. 지문 없음 → `HOST_KEY_UNKNOWN`(기존).
   2. `trustedFor(host, scope)` 를 `{ app, agent, user }` 를 반환하도록 수정한다.
      - `app` 은 기존과 같다.
      - `agent = [state().agent?.trustedHostKeys?.['host:'+host]].filter(Boolean)`.
      - `user` 는 `knownHostKeyEntries(userKnownHosts, host)` 와 `knownHostKeyEntries(systemKnownHosts, host)` 결과를 합친 것이다. 각각 실패하면 `[]`.
   3. `c = classifyHostKey(...)`. `trusted` → 기존 수락(`hostkey.pinned`).
   4. `autoTrustAllowed(mode, c.kind)` → `await trustHostKey(info.host, info.fingerprint)`. 실패해도 이번 접속은 수락한다(감사 detail에 `saved:false`). 그다음 `notify('hostkey.autotrusted', ...)` 후 `answer(info.accept)`. 다이얼로그는 띄우지 않는다.
   5. 그 외 → 1.1.8의 `confirmHostKey` 경로(다이얼로그). `previous` 는 `c.previous`, `source` 는 `c.source`.
3. 오류 흐름: `trustHostKey` 예외 → 수락은 하고 감사에 기록. 세션 중단(signal) → 아무것도 저장하지 않고 `answer('no')`.
4. 기존 `HOST_KEY_CHANGED` 분류 regex는 남긴다(이론상 더는 나오지 않지만, 시스템 설정이 바뀌는 경우에 대비).
5. 시작 시 정리: `main.cjs` `initializeAgent` 에서 `fs.rm(path.join(directory, 'known_hosts'), { force: true })` 와 `.old` 를 지운다. `showHostKeyPrompt` 의 `forgetKnownHost(agentKnownHostsPath(), host)` 호출(`main.cjs` remember 내부)도 삭제하고, `agentKnownHostsPath` 사용처를 정리한다. `profileTrusted` 는 앱 신뢰값, `state.agent.trustedHostKeys`, `~/.ssh`, `/etc/ssh/ssh_known_hosts` 항목 중 하나라도 있으면 true를 반환한다.

## 9.디자인 방향 (설정 UI)
- 위치: `preferences.html` "Authentication and triggers" fieldset(`agent-saved-auth` 아래).
- 컨트롤: `<label>Trust host keys automatically<select id="agent-host-key-trust">` 옵션 3개.
  - `off` "Off (ask me)"
  - `new` "New keys only"
  - `changed` "New and changed keys"
- 경고 영역: `<p id="agent-host-key-trust-warning" class="settings-note warning" role="note" hidden>`. off가 아니면 보인다. 기존 경고 스타일을 재사용하고, 새 색이나 아이콘 세트를 만들지 않는다.
- `changed` 선택 시: `agent-maximum-dialog` 와 같은 구조의 `<dialog id="agent-host-key-dialog">` 를 연다. 버튼은 [Cancel(기본), Turn On]이다. Cancel이나 Esc를 누르면 select를 이전 값으로 되돌린다.
- 프리셋(`agent-preferences.js:79-82`)은 4개 모두 `hostKeyTrust: 'off'` 로 둔다(9.D3). "maximum" 확인 다이얼로그 문구는 변경하지 않는다.
- 금지: 토글 하나로 `changed` 까지 켜는 UI, 경고 없이 켜지는 경로, 경고를 툴팁에만 두는 것.

문구 (localization.js 형식: `영어|한국어|日本語|中文`, 한 줄에 하나):
```
Trust host keys automatically|호스트 키 자동 신뢰|ホストキーを自動的に信頼|自动信任主机密钥
Off (ask me)|끔 (매번 확인)|オフ(毎回確認)|关闭(每次确认)
New keys only|처음 보는 키만|初めてのキーのみ|仅首次出现的密钥
New and changed keys|처음 보는 키와 바뀐 키|初めてのキーと変更されたキー|首次出现和已更改的密钥
PromeFTP will trust a server key it has not seen before without asking. If the first connection is intercepted (man-in-the-middle), saved passwords and answers can be sent to the attacker automatically. You are responsible for this choice.|PromeFTP가 처음 보는 서버 키를 묻지 않고 신뢰합니다. 첫 연결이 중간자 공격을 받으면 저장된 비밀번호와 응답이 공격자에게 자동으로 전송될 수 있습니다. 이 선택의 책임은 사용자에게 있습니다.|PromeFTP は初めて見るサーバーキーを確認せずに信頼します。最初の接続が中間者攻撃を受けた場合、保存されたパスワードと応答が攻撃者に自動送信される可能性があります。この選択の責任はユーザーにあります。|PromeFTP 将不经询问信任首次出现的服务器密钥。如果首次连接遭到中间人攻击,已保存的密码和应答可能会被自动发送给攻击者。此选择的责任由您承担。
PromeFTP will also trust a key that differs from the one you trusted, without asking. A changed key is the main sign of a man-in-the-middle attack. Saved passwords and answers can be sent to the attacker automatically. You are responsible for this choice.|PromeFTP가 신뢰했던 키와 다른 키도 묻지 않고 신뢰합니다. 키가 바뀐 것은 중간자 공격의 대표적인 징후입니다. 저장된 비밀번호와 응답이 공격자에게 자동으로 전송될 수 있습니다. 이 선택의 책임은 사용자에게 있습니다.|PromeFTP は信頼済みのキーと異なるキーも確認せずに信頼します。キーの変更は中間者攻撃の主な兆候です。保存されたパスワードと応答が攻撃者に自動送信される可能性があります。この選択の責任はユーザーにあります。|PromeFTP 也将不经询问信任与您已信任密钥不同的密钥。密钥变更是中间人攻击的主要迹象。已保存的密码和应答可能会被自动发送给攻击者。此选择的责任由您承担。
Trust changed host keys automatically?|바뀐 호스트 키를 자동으로 신뢰할까요?|変更されたホストキーを自動的に信頼しますか?|要自动信任已更改的主机密钥吗?
Turn On|켜기|オンにする|开启
Host key trusted automatically|호스트 키 자동 신뢰됨|ホストキーを自動的に信頼しました|已自动信任主机密钥
```
`Turn On` 등 이미 있는 키는 중복 추가하지 않는다(`grep -n "^Turn On|" localization.js` 로 먼저 확인). `test/i18n-keys.test.cjs` 를 통과해야 한다.

## 9.구현 체크리스트
- [ ] I9-1: `openssh.cjs` 를 수정한다.
  - `parseHostKeyPrompt` 에 `keyType` 을 추가한다.
  - `parseKeygenEntries`, `knownHostKeyEntries` 를 추가하고 export한다.
  - `agentRestrictedOptions` 에 `GlobalKnownHostsFile=/dev/null` 을 넣는다.
  - `start` 의 에이전트 known_hosts를 접속 임시 디렉터리 파일로 바꾼다.
  - 확인: `test/openssh.test.cjs` 의 신규·수정 케이스.
- [ ] I9-2: `agent-transport.cjs` 에 순수 함수 `classifyHostKey`, `autoTrustAllowed` 를 추가하고 `module.exports` 에 넣는다. 확인: `test/agent-transport.test.cjs` "classifyHostKey" 묶음.
- [ ] I9-3: `validateGrant` 반환에 `hostKeyTrust: ['off','new','changed'].includes(value.hostKeyTrust ?? 'off') ? (value.hostKeyTrust ?? 'off') : throw INVALID_REQUEST` 를 넣는다. 확인: 잘못된 값 → `INVALID_REQUEST`, 누락 → 'off'.
- [ ] I9-4: `createTransport` 인자에서 `knownHosts` 를 빼고 `trustHostKey`, `systemKnownHosts = '/etc/ssh/ssh_known_hosts'` 를 추가한다. `trustedFor` 는 9.동작 흐름 2-2대로 `{app, agent, user}` 를 반환하게 고치고, `trustOf` 는 삭제한다(`classifyHostKey` 가 대신한다). `pruneAgentKnownHosts` 와 그 호출을 삭제한다. `resolve` 에서 config에 `knownHosts` 를 넣던 코드도 삭제한다(`start` 가 정함). 확인: `grep -n "pruneAgentKnownHosts\|knownHosts" agent-transport.cjs` 결과가 `userKnownHosts`, `systemKnownHosts` 만.
- [ ] I9-5: `hostKeyDecision` 을 9.동작 흐름 2에 맞게 수정하고, 호출부(`agent-transport.cjs:205` 근처)에서 `decision.auto` 이면 `notify('hostkey.autotrusted', ...)` 를 보낸 뒤 answer한다. 확인: 테스트의 notify 순서 `hostkey.autotrusted` → answer.
- [ ] I9-6: `main.cjs` 를 수정한다.
  - `initializeAgent` 의 `createTransport` 호출에서 `knownHosts` 를 제거하고, `trustHostKey` 를 주입한다. 구현은 `state.agent.trustedHostKeys` 에만 쓴다(9.데이터 참고).
  - `confirmAgentHostKey` 는 변경하지 않는다(승인 시 계속 앱 `trustedHostKeys` 에 저장).
  - 예전 에이전트 known_hosts와 `.old` 를 삭제한다.
  - `showHostKeyPrompt` remember의 `forgetKnownHost(agentKnownHostsPath()...)` 를 삭제한다.
  - `profileTrusted` 에서 에이전트 파일을 제외하고, `state.agent.trustedHostKeys` 와 `/etc/ssh/ssh_known_hosts` 를 근거에 추가한다.
  - `agentKnownHostsPath` 는 삭제용으로만 남긴다.
  - 확인: `grep -n "agentKnownHostsPath" main.cjs` 가 정의와 삭제 코드 2건.
- [ ] I9-7: `agent-service.cjs` 에서 `hostkey.autotrusted` 를 감사에 기록하고, `sessionEvents` 의 operation 목록에 `hostkey.pinned`, `hostkey.autotrusted` 를 추가한다. 확인: 서비스 테스트 또는 수동 `promeftp events list`.
- [ ] I9-8: 설정 UI를 만든다.
  - `preferences.html` 에 select, 경고 p, `agent-host-key-dialog` 를 추가한다.
  - `agent-preferences.js` 를 고친다. 164행 근처 로드 시 `grant?.hostKeyTrust || 'off'` 를 쓰고, 375행 근처 저장 객체에 `hostKeyTrust` 를 넣는다. 프리셋 4개에 `hostKeyTrust:'off'` 를 넣고, 91행 근처 프리셋 적용에도 반영한다.
  - change 핸들러: off가 아니면 경고를 보이고, 문구는 new/changed에 따라 바꾼다. `changed` 를 고르면 다이얼로그를 열고, 취소하면 이전 값으로 되돌린다.
  - `preferences.js` 활동 라벨에 `hostkey.autotrusted` 를 추가한다.
  - `localization.js` 에 9.디자인 방향의 문구를 추가한다.
  - 확인: `npm test`(i18n, ipc-surface, syntax), 수동 UI 확인.
- [ ] I9-9: 문서를 갱신한다.
  - `docs/AGENTS.md` 21행 문단: 자동 신뢰 옵션 3단계와 위험, 접속별 임시 known_hosts, `hostkey.autotrusted` 이벤트.
  - `docs/TROUBLESHOOTING.md` 60-62행: `HOST_KEY_CHANGED` 가 더는 사전 중단으로 나오지 않음, 자동 신뢰 시 활동 기록에서 확인하는 법.
  - `skills/promeftp/SKILL.md`: 이벤트 목록에 `hostkey.pinned`, `hostkey.autotrusted` 를 추가하고, "에이전트는 hostKeyTrust를 바꿀 수 없고 사용자에게 요청만 한다"는 문장을 넣는다. 스킬 매니페스트 서명이 있으면(커밋 `0ea15b9`) 서명 갱신 절차를 RELEASE 문서대로 따른다.
  - `llms.txt`, `llms-full.txt`: 같은 내용을 반영한다.
  - 확인: `test/doc-links.test.cjs`, `test/agent-skills.test.cjs` 통과.
- [ ] I9-10: 테스트를 작성하고 `npm test` 전체를 통과시킨다.

## 9.테스트 계획
`test/agent-transport.test.cjs` 의 가짜 `ssh` 확장:
- `knownHostKeyEntries(file, host)` 는 테스트 맵을 반환한다.
- `parseHostKeyPrompt` 는 실제 함수를 쓴다.
- `trustHostKey` 는 호출을 기록하는 스파이다.
- `systemKnownHosts` 는 `'/sys/fake'` 로 주입하고, 가짜 `knownHostKeyEntries` 가 파일 경로별로 다른 목록을 반환한다.

목데이터:
```js
const ask = (type, fp) => `The authenticity of host 'example.invalid (203.0.113.5)' can't be established.\n${type} key fingerprint is ${fp}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?`;
const K_OLD = 'SHA256:old', K_NEW = 'SHA256:new';
```
classifyHostKey (순수):
- app=[K_NEW] → trusted
- app=[], agent=[K_NEW] → trusted. app=[], agent=[K_OLD] → changed, source 'agent'
- app=[K_NEW], agent=[K_OLD] → trusted (app 우선)
- app=[], agent=[K_OLD], user=[{K_NEW, ED25519}] → changed (agent가 user보다 우선)
- app=[K_OLD] → changed, source 'app'
- app=[], user=[] → new
- user=[{K_OLD, ED25519}], 질문 ED25519 K_NEW → changed, source 'user_known_hosts'
- user=[{K_OLD, RSA}], 질문 ED25519 → changed
- user=[{K_NEW, ED25519}] → trusted
autoTrustAllowed: 3×3 표 전부를 assert한다.

흐름:
- off + new → `confirmHostKey` 1회, `trustHostKey` 0회.
- new + new → `confirmHostKey` 0회, `trustHostKey('example.invalid', K_NEW)` 1회(main 구현 단위 확인: `state.agent.trustedHostKeys` 만 바뀌고 `state.trustedHostKeys` 는 그대로), `hostkey.autotrusted` detail `{kind:'new', previous:null, mode:'new'}`, answer = K_NEW.
- new + changed → `confirmHostKey` 1회(자동 수락 안 함).
- changed + changed(app K_OLD) → 자동 수락, detail `previous: K_OLD, source: 'app'`.
- 1.1.8 사전 중단 재현(원인의 경우 1): app 없음, user K_OLD, 질문 K_NEW → 오류가 아니라 다이얼로그(off) 또는 자동 수락(changed).
- `trustHostKey` 가 reject해도 answer가 호출된다.
- signal abort 후 → `trustHostKey` 0회.
- `/etc` 근거: user 맵의 `'/sys/fake'` 에만 {K_NEW, ED25519}가 있음 → trusted. `'/sys/fake'` 에만 K_OLD가 있음 → changed, source 'user_known_hosts'.
- validateGrant: `{hostKeyTrust:'yes'}` → INVALID_REQUEST, 누락 → 'off'.
`test/openssh.test.cjs`:
- `agentRestrictedOptions({knownHosts:'/x/k'})` 가 `GlobalKnownHostsFile=/dev/null` 을 포함하고 `.ssh` 문자열을 포함하지 않는다.
- `parseKeygenEntries('256 SHA256:abc example.invalid (ED25519)\n# Host x found: line 3')` → `[{fingerprint:'SHA256:abc', type:'ED25519'}]`. 빈 문자열 → `[]`.
- `parseHostKeyPrompt` 의 `keyType`: ED25519, ECDSA, RSA, 종류 줄이 없으면 ''.
- 서명 경로를 실제로 실행하지 않는다. 실제 `~/.ssh` 나 userData에 접근하지 않는다.

## 9.수용 기준
1. `npm test` 가 전부 통과한다.
2. 기본값(필드 없음)인 grant에서는 신뢰되지 않은 키를 다이얼로그 없이 수락하는 경로가 없다(테스트 off×{new,changed}).
3. `new` 모드는 바뀐 키와 새 종류 키를 자동 수락하지 않는다(테스트).
4. 자동 수락할 때마다 `hostkey.autotrusted` 가 host, fingerprint, previous, source, kind, mode와 함께 notify된다. agent-service 감사에 기록되고 `events list` 에도 포함된다.
5. 에이전트 ssh 인자에 `GlobalKnownHostsFile=/dev/null` 이 있고, `UserKnownHostsFile` 은 접속 임시 디렉터리 안의 파일 하나다. `~/.ssh` 경로는 인자에 없다.
6. 코드 어디에서도 `~/.ssh` 또는 `/etc/ssh` 아래에 쓰지 않는다. `forgetKnownHost` 호출이 남아 있지 않거나, 있다면 userData 경로만 대상으로 한다(grep).
7. 원인의 경우 1~3(앱 신뢰값 없음 또는 있음, 낡은 키)에서 에이전트 세션이 `HOST_KEY_CHANGED` 사전 중단으로 끝나지 않는다. 다이얼로그나 자동 수락으로 진행한다(테스트로 질문 흐름 확인. 실제 OpenSSH 동작은 수동 확인 1회).
8. 설정 UI: off 이외를 고르면 경고가 보인다. `changed` 는 확인 다이얼로그를 거쳐야 저장되고, 취소하면 원래 값으로 돌아간다. 4개 언어 문구가 있다.
9. 에이전트 API로는 `hostKeyTrust` 를 바꿀 수 없다. grant 저장은 앱 설정 IPC로만 한다(기존 구조 유지 확인).
10. 자동 신뢰는 `state.agent.trustedHostKeys` 에만 저장되고 앱 `trustedHostKeys` 는 바뀌지 않는다. 판정 우선순위는 app → agent → `~/.ssh`·`/etc` 이다(테스트).

## 9.확정된 결정
- 9.D1: 3단계 off/new/changed.
- 9.D2: 자동 신뢰값은 에이전트 전용 `state.agent.trustedHostKeys` 에 저장한다. 판정 우선순위는 앱 `trustedHostKeys` → 에이전트 전용 → `~/.ssh`·`/etc/ssh/ssh_known_hosts` 이다. 에이전트 다이얼로그 승인은 기존처럼 앱 `trustedHostKeys` 에 저장한다.
- 9.D3: 프리셋 4개 모두 off(maximum 포함).
- 9.D4: 접속별 임시 known_hosts + `GlobalKnownHostsFile=/dev/null`. `/etc/ssh/ssh_known_hosts` 는 읽기 전용 근거로 합친다.

## 9.결정 필요
(없음)

---

# 1.1.9 — 세션 유지·OTP 대기
기준: HEAD `b5f2134`(1.1.9 미출시). 위 1.1.9 호스트 키 섹션과 같은 릴리스에 포함한다.

## S.목표
OTP(keyboard-interactive) 접속에서는 사용자가 PromeFTP에서 OTP를 입력할 때까지 시간이 걸린다. 그동안 에이전트가 세션을 닫거나 실패로 보고하지 않게 한다. 스킬과 응답만 보고도 에이전트가 무엇을 해야 할지 알 수 있게 한다.

## S.현황 (근거)
- 유휴 한도 10분: `agent-service.cjs:10`. 요청마다 `touched` 갱신: `:308`. 유휴 종료 `IDLE_TIMEOUT`: `:143`.
- 인증 한도는 open 시각 + 120초(`authDeadline`, `:151`)이고, 지나면 `AUTH_TIMEOUT`(`:142`).
  - 이 120초에는 접속, 호스트 키 다이얼로그(최대 60초), OTP 입력이 모두 들어간다. 다이얼로그를 띄운 뒤 OTP를 받으면 실제 OTP 입력 시간은 60초 이하가 될 수 있다.
- 인증 질문은 앱에서 답한다. `answer()` 는 `authDeadline` 이 지나면 거부한다(`:570`).
- `session.status` 는 ready 전이면 `expires`(=authDeadline)를 준다(`:309`). 끝난 세션이면 `{status:'closed', reason, error}` 를 준다(`:295-300`).
- 요청 하나의 작업 한도는 30초이고, 초과하면 세션을 `TIMEOUT` 으로 **종료**한다(`:369-372`). 소켓 한도는 35초(`:397`), CLI 소켓 한도는 38초(`native/agent-cli.swift:73-75`).
- 종료 사유 코드: `CONNECT_FAILED`(`:199`), `CLIENT_CLOSED`(`:310`), `AUTH_TIMEOUT`, `IDLE_TIMEOUT`, `TIMEOUT`, `PERMISSION_CHANGED`(`:135`), `SERVICE_DISABLED`(`:465`), `USER_CANCELLED`(`:573`), `REMOTE_CLOSED`(`:199` 근처 closed 처리).
- CLI 소스: `native/agent-cli.swift`. 메서드와 허용 인자 표는 `:29-34`, 인자 파싱은 `:37-51`이다. 빌드는 `build-macos.sh:26` 의 `swiftc` 다. Node 테스트로는 실행할 수 없다.
- 스킬 `skills/promeftp/SKILL.md:13-24` 에는 상태별 행동, 폴링 간격, "닫지 말 것" 지시가 없다.

## S.비교와 결정
| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| (a) `session.wait` | 상태가 바뀌거나 최대 25초가 지나면 반환하는 블로킹 메서드와 CLI `session wait` | 폴링 횟수와 토큰이 줄고, 상태 변화에 즉시 반응한다. | 서비스와 CLI(Swift)를 모두 수정해야 한다. 30초 작업 한도보다 짧게 두어야 하고, `activeSession` 으로 잡으면 안 된다(잡으면 TIMEOUT 종료). |
| (b) 질문 대기 중 인증 한도 연장 | 질문이 뜨면 `authDeadline = max(authDeadline, now + 180초)`, 상한은 open + 600초 | 호스트 키 다이얼로그와 OTP가 겹쳐도 OTP 입력 시간이 3분 보장된다. | 무한히 연장되지 않도록 상한이 필요하다. |
| (c) status에 `next` 안내 | `connecting`/`waiting_for_user` 응답에 `next:[{action:'wait', message}]` 와 `retryAfter` | 스킬을 읽지 않은 에이전트도 올바르게 행동한다. 변경이 작다. | 응답 크기가 조금 늘어난다. |

확정: (a)(b)(c) 모두 넣는다(S.확정된 결정).

## S.데이터·인터페이스
- 상수(`agent-service.cjs` 상단): `const authWindow = 120_000, promptWindow = 180_000, authCeiling = 600_000, waitLimit = 25_000;`
- 세션 필드: `opened: Date.now()` (startSession), `waiters: new Set()`.
- `session.status` 응답 (ready 전):
  ```js
  { session, status: 'connecting'|'waiting_for_user', expires, retryAfter: 2,
    next: [{ action: 'wait', message: WAIT_MESSAGES[status] }] }
  ```
  - `WAIT_MESSAGES.connecting = 'Connecting. Keep polling session status every 2-5 seconds until expires. Do not close or reopen the session.'`
  - `WAIT_MESSAGES.waiting_for_user = 'Waiting for the user to answer an authentication prompt (such as an OTP) in PromeFTP. Tell the user once, then keep polling until expires. Do not close or reopen the session.'`
  - ready: `{ session, status: 'ready' }` (기존과 같음). closed: 기존과 같고 `error.next` 를 포함한다.
- 끝난 세션의 `reason` 이 `error` 를 만들지 않는 경우(`AUTH_TIMEOUT`, `IDLE_TIMEOUT`, `USER_CANCELLED`, `CLIENT_CLOSED`, `TIMEOUT`, `PERMISSION_CHANGED`, `SERVICE_DISABLED`, `REMOTE_CLOSED`)에는 `next` 를 `endNext[reason]` 으로 준다.
  - `{ session, status:'closed', reason, next }`. `error` 가 있으면 `error.next` 를 우선한다.
  - `endNext` 는 `agent-service.cjs` 상수이고 표 S.종료사유를 따른다.
- `session.wait`:
  - 요청 `{ session, timeout? }`. timeout은 밀리초 정수 1000-25000이고 기본 25000이다. 다른 값은 `INVALID_REQUEST`.
  - 반환은 `session.status` 와 같은 형태다. 호출 시점 상태가 ready 또는 closed면 즉시 반환한다. 아니면 status가 바뀌거나 세션이 끝나거나 timeout이 되면 반환한다.
  - `touched` 를 갱신한다. `activeSession`/`inFlight` 는 설정하지 않는다(설정하면 30초 한도로 세션이 종료된다).
- CLI `native/agent-cli.swift`:
  - `methods` 에 `"session.wait": ["session","timeout"]` 를 추가한다.
  - 파싱에서 `timeout` 은 `Int`, 범위 1000-25000. 필수 검사(`:51`)에서 `after` 처럼 선택 인자로 둔다(`$0 != "after" && $0 != "timeout"`).
  - usage(`:15-16`)를 `promeftp session status|close|wait --session ID [--timeout MS]` 로 고친다.

### S.종료사유 (스킬·`endNext` 공통)
| reason | 의미 | 에이전트 행동(next) |
|---|---|---|
| `AUTH_TIMEOUT` | 사용자가 시간 안에 인증(OTP 등)을 끝내지 않음 | `ask_user`: 준비됐는지 물은 뒤 새 세션을 한 번 연다 |
| `USER_CANCELLED` | 사용자가 인증을 취소함 | `ask_user`. 재시도 금지 |
| `IDLE_TIMEOUT` | 10분 동안 요청이 없음 | `retry`: 필요하면 새 세션(OTP를 다시 요구할 수 있음) |
| `CLIENT_CLOSED` | 에이전트가 닫음 | 없음 |
| `TIMEOUT` | 요청 하나가 30초를 넘김 | `retry`: 더 작은 작업으로 새 세션 |
| `CONNECT_FAILED` | 접속/인증/호스트 키 실패 | `error.next` 를 따른다 |
| `REMOTE_CLOSED` | 서버가 연결을 끊음 | `retry` 1회 |
| `PERMISSION_CHANGED` | 사용자가 권한을 바꿈 | `ask_user` |
| `SERVICE_DISABLED` | 에이전트 접근이 꺼짐 | `ask_user` |

## S.동작 흐름
1. open → `connecting`. `authDeadline = opened + authWindow`.
2. 이벤트 `prompt`(`agent-service.cjs:162-166`)로 `waiting_for_user` 가 될 때 `s.authDeadline = Math.min(s.opened + authCeiling, Math.max(s.authDeadline, Date.now() + promptWindow))` 로 늘린다. 호스트 키 확인 다이얼로그는 transport 안에서 처리되어 prompt 이벤트가 오지 않으므로, 다이얼로그 뒤의 OTP 질문에서 연장된다.
3. 상태가 바뀔 때마다(`s.status = ` 대입 4곳 `:157, :164, :175, :576`, 그리고 `end()`) `wake(s)` 를 호출한다. `wake` 는 `s.waiters` 의 resolve를 모두 호출하고 비운다.
4. 사용자가 앱에서 OTP를 입력하면 `connecting` → `ready` 가 된다. 에이전트는 같은 세션으로 작업한다.
5. 에러 흐름은 이렇다.
   - 한도가 지나면 기존처럼 `AUTH_TIMEOUT`.
   - wait 중 세션이 끝나면 closed 응답.
   - wait 중 소켓이 닫히면 waiter를 제거한다(리스너가 새지 않게 `finally` 에서 delete).

## S.스킬 변경 (`skills/promeftp/SKILL.md`)
2·3단계를 아래 내용으로 바꾸고, "Session lifecycle" 하위 목록을 추가한다(영어). 핵심 문장은 다음과 같다.
- Open one session per profile and reuse it for every command and file operation. Do not open a new session per command.
- Status table:
  - `connecting`: keep waiting.
  - `waiting_for_user`: tell the user once that PromeFTP is waiting for their answer (for example an OTP), then keep waiting.
  - `ready`: work.
  - `closed`: read `reason`/`error`.
- Wait with `promeftp session wait --session ID --json` (returns within 25 seconds), or poll `session status` every 2-5 seconds. Keep waiting until the status changes or `expires` passes. Never treat `connecting` or `waiting_for_user` as a failure.
- Never close or reopen a session while it is `connecting` or `waiting_for_user`; reopening asks the user for a new OTP.
- A session closes after 10 minutes without requests (`IDLE_TIMEOUT`). If you will continue soon, keep it; any request, including `session status`, keeps it open. When the task is done, close it.
- 종료 사유 표(S.종료사유)를 요약해 넣는다.
- 기존 "Treat any authentication or trust failure as a stop" 은 "Treat a closed session with an authentication or trust failure as a stop" 으로 고쳐, 대기 상태와 구분한다.

같은 내용을 `docs/AGENTS.md`(53행 근처 CLI 예시), `docs/TROUBLESHOOTING.md`(AUTH_TIMEOUT, "에이전트가 OTP 전에 실패" 항목), `llms.txt`, `llms-full.txt` 에 반영한다. 스킬 매니페스트 서명이 있으면 RELEASE 절차대로 다시 서명한다.

## S.구현 체크리스트
- [ ] S1: `agent-service.cjs` 를 고친다.
  - 상수 4개를 추가한다.
  - `startSession` 에 `opened`, `waiters` 를 넣고, `authDeadline: opened + authWindow` 로 바꾼다.
  - `wake(s)` 함수를 추가하고 상태 대입 4곳과 `end()` 에서 호출한다.
  - 확인: 테스트 "status change wakes waiters".
- [ ] S2: prompt 이벤트 처리(`:162-166`)에 S.동작 흐름 2의 연장식을 넣는다. 확인: 테스트 "prompt extends deadline, capped at 600s".
- [ ] S3: `session.status` 응답 생성을 함수 `statusOf(s)` 로 빼서 S.데이터 형태를 만든다(`WAIT_MESSAGES`, `retryAfter`, `next`). 끝난 세션 경로(`:295-300`)는 `endNext` 를 붙인다. 확인: 테스트.
- [ ] S4: `session.wait` 를 추가한다.
  - `operations` Set(`:258`)과 `allowed` 표(`:269`)에 `'session.wait': ['session','timeout']` 를 넣는다.
  - 끝난 세션 조회 분기(`:295`) 목록에 `session.wait` 를 넣는다.
  - work는 `new Promise(resolve => { s.waiters.add(resolve); setTimeout(resolve, timeout) })` 다음 `statusOf(s)` 이고, `finally` 에서 waiter를 제거한다.
  - `activeSession` 은 설정하지 않는다.
  - 확인: 테스트 3건(즉시 반환, 변경 시 반환, timeout 반환, 그리고 30초 TIMEOUT으로 세션이 끝나지 않음).
- [ ] S5: `native/agent-cli.swift` 의 methods, 파싱, 필수 검사, usage를 고친다(S.데이터).
  - 수동 빌드 확인(스크래치 경로에 출력하고, 앱 번들은 건드리지 않는다):
    ```sh
    out=$(mktemp -d)
    xcrun swiftc -target arm64-apple-macosx13.0 -O native/agent-cli.swift -o "$out/promeftp"
    "$out/promeftp" --help | grep -q "session status|close|wait"
    "$out/promeftp" session wait --session X --timeout 999 --json; echo "exit=$?"   # 기대: USAGE, exit=2
    "$out/promeftp" session wait --session X --timeout 25001 --json; echo "exit=$?" # 기대: USAGE, exit=2
    "$out/promeftp" session wait --json; echo "exit=$?"                             # 기대: USAGE, exit=2 (session 누락)
    ```
  - 이 확인은 앱 실행이나 토큰 없이 할 수 있다. 파싱 단계에서 USAGE로 끝나기 때문이다(`agent-cli.swift:27-51`, 토큰 검사는 그 뒤).
  - 앱이 켜져 있고 토큰이 있으면 `"$out/promeftp" session wait --session <ID> --json` 이 25초 안에 JSON을 반환하는지도 확인한다.
- [ ] S6: `skills/promeftp/SKILL.md`, `docs/AGENTS.md`, `docs/TROUBLESHOOTING.md`, `llms.txt`, `llms-full.txt` 를 갱신한다(S.스킬 변경). 확인: `test/doc-links.test.cjs`, `test/agent-skills.test.cjs`.
- [ ] S7: `test/agent-service.test.cjs` 를 새로 만든다(아래). `npm test` 전체 통과.

## S.테스트 계획
`test/agent-service.test.cjs`:
- `createAgentService` 를 임시 디렉터리(`fs.mkdtemp(os.tmpdir())`)로 만든다. `node:sqlite` 는 사용한다.
- 가짜 `transport.connect(p, grant, mode, notify)` 는 notify를 붙잡아 두고 테스트가 이벤트를 발생시킨다.
- 요청은 서비스가 노출한 내부 `execute` 경로 또는 소켓 클라이언트로 보낸다. 노출 함수가 없으면 `createAgentService` 반환에 테스트 전용 export를 추가하지 말고, `listen()` 후 실제 Unix 소켓(임시 경로)으로 JSON 요청을 보낸다. 구현자는 먼저 `agent-service.cjs` 의 `listen`/요청 프로토콜을 읽고 따른다.
- 시간은 `node:test` 의 `mock.timers.enable({ apis: ['Date','setTimeout','setInterval'] })` 로 제어한다.

케이스:
- 정상: open → status가 `connecting` 이고 `next[0].action==='wait'`, `retryAfter===2`, `expires===opened+120000`.
- prompt 이벤트 → `waiting_for_user`, expires가 now+180000으로 늘어남.
- 경계: open 후 590초에 prompt → expires = opened+600000(상한).
- 정상: ready 이벤트 → status ready, `expires`·`next` 없음.
- 비정상: 시간 경과 후 `AUTH_TIMEOUT`. 그 뒤 status가 `{status:'closed', reason:'AUTH_TIMEOUT', next:[{action:'ask_user'}]}`.
- wait: ready 상태면 즉시 반환. connecting에서 대기 중 ready 이벤트가 오면 그 상태로 반환. 변화 없이 timeout 5000 → connecting 반환. 30초 경과 후에도 세션이 살아 있음.
- wait 입력: `timeout: 999`, `30000`, `'5000'` → INVALID_REQUEST. 빈 값(없음) → 25000.
- 끝난 세션 wait → 즉시 closed.
- 사람 인증 경로 무영향: `answer()` 가 연장된 deadline 안에서 동작한다.

## S.수용 기준
1. `npm test` 가 통과한다(신규 `test/agent-service.test.cjs` 포함).
2. 인증 질문이 뜬 뒤 최소 180초 동안은 `AUTH_TIMEOUT` 이 나지 않는다. 어떤 경우에도 open 후 600초를 넘기지 않는다(테스트).
3. ready 전 `session.status` 응답에 `next[0].action==='wait'`, `retryAfter`, `expires` 가 있다. 닫힌 세션 응답에는 사유별 `next` 가 있다(S.종료사유 표의 모든 사유 매핑).
4. `session.wait` 는 25초 안에 반환하고, 상태 변화 후 1초 안에 반환한다. 이 호출이 세션을 `TIMEOUT` 으로 끝내지 않는다(테스트).
5. SKILL.md에 상태 표, 대기 방법, "connecting/waiting_for_user에서 닫거나 다시 열지 말 것", 세션 재사용, 10분 유휴 규칙, 종료 사유 표가 있다(리뷰어가 문서로 확인).
6. CLI는 `session wait` 를 지원하고, timeout 범위 밖이나 session 누락은 USAGE(exit 2)다. S5의 swiftc 명령으로 확인한다.

## S.확정된 결정
- S.D1: `session.wait` 를 추가한다. 최대 25초, `activeSession`/`inFlight` 로 잡지 않는다.
- S.D2: 질문 대기 연장은 180초, 상한은 open + 600초다.
- S.D3: 유휴 한도는 10분 그대로다. 스킬에서 유지/종료 방법을 안내한다.

## S.결정 필요
(없음)
