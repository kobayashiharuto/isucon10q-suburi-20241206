#!/bin/bash

# 移動とGit更新
cd /home/isucon/isucon10q-suburi-20241206/webapp/nodejs
git pull

# Git情報を取得
COMMIT_SHA=$(git rev-parse HEAD)
REPO_URL=$(git config --get remote.origin.url)

# 必要な環境変数を設定
export DD_GIT_COMMIT_SHA="$COMMIT_SHA"
export DD_GIT_REPOSITORY_URL="$REPO_URL"

# /home/isucon/env.sh を生成
cat <<EOF > /home/isucon/env.sh
MYSQL_HOST=" 172.31.35.57"
MYSQL_PORT=3306
MYSQL_USER=isucon
MYSQL_DBNAME=isuumo
MYSQL_PASS=isucon
DD_GIT_COMMIT_SHA="${DD_GIT_COMMIT_SHA}"
DD_GIT_REPOSITORY_URL="${DD_GIT_REPOSITORY_URL}"
EOF

# 環境変数ファイルの権限を設定
chmod 644 /home/isucon/env.sh

# npmでアプリケーションをビルド
npm install

# systemctlをリロードしてサービスを再起動
sudo systemctl daemon-reload
sudo systemctl restart isuumo.nodejs.service

# 完了メッセージ
echo "Deployment complete."
echo "Datadog APM Configuration:"
echo "  - Commit SHA: $DD_GIT_COMMIT_SHA"
echo "  - Repository URL: $DD_GIT_REPOSITORY_URL"