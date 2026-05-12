# 验证输出

## 后端测试
- 命令: `npm test -w router`
- 结果: PASS
- 测试数: 1339（110 passed files + 3 skipped files）
- 失败数: 0

## 后端 Lint
- 命令: `npm run lint -w router`
- 结果: PASS

## 前端类型检查
- 命令: `cd frontend && npx vue-tsc -b --noEmit`
- 结果: PASS

## 前端 Lint
- 命令: `cd frontend && npx eslint . --max-warnings=0`
- 结果: PASS

## 后端构建
- 命令: `npm run build -w router`
- 结果: PASS
