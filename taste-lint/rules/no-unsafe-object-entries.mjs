/**
 * 品味规则：Object.entries 动态构建时必须有白名单过滤
 *
 * Object.entries(obj).map() 拼接 SQL / 配置时，若不过滤字段，
 * 用户输入的任意 key 会被注入。必须先 .filter 白名单。
 * 参考：CodeTaste 反模式 "动态字段名无白名单"
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require whitelist filter before iterating Object.entries for dynamic construction',
    },
    messages: {
      unsafeEntries:
        'Object.entries().{{method}}() 未经过 .filter() 白名单过滤，动态字段可能导致注入。先 .filter(([k]) => ALLOWED.includes(k))。',
    },
  },
  create(context) {
    const DANGEROUS_METHODS = new Set(['map', 'reduce', 'forEach']);

    function isObjectEntries(node) {
      return (
        node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === 'Object' &&
        node.callee.property?.name === 'entries'
      );
    }

    return {
      CallExpression(node) {
        const method = node.callee?.property?.name;
        if (!DANGEROUS_METHODS.has(method)) return;

        // 直接链式：Object.entries(x).map(...) — 未经过 filter
        const receiver = node.callee?.object;
        if (isObjectEntries(receiver)) {
          context.report({
            node,
            messageId: 'unsafeEntries',
            data: { method },
          });
        }
      },
    };
  },
};
