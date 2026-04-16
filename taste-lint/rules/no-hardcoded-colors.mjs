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
