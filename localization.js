const supportedLocale = locale => {
  const language = String(locale || '').split(/[-_]/)[0].toLowerCase();
  return ({ ko: 'ko', ja: 'ja', zh: 'zh-Hans' })[language] || 'en';
};

const messages = Object.fromEntries(`
Preferences|설정|設定|设置
Preferences…|설정…|設定…|设置…
Preferences (⌘,)|설정 (⌘,)|設定 (⌘,)|设置 (⌘,)
General|일반|一般|通用
Terminal|터미널|ターミナル|终端
Authentication|인증|認証|身份验证
Shortcuts|단축키|ショートカット|快捷键
About PromeFTP|PromeFTP 정보|PromeFTP について|关于 PromeFTP
Guide|가이드|ガイド|指南
Quick Guide|빠른 가이드|クイックガイド|快速指南
Search guide|가이드 검색|ガイドを検索|搜索指南
No guide results|일치하는 가이드가 없습니다|一致するガイドはありません|没有匹配的指南
Connect|연결|接続|连接
OpenSSH config|OpenSSH 설정|OpenSSH 設定|OpenSSH 配置
SFTP files|SFTP 파일|SFTP ファイル|SFTP 文件
File navigation|파일 탐색|ファイル移動|文件导航
Use the mouse Back and Forward buttons over a local or remote file panel to navigate that panel’s visited paths. Right-click any file or folder and choose Copy Path to copy its full path.|로컬 또는 원격 파일 패널 위에서 마우스 뒤로/앞으로 버튼을 눌러 방문한 경로를 이동합니다. 파일이나 폴더를 우클릭하고 경로 복사를 선택하면 전체 경로가 복사됩니다.|ローカルまたはリモートのファイルパネル上でマウスの戻る／進むボタンを押すと、訪問したパスを移動できます。ファイルやフォルダを右クリックして「パスをコピー」を選ぶと、フルパスをコピーします。|在本地或远程文件面板上按鼠标后退/前进按钮，可切换访问过的路径。右键点击文件或文件夹并选择“复制路径”，即可复制完整路径。
Tabs and splits|탭과 분할 화면|タブと分割|标签页与分屏
Workspaces|워크스페이스|ワークスペース|工作区
PAM authentication|PAM 인증|PAM 認証|PAM 身份验证
Snippets and search|스니펫과 검색|スニペットと検索|代码片段与搜索
Preferences and shortcuts|설정과 단축키|設定とショートカット|设置与快捷键
Use + or ⌘N to enter a host. Choose SSH for a terminal or SFTP for file transfer. Select an OpenSSH alias to inherit its hostname, user, port, and identity.|+ 또는 ⌘N으로 호스트를 입력합니다. 터미널은 SSH, 파일 전송은 SFTP를 선택합니다. OpenSSH 별칭을 선택하면 hostname, 사용자, 포트, 키 설정을 가져옵니다.|+ または ⌘N でホストを入力します。ターミナルには SSH、ファイル転送には SFTP を選びます。OpenSSH エイリアスを選ぶと hostname、ユーザー、ポート、鍵の設定を引き継ぎます。|使用 + 或 ⌘N 输入主机。终端请选择 SSH，文件传输请选择 SFTP。选择 OpenSSH 别名可继承 hostname、用户、端口和密钥设置。
Local files are on the left and remote files are on the right. Drag files between panels to transfer. Use the grip in a remote panel toolbar to move that panel within the same tab. Shift selects a range; ⌘ toggles individual items. Right-click files for actions. Remote-to-remote copies work between remote panels in the same tab.|왼쪽은 로컬, 오른쪽은 원격 파일입니다. 패널 사이에 끌어 파일을 전송하세요. 원격 패널 도구 막대의 잡기 아이콘을 끌면 같은 탭 안에서 패널을 이동할 수 있습니다. Shift는 범위 선택, ⌘는 개별 항목 선택입니다. 파일을 우클릭하면 동작 메뉴가 열립니다. 원격 간 복사는 같은 탭 안의 원격 패널 사이에서 가능합니다.|左側がローカル、右側がリモートです。パネル間でドラッグして転送します。リモートパネルのツールバーにあるグリップをドラッグすると、同じタブ内でパネルを移動できます。Shift で範囲選択、⌘ で個別選択します。ファイルを右クリックすると操作メニューが開きます。同じタブ内のリモートパネル間でリモートコピーできます。|左侧是本地文件，右侧是远程文件。在面板间拖动文件即可传输。拖动远程面板工具栏中的抓手，可在同一标签页内移动面板。Shift 选择范围；⌘ 切换单项选择。右键文件可打开操作菜单。同一标签页中的远程面板之间支持远程复制。
Drag tabs to reorder, group them, or drop a terminal on an edge to split. Right-click a tab to rename it, set its tab color, duplicate it, group it, or close it. Right-click a group name to rename the group or set its separate group color. ⌘D splits right; ⌘⇧D splits down.|탭을 끌어 순서를 바꾸거나 그룹화하고, 터미널 가장자리에 놓아 분할하세요. 탭 우클릭으로 이름·탭 색상을 바꾸거나 복제·그룹화·닫기를 할 수 있습니다. 그룹명 우클릭으로 그룹 이름과 탭 색상과 별개인 그룹 색상을 바꿉니다. ⌘D는 오른쪽, ⌘⇧D는 아래로 분할합니다.|タブをドラッグして並べ替え・グループ化し、ターミナルの端にドロップして分割します。タブを右クリックすると名前やタブ色の変更、複製、グループ化、終了ができます。グループ名を右クリックすると名前とタブ色とは別のグループ色を変更できます。⌘D は右、⌘⇧D は下に分割します。|拖动标签页可排序或分组，将终端拖到边缘可分屏。右键标签页可重命名、设置标签颜色、复制、分组或关闭。右键分组名称可重命名或设置独立于标签颜色的分组颜色。⌘D 向右分屏；⌘⇧D 向下分屏。
Save selected open tabs or entire tab groups, including split layout and SFTP paths. Opening a workspace adds its tabs and keeps current sessions open. Restored connections authenticate again. Right-click a saved workspace to rename or delete it.|열린 탭 또는 탭 그룹을 선택해 분할 구조와 SFTP 경로까지 저장합니다. 워크스페이스를 열면 기존 세션은 유지되고 저장된 탭이 추가됩니다. 복원한 연결은 다시 인증해야 합니다. 저장한 워크스페이스를 우클릭해 이름을 바꾸거나 삭제하세요.|開いているタブまたはタブグループを選択し、分割構成と SFTP パスを保存します。ワークスペースを開いても現在のセッションは維持され、保存したタブが追加されます。復元した接続では再認証が必要です。保存済みワークスペースを右クリックして名前変更・削除できます。|选择已打开的标签页或整个标签组，可保存分屏布局和 SFTP 路径。打开工作区会保留当前会话并添加已保存标签页。恢复的连接需要重新验证。右键已保存工作区可重命名或删除。
Keyboard-interactive questions appear in the session. Save reusable answers after a successful login, or create global exact-match and regular-expression rules in Preferences → Authentication. Saved values are plain text in the local profile file. Turn off automatic sending if you want to review answers first.|Keyboard-interactive 질문은 세션에 표시됩니다. 로그인 성공 후 재사용할 응답을 저장하거나 설정 → 인증에서 전역 완전 일치·정규식 규칙을 만드세요. 저장값은 로컬 프로필 파일에 평문으로 보관됩니다. 응답을 확인한 뒤 보내려면 자동 전송을 끄세요.|Keyboard-interactive の質問はセッションに表示されます。ログイン成功後に回答を保存するか、設定 → 認証で完全一致・正規表現のグローバルルールを作成します。保存値はローカルプロファイルに平文で保存されます。確認してから送信するには自動送信をオフにします。|Keyboard-interactive 问题会显示在会话中。成功登录后可保存可重用回答，也可在设置 → 身份验证中创建全局精确匹配和正则规则。已保存的值以明文存储在本地配置文件中。若要先检查回答，请关闭自动发送。
Select recent terminal output and right-click to create a trigger. Choose notify, ask for input in the matching pane, or send a saved response when new output matches. Saved responses can contain multiple lines; each line is sent with Return. Enable or disable rules in the manager beside Snippets.|최근 터미널 출력을 선택하고 우클릭해 트리거를 만드세요. 새 출력이 일치하면 알림, 해당 창에서 입력 요청, 저장 응답 전송 중 동작을 선택합니다. 저장 응답은 여러 줄로 입력할 수 있고 각 줄 끝에 Return을 보냅니다. Snippets 옆 트리거 관리창에서 규칙을 켜거나 끌 수 있습니다.|最近のターミナル出力を選択して右クリックし、トリガーを作成します。新しい出力が一致したとき、通知、ペインでの入力要求、保存済み応答の送信を選べます。保存済み応答は複数行にでき、各行の末尾に Return を送ります。Snippets の横の管理画面でルールを有効・無効にできます。|选择最近的终端输出并右键创建触发器。匹配新输出时，可选择提醒、在对应窗格请求输入或发送已保存回答。已保存回答可包含多行，每行末尾发送 Return。可在 Snippets 旁的管理器中启用或停用规则。
⌘P opens snippets; choose one to paste it into the focused terminal. ⌘F searches terminal output. Return moves to the next match and Shift+Return moves to the previous match.|⌘P로 스니펫을 열고 선택한 명령을 포커스된 터미널에 붙여넣습니다. ⌘F로 터미널 출력을 검색합니다. Return은 다음 결과, Shift+Return은 이전 결과입니다.|⌘P でスニペットを開き、選択した内容をフォーカス中のターミナルに貼り付けます。⌘F で出力を検索します。Return は次、Shift+Return は前の結果へ移動します。|⌘P 打开代码片段并粘贴到当前终端。⌘F 搜索终端输出。Return 转到下一个结果，Shift+Return 转到上一个结果。
Open Preferences with ⌘,. Choose installed terminal fonts, theme, transparency, and scrollback behavior. ⌘+ and ⌘− adjust terminal text; ⌘0 resets its size. Preferences → Shortcuts lists available key bindings.|⌘,로 설정을 엽니다. 설치된 터미널 글꼴, 테마, 투명도와 스크롤백을 설정할 수 있습니다. ⌘+와 ⌘−는 글자 크기를 조절하고 ⌘0은 초기화합니다. 설정 → 단축키에서 키 목록을 확인하세요.|⌘, で設定を開きます。インストール済みフォント、テーマ、透明度、スクロールバックを設定できます。⌘+ と ⌘− で文字サイズを変更し、⌘0 で戻します。設定 → ショートカットでキー一覧を確認できます。|按 ⌘, 打开设置。可设置已安装字体、主题、透明度和回滚缓冲区。⌘+ 和 ⌘− 调整终端文字大小，⌘0 恢复默认值。设置 → 快捷键可查看按键列表。
About|앱 정보|情報|关于
Language and appearance|언어 및 모양|言語と外観|语言和外观
Language|언어|言語|语言
Appearance|모양|外観|外观
Theme|테마|テーマ|主题
System|시스템 설정|システム設定|跟随系统
Light|라이트|ライト|浅色
Dark|다크|ダーク|深色
Connections|연결|接続|连接
SSH configuration files|SSH 설정 파일|SSH 設定ファイル|SSH 配置文件
OpenSSH Config…|OpenSSH 설정…|OpenSSH 設定…|OpenSSH 配置…
OpenSSH config|OpenSSH 설정|OpenSSH 設定|OpenSSH 配置
Software Updates|소프트웨어 업데이트|ソフトウェアアップデート|软件更新
Install updates automatically|업데이트 자동 설치|アップデートを自動でインストール|自动安装更新
Install Updates Automatically|업데이트 자동 설치|アップデートを自動でインストール|自动安装更新
Check for a new version|새 버전 확인|新しいバージョンを確認|检查新版本
Check for Updates…|업데이트 확인…|アップデートを確認…|检查更新…
Support Development…|개발 후원…|開発を支援…|赞助开发…
Agents|에이전트|エージェント|智能体
Enable local agent access|로컬 에이전트 접속 허용|ローカルエージェントのアクセスを許可|允许本地智能体访问
Authentication requests|인증 요청|認証リクエスト|身份验证请求
Agent clients|에이전트 클라이언트|エージェントクライアント|智能体客户端
Client name|클라이언트 이름|クライアント名|客户端名称
Register Client|클라이언트 등록|クライアントを登録|注册客户端
Revoke Client|클라이언트 권한 철회|クライアントを無効化|撤销客户端
Bookmark access|북마크 접근 권한|ブックマークへのアクセス|书签访问权限
Remote directory|원격 디렉터리|リモートディレクトリ|远程目录
Allow SFTP browsing|SFTP 탐색 허용|SFTP の参照を許可|允许浏览 SFTP
Allow downloads|다운로드 허용|ダウンロードを許可|允许下载
Use saved authentication|저장된 인증 정보 사용|保存済みの認証情報を使用|使用已保存的身份验证信息
Allow SSH commands with approval|승인 후 SSH 명령 허용|承認した SSH コマンドを許可|批准后允许运行 SSH 命令
Optional task name|등록 작업 이름|タスク名（任意）|任务名称（可选）
Fixed SSH command|등록할 SSH 명령|固定 SSH コマンド|预设 SSH 命令
PAM rules|PAM 규칙|PAM ルール|PAM 规则
Notification triggers|알림 트리거|通知トリガー|通知触发器
Save Access|접근 권한 저장|アクセス権を保存|保存访问权限
Remove Access|접근 권한 제거|アクセス権を削除|移除访问权限
Install a skill|스킬 설치|スキルをインストール|安装技能
Install or Update|설치 또는 업데이트|インストールまたは更新|安装或更新
Remove Skill|스킬 제거|スキルを削除|移除技能
Update this skill automatically|이 스킬 자동 업데이트|スキルを自動更新|自动更新此技能
Activity history|활동 이력|アクティビティ履歴|活动记录
Retention (days)|보관 기간(일)|保持期間（日）|保留天数
Save Retention|보관 기간 저장|保持期間を保存|保存保留期限
Refresh History|이력 새로고침|履歴を更新|刷新记录
Export JSON|JSON으로 내보내기|JSON をエクスポート|导出 JSON
Include paths|경로 포함|パスを含める|包含路径
Show session timeline|세션 타임라인 보기|セッションの履歴を表示|查看会话时间线
Close active sessions before updating.|업데이트하기 전에 실행 중인 세션을 닫아 주세요.|更新する前に実行中のセッションを閉じてください。|更新前请关闭正在运行的会话。
Text|텍스트|テキスト|文本
Font family|글꼴|フォント|字体
Font size|글꼴 크기|フォントサイズ|字体大小
Scrollback|스크롤백|スクロールバック|回滚缓冲区
Unlimited scrollback|무제한 스크롤백|スクロールバックを無制限にする|无限回滚
Line limit|최대 줄 수|最大行数|行数上限
Keeps output in memory for the current session. Long sessions can use more memory.|현재 세션의 출력을 메모리에 보관합니다. 세션이 길어지면 메모리 사용량이 늘어날 수 있습니다.|現在のセッションの出力をメモリに保持します。長時間のセッションではメモリ使用量が増えることがあります。|在内存中保留当前会话的输出。长时间运行的会话可能占用更多内存。
Keyboard|키보드|キーボード|键盘
Use Option as Meta|Option 키를 Meta로 사용|Option キーを Meta として使う|将 Option 键用作 Meta
Global PAM Rules|전역 PAM 규칙|グローバル PAM ルール|全局 PAM 规则
Add Rule|규칙 추가|ルールを追加|添加规则
Rules apply to all SSH and SFTP connections.|모든 SSH 및 SFTP 연결에 적용됩니다.|すべての SSH および SFTP 接続に適用されます。|适用于所有 SSH 和 SFTP 连接。
Regex examples|정규식 예제|正規表現の例|正则表达式示例
matches the whole question.|는 질문 전체와 일치합니다.|は質問全体に一致します。|匹配整条提示。
matches a line break in one question.|은 한 질문 안의 줄바꿈과 일치합니다.|は質問内の改行に一致します。|匹配一条提示内的换行。
ignores case.|는 대소문자를 구분하지 않습니다.|は大文字と小文字を区別しません。|忽略大小写。
Authentication Storage|인증 정보 저장|認証情報の保存|认证信息存储
Allow OpenSSH to use Keychain|OpenSSH 키체인 사용 허용|OpenSSH にキーチェーンの使用を許可|允许 OpenSSH 使用钥匙串
Load saved PAM answers on connect|연결 시 저장된 PAM 응답 불러오기|接続時に保存済み PAM 応答を読み込む|连接时加载已保存的 PAM 回答
Saved passwords and answers are stored unencrypted in your local profile file. macOS account permissions restrict access.|저장된 암호와 응답은 로컬 프로필 파일에 암호화 없이 보관됩니다. macOS 계정 권한으로 접근을 제한합니다.|保存したパスワードと回答はローカルのプロファイルファイルに暗号化せず保存されます。macOS アカウント権限でアクセスを制限します。|保存的密码和回答以未加密形式存储在本地配置文件中。macOS 账户权限会限制访问。
Saved Answers|저장된 응답|保存済みの応答|已保存的回答
Send saved answers automatically|저장된 응답 자동 전송|保存済みの応答を自動送信|自动发送已保存的回答
No saved answers|저장된 응답이 없습니다|保存済みの応答はありません|没有已保存的回答
New answer (optional)|새 응답 (선택 사항)|新しい応答（任意）|新回答（可选）
New answer|새 응답|新しい応答|新回答
Use this answer across all SSH and SFTP connections?|이 응답을 모든 SSH 및 SFTP 연결에 사용할까요?|この応答をすべての SSH と SFTP 接続で使いますか？|要在所有 SSH 和 SFTP 连接中使用此回答吗？
Move to Global|전역으로 이동|グローバルに移動|移至全局
Moved to Global PAM Rules|전역 PAM 규칙으로 이동했습니다|グローバル PAM ルールに移動しました|已移至全局 PAM 规则
Answer removed|응답을 삭제했습니다|応答を削除しました|已删除回答
Answer updated|응답을 수정했습니다|応答を更新しました|已更新回答
New global rule|새 전역 규칙|新しいグローバルルール|新建全局规则
Question matching|질문 매칭 방식|質問の照合方法|提示匹配方式
Exact match|정확히 일치|完全一致|完全匹配
Regular expression|정규식|正規表現|正则表达式
PAM question or pattern|PAM 질문 또는 패턴|PAM の質問またはパターン|PAM 提示或匹配模式
Question pattern, e.g. ^OTP code.*:$|질문 패턴. 예: ^OTP code.*:$|質問パターン。例: ^OTP code.*:$|提示匹配模式，例如 ^OTP code.*:$
Exact PAM question|정확한 PAM 질문|PAM の質問全文|完整的 PAM 提示
Answer|응답|応答|回答
Global PAM answer|전역 PAM 응답|グローバル PAM 応答|全局 PAM 回答
Global rule saved|전역 규칙을 저장했습니다|グローバルルールを保存しました|已保存全局规则
Show answer|응답 보기|応答を表示|显示回答
Hide answer|응답 숨기기|応答を隠す|隐藏回答
Show saved answer|저장된 응답 보기|保存済みの応答を表示|显示已保存的回答
Hide saved answer|저장된 응답 숨기기|保存済みの応答を隠す|隐藏已保存的回答
Could not read the saved answer.|저장된 응답을 읽을 수 없습니다.|保存済みの応答を読み込めませんでした。|无法读取已保存的回答。
Build|빌드|ビルド|构建
Last update check|마지막 업데이트 확인|前回のアップデート確認|上次检查更新
No update checks yet|업데이트 확인 기록이 없습니다|アップデートの確認履歴がありません|尚未检查更新
Installation waits for active sessions and pending writes.|실행 중인 세션과 저장 작업이 끝나면 설치합니다.|実行中のセッションと書き込みの完了後にインストールします。|活动会话与写入任务结束后再安装。
Licenses|라이선스|ライセンス|许可证
PromeFTP © Promlee. Sparkle, Electron, and xterm.js are MIT licensed.|PromeFTP © Promlee. Sparkle, Electron, xterm.js는 MIT 라이선스를 사용합니다.|PromeFTP © Promlee。Sparkle、Electron、xterm.js は MIT ライセンスです。|PromeFTP © Promlee。Sparkle、Electron 和 xterm.js 使用 MIT 许可证。
System Monospace|시스템 고정폭 글꼴|システムの等幅フォント|系统等宽字体
Custom font|사용자 지정 글꼴|カスタムフォント|自定义字体
Custom font…|사용자 지정 글꼴…|カスタムフォント…|自定义字体…
Version|버전|バージョン|版本
SSH and SFTP for macOS, by Promlee.|Promlee의 macOS용 SSH 및 SFTP 앱입니다.|Promlee による macOS 用 SSH・SFTP アプリ。|由 Promlee 开发的 macOS SSH 和 SFTP 应用。
Release Notes|릴리스 노트|リリースノート|发行说明
User Guide|사용 가이드|ユーザーガイド|使用指南
Report an Issue|문제 신고|問題を報告|报告问题
Save|저장|保存|保存
Apply|적용|適用|应用
Remove|삭제|削除|移除
Cancel|취소|キャンセル|取消
Send|전송|送信|发送
Close|닫기|閉じる|关闭
Done|완료|完了|完成
App|앱|アプリ|应用
File|파일|ファイル|文件
Edit|편집|編集|编辑
Window|창|ウインドウ|窗口
New Host|새 호스트|新規ホスト|新建主机
Local Shell|로컬 셸|ローカルシェル|本地 Shell
Close Tab|탭 닫기|タブを閉じる|关闭标签页
Snippets|스니펫|スニペット|代码片段
Find|찾기|検索|查找
Split Right|오른쪽으로 분할|右に分割|向右拆分
Split Down|아래로 분할|下に分割|向下拆分
Clear Buffer|버퍼 지우기|バッファを消去|清除缓冲区
Increase Font Size|글꼴 키우기|フォントサイズを拡大|增大字号
Decrease Font Size|글꼴 줄이기|フォントサイズを縮小|减小字号
Reset Font Size|글꼴 크기 초기화|フォントサイズをリセット|重置字号
Copy selection|선택 영역 복사|選択範囲をコピー|复制选区
Paste|붙여넣기|ペースト|粘贴
Previous prompt mark|이전 프롬프트 표시|前のプロンプトマーク|上一提示标记
Next prompt mark|다음 프롬프트 표시|次のプロンプトマーク|下一提示标记
Toggle sidebar|사이드바 전환|サイドバーを切り替え|切换侧边栏
Local shell (⌘T)|로컬 셸 (⌘T)|ローカルシェル (⌘T)|本地 Shell (⌘T)
Local shell|로컬 셸|ローカルシェル|本地 Shell
New SFTP connection|새 SFTP 연결|新規 SFTP 接続|新建 SFTP 连接
Workspaces|워크스페이스|ワークスペース|工作区
Bookmarks|북마크|ブックマーク|书签
History|기록|履歴|历史记录
Filter|필터|絞り込み|筛选
Filter bookmarks|북마크 필터|ブックマークを絞り込む|筛选书签
Filter connection history|연결 기록 필터|接続履歴を絞り込む|筛选连接历史
New folder|새 폴더|新規フォルダ|新建文件夹
New bookmark folder|새 북마크 폴더|新規ブックマークフォルダ|新建书签文件夹
New host|새 호스트|新規ホスト|新建主机
New host (⌘N)|새 호스트 (⌘N)|新規ホスト (⌘N)|新建主机 (⌘N)
No bookmarks|북마크가 없습니다|ブックマークはありません|没有书签
No recent connections|최근 연결이 없습니다|最近の接続はありません|没有最近连接
PAM authentication settings|PAM 인증 설정|PAM 認証設定|PAM 身份验证设置
Snippets (⌘P)|스니펫 (⌘P)|スニペット (⌘P)|代码片段 (⌘P)
Resize sidebar|사이드바 크기 조절|サイドバーの幅を変更|调整侧边栏宽度
Sessions|세션|セッション|会话
Connect|연결|接続|连接
SSH alias|SSH 별칭|SSH エイリアス|SSH 别名
Use address|주소 사용|アドレスを使用|使用地址
Hostname or IP|호스트명 또는 IP|ホスト名または IP|主机名或 IP
Hostname / IP|호스트명 / IP|ホスト名 / IP|主机名 / IP
Port|포트|ポート|端口
From SSH config|SSH 설정 사용|SSH 設定を使用|使用 SSH 配置
Leave blank to use SSH config|SSH 설정을 사용하려면 비워 두세요|空欄にすると SSH 設定を使用します|留空以使用 SSH 配置
SSH host|SSH 호스트|SSH ホスト|SSH 主机
Login string|로그인 문자열|ログイン文字列|登录字符串
Split at the last @|마지막 @에서 분리|最後の @ で分割|在最后一个 @ 处拆分
Split address|주소 분리|アドレスを分割|拆分地址
Clear the User field to use this login string.|이 로그인 문자열을 사용하려면 사용자 필드를 비워 주세요.|このログイン文字列を使うにはユーザ欄を空にしてください。|清空用户字段以使用此登录字符串。
User|사용자|ユーザ|用户
Key|키|鍵|密钥
Default|기본값|デフォルト|默认
Choose private key|개인 키 선택|秘密鍵を選択|选择私钥
Options|옵션|オプション|选项
Name|이름|名前|名称
Folder|폴더|フォルダ|文件夹
Optional|선택 사항|任意|可选
SSH config|SSH 설정|SSH 設定|SSH 配置
Global options|전역 옵션|グローバルオプション|全局选项
Add directive|지시어 추가|ディレクティブを追加|添加指令
Add Host|Host 추가|Host を追加|添加 Host
Host patterns|호스트 패턴|ホストパターン|主机模式
Remove Host section|Host 섹션 삭제|Host セクションを削除|移除 Host 区块
Match section · preserved|Match 섹션 · 유지됨|Match セクション · 保持|Match 区块 · 保留
Add KEX compatibility|KEX 호환성 추가|KEX 互換性を追加|添加 KEX 兼容项
Added for this Host section. Save to apply.|이 Host 섹션에 추가했습니다. 저장하면 적용됩니다.|この Host セクションに追加しました。保存すると適用されます。|已添加到此 Host 区块。保存后生效。
Finish the new directive or Host entry before saving.|새 지시어나 Host 항목을 완성한 다음 저장하세요.|新しいディレクティブまたは Host 項目を完成させてから保存してください。|请先完成新指令或 Host 项再保存。
This KEX list uses an advanced operator; edit it manually in the directive field.|이 KEX 목록은 고급 연산자를 사용합니다. 지시어 입력란에서 직접 수정하세요.|この KEX リストは高度な演算子を使用しています。ディレクティブ欄で直接編集してください。|此 KEX 列表使用了高级运算符，请在指令栏中手动编辑。
A global KexAlgorithms setting takes precedence. Edit that directive to change it for every host.|전역 KexAlgorithms 설정이 우선 적용됩니다. 모든 호스트의 설정을 바꾸려면 해당 지시어를 수정하세요.|グローバルの KexAlgorithms 設定が優先されます。全ホストの設定を変更するには、そのディレクティブを編集してください。|全局 KexAlgorithms 设置优先。若要更改所有主机，请编辑该指令。
Saved. OpenSSH will use these settings on the next connection.|저장했습니다. 다음 연결부터 OpenSSH가 이 설정을 사용합니다.|保存しました。次回の接続から OpenSSH がこの設定を使用します。|已保存。OpenSSH 将在下次连接时使用这些设置。
Legacy key exchange offered|레거시 키 교환 방식이 제안되었습니다|旧式の鍵交換方式が提示されました|服务器提供了旧式密钥交换算法
Configure SSH…|SSH 설정…|SSH を設定…|配置 SSH…
Use Edit directives to manage global options and Host sections in the app. Match sections are preserved. If a server offers a legacy key exchange, use Configure SSH and add the suggested KEX to that host only.|지시어 편집에서 전역 옵션과 Host 항목을 관리할 수 있습니다. Match 항목은 보존됩니다. 서버가 레거시 키 교환 방식을 제공하면 SSH 설정을 열어 해당 호스트에만 제안된 KEX를 추가하세요.|「ディレクティブを編集」からグローバル設定と Host セクションを管理できます。Match セクションは保持されます。サーバーが旧式の鍵交換を提示した場合は、SSH 設定を開いて該当ホストにのみ推奨 KEX を追加します。|使用“编辑指令”在应用中管理全局选项和 Host 区块。Match 区块会保留。如果服务器提供旧式密钥交换，请使用“配置 SSH”仅为该主机添加建议的 KEX。
Choose SSH config|SSH 설정 파일 선택|SSH 設定を選択|选择 SSH 配置
Enable keyboard-interactive|키보드 대화형 인증 사용|キーボード対話認証を使用|启用键盘交互式验证
Enable SSH prompts for passwords, OTP, or PAM challenges. When off, use the SSH config setting.|비밀번호, OTP, PAM 질문을 받습니다. 끄면 SSH 설정을 따릅니다.|パスワード、OTP、PAM の SSH プロンプトを表示します。オフの場合は SSH 設定に従います。|启用密码、OTP 或 PAM 的 SSH 提示。关闭时遵循 SSH 配置。
Effective config|적용된 설정|有効な設定|生效配置
PAM rule|PAM 규칙|PAM ルール|PAM 规则
Cancel Split|분할 취소|分割をキャンセル|取消拆分
Save host|호스트 저장|ホストを保存|保存主机
Config file|설정 파일|設定ファイル|配置文件
Add config file|설정 파일 추가|設定ファイルを追加|添加配置文件
Open in text editor|텍스트 편집기에서 열기|テキストエディタで開く|在文本编辑器中打开
Remove from list|목록에서 제거|リストから削除|从列表移除
Refresh aliases|별칭 새로고침|エイリアスを更新|刷新别名
Find alias|별칭 검색|エイリアスを検索|查找别名
Split Connection|분할 연결|分割接続|拆分连接
New Connection…|새 연결…|新規接続…|新建连接…
Find a host|호스트 검색|ホストを検索|查找主机
Find a split host|분할 연결 호스트 검색|分割先のホストを検索|查找拆分主机
Workspace name|워크스페이스 이름|ワークスペース名|工作区名称
Tabs to include|저장할 탭|保存するタブ|要保存的标签页
Save Layout|레이아웃 저장|レイアウトを保存|保存布局
Open Tabs|탭 열기|タブを開く|打开标签页
Edit snippet|스니펫 수정|スニペットを編集|编辑代码片段
Cancel Edit|수정 취소|編集をキャンセル|取消编辑
Save Changes|변경 사항 저장|変更を保存|保存修改
Terminal Triggers|터미널 트리거|ターミナルトリガー|终端触发器
Terminal Triggers…|터미널 트리거…|ターミナルトリガー…|终端触发器…
Create Trigger from Selection…|선택한 텍스트로 트리거 만들기…|選択テキストからトリガーを作成…|从选中文字创建触发器…
Matches new terminal output. Choose whether to notify, ask for a reply, or send a saved response. Uses RE2 regular expressions.|새 터미널 출력과 일치할 때 알림, 직접 입력 또는 저장된 응답 전송 중 동작을 선택합니다. RE2 정규식을 사용합니다.|新しいターミナル出力に一致したとき、通知・入力の要求・保存済み応答の送信を選べます。RE2 正規表現を使います。|匹配新的终端输出时，可选择提醒、请求输入或发送已保存的回答。使用 RE2 正则表达式。
Action|동작|アクション|操作
Notify only|알림만|通知のみ|仅提醒
Ask me for input|직접 입력 요청|入力を求める|请求输入
Send saved response|저장된 응답 전송|保存済みの応答を送信|发送已保存的回答
Response to send|전송할 응답|送信する応答|要发送的回答
Type a response|응답 입력|応答を入力|输入回答
Trigger response sent|트리거 응답을 전송했습니다|トリガー応答を送信しました|已发送触发器回答
Trigger matched|트리거가 일치했습니다|トリガーに一致しました|触发器已匹配
Response sent|응답 전송됨|応答を送信しました|已发送回答
Input requested|입력 요청|入力を要求しました|已请求输入
Matched|일치함|一致しました|已匹配
Triggers|트리거|トリガー|触发器
New Rule|새 규칙|新規ルール|新建规则
Recent Matches|최근 일치 내역|最近の一致|最近匹配
Edit trigger|트리거 수정|トリガーを編集|编辑触发器
Remove trigger|트리거 삭제|トリガーを削除|移除触发器
Trigger saved|트리거를 저장했습니다|トリガーを保存しました|已保存触发器
On|켜짐|オン|开启
Off|꺼짐|オフ|关闭
Enable trigger|트리거 켜기|トリガーを有効化|启用触发器
Disable trigger|트리거 끄기|トリガーを無効化|停用触发器
Trigger enabled|트리거를 켰습니다|トリガーを有効にしました|已启用触发器
Trigger disabled|트리거를 껐습니다|トリガーを無効にしました|已停用触发器
Password saved for this host|이 호스트의 비밀번호를 저장했습니다|このホストのパスワードを保存しました|已保存此主机的密码
Will save after successful login|로그인에 성공하면 저장합니다|ログイン成功後に保存します|登录成功后保存
This password will not be saved|이 비밀번호는 저장되지 않습니다|このパスワードは保存されません|此密码不会保存
Password not saved (server did not ask)|서버가 비밀번호를 요청하지 않아 저장하지 않았습니다|サーバーがパスワードを要求しなかったため保存されませんでした|服务器未请求密码，因此未保存
Saving after authentication…|인증이 끝나면 저장합니다…|認証の完了後に保存します…|认证完成后保存…
Entered password was not saved. SSH asked again.|SSH가 비밀번호를 다시 요청해 입력값을 저장하지 않았습니다.|SSH がパスワードを再度要求したため、入力した値は保存されませんでした。|SSH 再次请求密码，输入的密码未保存。
Password was not saved. Connection did not complete.|연결이 완료되지 않아 비밀번호를 저장하지 않았습니다.|接続が完了しなかったため、パスワードは保存されませんでした。|连接未完成，密码未保存。
Could not save the SSH password.|SSH 비밀번호를 저장하지 못했습니다.|SSH パスワードを保存できませんでした。|无法保存 SSH 密码。
Select a shorter excerpt or enter a pattern.|더 짧은 텍스트를 선택하거나 패턴을 입력하세요.|短い範囲を選択するか、パターンを入力してください。|请选择更短的文本或输入模式。
Find a snippet|스니펫 검색|スニペットを検索|查找代码片段
Command|명령|コマンド|命令
Scope|범위|適用範囲|适用范围
All sessions|모든 세션|すべてのセッション|所有会话
This connection|이 연결|この接続|此连接
Authentication Activity|인증 활동|認証アクティビティ|身份验证活动
Hosts|호스트|ホスト|主机
Saved|저장했습니다|保存しました|已保存
No matching hosts|일치하는 호스트가 없습니다|一致するホストはありません|没有匹配的主机
Already sent automatically. Check the answer and retry.|이미 자동 전송했습니다. 응답을 확인한 뒤 다시 시도하세요.|自動送信済みです。応答を確認して再試行してください。|已自动发送。请检查回答后重试。
One reply per match. This connection only.|일치할 때 한 번 응답합니다. 이 연결에만 적용됩니다.|一致するたびに一度応答します。この接続にのみ適用します。|每次匹配仅回答一次。仅用于此连接。
Tab options|탭 옵션|タブのオプション|标签页选项
Close tab|탭 닫기|タブを閉じる|关闭标签页
Drag pane|패널 끌기|ペインをドラッグ|拖动窗格
Drag remote pane to rearrange|원격 패널을 끌어 재배치|リモートペインをドラッグして並べ替え|拖动远程窗格以重新排列
Close pane|패널 닫기|ペインを閉じる|关闭窗格
Find (⌘F)|찾기 (⌘F)|検索 (⌘F)|查找 (⌘F)
Previous match|이전 결과|前の一致項目|上一匹配项
Next match|다음 결과|次の一致項目|下一匹配项
Close find|검색 닫기|検索を閉じる|关闭查找
Export session log|세션 로그 내보내기|セッションログを出力|导出会话日志
Waiting for connection|연결 대기 중|接続を待機中|正在等待连接
Folder unavailable|폴더에 접근할 수 없습니다|フォルダを開けません|无法访问文件夹
Empty folder|빈 폴더|空のフォルダ|空文件夹
Recent folders|최근 폴더|最近のフォルダ|最近的文件夹
Rename|이름 변경|名前を変更|重命名
Delete|삭제|削除|删除
Toggle folder tree|폴더 트리 전환|フォルダツリーを切り替え|切换文件夹树
Refresh|새로고침|更新|刷新
Download selection|선택 항목 다운로드|選択項目をダウンロード|下载选中项
Upload to selected remote|선택한 원격으로 업로드|選択したリモートにアップロード|上传到选中的远程窗格
Show hidden files|숨김 파일 표시|隠しファイルを表示|显示隐藏文件
Choose local folder|로컬 폴더 선택|ローカルフォルダを選択|选择本地文件夹
New remote folder|새 원격 폴더|新規リモートフォルダ|新建远程文件夹
Close remote panel|원격 패널 닫기|リモートペインを閉じる|关闭远程窗格
No tabs open|열린 탭이 없습니다|開いているタブはありません|没有打开的标签页
No saved workspaces|저장된 워크스페이스가 없습니다|保存済みのワークスペースはありません|没有已保存的工作区
No matching workspaces|일치하는 워크스페이스가 없습니다|一致するワークスペースはありません|没有匹配的工作区
Filter workspaces|워크스페이스 필터|ワークスペースを絞り込む|筛选工作区
Save workspace layout|워크스페이스 레이아웃 저장|ワークスペースのレイアウトを保存|保存工作区布局
Select at least one tab.|탭을 하나 이상 선택하세요.|タブを一つ以上選択してください。|请至少选择一个标签页。
Layout saved|레이아웃을 저장했습니다|レイアウトを保存しました|已保存布局
Local|로컬|ローカル|本地
Remote|원격|リモート|远程
Connected|연결됨|接続済み|已连接
Disconnected|연결 종료|切断済み|已断开
Reconnect|다시 연결|再接続|重新连接
Name|이름|名前|名称
Modified|수정일|更新日時|修改时间
Size|크기|サイズ|大小
Type|종류|種類|类型
Link|링크|リンク|链接
Choose columns|표시 열 선택|表示列を選択|选择列
Open Folder|폴더 열기|フォルダを開く|打开文件夹
Refresh Folder|폴더 새로고침|フォルダを更新|刷新文件夹
New local folder|로컬 폴더 추가|ローカルフォルダを追加|新建本地文件夹
New remote folder|원격 폴더 추가|リモートフォルダを追加|新建远程文件夹
Show hidden files|숨김 파일 표시|隠しファイルを表示|显示隐藏文件
Hide hidden files|숨김 파일 숨기기|隠しファイルを隠す|隐藏隐藏文件
Duplicate Tab|탭 복제|タブを複製|复制标签页
Entire group|그룹 전체|グループ全体|整个分组
Background|배경|背景|背景
Terminal opacity|터미널 불투명도|ターミナルの不透明度|终端不透明度
Lower values reveal your desktop wallpaper through the terminal.|값을 낮추면 터미널 뒤로 데스크톱 배경화면이 비칩니다.|値を下げるとターミナル越しにデスクトップの壁紙が見えます。|值越低，桌面壁纸越能透过终端显示。
Password|비밀번호|パスワード|密码
Show password|비밀번호 보기|パスワードを表示|显示密码
Hide password|비밀번호 숨기기|パスワードを隠す|隐藏密码
Remember password|비밀번호 저장|パスワードを保存|保存密码
Forget saved|저장된 비밀번호 삭제|保存済みパスワードを削除|忘记已保存的密码
Leave blank to use saved password|비워 두면 저장된 비밀번호를 사용합니다|空欄の場合は保存済みパスワードを使用します|留空则使用已保存的密码
Saved password removed|저장된 비밀번호를 삭제했습니다|保存済みパスワードを削除しました|已删除保存的密码
Connecting…|연결 중…|接続中…|正在连接…
Starting…|시작 중…|起動中…|正在启动…
Replied automatically|자동으로 응답함|自動で応答しました|已自动回答
Canceled|취소됨|キャンセル済み|已取消
Reply|응답|応答する|发送回答
Save answer|응답 저장|応答を保存|保存回答
Send automatically|자동 전송|自動送信|自动发送
Verify SSH host key|SSH 호스트 키 확인|SSH ホスト鍵を確認|验证 SSH 主机密钥
Trust and Connect|신뢰하고 연결|信頼して接続|信任并连接
Don’t ask again for this verified key|이 키를 다시 묻지 않기|確認済みのこの鍵については再確認しない|不再询问此已验证的密钥
All Groups|모든 그룹|すべてのグループ|所有分组
Ungrouped|그룹 없음|グループなし|未分组
Show tab group|탭 그룹 표시|タブグループを表示|显示标签组
Rename Group…|그룹 이름 변경…|グループ名を変更…|重命名分组…
Ungroup Tabs|탭 그룹 해제|タブグループを解除|取消标签分组
Rename Group|그룹 이름 변경|グループ名を変更|重命名分组
Rename…|이름 변경…|名前を変更…|重命名…
Open|열기|開く|打开
Edit|편집|編集|编辑
Edit…|편집…|編集…|编辑…
Download|다운로드|ダウンロード|下载
Copy|복사|コピー|复制
Copy Path|경로 복사|パスをコピー|复制路径
Reveal in Finder|Finder에서 보기|Finderで表示|在 Finder 中显示
Move to Trash|휴지통으로 이동|ゴミ箱に入れる|移到废纸篓
Get Info|정보 가져오기|情報を見る|显示简介
Delete|삭제|削除|删除
Choose columns|열 선택|列を選択|选择列
`.trim().split('\n').map(line => {
  const [key, ko, ja, zh] = line.split('|');
  return [key, { ko, ja, 'zh-Hans': zh }];
}));
function translate(locale, key) {
  return Object.hasOwn(messages, key) ? messages[key][locale] || key : key;
}

let locale = 'en';
const t = key => translate(locale, key);
const staticStrings = [];
if (typeof document !== 'undefined') {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const original = node.nodeValue;
    if (Object.hasOwn(messages, original.trim())) {
      staticStrings.push(() => { node.nodeValue = original.replace(original.trim(), t(original.trim())); });
    }
  }
  for (const node of document.body.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const original = node.getAttribute(attr);
      if (Object.hasOwn(messages, original)) staticStrings.push(() => node.setAttribute(attr, t(original)));
    }
  }
}
function setLocale(next) {
  locale = supportedLocale(next);
  document.documentElement.lang = locale;
  for (const apply of staticStrings) apply();
}
if (typeof module !== 'undefined') module.exports = { translate, supportedLocale };
