import { Instant } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QuietHours } from './quiet-hours.js';

const LA_PAZ = 'America/La_Paz';
const night = QuietHours.of('22:00', '07:00');

describe('QuietHours', () => {
  it('[TC-NOTIFICATIONS-PREFS-002] 22:00–07:00 en La Paz: un umbral a las 23:15 se difiere a las 07:00 del día siguiente', () => {
    // 2026-11-12 23:15 en La Paz (UTC-4) = 2026-11-13T03:15:00Z.
    const published = Instant.parse('2026-11-13T03:15:00Z');
    expect(night.contains(published, LA_PAZ)).toBe(true);
    expect(night.nextAllowed(published, LA_PAZ).toString()).toBe('2026-11-13T11:00:00.000Z');
  });

  it('[TC-NOTIFICATIONS-PREFS-002] de madrugada (02:00) también espera hasta las 07:00 del mismo día', () => {
    const early = Instant.parse('2026-11-13T06:00:00Z'); // 02:00 en La Paz
    expect(night.nextAllowed(early, LA_PAZ).toString()).toBe('2026-11-13T11:00:00.000Z');
  });

  it('[TC-NOTIFICATIONS-PREFS-002] fuera del horario no se difiere nada (07:00 exacto ya está permitido)', () => {
    const noon = Instant.parse('2026-11-13T16:00:00Z'); // 12:00
    expect(night.contains(noon, LA_PAZ)).toBe(false);
    expect(night.nextAllowed(noon, LA_PAZ)).toBe(noon);
    const sevenSharp = Instant.parse('2026-11-13T11:00:00Z');
    expect(night.contains(sevenSharp, LA_PAZ)).toBe(false);
    expect(night.contains(Instant.parse('2026-11-13T10:59:59Z'), LA_PAZ)).toBe(true);
    // 22:00 exacto ya está dentro.
    expect(night.contains(Instant.parse('2026-11-13T02:00:00Z'), LA_PAZ)).toBe(true);
  });

  it('una ventana dentro del mismo día (13:00–15:00) no cruza la medianoche', () => {
    const lunch = QuietHours.of('13:00', '15:00');
    expect(lunch.contains(Instant.parse('2026-11-13T18:00:00Z'), LA_PAZ)).toBe(true); // 14:00
    expect(lunch.contains(Instant.parse('2026-11-13T20:00:00Z'), LA_PAZ)).toBe(false); // 16:00
    expect(lunch.nextAllowed(Instant.parse('2026-11-13T18:00:00Z'), LA_PAZ).toString()).toBe(
      '2026-11-13T19:00:00.000Z',
    );
  });

  it('valida el formato HH:mm y que inicio y fin difieran', () => {
    expect(() => QuietHours.of('25:00', '07:00')).toThrow(/HH:mm/);
    expect(() => QuietHours.of('22:00', '7:00')).toThrow(/HH:mm/);
    expect(() => QuietHours.of('22:00', '22:00')).toThrow(/differ/);
  });

  it('rechaza una zona horaria inválida', () => {
    expect(() => night.contains(Instant.parse('2026-11-13T03:15:00Z'), 'Mars/Olympus')).toThrow(/time zone/);
  });

  it('[TC-NOTIFICATIONS-PREFS-002] PBT: notBefore nunca cae dentro del horario ni es anterior a "ahora"', () => {
    const hhmm = fc
      .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
      .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    const windows = fc.tuple(hhmm, hhmm).filter(([s, e]) => s !== e);
    const zones = fc.constantFrom(LA_PAZ, 'America/Sao_Paulo', 'Europe/Madrid', 'Asia/Kolkata', 'UTC');
    const instants = fc.integer({
      min: Date.parse('2026-01-01T00:00:00Z'),
      max: Date.parse('2028-12-31T00:00:00Z'),
    });
    fc.assert(
      fc.property(windows, zones, instants, ([start, end], zone, ms) => {
        const window = QuietHours.of(start, end);
        const now = Instant.ofEpochMillis(ms);
        const notBefore = window.nextAllowed(now, zone);
        expect(notBefore.epochMillis).toBeGreaterThanOrEqual(now.epochMillis);
        // Salvo el desfase de una hora de un cambio de horario (el despacho reevalúa), queda fuera del horario.
        if (zone !== 'Europe/Madrid') expect(window.contains(notBefore, zone)).toBe(false);
        // No espera más de 24 h.
        expect(notBefore.epochMillis - now.epochMillis).toBeLessThanOrEqual(86_400_000);
      }),
      { numRuns: 300 },
    );
  });
});
