import { describe, expect, it } from 'vitest';

type Rule = (operation: unknown) => { message: string }[];
const FUNCTION = new URL('../../../contracts/openapi/functions/pfos-sunset-window.js', import.meta.url);
const load = async (): Promise<Rule> => ((await import(FUNCTION.href)) as { default: Rule }).default;

describe('regla Spectral pfos-sunset-on-deprecated (contracts/openapi/.spectral.yaml)', () => {
  it('[TC-PLATFORM-API-003] x-sunset a menos de 90 días del anuncio falla; a 90 días o más pasa', async () => {
    const rule = await load();
    const op = (sunset: string | undefined, announced: string | null = '2026-10-02') => ({
      deprecated: true,
      ...(announced ? { 'x-deprecated-at': announced } : {}),
      ...(sunset ? { 'x-sunset': sunset } : {}),
    });
    expect(rule(op('2026-11-15'))[0]?.message).toMatch(/44 days/);
    expect(rule(op('2026-12-31'))).toEqual([]);
    expect(rule(op(undefined))[0]?.message).toMatch(/x-sunset/);
    expect(rule(op('2026-12-31', null))[0]?.message).toMatch(/x-deprecated-at/);
    expect(rule(op('31/12/2026'))[0]?.message).toMatch(/x-sunset/);
    expect(rule({ deprecated: false })).toEqual([]);
    expect(rule(null)).toEqual([]);
  });
});
