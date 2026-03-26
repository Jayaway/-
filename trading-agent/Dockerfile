FROM node:20-slim

WORKDIR /app

# 复制项目文件
COPY . .

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 暴露端口
EXPOSE 3088

# 启动
CMD ["node", "server.js"]
