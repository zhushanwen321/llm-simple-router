/**
 * CodeTaste ESLint 配置 — Vue 3 + TypeScript 项目
 *
 * 在 base.mjs 基础上增加 Vue 特有规则。
 * 使用：import tasteConfig from './taste-lint/vue.mjs';
 *       export default tasteConfig;
 *
 * 额外依赖：eslint-plugin-vue
 */
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import baseConfig, { tasteRules, tastePlugin } from './base.mjs';

export default [
  ...baseConfig,

  // Vue 基础规则（不含格式化，格式化交给 Prettier）
  ...pluginVue.configs['flat/essential'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: {
      taste: tastePlugin,
    },
    rules: {
      // 应用 TS 品味规则到 .vue 文件
      ...tasteRules,

      // 安全：禁止 v-html（XSS 向量）
      'vue/no-v-html': 'error',

      // 统一性：组件名 PascalCase
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],

      // 可读性：强制 props 类型定义
      'vue/require-prop-types': 'warn',

      // 关闭过于严格的 Vue 格式化规则（交给 Prettier）
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/attributes-order': 'off',

      // shadcn-vue 组件库使用单字名称，允许例外
      'vue/multi-word-component-names': 'off',
    },
  },

  // 设计系统 token 规则 — 仅作用于前端源码
  {
    files: ['frontend/src/**/*.vue'],
    plugins: {
      taste: tastePlugin,
    },
    rules: {
      'taste/no-hardcoded-colors': 'error',
      'taste/no-magic-spacing': 'error',
    },
  },
];
