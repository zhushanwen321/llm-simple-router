# 阶段0：构建前端
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ .
RUN npm run build

# 阶段1：构建后端
FROM node:22-alpine AS builder

# prepare 脚本需要 bash
RUN apk add --no-cache bash

WORKDIR /app

COPY package*.json ./
COPY .githooks .githooks/
RUN npm ci

COPY tsconfig.json .
COPY src/ src/
RUN npm run build

# 阶段2：运行时
FROM node:22-alpine

# prepare 脚本需要 bash
RUN apk add --no-cache bash

WORKDIR /app

# 时区设置
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata

# better-sqlite3 native addon 编译需要这些工具
RUN apk add --no-cache python3 make g++

# 只安装生产依赖
COPY package*.json ./
COPY .githooks .githooks/
RUN npm ci --omit=dev && npm cache clean --force

# 清理编译工具，减小镜像体积
RUN apk del python3 make g++

# 复制后端编译产物
COPY --from=builder /app/dist dist/

# migrations SQL 文件在运行时需要
COPY --from=builder /app/src/db/migrations/ dist/db/migrations/

# 复制前端编译产物
COPY --from=frontend-builder /app/frontend/dist frontend-dist/

EXPOSE 3000

CMD ["node", "dist/index.js"]
