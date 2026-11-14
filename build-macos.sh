#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $(uname -s) != Darwin || $(uname -m) != arm64 ]]; then
  echo 'Run this build on Apple Silicon macOS.' >&2
  exit 1
fi
if [[ $# != 1 || $1 != /* || -e "$1" ]]; then
  echo 'Pass an unused absolute output path ending in .app.' >&2
  exit 1
fi
npm ci --ignore-scripts
./node_modules/.bin/electron --version
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
bundle="$staging/PromeFTP.app"
ditto node_modules/electron/dist/Electron.app "$bundle"
resource="$bundle/Contents/Resources/app"
mkdir "$resource"
cp main.cjs agent-service.cjs agent-transport.cjs agent-skills.cjs agent-preferences.js terminal-triggers.cjs openssh.cjs askpass.cjs askpass.sh preload.cjs renderer.js index.html preferences.html preferences.js ui-controls.js localization.js app-icon.svg style.css package.json package-lock.json "$resource/"
cp LICENSE THIRD-PARTY-NOTICES.md "$resource/"
mkdir "$resource/updates"
cp updates/public-key.txt "$resource/updates/"
ditto agent-skills "$resource/agent-skills"
xcrun swiftc -target arm64-apple-macosx13.0 -O native/agent-cli.swift -o "$bundle/Contents/MacOS/promeftp"
(cd "$resource" && npm ci --omit=dev --ignore-scripts)
chmod +x "$resource/askpass.sh"
chmod +x "$resource/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
mkdir "$staging/PromeFTP.iconset"
swift make-icon.swift "$staging/PromeFTP.iconset"
cp "$staging/PromeFTP.iconset/icon_128x128.png" "$resource/application-icon.png"
iconutil -c icns -o "$bundle/Contents/Resources/PromeFTP.icns" "$staging/PromeFTP.iconset"
plist="$bundle/Contents/Info.plist"
version="$(node -p 'require("./package.json").version')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected a numeric release version.' >&2; exit 1; }
/usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile PromeFTP.icns' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName PromeFTP' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName PromeFTP' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.promlee.promeftp' "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$plist"
if /usr/libexec/PlistBuddy -c 'Print :NSHumanReadableCopyright' "$plist" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c 'Set :NSHumanReadableCopyright Copyright © 2026 Promlee. PromeFTP is licensed under the MIT License.' "$plist"
else
  /usr/libexec/PlistBuddy -c 'Add :NSHumanReadableCopyright string Copyright © 2026 Promlee. PromeFTP is licensed under the MIT License.' "$plist"
fi
if [[ -n "${SPARKLE_DIST:-}" ]]; then
  frameworks="$bundle/Contents/Frameworks"
  sparkle="$SPARKLE_DIST/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
  ditto "$sparkle" "$frameworks/Sparkle.framework"
  cp "$SPARKLE_DIST/LICENSE" "$bundle/Contents/Resources/Sparkle-LICENSE"
  node_include="${NODE_INCLUDE:-$(node -p 'require("node:path").resolve(process.execPath, "../../include/node")')}"
  xcrun clang++ -arch arm64 -mmacosx-version-min=13.0 -fobjc-arc -bundle -undefined dynamic_lookup \
    -I "$node_include" -F "$frameworks" -framework AppKit -framework Sparkle \
    -Wl,-rpath,@loader_path native/update.mm -o "$frameworks/PromeFTPUpdate.node"
  feed="${PROMEFTP_UPDATE_FEED:-https://raw.githubusercontent.com/PROMLEE/promeftp/main/updates/appcast-arm64.xml}"
  /usr/libexec/PlistBuddy -c "Add :SUFeedURL string $feed" "$plist"
  /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $(cat updates/public-key.txt)" "$plist"
  /usr/libexec/PlistBuddy -c 'Add :SUEnableAutomaticChecks bool false' "$plist"
  /usr/libexec/PlistBuddy -c 'Add :SUAutomaticallyUpdate bool false' "$plist"
  /usr/libexec/PlistBuddy -c 'Add :SUVerifyUpdateBeforeExtraction bool true' "$plist"
  /usr/libexec/PlistBuddy -c 'Add :SURequireSignedFeed bool true' "$plist"
  /usr/libexec/PlistBuddy -c 'Add :SUSignedFeedFailureExpirationInterval integer 0' "$plist"
fi
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
ditto "$bundle" "$1"
