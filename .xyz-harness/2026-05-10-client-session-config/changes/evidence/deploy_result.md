# 部署结果

**日期：** 2026-05-10
**部署方式：** 本地开发环境（npm run dev）

## 状态：VERIFIED

### 部署方式

本项目是 npm 包 + Docker 镜像发布，不涉及传统部署。发布通过 GitHub Actions Publish workflow 触发。

当前验证方式：用户本地前后端 `npm run dev` 启动确认功能正常。

### 用户确认

用户已确认前后端 npm run dev 运行正常，功能符合预期。

### 发布步骤（待执行）

发布需要通过 PR 合并到 main 后执行 `bash scripts/publish.sh patch`，不在本次 dev-flow 范围内。
