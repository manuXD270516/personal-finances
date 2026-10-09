import { Instant, isDomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { RecentAuthPolicy } from './reauth.js';

const NOW = Instant.parse('2026-10-09T12:00:00.000Z');
const at = (minutesAgo: number) => NOW.epochMillis / 1000 - minutesAgo * 60;
const policy = new RecentAuthPolicy(10 * 60_000);

const rejects = (authTime: number | undefined): boolean => {
  try {
    policy.assertRecent(authTime, NOW);
    return false;
  } catch (err) {
    return isDomainError(err) && err.code === 'REAUTHENTICATION_REQUIRED';
  }
};

describe('RecentAuthPolicy (docs/12 §4)', () => {
  it('[TC-IDENTITY-EXPORT-001] acepta autenticaciones de hasta 10 minutos y rechaza las más antiguas', () => {
    expect(rejects(at(3))).toBe(false);
    expect(rejects(at(10))).toBe(false);
    expect(rejects(at(10) - 1)).toBe(true);
    expect(rejects(at(45))).toBe(true);
  });

  it('[TC-IDENTITY-EXPORT-001] sin claim auth_time (o no numérico) se trata como no reciente', () => {
    expect(rejects(undefined)).toBe(true);
    expect(rejects(Number.NaN)).toBe(true);
  });

  it('un auth_time futuro dentro de la tolerancia de reloj vale; uno absurdo no', () => {
    expect(rejects(at(-0.5))).toBe(false);
    expect(rejects(at(-5))).toBe(true);
  });
});
