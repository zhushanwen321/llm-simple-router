import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-raw-json-parse-models.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('taste/no-raw-json-parse-models', () => {
  it('reports JSON.parse(xxx.models)', () => {
    const cases = [
      // 直接属性访问
      {
        code: 'JSON.parse(provider.models)',
        errors: [{ messageId: 'rawJsonParseModels' }],
      },
      // LogicalExpression: ||
      {
        code: `JSON.parse(provider.models || '[]')`,
        errors: [{ messageId: 'rawJsonParseModels' }],
      },
      // LogicalExpression: ??
      {
        code: 'JSON.parse(provider.models ?? "[]")',
        errors: [{ messageId: 'rawJsonParseModels' }],
      },
      // 不同变量名也能检测
      {
        code: 'JSON.parse(p.models)',
        errors: [{ messageId: 'rawJsonParseModels' }],
      },
      // 链式访问
      {
        code: 'JSON.parse(r.models || "[]")',
        errors: [{ messageId: 'rawJsonParseModels' }],
      },
    ];

    ruleTester.run('no-raw-json-parse-models', rule, {
      valid: [],
      invalid: cases,
    });
  });

  it('does NOT report non-models property', () => {
    ruleTester.run('no-raw-json-parse-models', rule, {
      valid: [
        'JSON.parse(someObj.data)',
        'JSON.parse(response.body)',
        'JSON.parse(raw)',
        'JSON.parse("[]")',
        'someOtherFunction(provider.models)',
        'JSON.parse(provider.models_json)', // 不同属性名，不匹配
      ],
      invalid: [],
    });
  });

  it('matches snapshot for error message', () => {
    expect(rule.meta.messages.rawJsonParseModels).toContain('parseModels()');
  });
});
