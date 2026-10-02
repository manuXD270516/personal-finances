// SPIKE-03 lint feasibility: two complementary layers against `number` money.
import tseslint from 'typescript-eslint';
import pf from './lint/no-number-money.js';

const MONEY = '/^(amount|balance|price|fee|total|rate)$|(Amount|Balance|Price|Fee|Total|Rate)$/';

export default tseslint.config(
  { ignores: ['node_modules/**', 'bench/**'] },
  {
    files: ['src/**/*.ts', 'lint/fixtures/**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { pf },
    rules: {
      // Layer A — syntax only (no type info, cheap, zero custom code)
      'no-restricted-syntax': [
        'error',
        {
          selector: `TSPropertySignature[key.name=${MONEY}] TSNumberKeyword`,
          message: 'Money/rate fields must not be typed as number (ADR-0006).',
        },
        {
          selector: `PropertyDefinition[key.name=${MONEY}] TSNumberKeyword`,
          message: 'Money/rate fields must not be typed as number (ADR-0006).',
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'parseFloat is forbidden in money code (INV-001).',
        },
      ],
      // Layer B — typed rule (resolves aliases, detects Decimal#toNumber)
      'pf/no-number-money': 'error',
    },
  },
);
