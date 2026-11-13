# PromeFTP macOS 릴리스 운영 가이드

Apple Silicon용 설치 DMG, Sparkle 업데이트 ZIP, 두 파일의 SHA-256 체크섬, 서명된 appcast를 GitHub에 게시하는 절차다. 1.0.4에서 검증한 기본 절차와 1.0.7에서 검증한 업로드 복구 절차를 포함한다. 명령의 예시 버전은 이번에 배포할 버전으로 바꾼다.

## 1. 작업 위치와 전제 조건

| 항목 | 역할 |
| --- | --- |
| `work/promeftp` | 로컬 앱 소스. `package.json`, `build-macos.sh`, `native/update.mm`, `scripts/`, `updates/public-key.txt`가 있어야 한다. Git 체크아웃이 아닐 수 있다. |
| `work/publish-104` | 1.0.4에서 사용한 공개 저장소 체크아웃. `PROMLEE/promeftp`의 `main`에는 공개 문서와 업데이트 피드가 있다. 다음 배포에는 최신 `main`을 새로 체크아웃한다. |
| `outputs` | 사용자에게 전달하는 산출물. 빌드 중간 파일과 Sparkle 도구는 `work` 아래에 둔다. |

Apple Silicon Mac, Xcode Command Line Tools, Node.js와 npm, Python 3.11 이상, Git, GitHub 저장소 쓰기 권한이 필요하다. Node.js 개발 헤더에 `node_api.h`가 있어야 한다. 1.0.4는 기존 Sparkle 2.10.1과 앱의 잠금 파일에 있는 Electron 45.2.3으로 빌드했다. 다음 버전에서도 의도적으로 변경한 경우에만 의존성 버전을 바꾼다.

아래는 Bash에서 이 작업 공간의 최상위 폴더를 열고 실행하는 예시다. 같은 셸에서 순서대로 실행한다.

```bash
set -euo pipefail
export VERSION=1.0.5  # 예시. 배포할 버전으로 바꾼다.
ROOT="$PWD"
SRC="$ROOT/work/promeftp"
STAGE="$ROOT/work/release-stage-$VERSION"
PUBLIC="$STAGE/public"
ARTIFACTS="$STAGE/assets"
BUNDLE="$STAGE/PromeFTP.app"
REPO=PROMLEE/promeftp
TAG="v$VERSION"
PREFIX="PromeFTP-$VERSION-macos-arm64"

mkdir -p "$STAGE" "$ARTIFACTS"
if [ ! -d "$PUBLIC/.git" ]; then
  git clone https://github.com/PROMLEE/promeftp.git "$PUBLIC"
fi
git -C "$PUBLIC" ls-remote --tags origin "refs/tags/$TAG"
```

마지막 명령이 태그를 반환하면 기존 릴리스 상태를 먼저 확인한다. 이미 공개된 버전의 파일을 다시 빌드해 덮어쓰면 기존 체크섬과 Sparkle 서명이 맞지 않는다.

## 2. 버전과 릴리스 노트

1. `SRC`에서 `npm version "$VERSION" --no-git-tag-version`으로 `package.json`과 `package-lock.json`을 함께 갱신한다. 이미 두 파일의 버전이 맞으면 생략한다.
2. `docs/releases/$VERSION.md`에 영어 릴리스 노트를 작성한다. 사용자에게 보이는 변경, 사용 위치, 필요한 업데이트 조치를 적는다.
3. 같은 폴더에 `$VERSION.appcast.json`을 작성한다. `heading`, `summary`, `changes`(제목과 설명의 쌍 배열), `notice`를 채운다. 서명 스크립트가 이 파일을 Sparkle 업데이트 창의 HTML로 변환한다. `1.0.4.appcast.json`을 형식 예시로 사용한다.
4. 공개 체크아웃에는 릴리스 노트 두 파일, README와 설치·사용·업데이트 가이드, `llm.txt`, `llms.txt`, `llms-full.txt`의 관련 변경만 반영한다. 앱 소스 트리 전체를 공개 저장소로 복사하지 않는다.

## 3. Sparkle 준비와 앱 빌드

