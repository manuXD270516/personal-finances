import { fileURLToPath } from 'node:url';
import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { moneyConfig } from './index.js';
import { noNumberMoney } from './no-number-money.js';

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

describe('[TC-PLATFORM-ARCH-002] pf/no-number-money (RuleTester)', () => {
  tester.run('pf/no-number-money', noNumberMoney, {
    valid: [
      'interface Expense { amount: Money }',
      'Money.of("10.50", "BOB")',
      'const count: number = items.length',
      'function split(amount: string, parts: number) {}',
      'const shown = money.toFixed()',
      'const n = Number(items.length)',
    ],
    invalid: [
      { code: 'interface Expense { amount: number }', errors: [{ messageId: 'numberField' }] },
      { code: 'Money.of(10.5, "BOB")', errors: [{ messageId: 'numericLiteral' }] },
      { code: 'const fee = parseFloat(dto.fee)', errors: [{ messageId: 'floatParse' }] },
      { code: 'total.toFixed(2)', errors: [{ messageId: 'numberMethod' }] },
      { code: 'const x = Number(dto.amount)', errors: [{ messageId: 'floatParse' }] },
      { code: 'const x = +balance', errors: [{ messageId: 'floatParse' }] },
      { code: 'class P { feeAmount: number | string = 0 }', errors: [{ messageId: 'numberField' }] },
      { code: 'function f(price: number) {}', errors: [{ messageId: 'numberField' }] },
      { code: 'const exchangeRate: number = 6.96', errors: [{ messageId: 'numberField' }] },
      { code: 'd.amount.toNumber()', errors: [{ messageId: 'numberMethod' }] },
    ],
  });
});

describe('[TC-PLATFORM-ARCH-002] fixtures con el preset del monorepo', () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    overrideConfigFile: true,
    overrideConfig: [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, ...moneyConfig()],
    ignore: false,
  });

  it('el fixture malo FALLA: reporta cada uso de number como dinero y el Decimal global', async () => {
    const [result] = await eslint.lintFiles(['fixtures/bad.ts']);
    const found = result.messages.map((m) => `${m.line}:${m.ruleId}:${m.messageId ?? ''}`);
    expect(result.errorCount).toBe(found.length);
    expect(found).toEqual([
      '3:no-restricted-imports:pathWithCustomMessage',
      '9:pf/no-number-money:numberField',
      '10:pf/no-number-money:numberField',
      '15:pf/no-number-money:numberField',
      '19:pf/no-number-money:numberField',
      '24:pf/no-number-money:numericLiteral',
      '25:pf/no-number-money:floatParse',
      '27:pf/no-number-money:numberMethod',
      '29:pf/no-number-money:numberMethod',
    ]);
  });

  it('el fixture bueno PASA sin reportes (sin falsos positivos en números no monetarios)', async () => {
    const [result] = await eslint.lintFiles(['fixtures/good.ts']);
    expect(result.messages).toEqual([]);
  });
});
