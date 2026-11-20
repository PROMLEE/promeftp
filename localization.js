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
No shortcut|단축키 없음|ショートカットなし|无快捷键
Lets AI agents on this Mac connect through the PromeFTP CLI.|이 Mac의 AI 에이전트가 PromeFTP CLI로 연결할 수 있게 합니다.|この Mac の AI エージェントが PromeFTP CLI で接続できるようにします。|允许此 Mac 上的 AI 代理通过 PromeFTP CLI 连接。
Each client gets its own token. The token is shown only once.|에이전트마다 별도 토큰을 발급합니다. 토큰은 한 번만 표시됩니다.|クライアントごとに専用のトークンを発行します。トークンは一度だけ表示されます。|每个客户端都会获得独立的令牌，且令牌只显示一次。
Deletes the local token file that the CLI reads automatically.|CLI가 자동으로 읽던 로컬 토큰 파일을 삭제합니다.|CLI が自動で読み取るローカルのトークンファイルを削除します。|删除 CLI 自动读取的本地令牌文件。
Revokes this client's token and all of its bookmark permissions.|이 클라이언트의 토큰과 모든 북마크 권한을 취소합니다.|このクライアントのトークンとすべてのブックマーク権限を取り消します。|撤销此客户端的令牌及其所有书签权限。
Connects with this bookmark's OpenSSH settings, including aliases and ProxyJump. ProxyCommand may start a local process.|이 북마크의 OpenSSH 설정(alias, ProxyJump 포함)으로 연결합니다. ProxyCommand는 로컬 프로세스를 시작할 수 있습니다.|このブックマークの OpenSSH 設定（エイリアスと ProxyJump を含む）で接続します。ProxyCommand はローカルプロセスを起動する場合があります。|使用此书签的 OpenSSH 设置（包括别名和 ProxyJump）连接。ProxyCommand 可能会启动本地进程。
Allows listing and file information only, inside the folder you choose. Files cannot be changed.|지정한 폴더 아래에서만 목록 조회와 파일 정보 확인을 허용합니다. 파일은 수정할 수 없습니다.|選んだフォルダー内でのみ一覧表示とファイル情報の確認を許可します。ファイルの変更はできません。|仅允许在所选文件夹内列出文件和查看文件信息，不能修改文件。
The top folder the agent can see. It must start with /.|에이전트가 볼 수 있는 최상위 폴더입니다. /로 시작해야 합니다.|エージェントが参照できる最上位のフォルダーです。/ で始まる必要があります。|代理可以查看的顶层文件夹，必须以 / 开头。
Downloads files up to 16 MiB each into PromeFTP's private staging folder.|파일당 16 MiB까지 PromeFTP 전용 임시 폴더로 내려받습니다.|1 ファイルあたり 16 MiB まで、PromeFTP 専用の一時フォルダーにダウンロードします。|每个文件最大 16 MiB，下载到 PromeFTP 的专用暂存文件夹。
Uses the saved PAM responses for this host and all-host PAM rules when the agent connects. The PAM rules list is ignored while this is on.|에이전트가 연결할 때 이 호스트의 저장된 PAM 응답과 전역 인증 규칙을 사용합니다. 이 옵션이 켜져 있으면 PAM 규칙 목록은 무시됩니다.|エージェントの接続時に、このホストの保存済み PAM 応答と全ホスト向け PAM ルールを使用します。このオプションが有効な間、PAM ルールの一覧は無視されます。|代理连接时使用此主机已保存的 PAM 应答和所有主机的 PAM 规则。开启此选项时将忽略 PAM 规则列表。
Each command the agent requests runs only after you approve it in a confirmation window.|에이전트가 요청한 명령은 확인 창에서 승인해야 실행됩니다.|エージェントが要求したコマンドは、確認ウィンドウで承認された場合にのみ実行されます。|代理请求的每条命令都必须在确认窗口中审批后才会执行。
One command that can run without approval, identified by a name the agent uses.|승인 없이 실행할 수 있는 명령 하나를 에이전트가 쓰는 이름으로 등록합니다.|承認なしで実行できるコマンドを 1 つ、エージェントが使う名前で登録します。|注册一条无需审批即可运行的命令，并为其指定代理使用的名称。
Choose the host-wide PAM rules the agent connection may use. Ignored while saved authentication is on.|에이전트 연결에서 사용할 수 있는 모든 호스트 PAM 규칙을 고릅니다. 저장된 인증 사용이 켜져 있으면 무시됩니다.|エージェント接続で使用できる全ホスト向け PAM ルールを選びます。保存済みの認証を使用中は無視されます。|选择代理连接可以使用的全局主机 PAM 规则。开启已保存的身份验证时将忽略此设置。
Reports matching output to the agent as an event. It never sends an automatic reply.|일치하는 출력을 이벤트로 에이전트에 알립니다. 자동 응답은 보내지 않습니다.|一致した出力をイベントとしてエージェントに通知します。自動応答は送信しません。|将匹配的输出以事件形式通知代理，且从不自动回复。
Keeps activity for 1–90 days. Commands and passwords are never recorded.|활동 기록을 1–90일 보관합니다. 명령 내용과 비밀번호는 기록하지 않습니다.|アクティビティを 1～90 日間保存します。コマンドとパスワードは記録しません。|活动记录保留 1–90 天。从不记录命令和密码。
More information|자세히 보기|詳細|更多信息
SFTP|SFTP|SFTP|SFTP
SSH commands|SSH 명령|SSH コマンド|SSH 命令
Authentication and triggers|인증과 트리거|認証とトリガー|身份验证和触发器
This key is fixed for|이 키는 다음 기능에 고정되어 있습니다:|このキーは次の機能に固定されています：|此按键固定用于：
PAM rules and triggers are per bookmark and were left out here.|PAM 규칙과 트리거는 북마크마다 다르므로 여기서는 제외했습니다.|PAM ルールとトリガーはブックマークごとに異なるため、ここでは除外しました。|PAM 规则和触发器因书签而异，此处已省略。
Press keys… (Esc cancels, Delete clears)|키를 누르세요… (Esc 취소, Delete 해제)|キーを押してください…（Esc でキャンセル、Delete で解除）|请按下按键…（Esc 取消，Delete 清除）
Shortcut saved|단축키를 저장했습니다|ショートカットを保存しました|快捷键已保存
Change|변경|変更|更改
Reset|기본값|初期値に戻す|恢复默认
Reset All to Defaults|모두 기본값으로|すべて初期値に戻す|全部恢复默认
Fixed|고정|固定|固定
This shortcut is used for editing. Use it anyway?|편집에 쓰는 단축키입니다. 그래도 사용할까요?|編集に使われるショートカットです。それでも使用しますか？|此快捷键用于编辑。仍要使用吗？
This key is already used by|이 키는 이미 다음 동작에 쓰입니다:|このキーは次の操作で使用されています：|此按键已被以下操作使用：
Replace it?|바꿀까요?|置き換えますか？|要替换吗？
macOS reserves this shortcut.|macOS가 예약한 단축키입니다.|macOS が予約しているショートカットです。|此快捷键由 macOS 保留。
A shortcut needs a modifier key.|단축키에는 modifier 키가 하나 이상 필요합니다.|ショートカットには修飾キーが必要です。|快捷键需要一个修饰键。
This key cannot be used.|이 키는 사용할 수 없습니다.|このキーは使用できません。|无法使用此按键。
Key diagnostics|키 진단|キー診断|按键诊断
View log|로그 보기|ログを表示|查看日志
No key events recorded yet.|아직 기록된 키 이벤트가 없습니다.|まだキーイベントは記録されていません。|尚未记录按键事件。
Move to All Hosts|모든 호스트로 이동|すべてのホストへ移動|移到所有主机
Undo|실행 취소|取り消す|撤销
Deleted|삭제했습니다|削除しました|已删除
Edit Rule|규칙 편집|ルールを編集|编辑规则
Edit Saved Answer|저장된 응답 편집|保存済みの応答を編集|编辑已保存的应答
Matches|일치|一致|匹配
Does not match|일치하지 않음|一致しません|不匹配
Not a valid pattern|올바르지 않은 패턴|無効なパターン|无效的模式
Test question|테스트할 질문|テストする質問|测试问题
More actions|더 보기|その他の操作|更多操作
No saved answers. After a successful sign-in, choose Save Answer to add one here.|저장된 응답이 없습니다. 로그인에 성공한 뒤 '응답 저장'을 누르면 여기에 추가됩니다.|保存済みの応答はありません。サインイン成功後に「応答を保存」を選ぶとここに追加されます。|暂无已保存的应答。登录成功后，选择“保存应答”即可在此添加。
No rules yet. Add a rule to answer a question on every connection.|아직 규칙이 없습니다. 규칙을 추가하면 모든 연결에서 질문에 답합니다.|まだルールがありません。ルールを追加すると、すべての接続で質問に応答します。|暂无规则。添加规则后，每次连接都会应答问题。
Permission preset|권한 프리셋|権限プリセット|权限预设
Choose a preset|프리셋 선택|プリセットを選択|选择预设
Read-only: browse the root|읽기 전용: 루트 둘러보기|読み取り専用: ルートを閲覧|只读：浏览根目录
Browse and download|둘러보기와 다운로드|閲覧とダウンロード|浏览和下载
Browse, download, and approved commands|둘러보기, 다운로드, 승인된 명령|閲覧、ダウンロード、承認済みコマンド|浏览、下载和已批准的命令
Maximum allowed (review first)|최대 허용 (먼저 검토)|最大許可（先に確認）|最大允许（请先检查）
Apply to All Eligible Bookmarks|사용 가능한 모든 북마크에 적용|対象となるすべてのブックマークに適用|应用到所有符合条件的书签
Give this client every permission?|이 클라이언트에 모든 권한을 줄까요?|このクライアントにすべての権限を与えますか？|要授予此客户端所有权限吗？
bookmark(s).|개의 북마크.|件のブックマーク。|个书签。
bookmark(s)|북마크|ブックマーク|书签
Skipped|건너뜀|スキップ|已跳过
I understand the risks|위험을 이해했습니다|リスクを理解しました|我已了解风险
Commands still need approval each time. SFTP writes and commands without approval are not available through this API.|명령은 매번 승인이 필요합니다. SFTP 쓰기와 승인 없는 명령은 이 API로 열 수 없습니다.|コマンドは毎回承認が必要です。SFTP の書き込みと承認なしのコマンドはこの API では利用できません。|命令每次仍需审批。此 API 不提供 SFTP 写入和无需审批的命令。
Turn On|켜기|オンにする|开启
Register an agent client first.|먼저 에이전트 클라이언트를 등록하세요.|まずエージェントクライアントを登録してください。|请先注册代理客户端。
Register Client|클라이언트 등록|クライアントを登録|注册客户端
Choose the client that will receive this access.|이 권한을 받을 클라이언트를 선택하세요.|このアクセス権を受け取るクライアントを選んでください。|请选择要接收此访问权限的客户端。
Choose Client|클라이언트 선택|クライアントを選択|选择客户端
This server's host key is not trusted yet. Connect to it once in PromeFTP to trust it.|이 서버의 호스트 키를 아직 신뢰하지 않았습니다. PromeFTP에서 한 번 연결해 신뢰하세요.|このサーバーのホストキーはまだ信頼されていません。PromeFTPで一度接続して信頼してください。|此服务器的主机密钥尚未受信任。请先在 PromeFTP 中连接一次以信任它。
Show log|로그 보기|ログを表示|显示日志
No log is kept for this session.|이 세션의 로그는 보관되지 않았습니다.|このセッションのログは保存されていません。|此会话未保留日志。
Shows a question from a server that an agent session is waiting for you to answer. This section appears only when a request is waiting.|에이전트 세션이 서버 질문에 답을 기다릴 때 여기에 표시됩니다. 대기 중인 요청이 있을 때만 이 섹션이 보입니다.|エージェントセッションがサーバーの質問への回答を待っているときに表示されます。待機中のリクエストがあるときだけこのセクションが表示されます。|代理会话等待您回答服务器问题时会在此显示。仅在有待处理请求时显示此部分。
Transfers finished|전송 완료|転送完了|传输完成
Auth|인증|認証|认证
Auth response rule|인증 응답 규칙|認証応答ルール|认证应答规则
Authentication settings|인증 설정|認証設定|身份验证设置
No matching snippets. Use + to add one.|일치하는 스니펫이 없습니다. +로 추가하세요.|一致するスニペットがありません。+ で追加してください。|没有匹配的代码片段。使用 + 添加。
No snippets yet. Use + to add one.|아직 스니펫이 없습니다. +로 추가하세요.|まだスニペットがありません。+ で追加してください。|暂无代码片段。使用 + 添加。
Snippet|스니펫|スニペット|代码片段
Master switch. Turns on both all-host rules and per-host answers for connections. When it is off, neither is used.|마스터 스위치입니다. 켜면 모든 호스트 규칙과 호스트별 응답을 연결에 사용하고, 끄면 둘 다 사용하지 않습니다.|マスタースイッチです。オンにすると全ホスト向けルールとホストごとの応答を接続に使用し、オフにすると両方とも使用しません。|总开关。开启后连接会同时使用全局主机规则和按主机保存的应答；关闭后两者都不使用。
Rules that answer prompts on every SSH and SFTP connection. Match the exact text or a regular expression.|모든 SSH·SFTP 연결의 질문에 응답하는 규칙입니다. 질문 문장을 정확히 일치시키거나 정규식을 사용합니다.|すべての SSH・SFTP 接続でプロンプトに応答するルールです。質問文を完全一致させるか、正規表現を使います。|在每个 SSH 和 SFTP 连接中应答提示的规则。可按完整文本或正则表达式匹配。
Answers saved after a successful sign-in on one connection. They are used only for that host.|한 연결에서 로그인에 성공한 뒤 저장된 응답입니다. 해당 호스트에서만 사용합니다.|1 つの接続でサインインに成功した後に保存された応答です。そのホストにのみ使用します。|某个连接成功登录后保存的应答，仅用于该主机。
On: send the saved answer right away. Off: fill the field and wait for you to press Send.|켜면 저장된 응답을 바로 보냅니다. 끄면 입력란만 채우고 보내기를 기다립니다.|オン：保存済みの応答をすぐに送信します。オフ：入力欄に入れて送信ボタンを待ちます。|开启：立即发送已保存的应答。关闭：仅填入输入框，等待您点击发送。
Output is never discarded, so memory keeps growing while a session stays open.|출력을 버리지 않으므로 세션을 열어 두는 동안 메모리 사용량이 계속 늘어납니다.|出力を破棄しないため、セッションを開いたままにするとメモリ使用量が増え続けます。|输出不会被丢弃，因此会话保持打开时内存会持续增长。
Keeps the newest lines in memory. Older lines are discarded at the limit. Output is cleared when the session closes.|최근 줄을 메모리에 보관합니다. 한도를 넘으면 오래된 줄부터 버립니다. 세션을 닫으면 출력이 지워집니다.|最新の行をメモリに保持します。上限に達すると古い行から破棄します。セッションを閉じると出力は消去されます。|在内存中保留最新的行。达到上限时丢弃最旧的行。关闭会话后输出会被清除。
All-Host Rules|모든 호스트 규칙|全ホスト向けルール|全局主机规则
Per-Host Answers|호스트별 응답|ホストごとの応答|按主机的应答
Limit|제한|制限|限制
Unlimited|무제한|無制限|无限制
Copied|복사됨|コピーしました|已复制
Check Now|지금 확인|今すぐ確認|立即检查
MIT License|MIT 라이선스|MIT ライセンス|MIT 许可证
Open source notices|오픈소스 고지|オープンソースの告知|开源许可声明
SSH and SFTP in one macOS workspace.|SSH와 SFTP를 하나의 macOS 작업 공간에서|SSH と SFTP を 1 つの macOS ワークスペースで|在一个 macOS 工作区中使用 SSH 和 SFTP
Updates|업데이트|アップデート|更新
transfers finished|전송 완료|件の転送が完了|个传输已完成
Active|진행 중|進行中|进行中
Failed|실패|失敗|失败
Clear failed|실패 항목 지우기|失敗を消去|清除失败项
Hide transfers|전송 목록 접기|転送リストを隠す|隐藏传输列表
Search history|기록 검색|履歴を検索|搜索历史记录
Dismiss|닫기|閉じる|关闭
Interrupted transfers|중단된 전송|中断された転送|已中断的传输
Unfinished transfers|완료되지 않은 전송|未完了の転送|未完成的传输
Output stays in memory while the session is open and is never discarded. Closing the session clears it.|세션을 여는 동안 출력이 메모리에 남고 버려지지 않습니다. 세션을 닫으면 출력이 지워집니다.|セッションを開いている間、出力はメモリに保持され、破棄されません。セッションを閉じると出力は消去されます。|会话打开期间输出保留在内存中且不会被丢弃。关闭会话后输出会被清除。
Reconnect SFTP, then retry.|SFTP를 다시 연결한 뒤 재시도하세요.|SFTP に再接続してから再試行してください。|请重新连接 SFTP 后重试。
No transfers yet.|아직 전송 기록이 없습니다.|まだ転送の履歴はありません。|暂无传输记录。
No matching transfers.|일치하는 전송이 없습니다.|一致する転送はありません。|没有匹配的传输。
Pause transfer|전송 일시 정지|転送を一時停止|暂停传输
Resume transfer|전송 계속|転送を再開|继续传输
Access saved|접근 권한을 저장했습니다|アクセス権を保存しました|访问权限已保存
Access removed|접근 권한을 삭제했습니다|アクセス権を削除しました|已移除访问权限
Save failed|저장 실패|保存に失敗しました|保存失败
To allow SFTP browsing, enter a remote path that starts with /.|SFTP를 허용하려면 /로 시작하는 경로를 입력하세요.|SFTP 参照を許可するには、/ で始まるリモートパスを入力してください。|要允许 SFTP 浏览，请输入以 / 开头的远程路径。
Use lowercase letters, numbers, hyphens, and underscores, up to 64 characters.|소문자·숫자·-·_만 사용하고 64자 이내로 입력하세요.|小文字、数字、-、_ のみを使い、64 文字以内で入力してください。|仅可使用小写字母、数字、- 和 _，最多 64 个字符。
Enter a task name and a fixed command together.|작업 이름과 고정 명령을 함께 입력하세요.|タスク名と固定コマンドを両方入力してください。|请同时输入任务名称和固定命令。
Enter an absolute remote path that starts with /.|/로 시작하는 원격 경로를 입력하세요.|/ で始まるリモートパスを入力してください。|请输入以 / 开头的远程路径。
This bookmark can't be used by agents. Check its SSH settings.|이 북마크는 에이전트에 사용할 수 없습니다. SSH 설정을 확인하세요.|このブックマークはエージェントで使用できません。SSH 設定を確認してください。|此书签无法供代理使用，请检查其 SSH 设置。
The bookmark changed after this page loaded. Choose it again and save.|이 페이지를 연 뒤 북마크가 바뀌었습니다. 북마크를 다시 고른 뒤 저장하세요.|このページを開いた後にブックマークが変わりました。もう一度選んで保存してください。|打开此页面后书签已更改。请重新选择后保存。
Choose at least one permission: SFTP browsing, approved SSH commands, or a task.|권한을 하나 이상 고르세요: SFTP 탐색, 승인 후 SSH 명령, 또는 작업.|少なくとも 1 つの権限を選んでください：SFTP 参照、承認済み SSH コマンド、またはタスク。|请至少选择一项权限：SFTP 浏览、需审批的 SSH 命令或任务。
Snippets (alternate key)|스니펫 (대체 키)|スニペット (代替キー)|代码片段（备用键）
About PromeFTP|PromeFTP 정보|PromeFTP について|关于 PromeFTP
Guide|가이드|ガイド|指南
Quick Guide|빠른 가이드|クイックガイド|快速指南
Search guide|가이드 검색|ガイドを検索|搜索指南
No guide results|일치하는 가이드가 없습니다|一致するガイドはありません|没有匹配的指南
Connect|연결|接続|连接
OpenSSH config|OpenSSH 설정|OpenSSH 設定|OpenSSH 配置
SFTP files|SFTP 파일|SFTP ファイル|SFTP 文件
File navigation|파일 탐색|ファイル移動|文件导航
Use the star to save the current folder and the bookmark button to open saved paths. Local favorites are shared across local panels; remote favorites are saved per connection on this Mac. Use the clock for recent paths. Mouse Back and Forward navigate visited paths. Right-click any file or folder and choose Copy Path to copy its full path.|별표로 현재 폴더를 저장하고 북마크 버튼으로 저장한 경로를 엽니다. 로컬 즐겨찾기는 모든 로컬 패널에서 공유하고 원격 즐겨찾기는 이 Mac의 접속별로 저장합니다. 시계 버튼으로 최근 경로를 엽니다. 마우스 뒤로/앞으로 버튼으로 방문한 경로를 이동합니다. 파일이나 폴더를 우클릭하고 경로 복사를 선택하면 전체 경로를 복사합니다.|星で現在のフォルダを保存し、ブックマークボタンから保存したパスを開きます。ローカルのお気に入りはすべてのローカルペインで共有し、リモートのお気に入りはこの Mac の接続ごとに保存します。時計ボタンで最近のパスを開きます。マウスの戻る／進むボタンで訪問したパスを移動します。ファイルやフォルダを右クリックして「パスをコピー」を選ぶと、フルパスをコピーします。|点击星标可保存当前文件夹，点击书签按钮可打开已保存的路径。本地收藏在所有本地面板间共享，远程收藏按连接保存在此 Mac 上。点击时钟按钮可打开最近的路径。鼠标后退/前进按钮可切换访问过的路径。右键点击文件或文件夹并选择“复制路径”，即可复制完整路径。
Tabs and splits|탭과 분할 화면|タブと分割|标签页与分屏
Workspaces|워크스페이스|ワークスペース|工作区
Transfer queue and folder compare|전송 큐와 폴더 비교|転送キューとフォルダ比較|传输队列与文件夹比较
Open Compare folders from a remote pane to compare the current folders. Select files and queue them for transfer. The Transfers drawer shows progress with pause, cancel, and retry controls. Reconnect this SFTP session before retrying interrupted work.|원격 패널에서 폴더 비교를 열어 현재 폴더를 비교합니다. 파일을 선택해 전송 큐에 넣습니다. 전송 드로어에서 진행률을 보고 일시정지, 취소, 재시도를 할 수 있습니다. 중단된 작업을 다시 시도하기 전에 이 SFTP 세션을 다시 연결하세요.|リモートペインから「フォルダを比較」を開いて現在のフォルダを比較します。ファイルを選んで転送キューに追加します。転送ドロワーで進行状況を確認し、一時停止、キャンセル、再試行ができます。中断された作業を再試行する前に、この SFTP セッションを再接続してください。|从远程窗格打开“比较文件夹”以比较当前文件夹。选择文件并加入传输队列。“传输”抽屉可查看进度，并提供暂停、取消和重试控制。重试被中断的任务前，请先重新连接此 SFTP 会话。
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
Token is shown once.|토큰은 한 번만 표시됩니다.|トークンは一度だけ表示されます。|令牌仅显示一次。
Token help|토큰 도움말|トークンのヘルプ|令牌帮助
Save for installed skills|설치된 스킬에 저장|インストール済みスキル用に保存|保存供已安装技能使用
Forget saved token|저장된 토큰 삭제|保存済みトークンを削除|删除已保存的令牌
Saved token for installed skills. The CLI reads it automatically.|설치된 스킬용 토큰이 저장되어 CLI가 자동으로 사용합니다.|インストール済みスキル用のトークンを保存しました。CLI が自動的に読み込みます。|已保存供已安装技能使用的令牌。CLI 会自动读取。
Token saved for installed skills.|설치된 스킬용 토큰을 저장했습니다.|インストール済みスキル用のトークンを保存しました。|已保存供已安装技能使用的令牌。
Token removed.|저장된 토큰을 삭제했습니다.|保存済みトークンを削除しました。|已删除已保存的令牌。
This token is shown only once. Save it for installed skills or copy it before closing. After this window closes, PromeFTP cannot show it again.|이 토큰은 한 번만 표시됩니다. 설치된 스킬용으로 저장하거나 닫기 전에 복사하세요. 창을 닫으면 PromeFTP에서 다시 볼 수 없습니다.|このトークンは一度だけ表示されます。インストール済みスキル用に保存するか、閉じる前にコピーしてください。ウィンドウを閉じると再表示できません。|此令牌仅显示一次。请保存供已安装技能使用，或在关闭前复制。窗口关闭后 PromeFTP 无法再次显示。
Saving stores the plain-text token in a local 0600 file. PromeFTP CLI reads it automatically; the token is never written into skill files.|토큰은 권한이 제한된 0600 로컬 파일에 평문으로 저장되고 PromeFTP CLI가 자동으로 읽습니다. 스킬 파일에는 토큰을 기록하지 않습니다.|トークンはアクセス制限された 0600 のローカルファイルに平文で保存され、PromeFTP CLI が自動的に読み込みます。スキルファイルには書き込みません。|令牌以明文保存在权限受限的本地 0600 文件中，PromeFTP CLI 会自动读取；令牌不会写入技能文件。
Forget saved token removes the local copy. Revoking its client also removes the saved token.|저장된 토큰 삭제로 로컬 사본을 지울 수 있습니다. 해당 클라이언트를 해지해도 토큰이 삭제됩니다.|保存済みトークンを削除するとローカルコピーが消去されます。対応するクライアントを無効化した場合も削除されます。|删除已保存令牌可移除本地副本。撤销其客户端也会删除该令牌。
Without saving, copy the token before closing and provide it as|저장하지 않으면 창을 닫기 전에 토큰을 복사해 다음 변수로 전달하세요.|保存しない場合は閉じる前にトークンをコピーし、次の環境変数として渡してください。|如果不保存，请在关闭前复制令牌，并将其作为以下变量提供：
. If lost, revoke and register the client again.|. 토큰을 잃어버리면 클라이언트를 해지한 뒤 다시 등록하세요.|。紛失した場合はクライアントを無効化して再登録してください。|。如果令牌丢失，请撤销客户端并重新注册。
Client name|클라이언트 이름|クライアント名|客户端名称
Register & Copy Token|등록하고 토큰 복사|登録してトークンをコピー|注册并复制令牌
Revoke Client|클라이언트 권한 철회|クライアントを無効化|撤销客户端
Registering a client opens a one-time token window. Copy the token before closing; it cannot be shown again. Set it as PROMEFTP_AGENT_TOKEN in your agent runtime. If it is lost, revoke this client and register it again. Do not paste the token into chat or shell history.|클라이언트를 등록하면 토큰이 한 번 표시되는 창이 열립니다. 창을 닫기 전에 복사하고 에이전트 실행 환경에서 PROMEFTP_AGENT_TOKEN으로 설정하세요. 닫은 뒤에는 다시 볼 수 없습니다. 토큰을 잃어버리면 해당 클라이언트를 해지하고 다시 등록하세요. 채팅이나 셸 명령 기록에 토큰을 붙여 넣지 마세요.|クライアントを登録すると、トークンを一度だけ表示するウィンドウが開きます。閉じる前にコピーし、エージェントの実行環境で PROMEFTP_AGENT_TOKEN に設定してください。閉じた後は再表示できません。紛失した場合はクライアントを無効化して再登録してください。チャットやシェルの履歴に貼り付けないでください。|注册客户端后会打开一次性令牌窗口。请在关闭前复制，并将其设置为智能体运行环境中的 PROMEFTP_AGENT_TOKEN。窗口关闭后无法再次查看。如果令牌丢失，请撤销客户端并重新注册。请勿将令牌粘贴到聊天或 shell 历史记录中。
This token is shown only once. Copy it before closing and set it as PROMEFTP_AGENT_TOKEN in your agent runtime. After this window closes, PromeFTP cannot show it again.|此令牌只显示一次。请在关闭前复制，并在智能体运行环境中将其设为 PROMEFTP_AGENT_TOKEN。窗口关闭后 PromeFTP 无法再次显示。|このトークンは一度だけ表示されます。閉じる前にコピーし、エージェントの実行環境で PROMEFTP_AGENT_TOKEN に設定してください。ウィンドウを閉じると、PromeFTP では再表示できません。|此令牌仅显示一次。请在关闭前复制，并将其设置为智能体运行环境中的 PROMEFTP_AGENT_TOKEN。窗口关闭后 PromeFTP 无法再次显示。
Agent token|에이전트 토큰|エージェントトークン|智能体令牌
Copy Token|토큰 복사|トークンをコピー|复制令牌
Token copied to clipboard.|토큰을 클립보드에 복사했습니다.|トークンをクリップボードにコピーしました。|令牌已复制到剪贴板。
Token hidden. Revoke and register a new client if you need another token.|토큰 창을 닫았습니다. 새 토큰이 필요하면 클라이언트를 해지한 뒤 다시 등록하세요.|トークンウィンドウを閉じました。新しいトークンが必要な場合はクライアントを無効化して再登録してください。|令牌窗口已关闭。如需新令牌，请撤销客户端并重新注册。
Skill installed. Reload skills or start a new agent session.|스킬을 설치했습니다. 에이전트에서 스킬을 새로 고치거나 새 세션을 시작하세요.|スキルをインストールしました。エージェントのスキルを再読み込みするか、新しいセッションを開始してください。|技能已安装。请重新加载智能体技能或开始新的智能体会话。
The installed app provides the CLI.|설치된 앱에 CLI가 포함되어 있습니다.|インストール済みアプリに CLI が含まれています。|已安装的应用包含 CLI。
Save access again after a bookmark change.|북마크를 변경한 뒤 접근 권한을 다시 저장하세요.|ブックマークを変更した後、アクセス権を再度保存してください。|书签更改后请重新保存访问权限。
Enter a client name.|클라이언트 이름을 입력하세요.|クライアント名を入力してください。|请输入客户端名称。
No matching activity.|일치하는 활동이 없습니다.|一致するアクティビティはありません。|没有匹配的活动。
Client|클라이언트|クライアント|客户端
Bookmark|북마크|ブックマーク|书签
SSH target|SSH 대상|SSH 接続先|SSH 目标
Jump host|점프 호스트|踏み台ホスト|跳板主机
Allow this SSH command once?|이 SSH 명령을 한 번 실행하도록 허용할까요?|この SSH コマンドを一度だけ実行しますか？|是否允许执行一次此 SSH 命令？
Deny|거부|拒否|拒绝
Run Command|명령 실행|コマンドを実行|运行命令
Agent client|에이전트 클라이언트|エージェントクライアント|智能体客户端
Default SSH user|기본 SSH 사용자|既定の SSH ユーザー|默认 SSH 用户
Register an agent client?|에이전트 클라이언트를 등록할까요?|エージェントクライアントを登録しますか？|要注册智能体客户端吗？
Register|등록|登録|注册
Close|닫기|閉じる|关闭
allowed|허용|許可|已允许
denied|거부|拒否|已拒绝
success|성공|成功|成功
failed|실패|失敗|失败
unknown|알 수 없음|不明|未知
waiting_for_user|사용자 응답 대기|ユーザー応答待ち|等待用户
closed|종료|終了|已关闭
Bookmark access|북마크 접근 권한|ブックマークへのアクセス|书签访问权限
Uses this bookmark's SSH settings.|이 북마크의 SSH 설정을 사용합니다.|このブックマークの SSH 設定を使用します。|使用此书签的 SSH 设置。
SSH connection help|SSH 연결 도움말|SSH 接続のヘルプ|SSH 连接帮助
OpenSSH aliases, Include, ProxyJump, and ProxyCommand are honored.|OpenSSH 별칭, Include, ProxyJump, ProxyCommand 설정을 적용합니다.|OpenSSH のエイリアス、Include、ProxyJump、ProxyCommand を適用します。|支持 OpenSSH 别名、Include、ProxyJump 和 ProxyCommand。
Target and jump host keys must be trusted. ProxyCommand may start a local process.|대상과 점프 호스트의 키를 미리 신뢰해야 합니다. ProxyCommand는 로컬 프로세스를 실행할 수 있습니다.|接続先と踏み台ホストの鍵を事前に信頼する必要があります。ProxyCommand はローカルプロセスを起動する場合があります。|目标主机和跳板主机的密钥必须已受信任。ProxyCommand 可能会启动本地进程。
PAM login strings like account@host@account@host are accepted as SSH usernames.|account@host@account@host 형태의 PAM 로그인 문자열을 SSH 사용자명으로 사용할 수 있습니다.|account@host@account@host のような PAM ログイン文字列を SSH ユーザー名として使用できます。|可将 account@host@account@host 格式的 PAM 登录字符串用作 SSH 用户名。
Showing the 5 most recent activities.|최근 활동 5건을 표시합니다.|最近のアクティビティ 5 件を表示しています。|显示最近 5 条活动记录。
Use a valid SSH host name or alias.|유효한 SSH 호스트명 또는 별칭을 입력하세요.|有効な SSH ホスト名またはエイリアスを指定してください。|请输入有效的 SSH 主机名或别名。
Use a valid SSH username.|유효한 SSH 사용자 이름을 입력하세요.|有効な SSH ユーザー名を指定してください。|请输入有效的 SSH 用户名。
Use an absolute path for the identity file.|개인 키 파일은 절대 경로로 지정하세요.|秘密鍵ファイルには絶対パスを指定してください。|请为身份文件使用绝对路径。
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
Register a client to create an agent token.|에이전트 토큰을 만들려면 클라이언트를 등록하세요.|エージェントトークンを作成するにはクライアントを登録してください。|注册客户端以创建智能体令牌。
Choose client|클라이언트 선택|クライアントを選択|选择客户端
All|전체|すべて|全部
Detected|감지됨|検出済み|已检测
Automatic updates|자동 업데이트|自動更新|自动更新
From|시작일|開始日|开始日期
Result|결과|結果|结果
Operation|작업|操作|操作
Request ID|요청 ID|リクエスト ID|请求 ID
Session ID|세션 ID|セッション ID|会话 ID
Agent|에이전트|エージェント|智能体
Scope|범위|範囲|范围
User|사용자|ユーザー|用户
Project|프로젝트|プロジェクト|项目
Save as New Bookmark|새 북마크로 저장|新しいブックマークとして保存|另存为新书签
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
Add path to favorites|경로 즐겨찾기에 추가|パスをお気に入りに追加|将路径添加到收藏夹
Remove path from favorites|경로 즐겨찾기에서 제거|パスをお気に入りから削除|从收藏夹中移除路径
Favorite folders|즐겨찾는 폴더|お気に入りのフォルダ|收藏的文件夹
Transfers|전송|転送|传输
Edit Path|경로 편집|パスを編集|编辑路径
Rename Favorite|즐겨찾기 이름 변경|お気に入り名を変更|重命名收藏
Move Up|위로 이동|上へ移動|上移
Move Down|아래로 이동|下へ移動|下移
Remove from Favorites|즐겨찾기에서 제거|お気に入りから削除|从收藏夹移除
Retry|재시도|再試行|重试
Clear|지우기|クリア|清除
Folder comparison batch|폴더 비교 전송|フォルダ比較の転送|文件夹比较传输
Pause batch|묶음 일시 정지|バッチを一時停止|暂停批次
Cancel batch|묶음 취소|バッチをキャンセル|取消批次
Retry failed|실패 항목 재시도|失敗項目を再試行|重试失败项
Resume batch|묶음 재개|バッチを再開|恢复批次
Create folder|폴더 생성|フォルダを作成|创建文件夹
items|개 항목|件|项
source-only|원본에만 있음|ソースのみ|仅来源存在
destination-only|대상에만 있음|宛先のみ|仅目标存在
different|다름|異なる|不同
probably-equal|같을 가능성이 높음|同じ可能性が高い|可能相同
type-conflict|항목 유형 충돌|項目タイプが競合|类型冲突
path-conflict|대소문자 또는 유니코드 이름 충돌|大文字小文字またはUnicode名の競合|大小写或 Unicode 名称冲突
Folders are probably equal.|폴더가 같은 것으로 보입니다.|フォルダは同じようです。|文件夹可能相同。
items selected|개 항목 선택|件選択|项已选
Transfer progress|전송 진행률|転送の進行状況|传输进度
Details|세부 정보|詳細|详情
Files and empty folders can be selected; needed parent folders are created. Destination-only items are preserved.|파일과 빈 폴더를 선택할 수 있으며 필요한 상위 폴더는 자동 생성됩니다. 대상에만 있는 항목은 유지됩니다.|ファイルと空のフォルダを選択できます。必要な親フォルダは自動作成され、宛先だけの項目は保持されます。|可选择文件和空文件夹；必要时会创建父文件夹。仅存在于目标位置的项目会保留。
Folder comparison|폴더 비교|フォルダを比較|文件夹比较
Compare with|비교 대상|比較対象|比较对象
Destination-only items are preserved.|대상에만 있는 항목은 유지됩니다.|宛先にのみある項目は保持されます。|保留仅存在于目标中的项目。
Replace the remote file?|원격 파일을 덮어쓸까요?|リモートファイルを置き換えますか？|覆盖远程文件？
Replace the local file?|로컬 파일을 덮어쓸까요?|ローカルファイルを置き換えますか？|覆盖本地文件？
Comparing folders|폴더 비교 중|フォルダを比較中|正在比较文件夹
Cancel comparison|비교 취소|比較をキャンセル|取消比较
items scanned|개 항목 확인|件を確認|项已扫描
When a destination file exists|대상 파일이 이미 있을 때|宛先ファイルが存在する場合|目标文件已存在时
Ask each time|매번 확인|毎回確認|每次询问
Skip existing|기존 파일 건너뛰기|既存ファイルをスキップ|跳过现有文件
Replace existing|기존 파일 덮어쓰기|既存ファイルを置き換え|替换现有文件
Keep both|두 파일 모두 유지|両方のファイルを保持|保留两个文件
Queue selected|선택 항목 전송|選択項目を転送|传输所选项
Show details|세부 정보 펼치기|詳細を表示|显示详情
Hide details|세부 정보 접기|詳細を隠す|隐藏详情
Select all|전체 선택|すべて選択|全选
Checking for changes|변경 사항 확인 중|変更を確認中|正在检查更改
Compare folders|폴더 비교|フォルダを比較|比较文件夹
Difference|차이|差分|差异
Source and destination|원본 및 대상|ソースと宛先|来源和目标
Source|원본|ソース|来源
Destination|대상|宛先|目标
Cancel transfer|전송 취소|転送をキャンセル|取消传输
Pause|일시 정지|一時停止|暂停
Resume|계속|再開|继续
queued|대기 중|待機中|排队中
running|전송 중|転送中|传输中
waiting-conflict|응답 대기 중|応答待ち|等待响应
paused|일시 정지됨|一時停止中|已暂停
interrupted|중단됨|中断|已中断
cancelled|취소됨|キャンセル済み|已取消
completed|완료|完了|已完成
skipped|건너뜀|スキップ|已跳过
files to copy or update|개 파일 복사 또는 업데이트|件をコピーまたは更新|个文件待复制或更新
Files only; parent folders are created as needed. Destination-only files are preserved.|파일을 선택하세요. 필요한 상위 폴더는 자동 생성하며 대상에만 있는 파일은 유지합니다.|ファイルを選択してください。必要な親フォルダを作成し、宛先だけにあるファイルは保持します。|请选择文件。必要时会创建父文件夹，并保留仅存在于目标位置的文件。
No favorite folders|즐겨찾는 폴더 없음|お気に入りのフォルダはありません|没有收藏的文件夹
Could not save folder favorite.|폴더 즐겨찾기를 저장할 수 없습니다.|フォルダのお気に入りを保存できません。|无法保存文件夹收藏。
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
Modified|수정일|更新日時|修改时间
Size|크기|サイズ|大小
Type|종류|種類|类型
Link|링크|リンク|链接
Choose columns|표시 열 선택|表示列を選択|选择列
Open Folder|폴더 열기|フォルダを開く|打开文件夹
Refresh Folder|폴더 새로고침|フォルダを更新|刷新文件夹
New local folder|로컬 폴더 추가|ローカルフォルダを追加|新建本地文件夹
New remote folder|원격 폴더 추가|リモートフォルダを追加|新建远程文件夹
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
The server host key changed|서버 호스트 키가 바뀌었습니다|サーバーのホスト鍵が変更されました|服务器主机密钥已更改
New fingerprint|새 지문|新しいフィンガープリント|新指纹
Previous fingerprint|이전 지문|以前のフィンガープリント|之前的指纹
Trust this key only after you verify its fingerprint with the server administrator.|서버 관리자에게 지문을 확인한 뒤에만 이 키를 신뢰하세요.|サーバー管理者にフィンガープリントを確認した後にのみ、この鍵を信頼してください。|只有在与服务器管理员核对指纹后才信任此密钥。
Trust host keys automatically|호스트 키 자동 신뢰|ホストキーを自動的に信頼|自动信任主机密钥
Off (ask me)|끔 (매번 확인)|オフ(毎回確認)|关闭(每次确认)
New keys only|처음 보는 키만|初めてのキーのみ|仅首次出现的密钥
New and changed keys|처음 보는 키와 바뀐 키|初めてのキーと変更されたキー|首次出现和已更改的密钥
PromeFTP will trust a server key it has not seen before without asking. If the first connection is intercepted (man-in-the-middle), saved passwords and answers can be sent to the attacker automatically. You are responsible for this choice.|PromeFTP가 처음 보는 서버 키를 묻지 않고 신뢰합니다. 첫 연결이 중간자 공격을 받으면 저장된 비밀번호와 응답이 공격자에게 자동으로 전송될 수 있습니다. 이 선택의 책임은 사용자에게 있습니다.|PromeFTP は初めて見るサーバーキーを確認せずに信頼します。最初の接続が中間者攻撃を受けた場合、保存されたパスワードと応答が攻撃者に自動送信される可能性があります。この選択の責任はユーザーにあります。|PromeFTP 将不经询问信任首次出现的服务器密钥。如果首次连接遭到中间人攻击,已保存的密码和应答可能会被自动发送给攻击者。此选择的责任由您承担。
PromeFTP will also trust a key that differs from the one you trusted, without asking. A changed key is the main sign of a man-in-the-middle attack. Saved passwords and answers can be sent to the attacker automatically. You are responsible for this choice.|PromeFTP가 신뢰했던 키와 다른 키도 묻지 않고 신뢰합니다. 키가 바뀐 것은 중간자 공격의 대표적인 징후입니다. 저장된 비밀번호와 응답이 공격자에게 자동으로 전송될 수 있습니다. 이 선택의 책임은 사용자에게 있습니다.|PromeFTP は信頼済みのキーと異なるキーも確認せずに信頼します。キーの変更は中間者攻撃の主な兆候です。保存されたパスワードと応答が攻撃者に自動送信される可能性があります。この選択の責任はユーザーにあります。|PromeFTP 也将不经询问信任与您已信任密钥不同的密钥。密钥变更是中间人攻击的主要迹象。已保存的密码和应答可能会被自动发送给攻击者。此选择的责任由您承担。
Trust changed host keys automatically?|바뀐 호스트 키를 자동으로 신뢰할까요?|変更されたホストキーを自動的に信頼しますか?|要自动信任已更改的主机密钥吗?
Host key trusted automatically|호스트 키 자동 신뢰됨|ホストキーを自動的に信頼しました|已自动信任主机密钥
Don’t ask again for this verified key|이 키를 다시 묻지 않기|確認済みのこの鍵については再確認しない|不再询问此已验证的密钥
All Groups|모든 그룹|すべてのグループ|所有分组
Ungrouped|그룹 없음|グループなし|未分组
Show tab group|탭 그룹 표시|タブグループを表示|显示标签组
Rename Group…|그룹 이름 변경…|グループ名を変更…|重命名分组…
Ungroup Tabs|탭 그룹 해제|タブグループを解除|取消标签分组
Rename Group|그룹 이름 변경|グループ名を変更|重命名分组
Rename…|이름 변경…|名前を変更…|重命名…
Open|열기|開く|打开
Edit…|편집…|編集…|编辑…
Download|다운로드|ダウンロード|下载
Copy|복사|コピー|复制
Copy Path|경로 복사|パスをコピー|复制路径
Reveal in Finder|Finder에서 보기|Finderで表示|在 Finder 中显示
Move to Trash|휴지통으로 이동|ゴミ箱に入れる|移到废纸篓
Get Info|정보 가져오기|情報を見る|显示简介
Choose columns|열 선택|列を選択|选择列
..|..|..|..
Authentication response|인증 응답|認証への応答|身份验证响应
Bookmark changes saved|북마크 변경 사항을 저장했습니다|ブックマークの変更を保存しました|已保存书签更改
Local to Remote|로컬 → 원격|ローカルからリモートへ|本地到远程
New bookmark created|새 북마크를 만들었습니다|新しいブックマークを作成しました|已创建新书签
Paste into terminal|터미널에 붙여넣기|ターミナルに貼り付け|粘贴到终端
Reconnect the SFTP session before comparing.|비교하기 전에 SFTP를 다시 연결하세요.|比較する前に SFTP に再接続してください。|比较前请重新连接 SFTP。
Remote to Local|원격 → 로컬|リモートからローカルへ|远程到本地
Agent service could not start.|에이전트 서비스를 시작하지 못했습니다.|エージェントサービスを開始できませんでした。|无法启动智能体服务。
Another PromeFTP is still using the agent socket.|다른 PromeFTP가 아직 에이전트 소켓을 사용 중입니다.|別の PromeFTP がまだエージェントのソケットを使用しています。|另一个 PromeFTP 仍在使用智能体套接字。
Try Again|다시 시도|再試行|重试
Run commands without asking|명령을 묻지 않고 실행|確認なしでコマンドを実行|无需询问即可运行命令
Commands the agent sends run immediately without a confirmation window. Every command is still recorded in Activity.|에이전트가 보낸 명령이 확인 창 없이 바로 실행됩니다. 모든 명령은 활동 기록에 남습니다.|エージェントが送信したコマンドは、確認ウィンドウなしですぐに実行されます。すべてのコマンドはアクティビティに記録されます。|智能体发送的命令将立即运行，不再显示确认窗口。所有命令仍会记录在活动中。
Saved authentication is turned off in Authentication settings, so the agent will ask you for answers.|인증 설정에서 저장된 인증 사용이 꺼져 있어 에이전트가 응답을 물어봅니다.|認証設定で保存済みの認証がオフになっているため、エージェントが応答を尋ねます。|“身份验证”设置中已关闭已保存的身份验证，因此智能体会向您询问应答。
Open Authentication Settings|인증 설정 열기|認証設定を開く|打开身份验证设置
Access allowed|허용됨|許可済み|已允许
Save again|다시 저장 필요|再保存が必要|需要重新保存
Renew Access for Changed Bookmarks|변경된 북마크 권한 다시 저장|変更されたブックマークのアクセス権を再保存|为已更改的书签重新保存访问权限
Turn on local agent access to change these settings.|이 설정을 바꾸려면 로컬 에이전트 접속을 켜세요.|これらの設定を変更するには、ローカルのエージェントアクセスをオンにしてください。|如需更改这些设置，请先开启本地智能体访问。
This client gets browsing, downloads, commands that run without asking, automatic trust of new host keys, saved authentication and every rule and trigger, for|이 클라이언트는 탐색, 다운로드, 묻지 않는 명령 실행, 새 호스트 키 자동 신뢰, 저장된 인증, 모든 규칙과 트리거를 다음 북마크에 대해 받습니다:|このクライアントは、閲覧、ダウンロード、確認なしで実行されるコマンド、新しいホストキーの自動信頼、保存済み認証、すべてのルールとトリガーを次のブックマークに対して得ます：|此客户端将获得以下书签的浏览、下载、无需询问即可运行的命令、新主机密钥的自动信任、已保存认证以及所有规则和触发器：
Choose a bookmark.|북마크를 선택하세요.|ブックマークを選んでください。|请选择书签。
Add an SSH bookmark first.|먼저 SSH 북마크를 추가하세요.|先に SSH ブックマークを追加してください。|请先添加 SSH 书签。
Backup|백업|バックアップ|备份
Backing up…|백업 중…|バックアップ中…|正在备份…
Backed up as|다음 이름으로 백업됨:|次の名前でバックアップしました:|已备份为
items backed up|개 항목 백업됨|項目をバックアップしました|个项目已备份
This server doesn't allow shell commands. Copying through PromeFTP instead.|이 서버는 셸 명령을 허용하지 않아 PromeFTP를 거쳐 복사합니다.|このサーバーはシェルコマンドを許可していないため、PromeFTP 経由でコピーします。|此服务器不允许 shell 命令，将通过 PromeFTP 复制。
Split local pane right|로컬 패널을 오른쪽으로 분할|ローカルパネルを右に分割|向右拆分本地面板
Split local pane down|로컬 패널을 아래로 분할|ローカルパネルを下に分割|向下拆分本地面板
Close local pane|로컬 패널 닫기|ローカルパネルを閉じる|关闭本地面板
Backup failed|백업 실패|バックアップに失敗しました|备份失败
You don't have permission to write in this folder.|이 폴더에 쓸 권한이 없습니다.|このフォルダーに書き込む権限がありません。|您没有在此文件夹中写入的权限。
The server is out of disk space.|서버 디스크 공간이 부족합니다.|サーバーのディスク容量が不足しています。|服务器磁盘空间不足。
Links can't be backed up. Back up the original instead.|링크는 백업할 수 없습니다. 원본을 백업하세요.|リンクはバックアップできません。元のファイルをバックアップしてください。|无法备份链接。请改为备份原始项目。
Backup took too long and was stopped. Check the folder before retrying.|백업이 너무 오래 걸려 중단했습니다. 다시 시도하기 전에 폴더를 확인하세요.|バックアップに時間がかかりすぎたため中止しました。再試行する前にフォルダーを確認してください。|备份耗时过长已停止。重试前请先检查文件夹。
Too many backups with this name were made in the same second.|같은 초에 만든 같은 이름의 백업이 너무 많습니다.|同じ秒に同じ名前のバックアップが多すぎます。|同一秒内创建的同名备份过多。
Existing|기존 파일|既存のファイル|已有文件
Incoming|새 파일|新しいファイル|新文件
Newer|더 최신|より新しい|更新
Remember this choice|이 선택 기억|この選択を記憶|记住此选择
You can change this in Settings > General.|설정 > 일반에서 바꿀 수 있습니다.|設定 > 一般で変更できます。|可以在“设置 > 通用”中更改。
Replace if newer|더 최신이면 덮어쓰기|新しい場合は置き換え|较新时替换
File Transfers|파일 전송|ファイル転送|文件传输
When a file already exists|같은 이름의 파일이 있을 때|同じ名前のファイルがある場合|存在同名文件时
PromeFTP uses this choice without asking. Choose Ask each time to see the question again.|PromeFTP가 묻지 않고 이 선택을 사용합니다. 다시 확인하려면 "매번 확인"을 고르세요.|PromeFTP はこの選択を確認せずに使用します。再度確認するには「毎回確認」を選んでください。|PromeFTP 将不再询问并使用此选择。若要再次询问，请选择“每次询问”。
Skip|건너뛰기|スキップ|跳过
Replace|덮어쓰기|置き換え|替换
Apply to the rest of this transfer|이번 전송의 나머지 항목에도 적용|この転送の残りの項目にも適用|应用于本次传输的其余项目
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