```bash
SPARKLE_VERSION=2.10.1
SPARKLE_DIST="$ROOT/work/sparkle-$SPARKLE_VERSION"
mkdir -p "$SPARKLE_DIST"
curl -fL --retry 3 \
  "https://github.com/sparkle-project/Sparkle/releases/download/$SPARKLE_VERSION/Sparkle-$SPARKLE_VERSION.tar.xz" \
  -o "$STAGE/Sparkle.tar.xz"
tar -xf "$STAGE/Sparkle.tar.xz" -C "$SPARKLE_DIST"

# 공식 아카이브에서 프레임워크가 최상위에 있을 때 빌드가 기대하는 경로를 연결한다.
if [ -d "$SPARKLE_DIST/Sparkle.framework" ]; then
  mkdir -p "$SPARKLE_DIST/Sparkle.xcframework/macos-arm64_x86_64"
  ln -sfn ../../Sparkle.framework \
    "$SPARKLE_DIST/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
fi
test -x "$SPARKLE_DIST/bin/sign_update"
test -d "$SPARKLE_DIST/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"

NODE_INCLUDE="${NODE_INCLUDE:-$(node -p 'require("node:path").resolve(process.execPath, "../../include/node")')}"
test -f "$NODE_INCLUDE/node_api.h"

cd "$SRC"
SPARKLE_DIST="$SPARKLE_DIST" NODE_INCLUDE="$NODE_INCLUDE" ./build-macos.sh "$BUNDLE"

PLIST="$BUNDLE/Contents/Info.plist"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$PLIST")" = "$VERSION"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$PLIST")" = "$VERSION"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$PLIST")" = com.promlee.promeftp
test "$(/usr/libexec/PlistBuddy -c 'Print SUFeedURL' "$PLIST")" = \
  https://raw.githubusercontent.com/PROMLEE/promeftp/main/updates/appcast-arm64.xml
test -d "$BUNDLE/Contents/Frameworks/Sparkle.framework"
test -f "$BUNDLE/Contents/Frameworks/PromeFTPUpdate.node"
```

`build-macos.sh`는 존재하지 않는 절대 경로를 요구한다. 이전 빌드가 남아 있으면 새 경로를 사용한다. `SPARKLE_DIST`를 빠뜨려도 개발용 빌드는 성공할 수 있다. 그런 번들에는 업데이트 브리지와 Sparkle 설정이 없으므로 위 확인 단계에서 멈추고 다시 빌드한다. 이 단계의 앱은 임시 서명 상태다.

## 4. 기존 키로 서명하고 배포 파일 생성

```bash
cd "$SRC"
security find-generic-password -s com.promlee.promeftp.release-signing \
  -a production >/dev/null
python3 scripts/sign-from-keychain.py "$BUNDLE" "$SPARKLE_DIST/bin/sign_update" "$ARTIFACTS"

(
  cd "$ARTIFACTS"
  shasum -a 256 -c "$PREFIX.dmg.sha256"
  shasum -a 256 -c "$PREFIX.zip.sha256"
)
codesign --verify --deep --strict "$BUNDLE"
```

서명 도구는 Keychain 항목에서 기존 macOS 서명 인증서와 Sparkle 키를 읽는다. 앱의 서명 인증서 지문은 `updates/code-signing-sha1.txt`, Sparkle 공개 키는 `updates/public-key.txt`로 검증한다. 스크립트가 앱 서명, DMG 검증, ZIP과 appcast의 Sparkle 서명 검증까지 수행한다. Keychain 조회 성공은 항목이 있다는 뜻이며 실제 읽기와 서명은 스크립트의 종료 코드로 확인한다.

키를 읽지 못하면 로그인 Keychain의 잠금 상태, 접근 권한, 기존 인증서와 키의 위치를 확인한다. `init-release-identity.sh`는 최초 키 발급용이다. 기존 사용자의 업데이트 신뢰 관계를 유지하려면 정기 배포에서 키를 재발급하지 않는다. 서명 키, 인증서 개인키, GitHub 토큰을 로그·문서·명령줄에 출력하지 않는다.

성공하면 다음 다섯 파일이 생성된다.

| 산출물 | 용도 |
| --- | --- |
| `$PREFIX.dmg` | 수동 설치 |
| `$PREFIX.zip` | Sparkle 업데이트 |
| `$PREFIX.dmg.sha256`, `$PREFIX.zip.sha256` | 다운로드 검증 |
| `appcast-arm64.xml` | 릴리스 첨부 파일이자 안정판·베타 업데이트 피드의 원본 |

서명 후 ZIP이나 XML을 편집하거나 다시 압축하지 않는다. 업데이트 창의 문구를 고쳐야 하면 원본 JSON을 바꾸고 피드를 다시 서명한다.

## 5. GitHub 릴리스와 피드 게시

순서는 **공개 문서 커밋 → 릴리스 초안과 첨부 파일 → 릴리스 공개 및 다운로드 확인 → 업데이트 피드 게시**다. 피드를 먼저 올리면 앱이 아직 다운로드할 수 없는 ZIP을 안내한다.

공개 체크아웃에 2단계의 문서 변경을 적용한 뒤 커밋한다. 버전 태그는 해당 문서 커밋을 가리킨다.

