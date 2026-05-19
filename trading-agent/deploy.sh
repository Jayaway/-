#!/bin/bash
# 🍔 汉堡交易 · 一键部署脚本
# 用法: bash deploy.sh [服务器IP或域名]

set -e

SERVER="${1:-crayfish.icu}"
REMOTE_DIR="/opt/burger-trading"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_KEY="$(cd "$LOCAL_DIR/.." && pwd)/汉堡.pem"

echo "🍔 汉堡交易 · 部署脚本"
echo "=========================="
echo "目标: root@${SERVER}"
echo "密钥: ${SSH_KEY}"
echo "本地: ${LOCAL_DIR}"
echo ""

# 检查密钥
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ 找不到密钥: $SSH_KEY"
    echo "   请确认 汉堡.pem 位于项目上级目录"
    exit 1
fi

# 设置密钥权限
chmod 600 "$SSH_KEY"

# 1. 打包
echo "📦 打包项目文件..."
cd "$LOCAL_DIR"
tar czf /tmp/burger-trading.tar.gz \
    --exclude='node_modules' \
    --exclude='.DS_Store' \
    --exclude='data' \
    -C "$LOCAL_DIR" .

SIZE=$(du -h /tmp/burger-trading.tar.gz | cut -f1)
echo "   大小: ${SIZE}"

# 2. 上传
echo "📤 上传到服务器..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/burger-trading.tar.gz root@${SERVER}:/tmp/burger-trading.tar.gz

# 3. 远程部署
echo "🚀 远程部署..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no root@${SERVER} << 'ENDSSH'
set -e

# 解压到项目子目录（匹配服务器现有结构）
mkdir -p /opt/burger-trading/trading-agent
cd /opt/burger-trading/trading-agent
tar xzf /tmp/burger-trading.tar.gz
rm /tmp/burger-trading.tar.gz

# 确保 Docker 运行
systemctl start docker 2>/dev/null || true

# 停止旧容器
docker stop burger-trading 2>/dev/null || true
docker rm burger-trading 2>/dev/null || true

# 构建镜像
echo "🔨 构建镜像..."
docker build -t burger-trading .

# 启动容器
echo "🚀 启动容器..."
docker run -d \
    --name burger-trading \
    --restart always \
    -p 3088:3088 \
    -e NODE_ENV=production \
    burger-trading

# 等待启动
sleep 3

# 检查状态
if docker ps | grep -q burger-trading; then
    echo ""
    echo "✅ 部署成功！"
else
    echo ""
    echo "❌ 启动失败，查看日志:"
    docker logs burger-trading --tail 20
fi
ENDSSH

# 4. 清理
rm /tmp/burger-trading.tar.gz

echo ""
echo "=========================="
echo "✅ 部署完成！"
echo "🌐 http://${SERVER}"
echo ""
echo "常用命令:"
echo "  查看日志: ssh -i \"$SSH_KEY\" root@${SERVER} 'docker logs -f burger-trading'"
echo "  重启服务: ssh -i \"$SSH_KEY\" root@${SERVER} 'docker restart burger-trading'"
echo "  停止服务: ssh -i \"$SSH_KEY\" root@${SERVER} 'docker stop burger-trading'"
