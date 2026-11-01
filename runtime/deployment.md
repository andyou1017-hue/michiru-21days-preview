# HTTPS設置用の構成（未公開・オーナー承認待ち）

Dockerfile・compose.yaml・Caddyfileを用意した。作成しただけでサーバーやドメインを取得したわけではない。
必要なもの：Docker Compose対応サーバー、ドメインのDNS設定、80/443番への接続、永続ディスク、オーナーの正式公開承認。

## 公開前に確認できること

```sh
docker compose build
MICHIRU_DOMAIN=review.example.invalid MICHIRU_RELEASE_APPROVED=no docker compose config --quiet
```

上記はビルドと設定検査で、正式公開は行わない。実ドメイン未指定・承認フラグなしでは本番用起動を拒否する。
アプリは127.0.0.1:8341だけで待機し、Caddyとネットワークを共有する。外へ出すポートはCaddyの80/443だけ。アプリの8341番やDBは外部公開しない。
DBはprivate-data、TLS証明書は別のtls-dataボリュームに保持する。Nodeプロセスは非root、コード領域は読み取り専用。DBと補助ファイルは所有者だけが読める権限で作成する。

## 最終承認後の設置

DNSが設置先へ向いていることを確認してから、実ドメインを環境変数MICHIRU_DOMAINへ設定する。
オーナーの最終承認後にのみ、MICHIRU_RELEASE_APPROVED=yesを設定し、`docker compose up -d --build` を実行する。
HTTPS証明書の取得・HTTPからHTTPSへの移動・未招待拒否・招待登録・Safariでの記録保存と復元を実ドメインで確認する。この作業ではupやDNS変更は実行していない。

管理者の招待発行は `docker compose exec app node runtime/manage.js invite student@example.com`。
表示されるコードは本人へ安全に渡し、公開ログやリポジトリへ貼らない。メール送信は自動化していない。

## バックアップ

`docker compose exec app node runtime/backup.js /data/backups/unique-name.sqlite` で、稼働中の招待・アカウント・セッションDBを整合性確認後にバックアップする。
保存済みファイルは上書きしない。バックアップは600権限で作成する。DBボリュームとは別の保管先にも、アクセスを制限して保管する必要がある。
復元はサービスを停止し、現DB一式を先に退避したうえで、整合性検証したバックアップをDBへ置いて再起動する。稼働中のDBやWALを個別に差し替えない。
受講生が書いた文章は現在ブラウザ内保存なので、このサーバーDBバックアップには含まれない。受講生の記録はアプリのバックアップ機能で別途保存する。

## まだ配布可とは扱わない

本番設置先・ドメイン・Safari実機確認が未設定／未完了。受講生画面の自動同期と、サーバー側で実装した7日間の手紙開封制限APIへの画面接続、パスワード再設定も残る。画面だけの時計確認は本番用の7日制限の代わりにはならない。
承認フラグはオーナー確認の代わりにならない。未承認でyesを設定して公開しない。
