# PromeFTP 정리·리팩터링 설계 (1.1.7 이후)

## 목표
1.1.7 안정화 이후, 동작을 바꾸지 않고 (1) 폴더·파일 정리 (2) 코드 스멜 정리 (3) 성능 최적화를 한다. 대상은 유지보수자와 공개 저장소 기여자다. 이후 기능 작업(1.1.8)을 안전하게 하려고 특성화 테스트 기반을 먼저 만든다.

## 범위
포함
- 특성화 테스트 추가 (main.cjs 순수 함수, transfer-service, directory-compare, path-favorites, terminal-triggers, openssh 파서, preload↔main IPC 목록 일치)
- main.cjs의 순수 함수를 Electron 비의존 모듈로 추출 (단계별)
- 확인된 죽은 코드·중복 파일 제거 (결정 필요 항목은 결정 후)
- 깨진 문서 링크 수정
- 측정 근거가 있는 성능 개선 2건 (전송 큐 렌더, 로컬 디렉터리 비교 목록)

제외 (하지 말 것)
- 사용자에게 보이는 문구·동작·단축키 변경, localization.js 문구 변경
- `userData/profiles.json` 구조, 에이전트 API·CLI JSON 형식 변경
- Sparkle 경로 이동: `updates/appcast-arm64.xml`, `updates/beta/appcast-arm64.xml`, `updates/agent-skills.json`, `updates/public-key.txt`, `updates/code-signing-sha1.txt`
- `docs/RELEASE.md`가 참조하는 경로 변경: `build-macos.sh`, `native/update.mm`, `scripts/*`, `updates/public-key.txt` (스크립트 파일 위치는 불변. `scripts/sign-release.py` 내부의 소스 경로 한 줄만 I1-1에서 수정)
- 최상위 소스 파일을 `src/` 등으로 옮기는 일 (평면 배치 유지)
- renderer.js 분할
- `llm.txt` 삭제 (유지)
- 앱 번들 내부 경로 `Resources/app/agent-skills/promeftp/SKILL.md`와 `agent-skills.cjs:14`가 읽는 경로 변경
- `docs/design/HANDOFF-1.1.8.md`의 이월 기능 수정
- 의존성 버전 변경, ESLint 등 린터·포매터 도입 (`node --check` 문법 검사는 허용, I0-6)

## 현황 진단 (근거)

### 파일 배치
| 항목 | 근거 | 판단 |
|---|---|---|
| `agent-skills/promeftp/SKILL.md`와 `skills/promeftp/SKILL.md`가 바이트 단위 동일 (`diff -r` 결과 동일) | `build-macos.sh:24`는 `agent-skills/`만 번들에 복사 | `skills/`가 원본: 서명된 `updates/agent-skills.json`이 `https://raw.githubusercontent.com/PROMLEE/promeftp/v1.1.7/skills/promeftp/SKILL.md`를 가리킴. 소스 `agent-skills/`는 삭제하고 빌드가 `skills/promeftp`를 번들 내부 `agent-skills/promeftp`로 복사. 소스 경로 참조처: `build-macos.sh:24`, `scripts/sign-release.py:107`. 앱 코드 `agent-skills.cjs:14`는 번들 내부 경로를 읽으므로 불변 |
| `llm.txt`와 `llms.txt`가 동일 | 문서 내 `llm.txt` 참조 없음 | 유지 (공개 URL 보존) |
| 빈 폴더 `assets/` | `ls -la assets` 비어 있음, 빌드 미사용 (`build-macos.sh:20-24`) | git은 빈 폴더를 추적하지 않으므로 로컬 잔재. 삭제(작업 트리만) |
| `TODO.md:5`가 존재하지 않는 `docs/design/SFTP-WORKFLOW.md`를 링크 | `ls docs/design` = HANDOFF-1.1.7/1.1.8, UX-1.1.6 | 깨진 링크. 가리킬 문서가 없으므로 `See ... SFTP workflow design ...` 문장 전체를 삭제(체크 항목 본문은 유지) |
| 최상위에 소스 20여 개가 평면 배치 | `build-macos.sh:20` cp 목록에 파일명 하드코딩, `index.html:9-16`이 `node_modules/...` 상대경로 로드, `test/i18n-keys.test.cjs`의 `codeKeys()`가 `readdirSync(root)`로 **최상위만** 스캔 | 이동 시 빌드·i18n 테스트가 조용히 깨짐. 재배치하지 않음(평면 유지) |
| `make-icon.swift`, `app-icon.svg`가 최상위 | `build-macos.sh:20,30`에서 참조 | 이동하지 않음 |

