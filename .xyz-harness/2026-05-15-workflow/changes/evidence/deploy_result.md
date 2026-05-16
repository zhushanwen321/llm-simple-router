# 部署结果

**日期**: 2026-05-16
**分支**: feat-image-model-switch
**PR**: #135 (未合并)

## 状态

PR 已创建，等待评审和合并。合并后通过 GitHub Actions Publish workflow 自动发布。

## 发布流程

合并到 main 后执行：
```bash
bash scripts/publish.sh patch
```

自动完成：版本升级 → commit + tag → GitHub Release → npm publish → Docker 镜像推送。

## 本地验证结果

| 检查项 | 结果 |
|--------|------|
| tsc 编译 | PASS |
| vitest 1392/1392 | PASS |
| ESLint backend 0 warnings | PASS |
| vue-tsc frontend | PASS |
| pre-commit hooks | PASS |

## 部署前检查清单

- [ ] PR 审查通过
- [ ] CI 全绿
- [ ] 合并到 main
- [ ] 执行 `bash scripts/publish.sh patch`
