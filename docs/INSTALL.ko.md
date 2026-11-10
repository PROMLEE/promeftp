# PromeFTP 설치 가이드

PromeFTP 0.0.6 베타는 Apple Silicon Mac용입니다.

## DMG로 설치

1. [공식 GitHub 릴리스](https://github.com/PROMLEE/promeftp/releases/tag/v0.0.6)의 **Assets**에서 `PromeFTP-0.0.6-macos-arm64.dmg`를 받습니다.
2. DMG를 열고 **PromeFTP**를 **Applications** 폴더로 드래그합니다.
3. Finder의 **응용 프로그램**에서 **PromeFTP**를 실행합니다.

## 첫 실행에서 macOS가 차단할 때

이 베타는 자체 서명으로 배포되며 Apple 공증을 받지 않았습니다. 첫 실행 때 Apple이 PromeFTP에 악성 소프트웨어가 있는지 확인할 수 없다는 경고가 표시될 수 있습니다. 공식 릴리스에서 받은 DMG임을 확인한 뒤 아래 순서로 진행하세요.

1. 경고창에서 **완료**를 누릅니다.
2. ** → 시스템 설정 → 개인정보 보호 및 보안**을 열고 아래쪽 **보안**으로 이동합니다.
3. PromeFTP 실행이 차단되었다는 메시지 옆의 **그래도 열기**를 누릅니다.
4. 확인창에서 앱 이름이 **PromeFTP**인지 확인하고 **열기** 또는 **그래도 열기**를 누릅니다. macOS가 요청하면 Touch ID나 Mac 로그인 암호로 확인합니다.

**그래도 열기**가 보이지 않으면 Finder의 **응용 프로그램**에서 PromeFTP 실행을 다시 시도한 직후 설정을 확인하세요. macOS가 앱이 손상되었거나 컴퓨터를 손상시킨다고 표시하면 실행을 중단하세요. [Apple의 공식 실행 안내](https://support.apple.com/ko-kr/102445)

이 단계는 macOS에서 PromeFTP 실행을 허용하는 절차입니다. SFTP에서 데스크탑·문서·다운로드 같은 로컬 보호 폴더를 열 때는 macOS가 해당 폴더 접근을 따로 물을 수 있습니다.
