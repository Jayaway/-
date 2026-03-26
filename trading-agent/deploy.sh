#!/bin/bash
# 🍔 汉堡交易 · 一键部署脚本
# 用法: bash deploy.sh [服务器IP或域名]

set -e

SERVER="${1:-crayfish.icu}"
REMOTE_DIR="/opt/burger-trading"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🍔 汉堡交易 · 部署脚本"
echo "=========================="
echo "目标: root@${SERVER}"
echo "本地: ${LOCAL_DIR}"
echo ""

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
scp /tmp/burger-trading.tar.gz root@${SERVER}:/tmp/burger-trading.tar.gz

# 3. 远程部署
echo "🚀 远程部署..."
ssh root@${SERVER} << 'ENDSSH'
set -e

# 解压
mkdir -p /opt/burger-trading
cd /opt/burger-trading
tar xzf /tmp/burger-trading.tar.gz
rm /tmp/burger-trading.tar.gz

# 确保 Docker 运行
if ! command -v docker &> /dev/null; then
    echo "📦 安装 Docker..."
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
fi

# 确保 Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "📦 安装 Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# 停止旧容器
docker-compose down 2>/dev/null || true

# 构建并启动
docker-compose up -d --build

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
echo "  查看日志: ssh root@${SERVER} 'docker logs -f burger-trading'"
echo "  重启服务: ssh root@${SERVER} 'cd /opt/burger-trading && docker-compose restart'"
echo "  停止服务: ssh root@${SERVER} 'cd /opt/burger-trading && docker-compose down'"
