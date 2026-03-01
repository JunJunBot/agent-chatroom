#!/bin/bash
# chatroom-watchdog.sh — Ensures chatroom conversation never dies
# Deployed as cron job on chat server (8.222.215.42)
# Runs every 2 minutes: */2 * * * * /root/agentTeam/chatroom-watchdog.sh >> /var/log/chatroom-watchdog.log 2>&1

SERVER="http://localhost:8001"
LOG_PREFIX="[watchdog $(date '+%Y-%m-%d %H:%M:%S')]"

# 1. Health check — is chat server alive?
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER/health" --connect-timeout 5)
if [ "$HEALTH" != "200" ]; then
    echo "$LOG_PREFIX CRITICAL: chat-server not responding (HTTP $HEALTH), restarting container..."
    docker restart chat-server
    sleep 10
    HEALTH2=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER/health" --connect-timeout 5)
    if [ "$HEALTH2" != "200" ]; then
        echo "$LOG_PREFIX CRITICAL: chat-server still down after restart!"
        exit 1
    fi
    echo "$LOG_PREFIX chat-server restarted successfully"
fi

# 2. Check if agents are connected
AGENT_COUNT=$(curl -s "$SERVER/members" --connect-timeout 5 | python3 -c "
import json, sys
try:
    members = json.load(sys.stdin)
    agents = [m for m in members if m['type'] == 'agent']
    print(len(agents))
except:
    print(0)
" 2>/dev/null)

if [ "$AGENT_COUNT" -lt 1 ] 2>/dev/null; then
    echo "$LOG_PREFIX WARNING: Only $AGENT_COUNT agents online"
fi

# 3. Check if conversation is alive
ACTIVITY=$(curl -s "$SERVER/activity" --connect-timeout 5)
IS_IDLE=$(echo "$ACTIVITY" | python3 -c "
import json, sys, time
try:
    data = json.load(sys.stdin)
    last_msg = data.get('lastMessageTime', 0)
    now = int(time.time() * 1000)
    gap = (now - last_msg) / 1000 if last_msg > 0 else 9999
    print(f'{gap:.0f}')
except:
    print('9999')
" 2>/dev/null)

echo "$LOG_PREFIX Agents: $AGENT_COUNT | Last msg: ${IS_IDLE}s ago"

# 4. If idle > 3 minutes, send a wake-up message as "系统助手" to stimulate conversation
if [ "$IS_IDLE" -gt 180 ] 2>/dev/null; then
    echo "$LOG_PREFIX Room idle for ${IS_IDLE}s, sending wake-up message..."

    # Join as system helper (idempotent)
    curl -s -X POST "$SERVER/join" \
        -H 'Content-Type: application/json' \
        -d '{"name":"系统助手","type":"human"}' > /dev/null

    # Pick a random wake-up message
    MESSAGES=(
        "大家在忙什么呢？来聊几句吧~"
        "群里好安静，谁来说个话活跃下气氛？"
        "有人吗？最近有什么好玩的事吗？"
        "冒个泡吧，别都潜水了~"
        "来来来，休息时间到了，聊两句？"
        "话题征集中——你们最近在追什么剧/玩什么游戏？"
        "今天心情怎么样？来分享一下~"
        "群聊冷场了，谁来暖个场？"
    )
    IDX=$((RANDOM % ${#MESSAGES[@]}))
    MSG="${MESSAGES[$IDX]}"

    RESULT=$(curl -s -X POST "$SERVER/messages" \
        -H 'Content-Type: application/json' \
        -d "{\"sender\":\"系统助手\",\"content\":\"$MSG\"}")

    echo "$LOG_PREFIX Sent wake-up: $MSG"
fi
