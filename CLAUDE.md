<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

## Frontend 规范：禁止使用原生 HTML 表单/交互组件

前端（`frontend/`）使用 **shadcn-vue** 组件库，**禁止**使用浏览器原生 HTML 表单和交互元素。所有 UI 组件必须使用 shadcn-vue 提供的对应组件。

### 替换对照表

| 禁止的原生元素 | 必须使用的 shadcn-vue 组件 |
|---------------|--------------------------|
| `<button>` | `<Button variant="default/outline/ghost/destructive" size="default/sm">` |
| `<input>` | `<Input>` |
| `<select>` + `<option>` | `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` |
| `<table>` 系列 | `<Table>` + `<TableHeader>` + `<TableBody>` + `<TableRow>` + `<TableHead>` + `<TableCell>` |
| 手写模态框 (`fixed inset-0 bg-black/50`) | `<Dialog>` + `<DialogContent>` + `<DialogHeader>` + `<DialogTitle>` + `<DialogFooter>` |
| 手写确认弹窗 | `<AlertDialog>` + `<AlertDialogContent>` + `<AlertDialogAction>` + `<AlertDialogCancel>` |
| `<span>` 用作状态标签 | `<Badge variant="default/secondary/outline/destructive">` |
| `<div class="bg-white rounded-lg border">` 卡片容器 | `<Card>` + `<CardHeader>` + `<CardTitle>` + `<CardContent>` |
| `<label>` | `<Label>` |

### 组件安装方式

```bash
cd frontend && npx shadcn-vue@latest add button input select table dialog alert-dialog badge card label
```

### 检查规则

新增或修改前端代码时，必须检查是否使用了原生 `<button>`、`<input>`、`<select>`、`<table>`、手写弹窗等元素。如发现，必须替换为对应的 shadcn-vue 组件。
