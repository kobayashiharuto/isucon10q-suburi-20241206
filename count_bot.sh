#!/bin/bash

# ログファイルのパス
LOG_FILE="/var/log/nginx/access.log"

# 時間の指定 (引数)
if [ $# -ne 1 ]; then
    echo "Usage: $0 HH:MM"
    exit 1
fi

TARGET_TIME="$1"

# 正規表現リストを OR (|) でつなげたパターン
BOT_PATTERNS='ISUCONbot(-Mobile)?|ISUCONbot-Image\/|Mediapartners-ISUCON|ISUCONCoffee|ISUCONFeedSeeker(Beta)?|crawler \(https:\/\/isucon\.invalid\/(support\/faq\/|help\/jp\/)|isubot|Isupider|Isupider(-image)?\+|(bot|crawler|spider)(?:[-_ .\/;@()]|$)'

# 指定された時間以降のログを抽出
TARGET_LOGS=$(awk -v time="$TARGET_TIME" '$0 ~ time {print $0}' "$LOG_FILE")

# 指定時間以降のリクエスト総数
TOTAL_REQUESTS=$(echo "$TARGET_LOGS" | wc -l)

# 指定時間以降のボットリクエスト数をカウント
BOT_REQUESTS=$(echo "$TARGET_LOGS" | grep -E "$BOT_PATTERNS" | wc -l)

# 割合計算
if [ "$TOTAL_REQUESTS" -eq 0 ]; then
    echo "No requests found after $TARGET_TIME."
else
    BOT_PERCENTAGE=$(echo "scale=2; ($BOT_REQUESTS / $TOTAL_REQUESTS) * 100" | bc)
    echo "Total requests after $TARGET_TIME: $TOTAL_REQUESTS"
    echo "Bot requests after $TARGET_TIME: $BOT_REQUESTS"
    echo "Bot request percentage: $BOT_PERCENTAGE%"
fi