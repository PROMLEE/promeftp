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
- 사람 확인 없이 바뀐 호스트 키를 자동 수락하는 옵션(선택지 b)을 만들지 않는다.
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
- D4: "호스트 키 변경 자동 수락" 옵션은 만들지 않는다.

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
