/**
 * 品味规则：禁止对 provider.models 直接 JSON.parse
 *
 * providers.models 存储的是 ModelEntry[] 的 JSON 文本，数据格式已从早期 string[]
 * 演进为对象数组。直接 JSON.parse 会得到对象数组而非字符串数组，导致运行时错误。
 *
 * 正确做法：使用 parseModels()（from config/model-context.ts）解析。
 *
 * 例外：迁移代码（db/index.ts 中 app_migration_040 开头的函数）需要操作原始 JSON 结构，
 * 已通过注释标注豁免。
 *
 * 已知限制：无法检测变量别名（const m = provider.models; JSON.parse(m)）、
 * 动态属性访问（provider[field]）或解构（const { models } = provider; JSON.parse(models)）。
 */

/** 递归检测 AST 节点中是否包含 .models 属性访问 */
function containsModelsAccess(n) {
  if (
    n.type === 'MemberExpression' &&
    n.property.type === 'Identifier' &&
    n.property.name === 'models'
  ) return true;
  if (n.type === 'BinaryExpression' || n.type === 'LogicalExpression') {
    return containsModelsAccess(n.left) || containsModelsAccess(n.right);
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct JSON.parse on providers.models — use parseModels() instead',
    },
    messages: {
      rawJsonParseModels:
        '禁止直接 JSON.parse(provider.models) — 数据格式已从 string[] 演进为 ModelEntry[]，' +
        '请使用 parseModels()（from config/model-context.ts）解析。' +
        '如确需操作原始 JSON（如迁移代码），请在上方添加 eslint-disable 注释并说明原因。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'JSON' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'parse' &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          // JSON.parse(xxx.models)
          if (
            arg.type === 'MemberExpression' &&
            arg.property.type === 'Identifier' &&
            arg.property.name === 'models'
          ) {
            context.report({ node, messageId: 'rawJsonParseModels' });
            return;
          }
          // JSON.parse(xxx.models || "[]") / JSON.parse(xxx.models ?? "[]")
          if (arg.type === 'BinaryExpression' || arg.type === 'LogicalExpression') {
            if (containsModelsAccess(arg)) {
              context.report({ node, messageId: 'rawJsonParseModels' });
            }
          }
        }
      },
    };
  },
};
