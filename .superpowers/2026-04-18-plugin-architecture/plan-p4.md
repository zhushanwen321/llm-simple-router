# P4: Example Plugin Template + Developer Docs

## Task 12: Example Plugin Template

**Files:**
- Create: `examples/hello-world-plugin/manifest.json`
- Create: `examples/hello-world-plugin/server/index.ts`
- Create: `examples/hello-world-plugin/client/index.ts`
- Create: `examples/hello-world-plugin/package.json`

- [ ] **Step 1: Create minimal example plugin**

示例插件演示如何注册 `proxy:beforeProxy` 和 `log:parseResponse` 扩展点：
- server/index.ts：导出 `beforeProxy` hook，在请求中添加自定义 header
- client/index.ts：导出 `parseResponse`，为特定 apiType 返回自定义解析结果
- manifest.json：声明使用的扩展点

- [ ] **Step 2: Commit**

```bash
git add examples/hello-world-plugin/
git commit -m "docs: add hello-world plugin example"
```

## Task 13: Plugin Development Guide

**Files:**
- Create: `docs/plugin-development.md`

- [ ] **Step 1: Write developer guide**

内容：
1. 插件结构（manifest + server + client）
2. Manifest 字段说明
3. 后端插件接口（beforeProxy / intercept / afterResponse）
4. 前端插件接口（parseRequest / parseResponse / renderComponent）
5. 构建约束（Vue external、ESM 输出）
6. 测试插件的方法
7. 发布插件（推送到 Git 仓库）

- [ ] **Step 2: Commit**

```bash
git add docs/plugin-development.md
git commit -m "docs: add plugin development guide"
```

## Task 14: Integration Test End-to-End

**Files:**
- Test: `tests/integration.test.ts`（补充插件相关场景）

- [ ] **Step 1: Add E2E test**

测试完整流程：
1. 安装内置插件
2. 发送代理请求，验证 beforeProxy 和 intercept 生效
3. 查看日志详情页，验证前端插件解析生效
4. 禁用插件后验证 fallback 行为

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add plugin E2E tests"
```

## P4 Complete

示例插件和开发文档完成。插件系统完整交付。
