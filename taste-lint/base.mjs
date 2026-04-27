/**
 * CodeTaste ESLint 基础配置 — TypeScript / Node.js 项目
 *
 * 使用：在项目 eslint.config.mjs 中导入
 *   import tasteConfig from './taste-lint/base.mjs';
 *   export default tasteConfig;
 *
 * 依赖：typescript-eslint
 */
import tseslint from 'typescript-eslint';
import preferAllsettled from './rules/prefer-allsettled.mjs';
import noSilentCatch from './rules/no-silent-catch.mjs';
import noUnsafeObjectEntries from './rules/no-unsafe-object-entries.mjs';
import noHardcodedColors from './rules/no-hardcoded-colors.mjs';
import noMagicSpacing from './rules/no-magic-spacing.mjs';
import noDeprecatedRuleFormat from './rules/no-deprecated-rule-format.mjs';

export const tastePlugin = {
  meta: { name: 'eslint-plugin-taste' },
  rules: {
    'prefer-allsettled': preferAllsettled,
    'no-silent-catch': noSilentCatch,
    'no-unsafe-object-entries': noUnsafeObjectEntries,
    'no-hardcoded-colors': noHardcodedColors,
    'no-magic-spacing': noMagicSpacing,
    'no-deprecated-rule-format': noDeprecatedRuleFormat,
  },
};

/** 品味规则配置，可在 vue.mjs 等扩展配置中复用 */
export const tasteRules = {
  // 类型即契约
  '@typescript-eslint/no-explicit-any': 'error',

  // 缩进：仅允许 space
  'indent': ['warn', 2, { SwitchCase: 1 }],

  // 结构先于一切
  'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],

  // 语义化命名
  'no-magic-numbers': ['warn', {
    ignore: [0, 1, -1],
    ignoreArrayIndexes: true,
  }],

  // 反馈不断裂
  'no-empty': 'error',

  // 安全无例外
  'no-eval': 'error',
  'no-implied-eval': 'error',

  // 品味自定义规则
  'taste/prefer-allsettled': 'warn',
  'taste/no-silent-catch': 'warn',
  'taste/no-unsafe-object-entries': 'warn',
  'taste/no-deprecated-rule-format': 'warn',
};

export default [
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { taste: tastePlugin },
    rules: tasteRules,
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'frontend-dist/**', 'frontend/dist/**', 'frontend/node_modules/**', 'frontend/.vite/**', '*.d.ts', '**/*.generated.*', '**/*.test.ts', '**/*.spec.ts'],
  },
];
