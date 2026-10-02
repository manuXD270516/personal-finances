import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('Lint: prohibido number para dinero (factibilidad TC-PLATFORM-ARCH-002)', () => {
  it('reporta los number monetarios del fixture malo y nada en el bueno', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [bad, good] = await eslint.lintFiles(['lint/fixtures/bad.ts', 'lint/fixtures/good.ts']);
    const lines = (ruleId: string) =>
      bad!.messages.filter((m) => m.ruleId === ruleId).map((m) => m.line).sort((a, b) => a - b);
    expect(bad!.messages.filter((m) => m.fatal)).toEqual([]);
    expect(lines('no-restricted-syntax')).toEqual([7, 8, 14, 27]);
    expect(lines('pf/no-number-money')).toEqual([7, 8, 9, 14, 18, 24]);
    expect(good!.messages).toEqual([]);
  }, 60_000);
});
