/**
 * 禁止行内 import(...).Type 类型断言（as / satisfies）
 *
 * 行内类型导入降低可读性，且增加重构难度。
 * 应在文件顶部统一 import 类型。
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow inline import(...).Type — use top-level type imports instead',
    },
    schema: [],
    messages: {
      inlineImportType:
        '禁止行内 import(...).Type 类型断言。请在文件顶部统一 import 类型，' +
        '而不是在表达式中使用 as import("path").Type。',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? '';

    if (
      filename.includes('.test.') ||
      filename.includes('.spec.') ||
      filename.includes('__tests__') ||
      filename.includes('/migrations/')
    ) {
      return {};
    }

    const sourceCode = context.sourceCode ?? context.getSourceCode?.();
    if (sourceCode) {
      const text = sourceCode.getText?.() ?? '';
      if (text.includes('// taste:allow-inline-import-type')) return {};
    }

    /** 递归检查类型节点中是否包含 TSImportType */
    function containsImportType(typeNode) {
      if (!typeNode) return false;
      if (typeNode.type === 'TSImportType') return true;
      if (typeNode.type === 'TSUnionType' || typeNode.type === 'TSIntersectionType') {
        return (typeNode.types ?? []).some(containsImportType);
      }
      if (typeNode.type === 'TSTypeReference' && typeNode.typeName?.type === 'TSImportType') {
        return true;
      }
      return false;
    }

    return {
      TSAsExpression(node) {
        if (containsImportType(node.typeAnnotation)) {
          context.report({ node, messageId: 'inlineImportType' });
        }
      },
      TSSatisfiesExpression(node) {
        if (containsImportType(node.typeAnnotation)) {
          context.report({ node, messageId: 'inlineImportType' });
        }
      },
    };
  },
};