```bash
cd "$PUBLIC"
cp "$SRC/docs/releases/$VERSION.md" "$SRC/docs/releases/$VERSION.appcast.json" docs/releases/
git diff --check
git status --short
# 추가 문서 변경도 확인한 후 필요한 파일만 스테이징한다.
git add "docs/releases/$VERSION.md" "docs/releases/$VERSION.appcast.json"
git diff --cached --stat
git commit -m "Document PromeFTP $VERSION"
git push origin main
DOC_COMMIT="$(git rev-parse HEAD)"
```

GitHub CLI를 사용할 수 있으면 아래처럼 실행한다. 이미 초안이 있으면 새로 만들지 말고 첨부 상태를 확인해 이어서 진행한다.

```bash
gh auth status
gh release create "$TAG" --repo "$REPO" --target "$DOC_COMMIT" \
  --draft --title "PromeFTP $VERSION" --notes-file "docs/releases/$VERSION.md"
gh release upload "$TAG" --repo "$REPO" \
  "$ARTIFACTS/$PREFIX.dmg" "$ARTIFACTS/$PREFIX.dmg.sha256" \
  "$ARTIFACTS/$PREFIX.zip" "$ARTIFACTS/$PREFIX.zip.sha256" "$ARTIFACTS/appcast-arm64.xml"
gh release view "$TAG" --repo "$REPO" --json isDraft,assets
# 다섯 파일 이름과 크기를 확인한 다음 공개한다.
gh release edit "$TAG" --repo "$REPO" --draft=false --latest
```

### `gh`가 없거나 업로드가 중단됐을 때

