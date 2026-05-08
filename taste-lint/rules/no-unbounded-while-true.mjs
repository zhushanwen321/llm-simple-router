/**
 * 品味规则：禁止缺少迭代上限的 while(true) 循环
 *
 * while(true) 本身不保证终止，如果循环体没有计数器递增 + 条件检查，
 * 或 break/return/throw 等退出路径，就是潜在的无限循环 bug。
 *
 * 判定为"有界"的条件（满足任一即可）：
 *   1. 循环体内有 break / return / throw
 *   2. 有 UpdateExpression（i++）或 += 赋值，且同一标识符出现在比较表达式中
 *
 * 豁免：测试文件、迁移文件、含 // taste:allow-unbounded-loop 注释的文件
 */

/**
 * 检查 while(true) 循环体是否有迭代上限保护
 * @param {import('eslint').Rule.Node} whileNode
 * @returns {boolean} true = 有界，不需要报告
 */
function checkHasLimit(whileNode) {
  const body = whileNode.body;
  // 单语句 body 无法可靠分析，放过
  if (body.type !== 'BlockStatement') return true;

  let hasDirectExit = false;
  const updatedIds = new Set();
  const comparedIds = new Set();

  /**
   * 递归遍历语句列表，收集：
   * - 直接退出语句（break/return/throw）
   * - 被递增的标识符（i++, ++i, i += 1）
   * - 出现在比较表达式中的标识符（i < MAX）
   */
  function walkStatements(nodes) {
    for (const stmt of nodes) {
      if (!stmt) continue;

      if (
        stmt.type === 'BreakStatement' ||
        stmt.type === 'ReturnStatement' ||
        stmt.type === 'ThrowStatement'
      ) {
        hasDirectExit = true;
        continue;
      }

      // if 语句：检查条件中的比较，递归两个分支
      if (stmt.type === 'IfStatement') {
        collectComparedIds(stmt.test);
        if (stmt.consequent) walkStatements(Array.isArray(stmt.consequent) ? stmt.consequent : [stmt.consequent]);
        if (stmt.alternate) walkStatements(Array.isArray(stmt.alternate) ? stmt.alternate : [stmt.alternate]);
        continue;
      }

      // try-catch：递归 block 和 handler
      if (stmt.type === 'TryStatement') {
        walkStatements(stmt.block?.body ?? []);
        if (stmt.handler?.body) walkStatements(stmt.handler.body.body ?? []);
        if (stmt.finalizer) walkStatements(stmt.finalizer.body ?? []);
        continue;
      }

      // for/while/do-while/switch：递归进入 body
      if (stmt.type === 'ForStatement' || stmt.type === 'DoWhileStatement') {
        if (stmt.body) walkStatements(Array.isArray(stmt.body) ? stmt.body : [stmt.body]);
        continue;
      }
      if (stmt.type === 'SwitchStatement') {
        for (const c of stmt.cases ?? []) {
          walkStatements(c.consequent ?? []);
        }
        continue;
      }

      // BlockStatement（如 for 循环体嵌套的 block）
      if (stmt.type === 'BlockStatement') {
        walkStatements(stmt.body);
        continue;
      }

      // ExpressionStatement：检查更新表达式和赋值表达式
      if (stmt.type === 'ExpressionStatement') {
        const expr = stmt.expression;

        // i++ / ++i / i-- / --i
        if (expr.type === 'UpdateExpression') {
          const arg = expr.argument;
          if (arg.type === 'Identifier') updatedIds.add(arg.name);
          continue;
        }

        // i += 1 / i -= 1
        if (
          expr.type === 'AssignmentExpression' &&
          (expr.operator === '+=' || expr.operator === '-=') &&
          expr.left.type === 'Identifier'
        ) {
          updatedIds.add(expr.left.name);
          continue;
        }

        // 表达式中可能嵌套比较（如函数调用参数），递归检查
        collectComparedIds(expr);
        continue;
      }

      // VariableDeclaration：const i = 0 之类的声明中可能有初始比较（少见但兜底）
      if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations ?? []) {
          if (decl.init) collectComparedIds(decl.init);
        }
      }
    }
  }

  /**
   * 从表达式中收集出现在比较运算符两侧的标识符
   */
  function collectComparedIds(expr) {
    if (!expr) return;

    if (expr.type === 'BinaryExpression') {
      if (['<', '>', '<=', '>=', '===', '!==', '==', '!='].includes(expr.operator)) {
        if (expr.left.type === 'Identifier') comparedIds.add(expr.left.name);
        if (expr.right.type === 'Identifier') comparedIds.add(expr.right.name);
      }
      collectComparedIds(expr.left);
      collectComparedIds(expr.right);
      return;
    }

    // 穿透 LogicalExpression（&& / ||）和 ConditionalExpression（?:）
    if (expr.type === 'LogicalExpression') {
      collectComparedIds(expr.left);
      collectComparedIds(expr.right);
      return;
    }
    if (expr.type === 'ConditionalExpression') {
      collectComparedIds(expr.test);
      collectComparedIds(expr.consequent);
      collectComparedIds(expr.alternate);
      return;
    }

    // 穿透 CallExpression 参数（如 fn(i < MAX)）
    if (expr.type === 'CallExpression') {
      for (const arg of expr.arguments ?? []) collectComparedIds(arg);
      return;
    }
  }

  walkStatements(body.body);

  // 有直接退出语句（break/return/throw），视为有界
  if (hasDirectExit) return true;

  // 有计数器递增 + 同一计数器出现在比较表达式中，视为有界
  for (const id of updatedIds) {
    if (comparedIds.has(id)) return true;
  }

  return false;
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow while(true) loops without iteration limit',
    },
    schema: [],
    messages: {
      unboundedLoop:
        'while(true) 循环缺少迭代上限保护。添加 MAX_ITERATIONS 常量 + 计数器检查，' +
        '防止意外无限循环。',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode?.() ?? null;
    const filename = context.filename ?? context.getFilename?.() ?? '';

    return {
      WhileStatement(node) {
        // 仅匹配 while(true) / while (true)
        if (
          node.test.type !== 'Literal' ||
          node.test.value !== true
        ) return;

        // 豁免：测试文件、迁移文件
        if (
          filename.includes('.test.') ||
          filename.includes('.spec.') ||
          filename.includes('__tests__') ||
          filename.includes('/migrations/')
        ) return;

        // 豁免：文件级注释
        if (sourceCode) {
          const comments = sourceCode.getAllComments();
          if (comments.some((c) => c.value.trim() === 'taste:allow-unbounded-loop')) return;
        }

        if (!checkHasLimit(node)) {
          context.report({ node, messageId: 'unboundedLoop' });
        }
      },
    };
  },
};