### 죽은 코드 후보
preload에 노출되었지만 어떤 렌더러(renderer.js, preferences.js, agent-preferences.js, ui-controls.js)도 호출하지 않는 IPC (문자열 검색 결과):
- `show-about` (`main.cjs:504`), `set-appearance` (`main.cjs:556`), `save-sftp-favorites` (`main.cjs:146`), `forget-ssh-password` (`main.cjs:587`), `copy-remote` (`main.cjs:1436`)
- 설계 시점 grep(main.cjs, preload.cjs, renderer.js, preferences.js, agent-preferences.js, ui-controls.js, agent-service.cjs) 결과, 5개 모두 등장 위치가 선언뿐이다: `preload.cjs:5`(show-about, set-appearance) 또는 `preload.cjs:6`(나머지 3개), `main.cjs:95`의 `preferencesMethods`(show-about만), 각 `handle(...)` 정의 줄. 메뉴(`buildApplicationMenu`, `main.cjs:1713`)는 `openPreferences`를 직접 부른다.
- 동적 호출 확인: `renderer.js:2943` `api[method]`는 `runTransferControl`에서만 쓰이며 method 값은 `'transfer-control'`, `'transfer-batch-control'` 두 가지뿐이다. 따라서 5개는 동적 호출 대상도 아니다.
- 최종 삭제는 I5-1에서 구현 시점에 다시 grep한 결과로 판정한다(호출처가 하나라도 있으면 유지).
- `preload.cjs:1`의 methods 배열 파싱 시 'electron'이 섞여 보인 것은 require 문자열이며 문제 아님.

### 과대 함수·중복
- `renderer.js` 3958줄, 최상위 함수 124개. `setupFiles` (`renderer.js:2092`) 약 816줄, `setupTerminal` (`renderer.js:1838`) 약 166줄, `showFolderCompare` (`renderer.js:2947`) 약 138줄, `makeTab` (`renderer.js:1305`) 약 118줄.
- `main.cjs` 1972줄, `handle(...)` 107개가 최상위에 나열. 긴 핸들러: `connect` (`main.cjs:752`, 약 97줄 이상), `sftp` (`main.cjs:1516`, 약 150줄), `disconnect` 블록 (`main.cjs:864` 이후 약 140줄에 인증 프롬프트 함수 포함), `context-menu` (`main.cjs:1034`).
- main.cjs의 순수 로직이 `require('electron')`(`main.cjs:1`) 뒤에 있어 테스트 불가: `profile` (`main.cjs:76`), `bookmarkFolderName` (`main.cjs:120`), `workspaceName` (`main.cjs:276`), `snippetScope` (`main.cjs:352`), `normalizedAuthQuestion` (`main.cjs:699`), `matchesGlobalPattern`/`globalPattern` (`main.cjs:642-652`), `recordKey` (`main.cjs:1657`), `comparisonAdapter` (`main.cjs:1312`). (단, `recordKey`는 `state` 전역과 파일 쓰기에 의존하므로 추출 대상 아님, main.cjs 유지)
- `const byId = id => document.getElementById(id)` 중복: `renderer.js:2`, `preferences.js:2`. 서로 다른 HTML에서 로드되므로 중복은 허용 범위(통합은 ui-controls.js로 옮기면 가능하나 이득 작음 → 하지 않음).
- `expandHome`(`main.cjs:64`)가 `app.getPath('home')`에 의존 → 추출 시 home을 인자로 받도록 해야 함.

