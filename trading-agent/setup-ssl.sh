#!/bin/bash
# HTTPS 一键配置脚本
# 域名: crayfish.icu

set -e

DOMAIN="crayfish.icu"
NGINX_CONF="/etc/nginx/conf.d/burger-trading.conf"

echo "🔐 配置 HTTPS - ${DOMAIN}"
echo "=========================="

# 1. 安装 certbot
if ! command -v certbot &> /dev/null; then
    echo "📦 安装 certbot..."
    apt-get update && apt-get install -y certbot python3-certbot-nginx
fi

# 2. 复制 nginx 配置
echo "📝 配置 Nginx..."
cp nginx.conf "$NGINX_CONF"

# 3. 先用 HTTP 配置获取证书
cat > /tmp/nginx-http.conf << EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        proxy_pass http://127.0.0.1:3088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF
cp /tmp/nginx-http.conf "$NGINX_CONF"
nginx -t && systemctl reload nginx

# 4. 获取证书
echo "🔒 获取 SSL 证书..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@$DOMAIN

# 5. 重载配置
nginx -t && systemctl reload nginx

# 6. 设置自动续期
echo "⏰ 设置证书自动续期..."
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && nginx -s reload") | crontab -

echo ""
echo "=========================="
echo "✅ HTTPS 配置完成！"
echo ""
echo "🌐 https://${DOMAIN}"
echo ""
echo "证书自动续期已配置 (每天凌晨3点检查)"
