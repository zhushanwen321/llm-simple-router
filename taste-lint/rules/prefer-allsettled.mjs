/**
 * 品味规则：独立数据源优先使用 Promise.allSettled
 *
 * Promise.all 一个失败全部失败，独立数据源应允许部分降级。
 * 参考：CodeTaste 偏好 "Promise.allSettled 优于 Promise.all"
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer Promise.allSettled for independent data sources',
    },
    messages: {
      preferAllSettled:
        'Promise.all 一个失败全部失败。如果是独立数据源，改用 Promise.allSettled 允许部分降级。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Promise' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'all'
        ) {
          context.report({ node, messageId: 'preferAllSettled' });
        }
      },
    };
  },
};