### 성능 핫스팟
1. 전송 진행률: `transfer-service.cjs:134`가 120ms마다 전체 `snapshot()`을 보내고, `renderer.js:1622` → `renderTransferQueue` (`renderer.js:3248`)가 매번 목록 DOM을 다시 만든다(스크롤·포커스·열린 배치를 수동 복원, `renderer.js:3256-3259`). 작업 수가 많을 때 비용이 선형으로 커짐.
2. 로컬 비교 목록: `comparisonAdapter` local `list` (`main.cjs:1316-1320`)가 `readdir` 후 항목마다 `lstat`을 무제한 `Promise.all`로 실행. 큰 폴더에서 파일 디스크립터·이벤트 루프 압박. 조치 근거는 속도가 아니라 큰 폴더에서 동시 `lstat` 수 상한(EMFILE 방지)이다. 측정상 속도 이득은 없었다.
3. 상태 저장: `updateState` (`main.cjs:44`)가 변경마다 `structuredClone(state)` + 들여쓰기 JSON 전체 쓰기. 직렬화되어 있어 정합성은 안전하며 빈도가 낮아 **변경하지 않는다**(형식 보존 요건과 충돌).
4. 키 진단 로그: `main.cjs:1659-1663`이 키 입력마다 최대 200줄 전체 파일을 다시 씀. 진단 모드에서만 동작하므로 우선순위 낮음, 이번 범위 제외.

### 테스트 현황
- `npm test` = `test/classify-ssh-failure.test.cjs`, `test/i18n-keys.test.cjs` (16 pass, 확인함). `package.json` scripts.test가 파일을 개별 나열하므로 새 테스트를 추가할 때 목록 갱신이 필요.

## 구조
새로 만들 파일 (모두 최상위, 기존 평면 배치 유지)
- `state-rules.cjs` — main.cjs에서 추출한 순수 검증·정규화 함수(`profile`, `bookmarkFolderName`, `bookmarkFolderNames`, `workspaceName`, `snippetScope`). Electron require 금지. `expandHome`은 `expandHome(value, home)` 형태로 이 모듈에 둔다.
- `auth-rules.cjs` — `normalizedAuthQuestion`, `globalPattern`, `matchesGlobalPattern`(WeakMap 캐시 포함). Electron require 금지.
- `test/state-rules.test.cjs`, `test/auth-rules.test.cjs`, `test/transfer-service.test.cjs`, `test/directory-compare.test.cjs`, `test/path-favorites.test.cjs`, `test/terminal-triggers.test.cjs`, `test/ipc-surface.test.cjs`

수정할 파일
- `main.cjs` — 추출한 함수를 require로 대체. 함수 본문 외 변경 금지.
- `build-macos.sh:20` — cp 목록에 새 `.cjs` 파일 추가 (누락 시 앱 실행 즉시 실패).
- `package.json` scripts.test — `node --test test/` 형태로 바꿔 신규 테스트 자동 포함 (Node 20+ 디렉터리 실행 지원. 실패 시 파일 나열 유지).
- `build-macos.sh:24` — `ditto agent-skills "$resource/agent-skills"`를 `mkdir -p "$resource/agent-skills"` + `ditto skills/promeftp "$resource/agent-skills/promeftp"`로 변경.
- `scripts/sign-release.py:107` — `ROOT / 'agent-skills/promeftp/SKILL.md'`를 `ROOT / 'skills/promeftp/SKILL.md'`로 변경. 출력 경로(`output / 'skills/promeftp'`)와 manifest 형식은 불변.
- 삭제: `agent-skills/` 소스 폴더 전체.
- `test/syntax.test.cjs` — 최상위 `.js`/`.cjs`와 `test/*.cjs`에 `node --check` 실행.
- `TODO.md:5` — 줄 끝의 문장 `See [SFTP workflow design](docs/design/SFTP-WORKFLOW.md).`를 통째로 삭제(가리킬 문서 없음). 그 앞의 체크 항목 문장은 유지.
- `docs/design/CLEANUP.md` — 이 문서. 단계 1 커밋에 함께 포함한다.
- `renderer.js` — 성능 단계에서 `renderTransferQueue`만 수정.

