import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { FixedClock, Instant, systemClock } from './instant.js';
import { LocalDate } from './local-date.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

describe('fechas de negocio frente a instantes (platform/api-conventions)', () => {
  it('[TC-PLATFORM-API-019] 23:30 del 2026-09-30 en La Paz es la fecha de negocio 2026-09-30 y el instante 2026-10-01T03:30:00.000Z', () => {
    const clock = new FixedClock(Instant.parse('2026-10-01T03:30:00Z'));
    expect(clock.now().toString()).toBe('2026-10-01T03:30:00.000Z');
    expect(LocalDate.ofInstant(clock.now(), 'America/La_Paz').toString()).toBe('2026-09-30');
    expect(LocalDate.ofInstant(clock.now(), 'UTC').toString()).toBe('2026-10-01');
    expect(JSON.stringify({ createdAt: clock.now(), date: LocalDate.parse('2026-09-30') })).toBe(
      '{"createdAt":"2026-10-01T03:30:00.000Z","date":"2026-09-30"}',
    );
  });

  it('[TC-PLATFORM-API-019] una fecha de negocio con hora u offset se rechaza', () => {
    for (const bad of [
      '2026-09-30T23:30:00-04:00',
      '2026-09-30T23:30:00Z',
      '2026-9-30',
      '30/09/2026',
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '0000-01-01',
      '',
    ]) {
      expect(
        codeOf(() => LocalDate.parse(bad)),
        bad,
      ).toBe('VALIDATION_FAILED');
    }
    expect(LocalDate.parse('2028-02-29').toString()).toBe('2028-02-29');
    expect(codeOf(() => LocalDate.parse('2026-02-29'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => LocalDate.parse('2100-02-29'))).toBe('VALIDATION_FAILED');
    expect(LocalDate.parse('2000-02-29').toString()).toBe('2000-02-29');
    expect(codeOf(() => LocalDate.ofInstant(systemClock.now(), 'Mars/Olympus'))).toBe('INVALID_TIMEZONE');
  });

  it('[TC-PLATFORM-API-019] un instante solo se acepta en RFC 3339 UTC con sufijo Z', () => {
    expect(Instant.parse('2026-10-01T03:30:00.123456Z').toString()).toBe('2026-10-01T03:30:00.123Z');
    for (const bad of [
      '2026-10-01T03:30:00-04:00',
      '2026-10-01',
      '2026-10-01T25:00:00Z',
      '2026-02-30T00:00:00Z',
    ]) {
      expect(
        codeOf(() => Instant.parse(bad)),
        bad,
      ).toBe('VALIDATION_FAILED');
    }
    expect(codeOf(() => Instant.ofEpochMillis(Number.NaN))).toBe('VALIDATION_FAILED');
  });

  it('comparaciones y reloj controlable', () => {
    const a = LocalDate.of(2026, 9, 30);
    const b = LocalDate.parse('2026-10-01');
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.equals(LocalDate.parse('2026-09-30'))).toBe(true);
    const clock = new FixedClock(Instant.fromDate(new Date('2026-10-01T10:00:00Z')));
    const before = clock.now();
    clock.advance(25 * 3_600_000);
    expect(before.isBefore(clock.now())).toBe(true);
    expect(clock.now().toString()).toBe('2026-10-02T11:00:00.000Z');
    clock.set(before);
    expect(clock.now().equals(before)).toBe(true);
    expect(clock.now().toDate().getTime()).toBe(before.epochMillis);
  });

  it('[TC-PLATFORM-API-019] propiedad: toda fecha válida hace round-trip exacto y nunca cambia de día', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1900-01-01Z'), max: new Date('2199-12-31Z'), noInvalidDate: true }),
        (d) => {
          const iso = d.toISOString().slice(0, 10);
          expect(LocalDate.parse(iso).toString()).toBe(iso);
          expect(LocalDate.ofInstant(Instant.fromDate(d), 'UTC').toString()).toBe(iso);
          expect(Instant.parse(d.toISOString()).toString()).toBe(d.toISOString());
        },
      ),
      { numRuns: 300 },
    );
  });
});
