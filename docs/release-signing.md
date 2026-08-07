# 署名付きリリースビルドの手順書（m6-t12）

**この文書の読者**: SSL.com も Apple Developer も初めて操作する人。画面のどこを開き、何をコピーし、どこへ貼るかまで書いてある。エージェント（AI）との伴走作業を前提に、1項目ずつ進めればよい構成にしてある。

**全体像**: 署名付きビルドは GitHub Actions の `Build and Release` ワークフローを手動実行（release チェック ON）して作る。そのために「Apple の資格情報5点」「SSL.com の資格情報4点」を一度だけ取得し、GitHub の environment `release` に登録する。以後のリリースは Part D の実行だけで済む。証明書の有効期限が切れたときだけ Part A/B をやり直す。

| # | secret 名 | 何か | 取得先 |
|---|---|---|---|
| 1 | `APPLE_CERT_BASE64` | Developer ID Application 証明書（.p12）の base64 | Part A |
| 2 | `APPLE_CERT_PASSWORD` | .p12 書き出し時に付けたパスワード | Part A |
| 3 | `APPLE_ID` | Apple ID のメールアドレス | Part A |
| 4 | `APPLE_APP_SPECIFIC_PASSWORD` | アプリ用パスワード（Apple ID の設定で発行） | Part A |
| 5 | `APPLE_TEAM_ID` | 10桁の Team ID | Part A |
| 6 | `ES_USERNAME` | SSL.com アカウントのユーザー名（メール） | Part B |
| 7 | `ES_PASSWORD` | SSL.com アカウントのパスワード | Part B |
| 8 | `ES_CREDENTIAL_ID` | eSigner の署名証明書 ID（UUID 形式） | Part B |
| 9 | `ES_TOTP_SECRET` | eSigner 2FA の TOTP シークレット（base32 文字列） | Part B |

> ⚠️ この9点はすべて秘密情報である。チャットやリポジトリに貼らないこと。登録先は Part C の environment secrets のみ。

---

## Part A: Apple の資格情報5点

### A-1. CSR（証明書署名要求）を作る — Mac のキーチェーンアクセス

1. Mac で **キーチェーンアクセス** を開く（Spotlight で「キーチェーン」と検索）
2. メニューバー → **キーチェーンアクセス → 証明書アシスタント → 認証局に証明書を要求...**
3. 「ユーザのメールアドレス」= Apple ID のメール、「通称」= 任意（例: Maplat Developer ID）
4. **「ディスクに保存」を選択**し、「鍵ペア情報を指定」にチェック → 続ける
5. 鍵のサイズ 2048ビット / RSA のまま → 続ける → `CertificateSigningRequest.certSigningRequest` が保存される

### A-2. Developer ID Application 証明書を発行する