## 데이터·인터페이스
```js
// state-rules.cjs
module.exports = {
  expandHome(value: string, home: string): string,
  profile(input: object, home: string): Profile,          // main.cjs:76과 동일 결과·동일 에러 메시지
  bookmarkFolderName(value: unknown): string,
  bookmarkFolderNames(snapshot: State): Set<string>,
  workspaceName(value: unknown): string,                   // 원본 시그니처 유지, 외부 상태 필요 시 인자로 추가
  snippetScope(context: object): ...,                      // 원본과 동일
};
// auth-rules.cjs
module.exports = { normalizedAuthQuestion, globalPattern, matchesGlobalPattern };
```
- main.cjs 쪽은 기존 이름을 유지하는 얇은 래퍼를 둔다: `const profile = input => rules.profile(input, app.getPath('home'));` → 호출부 수정 0.
- 추출 함수가 `state` 전역을 읽으면 추출하지 않고 체크리스트에 "보류"로 기록한다(구현자가 판단하지 말 것).
- 에러 메시지 문자열은 한 글자도 바꾸지 않는다(렌더러가 번역 키로 쓴다).

## 동작 흐름
- 정상: 모든 IPC·저장 흐름은 현재와 동일. 추출은 순수 함수 호출 경로만 바뀐다.
- 에러: 기존 `throw Error('...')` 메시지·타입 동일. `handle()` 신뢰 검사(`main.cjs:104-110`) 불변.

## 구현 체크리스트
단계마다 별도 커밋·별도 리뷰. 각 단계 끝에 `npm test` 통과 + 수동 스모크(S) 필수.

수동 스모크 S: `npm start` → 프로필 저장·편집 → SSH 연결·터미널 입력 → SFTP 목록·업로드 1건·다운로드 1건 → 폴더 비교 열기 → 환경설정 창 열기 → 에이전트 탭 열기. 오류 대화상자·콘솔 예외 없음.

### 단계 0: 테스트 기반 (코드 변경 없음)
- [ ] I0-1: `package.json` test 스크립트를 디렉터리 실행으로 변경. 검증: 기존 16개 그대로 pass.
- [ ] I0-2: `test/ipc-surface.test.cjs` — `main.cjs`의 `^handle\('name'` 집합 == `preload.cjs` methods 집합, `preferencesMethods`(main.cjs:93 부근) ⊆ handle 집합. 검증: 현재 코드에서 pass.
- [ ] I0-3: `test/transfer-service.test.cjs` — 임시 디렉터리 file/historyFile, 가짜 `execute`로 enqueue→완료, 실패→재시도, 취소, 영속 파일 `version: 2` 형식(`transfer-service.cjs:26`)과 `cancel/active/progressSample/shutdown` 필드가 저장되지 않음을 고정. 검증: pass.
- [ ] I0-4: `test/directory-compare.test.cjs`, `test/path-favorites.test.cjs`, `test/terminal-triggers.test.cjs` — 각 모듈 export의 현재 출력 고정(정상/빈 입력/경계값). 검증: pass.
- [ ] I0-6: `test/syntax.test.cjs` — 최상위 `*.js`, `*.cjs`, `test/*.cjs` 각각에 `execFileSync(process.execPath, ['--check', file])`. 검증: 현재 코드에서 pass, 일부러 문법 오류를 넣으면 fail.
- [ ] I0-5: `test/openssh.test.cjs` — `openssh.cjs:275` export 중 프로세스를 띄우지 않는 함수만(파서류) 고정. spawn하는 함수는 제외. 검증: pass.

### 단계 1: 파일 정리
- [ ] I1-1: `agent-skills/` 소스 폴더 삭제, `skills/promeftp/SKILL.md`를 원본으로 유지. `build-macos.sh:24`와 `scripts/sign-release.py:107`을 위 구조대로 수정. `agent-skills.cjs:14`는 수정하지 않는다. 검증: (a) `grep -rn "agent-skills/" --exclude-dir=node_modules .`에서 남는 것은 `agent-skills.cjs:14`(번들 내부 경로)와 `build-macos.sh`의 `$resource/agent-skills` 대상 경로, 이 문서뿐 (b) 빌드 산출 번들의 `Contents/Resources/app/agent-skills/promeftp/SKILL.md`의 `shasum -a 256` 값 == `skills/promeftp/SKILL.md` 값 (c) 빌드 앱에서 환경설정 에이전트 탭의 스킬 설치가 정상.
- [ ] I1-2: `llm.txt`는 유지(변경 없음). 검증: `git diff --stat`에 llm.txt 없음.
- [ ] I1-3: `TODO.md:5`에서 `See [SFTP workflow design](docs/design/SFTP-WORKFLOW.md).` 문장 전체 삭제(앞부분 항목 문장 유지). 검증: `grep -n "SFTP-WORKFLOW\|SFTP workflow design" TODO.md` 0건, I1-4 링크 테스트 pass.
- [ ] I1-4: 링크 검사 — README*.md, CONTRIBUTING.md, TODO.md, docs/**/*.md, llms*.txt의 상대 링크 대상이 모두 존재. 검증 명령을 `test/doc-links.test.cjs`로 추가해 `npm test`에 포함.

