import { describe, expect, it } from 'vitest';
import { type DomainError } from '../errors/domain-error.js';
import { endOfDayInstant } from './end-of-day.js';

const iso = (date: string, zone: string) => endOfDayInstant(date, zone).toString();

// Último instante (23:59:59.999 local) del día de negocio en la zona del workspace: la tasa "vigente al cierre del día".
describe('endOfDayInstant (shared-kernel)', () => {
  it('America/La_Paz (UTC-4 sin horario de verano): el día cierra a las 03:59:59.999Z del día siguiente', () => {
    expect(iso('2026-11-12', 'America/La_Paz')).toBe('2026-11-13T03:59:59.999Z');
    expect(iso('2026-12-31', 'America/La_Paz')).toBe('2027-01-01T03:59:59.999Z');
  });

  it('UTC: 23:59:59.999Z del mismo día; fin de febrero bisiesto y no bisiesto', () => {
    expect(iso('2026-11-12', 'UTC')).toBe('2026-11-12T23:59:59.999Z');
    expect(iso('2028-02-29', 'UTC')).toBe('2028-02-29T23:59:59.999Z');
    expect(iso('2027-02-28', 'UTC')).toBe('2027-02-28T23:59:59.999Z');
  });

  it('zona con offset positivo: el cierre local cae en el mismo día UTC (Asia/Tokyo, UTC+9)', () => {
    expect(iso('2026-11-12', 'Asia/Tokyo')).toBe('2026-11-12T14:59:59.999Z');
  });

  it('cambios de horario: usa el offset vigente al cierre del día (America/New_York)', () => {
    expect(iso('2026-03-07', 'America/New_York')).toBe('2026-03-08T04:59:59.999Z');
    // 2026-03-08 salta a EDT (UTC-4): el cierre del día ya es 04:00Z.
    expect(iso('2026-03-08', 'America/New_York')).toBe('2026-03-09T03:59:59.999Z');
    // 2026-11-01 vuelve a EST (UTC-5).
    expect(iso('2026-11-01', 'America/New_York')).toBe('2026-11-02T04:59:59.999Z');
  });

  it('una zona IANA inválida se rechaza con INVALID_TIMEZONE', () => {
    try {
      endOfDayInstant('2026-11-12', 'Marte/Olimpo');
      expect.unreachable();
    } catch (err) {
      expect((err as DomainError).code).toBe('INVALID_TIMEZONE');
    }
  });
});
