# 暗号化バックアップの一回実行（本番未適用）

`runtime/backup-run.js` は、既存の暗号化・復元検証機能を用いて、日時と乱数を付けた新しいバックアップを**一回だけ**作るための実行入口です。オーナー最終承認前の本番デプロイ、課金、受講生の実データ操作は行っていません。

## 実行前の必須条件

- Node.js 22.16以降、永続化された非公開SQLiteデータベース、16文字以上の強いバックアップ専用パスフレーズ。
- `MICHIRU_BACKUP_DIR` は**事前に存在する所有者専用（0700）のディレクトリ**。公開リポジトリ内・シンボリックリンク・権限が広いディレクトリは拒否します。ディレクトリを勝手に作らないため、外部ディスクのマウント忘れを検知しやすくなります。
- このプログラムはディスクが実際に別拠点・外部ストレージであるかは判定しません。マウントの実体、空き容量、保管先の権限、秘密鍵の安全な別管理は運用担当が確認してください。

## 非公開のテスト環境での操作例

```sh
# 下記パスは例です。公開リポジトリやCIのログへ実際のパスフレーズを書かない。
export MICHIRU_DB=/private/data/michiru.sqlite
export MICHIRU_BACKUP_DIR=/private/mounted-backup
read -r -s -p 'Backup passphrase: ' MICHIRU_BACKUP_PASSPHRASE; echo
export MICHIRU_BACKUP_PASSPHRASE
node runtime/backup-run.js
unset MICHIRU_BACKUP_PASSPHRASE
```

成功時は `michiru-日時-乱数.enc` を0600権限で新規作成し、公開前と公開後に暗号化ファイルの復号・SQLite整合性を確認します。同名ファイルは上書きしません。実行ごとに新しいファイルを作るため、**定期実行を設定しただけでは古い世代が削除されず容量を消費**します。

## 本番前に残ること

この一回実行ツールは、定期実行・外部転送・保管世代管理・障害通知・復元訓練を**自動化しません**。それらの仕組みと運用担当を確定し、外部保管から戻したファイルに `node runtime/encrypted-backup.js verify /private/path/file.enc` を実行して復元演習してください。秘密鍵を失うと復元できません。受講生の端末内だけにある下書き等はこのサーバーDBバックアップに含まれません。

PR #10 の確認用追加であり、正式原稿・33秒瞑想原文・Canva/Drive原本・保護対象リポジトリは変更しません。最終承認前にマージ・公開・有料サービス契約をしません。

## 暗号化ファイルの外部保管先への安全なコピー（レビュー用・未運用）

`runtime/offsite-copy.js` は、`backup-run.js` で作成した暗号化 `.enc` を、**運用担当が事前に用意・マウントした**別の非公開ディレクトリへコピーします。保存後にパスフレーズで復号しSQLite整合性を確認してから、最終ファイル名で公開します。既存ファイルを上書きせず、失敗時は一時ファイルを削除します。

```sh
# 実パスフレーズはコマンド履歴・GitHub・CIログへ書かない。
export MICHIRU_OFFSITE_DIR=/private/mounted-offsite
read -r -s -p 'Backup passphrase: ' MICHIRU_BACKUP_PASSPHRASE; echo
export MICHIRU_BACKUP_PASSPHRASE
node runtime/offsite-copy.js /private/mounted-backup/michiru-日時-乱数.enc
unset MICHIRU_BACKUP_PASSPHRASE
```

保存先は**既存の0700ディレクトリ**で、シンボリックリンクは不可です。元の `.enc` は通常ファイル・0600権限が必要です。元ファイルは削除しません。別の場所へコピーして復元検証する機能であり、**実際に別サーバー・別拠点・クラウドへ転送されたことの証明ではありません**。マウントの実体、外部保存先の障害耐性、定期実行、保持期間、空き容量監視、失敗通知、秘密の別管理、外部から戻したファイルの復元演習は引き続き未完了です。公開前にこれらを運用担当が確認してください。
