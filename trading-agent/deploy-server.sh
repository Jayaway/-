#!/bin/bash
# 🍔 汉堡交易 · 服务器一键部署脚本
# 用法: bash deploy-server.sh

set -e

REPO_URL="https://gcw_lWxzeyAj:4e2SKbvBL4zH-6rofKx5gPP8@gitcode.com/gcw_lWxzeyAj/123.git"
DEPLOY_DIR="/opt/burger-trading"
PEM_KEY="$HOME/代码/汉堡.pem"
SERVER="root@47.85.16.18"

echo "🍔 汉堡交易 · 服务器部署脚本"
echo "=========================================="
echo ""

# 1. SSH远程执行
ssh -i "$PEM_KEY" "$SERVER" << 'ENDSSH'
set -e

REPO_URL="https://gcw_lWxzeyAj:4e2SKbvBL4zH-6rofKx5gPP8@gitcode.com/gcw_lWxzeyAj/123.git"
DEPLOY_DIR="/opt/burger-trading"

echo "📦 拉取最新代码..."
if [ -d "$DEPLOY_DIR/.git" ]; then
    cd "$DEPLOY_DIR"
    git pull origin main
else
    rm -rf "$DEPLOY_DIR"
    git clone "$REPO_URL" "$DEPLOY_DIR"
    cd "$DEPLOY_DIR"
fi

echo ""
echo "🛑 停止旧服务..."
pkill -f "node server.js" 2>/dev/null || true

echo ""
echo "🚀 启动新服务..."
cd "$DEPLOY_DIR"
PORT=3088 nohup node server.js > app.log 2>&1 &
sleep 2

echo ""
echo "✅ 检查服务状态..."
if pgrep -f "node server.js" > /dev/null; then
    echo "   服务运行中！"
    ss -tlnp | grep 3088
else
    echo "   ❌ 服务启动失败，查看日志:"
    tail -20 app.log
    exit 1
fi

ENDSSH

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "🌐 https://crayfish.icu"
echo ""
