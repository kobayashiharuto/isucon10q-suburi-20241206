#!/bin/bash

# ログファイルのパス
LOG_FILE="/var/log/nginx/access.log"

# 正規表現パターン
BOT_PATTERNS='ISUCONbot(-Mobile)?|ISUCONbot-Image\/|Mediapartners-ISUCON|ISUCONCoffee|ISUCONFeedSeeker(Beta)?|crawler \(https:\/\/isucon\.invalid\/(support\/faq\/|help\/jp\/)|isubot|Isupider|Isupider(-image)?\+|(bot|crawler|spider)(?:[-_ .\/;@()]|$)'

# 14:20以降のログをフィルタリング
MATCHED_LINES=$(awk '$4 ~ /06\/Dec\/2024:14:2[0-9]:|06\/Dec\/2024:14:[3-5][0-9]:|06\/Dec\/2024:15:/' "$LOG_FILE" | grep -E "$BOT_PATTERNS" | wc -l)
TOTAL_LINES=$(awk '$4 ~ /06\/Dec\/2024:14:2[0-9]:|06\/Dec\/2024:14:[3-5][0-9]:|06\/Dec\/2024:15:/' "$LOG_FILE" | wc -l)

# 結果を計算
if [ $TOTAL_LINES -gt 0 ]; then
    BOT_PERCENTAGE=$(echo "scale=2; ($MATCHED_LINES / $TOTAL_LINES) * 100" | bc)
    echo "Total requests (14:20 and later): $TOTAL_LINES"
    echo "Bot requests (14:20 and later): $MATCHED_LINES"
    echo "Bot request percentage: $BOT_PERCENTAGE%"
else
    echo "No requests found after 14:20."
fi

