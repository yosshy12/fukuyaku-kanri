# Android版（ローカルファースト）

Android版のソースは `android-app/` にあります。既存のGitHub Pages版は、Android版への移行が完了するまでそのまま利用できます。

## 保存とバックアップ

- 正式なデータは端末内の `fukuyaku-kanri.db`（Room / SQLite）に即時保存されます。
- 服薬記録と薬にはUUID、作成日時、更新日時、削除状態、同期状態が付きます。
- Google Drive接続後は、通信可能時にWorkManagerがバックアップを実行します。
- Driveには日時入りのSQLiteファイルとUTF-8 CSVファイルを保存します。
- バックアップ画面には、最終成功日時と直近処理の成功・失敗が表示されます。
- SQLiteの最新バックアップは同じ画面から復元できます。

## Google Cloudの設定

Google Drive連携には、利用者がGoogleの許可画面で明示的に許可するOAuth方式を使います。サービスアカウント、秘密鍵、固定アクセストークンはアプリに入れません。

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを作成します。
2. `Google Drive API`を有効にします。
3. OAuth同意画面を設定します。公開前のテスト中は、本人とお母様のGoogleアカウントをテストユーザーへ追加します。
4. OAuthクライアントを「Android」で作成します。
5. パッケージ名に `jp.yosshy12.fukuyakukanri` を指定します。
6. インストールするAPKの署名証明書のSHA-1を登録します。
7. OAuthスコープには `https://www.googleapis.com/auth/drive.file` だけを追加します。

`drive.file`は、このアプリが作成したファイルと利用者が明示的に開いたファイルだけを扱う権限です。Drive全体を読み取る権限は要求しません。

## 既存スプレッドシートの取り込み

Android版の「バックアップ設定」から、これまで使用していたApps Script URLと接続キーを入力して「既存データを取り込む」を押します。薬リストと服薬記録を全件Roomへ取り込みます。

URLと接続キーはAndroid Keystoreで生成した鍵を使い、端末内でAES-GCM暗号化して保存します。移行後はスプレッドシートへ書き戻しません。

## ビルド

GitHubへ送信すると、`Build Android app`ワークフローがデバッグAPKを作成します。GitHubの `Actions` → `Build Android app` → 完了した実行 → `Artifacts` から `fukuyaku-kanri-debug-apk`を取得できます。

実際に継続利用する配布版では、固定の署名鍵をGitHub Secretsまたは安全なオフライン環境で管理し、そのSHA-1をGoogle Cloudへ登録してください。署名鍵をリポジトリへ直接保存してはいけません。
