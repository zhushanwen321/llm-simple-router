/**
 * 品味规则：禁止使用 eslint-disable 注释
 *
 * eslint-disable 注释掩盖问题而非解决问题。应正面修复 lint 警告：
 * 提取函数减少行数、用命名常量替代魔法数字、在 catch 中加入有意义的错误处理等。
 */
const ESLINT_DISABLE_RE =
  /eslint-disable(?:-next-line|-line)?(?:\s|$)/;

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow eslint-disable comments',
    },
    messages: {
      noEslintDisable:
        '禁止使用 eslint-disable 注释来跳过 lint 规则。请正面解决 lint 问题（如提取函数减少行数、用命名常量替代魔法数字、在 catch 中加入有意义的错误处理等）',
    },
  },
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode.getAllComments();
        for (const comment of comments) {
          if (ESLINT_DISABLE_RE.test(comment.value)) {
            context.report({ node: comment, messageId: 'noEslintDisable' });
          }
        }
      },
    };
  },
};
