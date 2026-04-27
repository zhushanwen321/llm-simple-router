/**
 * taste-lint: no-deprecated-rule-format
 *
 * 禁止在后端代码中访问 mapping_groups.rule 的旧格式字段 (.default / .windows)。
 * migration 026/028 已统一为 { targets: [...] }，旧字段仅保留兼容读取。
 * 新代码不应再依赖这些字段。
 *
 * 适用文件: src/**（排除测试和迁移文件）
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: '禁止访问已废弃的 rule.default / rule.windows 字段',
    },
    schema: [],
    messages: {
      deprecatedDefault: '禁止访问 rule.default — 已废弃。migration 026/028 统一为 rule.targets。',
      deprecatedWindows: '禁止访问 rule.windows — 已废弃。时间窗口已迁移至 schedules 表。',
    },
  },
  create(context) {
    return {
      /** 检查 rule.default 的成员访问 */
      MemberExpression(node) {
        // 匹配 rule.default 或 rule.windows（通过 property name）
        if (node.computed) return; // 只检查 .property 形式

        const propName = node.property?.name;
        if (propName !== 'default' && propName !== 'windows') return;

        // 父对象必须是 rule（变量名匹配）
        const obj = node.object;
        if (obj?.type !== 'Identifier') return;
        if (obj.name !== 'rule') return;

        // 排除 migration SQL 文件和测试文件
        const filename = context.filename ?? context.getFilename?.() ?? '';
        if (filename.includes('/migrations/') || filename.includes('.test.')) return;

        if (propName === 'default') {
          context.report({ node, messageId: 'deprecatedDefault' });
        } else {
          context.report({ node, messageId: 'deprecatedWindows' });
        }
      },
    };
  },
};
