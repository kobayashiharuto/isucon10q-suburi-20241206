#!/bin/bash

# 移動とGit更新
cd /home/isucon/isucon10q-suburi-20241206/webapp/nodejs
git reset --hard
git pull

# /home/isucon/env.sh を生成
cp /home/isucon/isucon10q-suburi-20241206/bin/env.sh /home/isucon/env.sh

# 環境変数ファイルの権限を設定
chmod 644 /home/isucon/env.sh

# npmでアプリケーションをビルド
npm install

# systemctlをリロードしてサービスを再起動
sudo systemctl daemon-reload
sudo systemctl restart isuumo.nodejs.service

# 完了メッセージ
echo "Deployment complete."