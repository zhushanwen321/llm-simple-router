# Phase 4: 文档、Hook 更新与验证（Tasks 22-24）

## Task 22: 更新 vue_rules_checker.py

**Files:**
- Modify: `.githooks/vue_rules_checker.py`

- [ ] **Step 1: 添加硬编码颜色检查函数**

在 `check_vue_component_usage` 函数之后添加 `check_hardcoded_colors`：

```python
# 禁止的 Tailwind 色系前缀
BLOCKED_COLOR_FAMILIES = [
    'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
    'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple',
    'fuchsia', 'pink', 'rose', 'slate', 'gray', 'zinc', 'neutral',
    'stone',
]

# 允许的语义色前缀
ALLOWED_SEMANTIC = [
    'background', 'foreground', 'primary', 'secondary', 'destructive',
    'muted', 'accent', 'card', 'popover', 'border', 'input', 'ring',
    'success', 'warning', 'danger', 'info', 'page', 'sidebar', 'chart',
]

COLOR_UTIL_RE = re.compile(
    r'\b(?:bg|text|border|ring|outline|shadow|fill|stroke|divide|from|via|to)-'
    r'([a-z]+(?:-[a-z]+)*)'
)

def check_hardcoded_colors(content: str, relative_path: str) -> tuple[int, list[str]]:
    """检查 Vue 模板中的硬编码颜色"""
    issues = []
    exit_code = 0

    if '/components/ui/' in relative_path:
        return 0, []

    lines = content.split('\n')
    in_template = False

    for i, line in enumerate(lines, 1):
        if '<template' in line:
            in_template = True
            continue
        if '</template>' in line:
            in_template = False
            continue
        if not in_template:
            continue

        for match in COLOR_UTIL_RE.finditer(line):
            color_name = match.group(1)
            # 去掉 responsive/state 前缀 (hover:, dark: 等)
            clean = color_name.split(':')[-1]
            if any(clean == p or clean.startswith(p + '-') for p in ALLOWED_SEMANTIC):
                continue
            if any(clean == f or clean.startswith(f + '-') for f in BLOCKED_COLOR_FAMILIES):
                issues.append(f"  [第{i}行] 禁止硬编码颜色 '{match.group()}'")
                issues.append("    请使用语义 token（如 bg-success、text-foreground）替代")
                exit_code = 2

    return exit_code, issues
```

- [ ] **Step 2: 在 `check_vue_file` 中调用新检查**

在 `check_vue_file` 函数末尾（组件使用检查之后）添加：

```python
# 检查 4: 禁止硬编码颜色
color_exit, color_issues = check_hardcoded_colors(content, relative_path)
if color_exit > exit_code:
    exit_code = color_exit
issues.extend(color_issues)
```

## Task 23: 编写设计规范文档

**Files:**
- Create: `frontend/docs/design-system.md`

- [ ] **Step 1: 编写设计规范文档**

内容包含：
- Token 清单（引用 tokens.css 中的变量）
- 颜色使用指南：success 用于成功/在线，danger 用于错误/删除，warning 用于警告，info 用于提示
- 间距规范：page > section > card > tight 的层级
- 暗色模式适配：在 `.dark` 中覆盖 `-light` 变体
- 组件使用规范：强制 shadcn-vue
- 禁止项：硬编码 Tailwind 色系、原生 HTML 表单元素

- [ ] **Step 2: 提交 Phase 3 + Phase 4**

```bash
git add frontend/ .githooks/
git commit -m "feat: migrate all hardcoded colors to design tokens and add enforcement"
```

## Task 24: 最终验证

- [ ] **Step 1: 运行 ESLint 确认无违规**

Run: `npx eslint frontend/src/ --max-warnings=0`
Expected: 0 warnings, 0 errors

- [ ] **Step 2: 运行构建确认无错误**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 3: 运行 githooks 检查**

Run: `python3 .githooks/vue_rules_checker.py --batch "$PWD/frontend/src/views/Login.vue" "$PWD/frontend/src/views/Dashboard.vue"`
Expected: 无硬编码颜色报错

- [ ] **Step 4: 目视检查**

启动 `npm run dev` + `cd frontend && npm run dev`，在浏览器中检查：
- 所有页面在亮色模式下正常显示
- 切换到暗色模式（如果可用）检查颜色对比度
- Chart.js 图表颜色正确显示
