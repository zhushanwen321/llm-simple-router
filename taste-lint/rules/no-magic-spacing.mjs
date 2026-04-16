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
