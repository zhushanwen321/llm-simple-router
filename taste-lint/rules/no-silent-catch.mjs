/**
 * 品味规则：catch 块必须有实质错误处理
 *
 * 空 catch 吞掉错误；仅 console.error 对用户无感知。
 * 参考：CodeTaste 反模式 "异步操作无 UI 反馈" + "忽略底层错误"
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow catch blocks that silently swallow errors',
    },
    messages: {
      emptyCatch: '空 catch 块吞掉了错误，至少需要记录日志。',
      consoleOnly:
        'catch 块只有 console 调用 —— 底层错误未传播给调用方或用户。考虑：返回错误响应 / 设置错误状态 / toast 提示 / 重抛。',
    },
  },
  create(context) {
    function isOnlyConsole(body) {
      if (body.length !== 1) return false;
      const stmt = body[0];
      return (
        stmt.type === 'ExpressionStatement' &&
        stmt.expression.type === 'CallExpression' &&
        stmt.expression.callee.type === 'MemberExpression' &&
        stmt.expression.callee.object.type === 'Identifier' &&
        stmt.expression.callee.object.name === 'console'
      );
    }

    return {
      CatchClause(node) {
        const body = node.body?.body;
        if (!body) return;

        if (body.length === 0) {
          context.report({ node, messageId: 'emptyCatch' });
        } else if (isOnlyConsole(body)) {
          context.report({ node, messageId: 'consoleOnly' });
        }
      },
    };
  },
};
