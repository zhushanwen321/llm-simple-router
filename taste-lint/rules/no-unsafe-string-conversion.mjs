/**
 * 品味规则：禁止对非原始类型使用 String()
 *
 * String(x) 在 x 为对象时会产生 "[object Object]"，通常是 bug。
 * 本规则对 MemberExpression / CallExpression / Identifier / ObjectExpression / ArrayExpression
 * 等无法静态确定类型为原始值的参数进行标记。
 *
 * 例外：
 * - 字符串/数字/布尔字面量、模板字面量
 * - 二元 + 表达式（可能是字符串拼接）
 * - 一元表达式（+x, -x 等数值操作）
 * - 测试文件、迁移文件
 * - 文件顶部含 // taste:allow-string-conversion 注释
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow String() on non-primitive values to prevent "[object Object]"',
    },
    schema: [],
    messages: {
      unsafeStringConversion:
        '禁止对非原始类型使用 String()。当前参数类型不确定，可能输出 "[object Object]"。' +
        '如果确定是 string/number/boolean，用显式类型标注；否则用 JSON.stringify()。',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? '';

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'String'
        )
          return;
        if (node.arguments.length !== 1) return;

        if (
          filename.includes('.test.') ||
          filename.includes('.spec.') ||
          filename.includes('__tests__') ||
          filename.includes('/migrations/')
        )
          return;

        const sourceCode = context.sourceCode ?? context.getSourceCode?.();
        if (sourceCode) {
          const text = sourceCode.getText();
          if (text.includes('// taste:allow-string-conversion')) return;
        }

        const arg = node.arguments[0];

        if (
          arg.type === 'Literal' ||
          arg.type === 'TemplateLiteral' ||
          arg.type === 'UnaryExpression'
        )
          return;

        if (arg.type === 'BinaryExpression' && arg.operator === '+') return;

        context.report({
          node,
          messageId: 'unsafeStringConversion',
          data: { argType: arg.type },
        });
      },
    };
  },
};
