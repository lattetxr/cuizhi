FROM node:18-alpine

WORKDIR /app

# 安装依赖（利用 Docker 缓存）
COPY package*.json ./
RUN npm ci --only=production

# 复制源码
COPY . .

# 环境变量
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0

# 暴露端口
EXPOSE 4173

# 健康检查（可选，帮助平台判断服务是否就绪）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4173/api/health || exit 1

# 启动
CMD ["node", "server.mjs"]
