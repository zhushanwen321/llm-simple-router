# CI 结果

**日期：** 2026-05-10

## 状态：LOCAL_ONLY

本项目无针对 feature 分支的 CI pipeline。所有验证在本地执行。

### 本地替代验证（等同于 CI）

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 后端编译 | PASS | npm run build |
| 后端 Lint | PASS | eslint . --max-warnings=0 |
| 后端测试 | PASS | 1199 passed / 3 skipped |
| 前端类型检查 | PASS | vue-tsc -b --noEmit |
| 前端 Lint（变更文件） | PASS | eslint --max-warnings=0 |
| 前端构建 | PASS | vite build |

### 远端 CI

远端 CI（`.github/workflows/ci.yml`）仅在 PR 创建后触发。当前分支尚未创建 PR，远端 CI 未运行。