1. [https://developer.apple.com/account](https://developer.apple.com/account) にサインイン
2. **Certificates, Identifiers & Profiles → Certificates** → 青い「＋」ボタン
3. 一覧の下の方にある **「Developer ID Application」** を選ぶ（似た名前に注意 — App Store 用の「Apple Distribution」では**ない**。「Developer ID Installer」でも**ない**）
   - ⚠️ この項目は **Account Holder（アカウント保持者）権限**でしか作れない。表示されない場合は権限を確認
4. Profile Type を聞かれたら既定（G2 Sub-CA）のまま → A-1 の CSR ファイルをアップロード → Continue
5. 発行された証明書（.cer）を **Download** する

### A-3. .p12 に書き出して base64 化する（secrets 1・2）

1. ダウンロードした .cer をダブルクリック → キーチェーンアクセスの「ログイン」キーチェーンに入る
2. キーチェーンアクセスで **「証明書」カテゴリ**を開き、`Developer ID Application: <名前> (<TeamID>)` を探す
3. その証明書を**右クリック → 書き出す**。フォーマットは **.p12** を選び、保存
4. パスワードを求められるので**新しく決めて入力**（これが `APPLE_CERT_PASSWORD`）
5. ターミナルで base64 化してクリップボードへ:
   ```bash
   base64 -i ~/Desktop/certificate.p12 | pbcopy
   ```
   貼り付けた内容が `APPLE_CERT_BASE64`
6. 済んだら .p12 ファイルは安全な場所（パスワードマネージャ等）に保管し、デスクトップから片付ける

### A-4. アプリ用パスワードを発行する（secrets 3・4）

公証（notarization）は Apple ID 本体のパスワードではなく**アプリ用パスワード**を使う。

1. [https://account.apple.com](https://account.apple.com) にサインイン
2. **サインインとセキュリティ → アプリ用パスワード** → 「＋」または「アプリ用パスワードを生成」
3. 名前は任意（例: `maplat-notarize`）→ 生成された `xxxx-xxxx-xxxx-xxxx` 形式を控える（**この画面を閉じると二度と見られない**）
4. `APPLE_ID` = Apple ID のメールアドレス / `APPLE_APP_SPECIFIC_PASSWORD` = 生成された値

### A-5. Team ID を確認する（secret 5）

1. [https://developer.apple.com/account](https://developer.apple.com/account) → 下へスクロールして **Membership details**
2. **Team ID**（10桁の英数字）をコピー → `APPLE_TEAM_ID`

---

## Part B: SSL.com eSigner の資格情報4点

前提知識: eSigner は**クラウド署名**。証明書ファイル（p12）は存在せず、SSL.com のサーバ上の鍵で署名する（2023年以降のコード署名は秘密鍵の HSM 保管が必須のため）。CI はアカウント情報 + 証明書 ID + ワンタイムパスワードの種で署名する。

### B-1. ユーザー名とパスワード（secrets 6・7）

- `ES_USERNAME` / `ES_PASSWORD` = SSL.com にログインするときのメールアドレスとパスワードそのもの

### B-2. Credential ID を確認する（secret 8）

1. [https://www.ssl.com](https://www.ssl.com) にログイン → ダッシュボードの **Orders**（注文）一覧
2. コード署名証明書（EV/OV Code Signing）の注文をクリックして詳細を開く
3. 詳細ページ内の **「eSigner」タブ（またはセクション）**を開く
4. **Credential ID**（`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 形式の UUID）をコピー → `ES_CREDENTIAL_ID`
   - 見つからない場合、eSigner への証明書の enrollment（登録）がまだの可能性がある。その場合同ページに「eSigner に登録」する案内が出るので、案内に従って登録すると 2FA 設定（B-3）に進む

### B-3. TOTP シークレットを控える（secret 9）

eSigner の署名には 2FA（ワンタイムパスワード）が必須で、CI は **TOTP シークレット文字列**から OTP を自動生成する。

1. eSigner の 2FA 設定画面（B-2 の enrollment 時、または SSL.com ダッシュボードの eSigner 設定）で QR コードが表示される
2. QR コードの近くにある **「text version」（テキスト表示）**リンクを開くと、base32 の文字列（例: `JBSWY3DPEHPK3PXP...`）が見える。**これが `ES_TOTP_SECRET`**
3. ⚠️ **既に認証アプリで設定済みで文字列を控えていない場合**: ダッシュボードから eSigner の 2FA を**リセット**して再設定し、そのとき表示される文字列を保存する（リセットしても証明書自体には影響しない）

### B-4. 知っておくべき注意2点

- CI は **production 環境**（`environment_name: PROD`）で署名する。SSL.com の sandbox はテスト用で、本物の署名にならない
- **署名は1回ごとに課金**される。本ワークフローはインストーラ（Setup.exe × 2 アーキテクチャ）のみ署名する設計で、**1リリース = 2署名**。アプリ内部の exe は署名しない（SmartScreen の評価対象は主にダウンロードされるインストーラであるため。将来問題が出たら署名範囲の拡大を再検討）
- もし CI の署名ステップが「hash needs to be scanned first」で失敗したら、eSigner の Malware Blocker が有効になっている。build.yml の eSigner ステップに `malware_block: 'true'` を追加するか、SSL.com 側で Malware Blocker を無効化する

---

## Part C: GitHub に environment `release` を作って secrets を登録する

1. [https://github.com/code4history/MaplatEditor/settings/environments](https://github.com/code4history/MaplatEditor/settings/environments) を開く（Settings → Environments）
2. **New environment** → 名前は正確に **`release`** → Configure environment
3. **Deployment protection rules** で **Required reviewers** にチェック → 自分（kochizufan）を追加 → Save protection rules
   - これで release ビルドは**実行のたびに承認ボタンを押す**流れになる（誤爆と署名回数の浪費を防ぐ）
4. 同じ画面の **Environment secrets** → **Add environment secret** で、冒頭の表の9点を1つずつ登録する
   - ⚠️ **repo 全体の secrets（Settings → Secrets and variables → Actions）には置かない**こと。environment に置くから push ビルドから読めない、という設計である

補足（見た目の話・実害なし）:
- environment `ci` は保護なしのダミーで、初回の push ビルド時に自動作成されて環境一覧に載る。消さなくてよい
- environment を使う関係で、push ビルドにも「deployment」記録が残るようになる。GitHub の仕様で、動作への影響はない

---

## Part D: 署名付きリリースビルドの実行

1. [https://github.com/code4history/MaplatEditor/actions/workflows/build.yml](https://github.com/code4history/MaplatEditor/actions/workflows/build.yml) を開く
2. 右上の **Run workflow** → ブランチを選ぶ → **「リリースビルド（...）」にチェック** → Run workflow
   - 実行できる条件: **master ブランチ**、または **prerelease バージョン**（package.json の version に `-` を含む。例 `1.0.0-rc1`）の任意ブランチ。正式版バージョンを master 以外から release 実行するとガードが止める
3. 実行が始まると build-mac / build-win が **承認待ち（Review deployments）**になる → 黄色の表示をクリックし、`release` にチェックして **Approve and deploy**
4. 完了後の確認:
   - **Artifacts**: mac-artifacts（.dmg / .dmg.blockmap / latest-mac.yml）、win-artifacts（Setup.exe / .exe.blockmap / latest.yml）、linux-artifacts（.AppImage / latest-linux.yml）
   - **Releases** に draft（下書き）の Release ができている → 内容を確認して人間が Publish する（自動公開はしない）
5. 署名の確認（任意・初回推奨）:
   - Mac: DMG からアプリを取り出し `codesign -dv --verbose=2 MaplatEditor.app`、公証は `spctl -a -vv MaplatEditor.app`（`accepted` / `Notarized Developer ID` と出れば成功）
   - Windows: Setup.exe を右クリック → プロパティ → **デジタル署名**タブに SSL.com 発行の署名が見える

## Part E: 仕様メモ（運用者向け）

- **push（master / glm52 / foss4g-hiroshima）は常に無署名ビルド**。旧仕様の「master push で Mac 署名のみ」は m6-t12 で廃止した（secrets を environment に隔離したため）
- Windows は**署名後に auto-update メタデータを再生成**している（`scripts/m6-t12/resign-update-metadata.mjs`）。署名でバイナリが変わるため、これを怠ると自動更新が壊れる。ワークフローが自動でやるので通常は意識不要
- Linux（AppImage）は署名なし（現行方針）
- 証明書の期限が切れたら: Apple → Part A をやり直して secrets 1・2 を更新 / SSL.com → 証明書更新後、Credential ID が変わっていないか B-2 で確認