### 단계 2: auth-rules 추출 (작음)
- [ ] I2-1: 먼저 `test/auth-rules.test.cjs`를 main.cjs에서 복사한 함수 기준 기대값으로 작성(접두 `(user@host) ` 제거, 512자 경계, 와일드카드 규칙, 잘못된 패턴 → false).
- [ ] I2-2: `auth-rules.cjs` 생성, main.cjs에서 해당 함수 삭제 후 require. `build-macos.sh:20`에 추가. 검증: `npm test` pass, `grep -n "function normalizedAuthQuestion" main.cjs` 0건, S 통과(키보드 인터랙티브 서버가 있으면 저장 응답 자동 입력 확인).

### 단계 3: state-rules 추출
- [ ] I3-1: 테스트 먼저 — `profile`: 빈 host, `-` 시작, 공백 포함, port 0/1/65535/65536/null, usesAlias+hostname 허용·거부, `~/` 확장. `bookmarkFolderName`: 빈 값, 80자, 81자, 앞뒤 공백. 나머지 함수는 현재 출력 고정.
- [ ] I3-2: 추출, main.cjs에는 래퍼만. `build-macos.sh:20` 갱신. 검증: `npm test` pass, main.cjs 줄 수 감소, S 통과, 기존 profiles.json으로 실행 시 북마크 전부 표시.

### 단계 4: 성능
- [ ] I4-1: `comparisonAdapter` local list(`main.cjs:1316-1320`)의 `lstat`을 동시성 32로 제한. 헬퍼 `mapLimited(items, limit, fn)`(결과 순서 보존)는 **main.cjs 안에** 두고 새 파일을 만들지 않는다. 목적은 큰 폴더에서 동시 `lstat` 수 상한(EMFILE 방지)이며, 측정상 속도 이득은 없었다(PR에 그대로 기록). 검증: 단위 테스트 대신 차등 검사 — 임시 폴더에 파일 500개를 만들고 변경 전·후 앱에서 실제 `compare-start` IPC로 같은 비교를 실행해 결과(항목 목록·분류)가 동일함을 확인, S의 폴더 비교 정상.
- [ ] I4-2: `renderTransferQueue`에서 job id 기준으로 기존 행을 재사용하고 진행률·상태 텍스트만 갱신(행 구조가 바뀌는 상태 전이일 때만 `transferRow` 재생성). 스크롤·포커스·열린 배치 복원 동작 유지. 검증: 수동 — 파일 50개 업로드 중 드로어 스크롤·포커스 유지, 완료/실패/재시도 표시 동일, DevTools Performance에서 진행 중 프레임당 스크립트 시간이 변경 전보다 감소(수치를 PR에 기록).

### 단계 5: 죽은 IPC 정리
- [ ] I5-1: 아래 5개 각각에 대해 구현 시점에 `grep -n "<name>" main.cjs preload.cjs renderer.js preferences.js agent-preferences.js ui-controls.js agent-service.cjs agent-transport.cjs`를 실행하고, `api[` 동적 호출(`renderer.js:2943` 등)의 값 목록도 다시 확인한다. 선언(preload 목록, `preferencesMethods`, `handle` 정의) 외에 호출이 하나도 없을 때만 삭제한다. 하나라도 있으면 유지하고 PR에 근거 줄을 적는다.

