# Phase 2: ESLint 规则（Tasks 6-9）

## Task 6: no-hardcoded-colors 规则（TDD）

**Files:**
- Create: `taste-lint/rules/no-hardcoded-colors.mjs`

- [ ] **Step 1: 编写测试用例**

在规则文件中直接用注释说明测试场景（ESLint 规则用 ESLint's RuleTester 测试较重，实际验证在 Task 9 统一做）。

**测试场景：**
- `bg-red-500` → error
- `text-gray-700` → error
- `border-blue-300` → error
- `hover:text-blue-600` → error
- `bg-destructive` → ok（shadcn 语义色）
- `text-muted-foreground` → ok（shadcn 语义色）
- `text-success` → ok（自定义 token）
- `bg-danger-light` → ok（自定义 token）
- `bg-background` → ok（shadcn 基础色）
- `text-foreground` → ok（shadcn 基础色）
- `border-border` → ok（shadcn 基础色）
- `bg-primary` → ok（shadcn 基础色）
- `hover:bg-accent` → ok（shadcn 基础色）

- [ ] **Step 2: 实现规则**

```js
/**
 * 品味规则：禁止 Vue 模板中的硬编码颜色
 *
 * Tailwind 色系（red/blue/gray/slate 等）应替换为语义 token。
 * 允许的语义色：shadcn-vue 基础色 + 自定义 token（success/warning/danger/info）。
 */
const ALLOWED_PREFIXES = [
  'background', 'foreground', 'primary', 'secondary', 'destructive',
  'muted', 'accent', 'card', 'popover', 'border', 'input', 'ring',
  'success', 'warning', 'danger', 'info', 'page', 'sidebar', 'chart',
  'inherit', 'transparent', 'current', 'black', 'white',
  'none', 'auto', 'full',
]

const COLOR_UTILS = ['bg', 'text', 'border', 'ring', 'outline', 'shadow',
  'fill', 'stroke', 'divide', 'from', 'via', 'to', 'decoration', 'placeholder', 'caret']

/**
 * 从单个 class 名中提取颜色部分。
 * 处理 hover: dark: 等变体前缀 + opacity 修饰符。
 * 返回 null 表示不是颜色相关的 class。
 */
function extractColorName(cls) {
  // 去掉变体前缀 (hover:, dark:, md:, focus-within: 等)
  const cleaned = cls.replace(/^(?:[a-z-]+:)+/, '')
  // 匹配 utility-colorName 或 utility-colorName/opacity
  const match = cleaned.match(new RegExp(
    `^(${COLOR_UTILS.join('|')})-(.+?)(?:\\/\\d+)?$`
  ))
  if (!match) return null
  return match[2] // 纯颜色名部分
}

function isAllowedColor(cls) {
  const colorName = extractColorName(cls)
  if (colorName === null) return true // 不是颜色 class
  return ALLOWED_PREFIXES.some(p => colorName === p || colorName.startsWith(p + '-'))
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded Tailwind colors in Vue templates' },
    messages: {
      noHardcodedColor: '禁止硬编码颜色 "{{color}}"，请使用语义 token（如 bg-success、text-foreground）。',
    },
    fixable: null,
  },
  create(context) {
    return {
      VAttribute(node) {
        if (node.key?.name !== 'class') return
        if (!node.value?.value) return
        const classes = node.value.value.split(/\s+/)
        for (const cls of classes) {
          if (!isAllowedColor(cls)) {
            context.report({
              node,
              messageId: 'noHardcodedColor',
              data: { color: cls },
            })
          }
        }
      },
    }
  },
}
```

- [ ] **Step 3: 手动验证规则**

在任意 `.vue` 文件中临时添加 `class="bg-red-500"`，运行 `npx eslint` 确认报错，然后撤销。

## Task 7: no-magic-spacing 规则

**Files:**
- Create: `taste-lint/rules/no-magic-spacing.mjs`

- [ ] **Step 1: 实现规则**

Phase 1 只禁止任意值间距（方括号语法），不限制 Tailwind 标准 scale。

```js
/**
 * 品味规则：禁止 Vue 模板中的魔法间距值
 *
 * Phase 1: 只禁止方括号任意值（p-[17px]），允许标准 spacing scale。
 */
const ARBITRARY_SPACING_RE = /\b[mp][xytblr]?-\[[^\]]+\]|\bgap-[xy]?\[[^\]]+\]/

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow arbitrary spacing values in Vue templates' },
    messages: {
      noMagicSpacing: '禁止使用任意值间距 "{{value}}"，请使用 Tailwind 标准 spacing scale 或语义 token。',
    },
  },
  create(context) {
    return {
      VAttribute(node) {
        if (node.key?.name !== 'class') return
        if (!node.value?.value) return
        const classes = node.value.value.split(/\s+/)
        for (const cls of classes) {
          if (ARBITRARY_SPACING_RE.test(cls)) {
            context.report({
              node,
              messageId: 'noMagicSpacing',
              data: { value: cls },
            })
          }
        }
      },
    }
  },
}
```

## Task 8: 更新 taste-lint 注册规则

**Files:**
- Modify: `taste-lint/base.mjs`
- Modify: `taste-lint/vue.mjs`

- [ ] **Step 1: 在 base.mjs 中注册新规则**

在现有 import 之后添加：

```js
import noHardcodedColors from './rules/no-hardcoded-colors.mjs';
import noMagicSpacing from './rules/no-magic-spacing.mjs';
```

在 `tastePlugin.rules` 中添加：

```js
'no-hardcoded-colors': noHardcodedColors,
'no-magic-spacing': noMagicSpacing,
```

- [ ] **Step 2: 在 vue.mjs 中添加规则到 Vue 配置**

在现有 `files: ['**/*.vue']` 配置块之后，添加一个 **独立的配置块** 将设计系统规则限制在 `frontend/src/`：

```js
// 设计系统 token 规则 — 仅作用于前端源码
{
  files: ['frontend/src/**/*.vue'],
  plugins: {
    taste: tastePlugin,
  },
  rules: {
    'taste/no-hardcoded-colors': 'error',
    'taste/no-magic-spacing': 'error',
  },
},
```

- [ ] **Step 3: 运行 ESLint 验证规则加载**

Run: `npx eslint --print-config frontend/src/views/Login.vue | grep -A5 taste`
Expected: 看到 `no-hardcoded-colors` 和 `no-magic-spacing` 在 rules 中。

- [ ] **Step 4: 提交 Phase 2**

```bash
git add taste-lint/
git commit -m "feat: add ESLint rules for design token enforcement"
```