1. **이미 만든 초안부터 찾는다.** 로그인한 GitHub의 [Releases](https://github.com/PROMLEE/promeftp/releases)에서 같은 태그의 초안을 확인한다. REST API에서는 인증된 `GET /repos/PROMLEE/promeftp/releases` 목록이나 알고 있는 릴리스 ID로 조회한다. 태그 조회에서 404가 나와도 초안 목록을 확인하기 전에는 새 초안을 만들지 않는다. 초안이 없을 때만 문서 커밋을 대상으로 `draft: true`로 생성한다. 서명과 체크섬을 검증한 기존 산출물을 그대로 사용한다.
2. **API 인증은 저장소 조회로 먼저 확인한다.** 아래 명령으로 HTTP 응답과 `permissions.push`를 확인한다. `git push` 성공만으로 REST API가 인증됐다고 판단하지 않는다. `401 Bad credentials`가 나오면 이 조회를 다시 실행해 현재 상태를 확인한다. 계속 401이면 로그인된 브라우저에서 기존 초안을 열어 이어가거나 저장소 쓰기 권한이 있는 인증을 갱신한다. 1.0.7의 첫 401 원인은 확인되지 않았다.
3. **실패한 첨부만 복구한다.** 브라우저에서 여러 파일을 한꺼번에 올리다 실패하면 기존 초안의 실패한 첨부를 제거하고 DMG부터 한 개씩 선택한다. 업로드 중에는 페이지를 새로고침하지 않는다. API를 쓸 때는 릴리스 ID로 첨부 목록을 다시 읽고, `starter` 상태의 0바이트 첨부만 제거해 재시도한다. 이미 올라간 파일은 이름·크기·SHA-256을 비교해 일치하면 건너뛴다. 내용이 다르면 어떤 빌드가 맞는지 확인한 뒤 진행한다.
4. **브라우저와 API 사이를 전환해도 같은 초안을 사용한다.** API는 기존 초안의 `upload_url`에서 URI 템플릿 부분을 떼고 URL 인코딩한 파일명을 `?name=<파일명>`에 넣는다. 파일은 한 개씩 `application/octet-stream`으로 전송한다. 1.0.7에서는 브라우저로 DMG와 appcast를 각각 올리고, 쓰기 권한이 확인된 API로 같은 초안에 ZIP과 체크섬 두 개를 올렸다. 다섯 파일의 `state=uploaded`, 크기, SHA-256을 확인한 뒤 공개한다. API에서 정식 릴리스를 공개할 때는 `PATCH /repos/PROMLEE/promeftp/releases/{id}`에 `{"draft": false, "make_latest": "true"}`를 보낸다.

다음 조회는 Git의 credential helper 출력을 Python 프로세스 안에서만 읽는다. **`git credential fill`을 터미널에서 단독 실행하거나, 토큰이 들어간 헤더·디버그 로그를 출력하지 않는다.** 이전 배포의 인증 점검에서 이 명령을 단독 실행해 토큰이 출력된 일이 있었다.

```bash
python3 - "$REPO" <<'PY'
import json
import os
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

result = subprocess.run(
    ["git", "credential", "fill"],
    input="protocol=https\nhost=github.com\n\n",
    text=True,
    capture_output=True,
    env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
)
credentials = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
if result.returncode or not credentials.get("password"):
    sys.exit("GitHub credential is unavailable")

request = Request(f"https://api.github.com/repos/{sys.argv[1]}", headers={
    "Authorization": "Bearer " + credentials["password"],
    "Accept": "application/vnd.github+json",
    "User-Agent": "PromeFTP-release",
    "Cache-Control": "no-cache",
})
try:
    with urlopen(request, timeout=15) as response:
        can_push = json.load(response).get("permissions", {}).get("push") is True
        print(f"GitHub API HTTP {response.status}, permissions.push={can_push}")
except HTTPError as error:
    sys.exit(f"GitHub API HTTP {error.code}")
if not can_push:
    sys.exit("GitHub API credential lacks repository write access")
PY
```

### 공개 다운로드 확인 후 업데이트 피드 게시

공개 ZIP과 DMG에 접근할 수 있는지 확인한 다음 서명된 피드를 **바이트 그대로** 복사한다. 1.0.4에서는 두 채널 모두 같은 정식 빌드로 업데이트했다. 베타 전용 배포라면 안정판 피드를 바꾸지 않는다.

```bash
cd "$PUBLIC"
BASE="https://github.com/$REPO/releases/download/$TAG"
for suffix in dmg zip; do
  curl -fLsS --range 0-0 -o /dev/null "$BASE/$PREFIX.$suffix"
done

cp "$ARTIFACTS/appcast-arm64.xml" updates/appcast-arm64.xml
cp "$ARTIFACTS/appcast-arm64.xml" updates/beta/appcast-arm64.xml
git add updates/appcast-arm64.xml updates/beta/appcast-arm64.xml
git commit -m "Publish PromeFTP $VERSION update to stable and beta users"
git push origin main
```

## 6. 완료 확인과 실패 시 이어서 진행

```bash
for feed_path in updates/appcast-arm64.xml updates/beta/appcast-arm64.xml; do
  curl -fsSL --retry 3 "https://raw.githubusercontent.com/$REPO/main/$feed_path?release=$VERSION" \
    | cmp - "$ARTIFACTS/appcast-arm64.xml"
done
# gh 없이도 공개 상태와 파일 목록을 확인할 수 있다.
curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$TAG"
```

- GitHub의 공개 릴리스에서 태그와 첨부 파일 다섯 개의 SHA-256을 확인한다. 정식 배포는 Latest로 표시되는지 확인한다. 공개 DMG와 ZIP 다운로드가 성공해야 하며, 서명된 피드의 ZIP URL·버전·파일 크기는 공개 ZIP과 일치해야 한다.
- GitHub 초안, 파일 업로드 성공, 릴리스 공개는 각각 중간 상태다. 위 다운로드 확인을 마치고 대상 채널의 공개 appcast가 로컬 서명본과 바이트 단위로 일치할 때 배포 완료로 기록한다.
- 피드 비교가 실패하면 GitHub 원격 `main`의 커밋을 먼저 확인하고, CDN 캐시가 갱신된 뒤 다시 확인한다. 릴리스와 첨부 파일이 공개된 상태라면 새 릴리스를 만들 필요 없이 피드 단계부터 이어간다.
- 다른 에이전트에게는 공개 릴리스 URL, 서명 및 체크섬 검증 결과, 두 피드의 확인 결과를 남긴다. 실제 앱에서 자동 업데이트 설치까지 실행했는지는 별도로 기록한다. 배포와 이 Mac의 설치 앱 교체는 별개의 작업이다.
- 완료된 설치 파일을 사용자에게 직접 전달할 경우 DMG와 체크섬을 `outputs`에 복사한다.

## 1.0.4 참고 기록

- 공개 릴리스와 다섯 배포 파일은 [GitHub v1.0.4](https://github.com/PROMLEE/promeftp/releases/tag/v1.0.4)에 있다.
- 공개 문서 커밋은 `02fc745`, 안정판·베타 피드 게시 커밋은 `2c3f2c1`이다.
- 1.0.4에서 기존 PromeFTP 키로 서명했고 DMG·ZIP 체크섬과 두 공개 피드의 바이트 일치를 확인했다.

## 1.0.7 복구 기록

- 최초 API 요청은 401을 반환했고, 브라우저에서 다섯 파일을 한꺼번에 올리자 DMG 업로드가 실패했다.
- 기존 초안에서 실패한 첨부를 제거하고 appcast와 DMG를 각각 업로드했다. 저장소 API 재조회가 HTTP 200과 `permissions.push=true`를 반환한 뒤 같은 초안에 ZIP과 체크섬을 올렸다.
- [GitHub v1.0.7](https://github.com/PROMLEE/promeftp/releases/tag/v1.0.7)을 공개하고 첨부 다섯 개의 SHA-256과 DMG·ZIP 다운로드를 확인했다. 커밋 `9ee5a53`에서 게시한 안정판·베타 appcast는 로컬 서명본과 일치했다.