| IPC | 설계 시점 등장 위치 (선언만) | 조치 |
|---|---|---|
| `show-about` | `preload.cjs:5`, `main.cjs:95`, `main.cjs:504` | 삭제(3곳 모두) |
| `set-appearance` | `preload.cjs:5`, `main.cjs:556` | 삭제 |
| `save-sftp-favorites` | `preload.cjs:6`, `main.cjs:146` | 삭제 (`pathFavorites`의 다른 핸들러·모듈 함수는 유지) |
| `forget-ssh-password` | `preload.cjs:6`, `main.cjs:587` | 삭제 (핸들러 안에서만 쓰이던 헬퍼는 다른 호출처가 없을 때만 삭제) |
| `copy-remote` | `preload.cjs:6`, `main.cjs:1436` | 삭제 (위와 같은 헬퍼 규칙) |

  검증: I0-2 테스트 pass, 각 이름의 `grep -rn "'<name>'"`가 0건(이 문서 제외), `npm test` pass, S 통과(환경설정 정보 탭, 테마 변경, SFTP 즐겨찾기 추가·삭제, 비밀번호 저장 프로필 연결, 원격 간 복사 메뉴가 있다면 동작).

## 테스트 계획
- 정상: 각 모듈의 대표 입력과 현재 출력 스냅숏.
- 경계값: port 1/65535, 폴더명 80자, 질문 접두 512자, 빈 디렉터리 비교, 전송 큐 0건.
- 비정상: 잘못된 host, 잘못된 정규식 규칙, execute가 throw, 존재하지 않는 경로.
- 빈 값: `''`, `undefined` 필드, 빈 profiles 배열·bookmarkFolders 없음.
- 목데이터: `test/fixtures/` 아래 `profiles-sample.json`(가짜 호스트 `example.invalid`만 사용, 실제 사용자 데이터 금지), 임시 디렉터리는 `fs.mkdtemp(os.tmpdir())`로 생성 후 정리.
- 테스트는 Electron 없이 `node --test`로 실행 가능해야 한다.

## 수용 기준
- `npm test`가 모두 pass하고, 테스트 수가 16개보다 많다.
- `git diff`에 localization.js 문구, `updates/` 아래 파일, `native/update.mm`, `docs/RELEASE.md`, `llm.txt` 변경이 없다. `scripts/`의 변경은 `sign-release.py:107` 한 줄뿐이다.
- `agent-skills/` 소스 폴더가 없고, 빌드 번들의 `agent-skills/promeftp/SKILL.md` sha256이 `skills/promeftp/SKILL.md`와 같다.
- `npm test`에 `node --check` 문법 검사가 포함된다.
- `docs/design/CLEANUP.md`가 커밋에 포함된다.
- 추출된 모듈은 `require('electron')`을 포함하지 않는다(`grep` 0건).
- `build-macos.sh:20` cp 목록에 모든 신규 `.cjs`가 있고, 빌드한 앱에서 S 통과.
- 문서 링크 테스트 pass(깨진 상대 링크 0건).
- 각 단계 PR에 S 수행 결과가 적혀 있다. 단계 4 PR에는 성능 전후 수치가 있다.
- profiles.json을 변경 전 버전과 교차로 열어도(구버전→신버전→구버전) 데이터 손실 없음.

## 리스크
- 신규 파일을 `build-macos.sh` cp 목록에 빠뜨리면 배포 앱이 시작 시 크래시 → 수용 기준에 포함, 빌드 산출물 스모크 필수.
- i18n 테스트는 최상위 파일만 스캔하므로 새 모듈은 반드시 최상위에 둔다(하위 폴더면 번역 누락이 검출되지 않음).
- 렌더러 DOM 재사용(I4-2)은 포커스·접근성 회귀 가능성이 가장 큼 → 단독 PR, 되돌리기 쉬운 단위.
- 에러 메시지 변경은 번역 매칭을 깨뜨림 → 문자열 불변.
- 공개 저장소: 테스트 픽스처에 실제 호스트·사용자명 금지.
- `sign-release.py` 경로 수정을 빠뜨리면 다음 릴리스 서명이 실패한다(FileNotFoundError) → I1-1 검증 (a)의 grep으로 차단.
- manifest의 원격 URL(`skills/promeftp/SKILL.md`)은 태그 기준이라 소스 정리와 무관하지만, `skills/` 경로를 옮기면 이후 릴리스가 깨진다 → `skills/`는 이동 금지.

## 결정 필요
없음.
