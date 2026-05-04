# 阶段0：构建前端
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# 复制 monorepo 锁文件和根 package.json
COPY package.json package-lock.json ./
COPY frontend/ frontend/

# 通过 monorepo workspace 安装前端依赖
RUN npm ci --workspace=frontend --legacy-peer-deps

# 构建前端
WORKDIR /app/frontend
RUN npm run build

# 阶段1：构建后端
FROM node:22-alpine AS builder

WORKDIR /app

# 安装 monorepo 所有依赖（workspace）
COPY package.json package-lock.json ./
COPY router/package.json router/package.json
COPY core/package.json core/package.json
RUN npm ci

# 复制源码和 tsconfig
COPY tsconfig.base.json .
COPY router/tsconfig.json router/
COPY router/src/ router/src/
COPY core/ core/

# 构建 router（自动编译 core 引用）
RUN npm run build -w router

# 阶段2：运行时
FROM node:22-alpine

WORKDIR /app

# 时区设置
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata

# better-sqlite3 native addon 编译需要这些工具
RUN apk add --no-cache python3 make g++

# 安装 monorepo 生产依赖
COPY package.json package-lock.json ./
COPY router/package.json router/package.json
COPY core/package.json core/package.json
RUN npm ci --omit=dev && npm cache clean --force

# 清理编译工具，减小镜像体积
RUN apk del python3 make g++

# 复制后端编译产物
COPY --from=builder /app/router/dist router/dist/

# migrations SQL 文件在运行时需要
COPY --from=builder /app/router/src/db/migrations/ router/dist/db/migrations/

# 复制前端编译产物
COPY --from=frontend-builder /app/frontend/dist frontend-dist/

# 复制配置模板（recommended-providers.json 等）
COPY router/config/ router/config/

EXPOSE 9981

CMD ["node", "router/dist/index.js"]
