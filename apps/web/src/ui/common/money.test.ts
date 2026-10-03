import { describe, expect, it } from 'vitest';
import { localDateTimeIn, monthRange, todayIn, zonedLocalToInstant } from './dates';
import {
  allocateByPercent,
  allocateEqually,
  normalizeDecimalInput,
  parseAmount,
  parseRate,
  subtractAmounts,
  sumAmounts,
} from './money';

const bob = { locale: 'es-BO', currency: 'BOB', scale: 2 };
const usdt = { locale: 'es-BO', currency: 'USDT', scale: 6 };

describe('entrada de montos tolerante al locale (NFR-USAB-003)', () => {
  it('es-BO: coma decimal, punto de miles y también el punto como decimal cuando no son miles', () => {
    expect(normalizeDecimalInput('1.234,56', 'es-BO')).toBe('1234.56');
    expect(normalizeDecimalInput('1234,5', 'es-BO')).toBe('1234.5');
    expect(normalizeDecimalInput('45.90', 'es-BO')).toBe('45.90');
    expect(normalizeDecimalInput('1.234', 'es-BO')).toBe('1234');
    expect(normalizeDecimalInput('10.000.000', 'es-BO')).toBe('10000000');
    expect(normalizeDecimalInput(' 8 000,00 ', 'es-BO')).toBe('8000.00');
    expect(normalizeDecimalInput('0,000001', 'es-BO')).toBe('0.000001');
  });

  it('en-US: punto decimal y coma de miles', () => {
    expect(normalizeDecimalInput('1,234.56', 'en-US')).toBe('1234.56');
    expect(normalizeDecimalInput('1,234', 'en-US')).toBe('1234');
    expect(normalizeDecimalInput('1,5', 'en-US')).toBe('1.5');
  });

  it('rechaza lo que no es un número', () => {
    for (const raw of ['', 'abc', '1,2,3', '1.2.3,4,5', '12a', '1.23.4', '--1', '.']) {
      expect(normalizeDecimalInput(raw, 'es-BO')).toBeNull();
    }
  });

  it('valida la escala de la moneda sin redondear y exige monto positivo', () => {
    expect(parseAmount('45,9', bob)).toEqual({ ok: true, value: '45.90' });
    expect(parseAmount('8.000', bob)).toEqual({ ok: true, value: '8000.00' });
    expect(parseAmount('12,345', bob)).toEqual({ ok: false, error: 'SCALE' });
    expect(parseAmount('100,000000', usdt)).toEqual({ ok: true, value: '100.000000' });
    expect(parseAmount('0,0000001', usdt)).toEqual({ ok: false, error: 'SCALE' });
    expect(parseAmount('0', bob)).toEqual({ ok: false, error: 'NOT_POSITIVE' });
    expect(parseAmount('0', { ...bob, allowZero: true })).toEqual({ ok: true, value: '0.00' });
    expect(parseAmount('-5', bob)).toEqual({ ok: false, error: 'NOT_POSITIVE' });
    expect(parseAmount('  ', bob)).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseAmount('x', bob)).toEqual({ ok: false, error: 'INVALID' });
    // 20 dígitos enteros con escala de ETH: exacto, sin pasar por number.
    expect(parseAmount('123456789012345678901,5', { ...bob, currency: 'ETH', scale: 18 })).toEqual({
      ok: false,
      error: 'INVALID',
    });
    expect(
      parseAmount('12345678901234567890,123456789012345678', { ...bob, currency: 'ETH', scale: 18 }),
    ).toEqual({ ok: true, value: '12345678901234567890.123456789012345678' });
  });

  it('tasas positivas con hasta 18 decimales', () => {
    expect(parseRate('6,95', 'es-BO')).toEqual({ ok: true, value: '6.95' });
    expect(parseRate('0', 'es-BO')).toEqual({ ok: false, error: 'NOT_POSITIVE' });
    expect(parseRate('', 'es-BO')).toEqual({ ok: false, error: 'EMPTY' });
  });
});

describe('aritmética exacta de splits (regla compartida Money.allocate)', () => {
  it('sumas y restante por asignar exactos', () => {
    expect(sumAmounts(['300.00', '35.50', '14.50'], 'BOB', 2)).toBe('350.00');
    expect(subtractAmounts('350.00', '349.99', 'BOB', 2)).toBe('0.01');
    expect(subtractAmounts('100.00', '120.00', 'BOB', 2)).toBe('-20.00');
  });

  it('tres partes iguales de 100.00 BOB = 33.34, 33.33, 33.33 (mayor residuo, índice menor)', () => {
    expect(allocateEqually('100.00', 3, 'BOB', 2)).toEqual(['33.34', '33.33', '33.33']);
  });

  it('50 % y 50 % de 10.000001 USDT = 5.000001 y 5.000000, determinista', () => {
    expect(allocateByPercent('10.000001', ['50', '50'], 'USDT', 6)).toEqual(['5.000001', '5.000000']);
    expect(allocateByPercent('10.000001', ['50', '50'], 'USDT', 6)).toEqual(['5.000001', '5.000000']);
    expect(allocateByPercent('100.00', ['33.5', '66.5'], 'BOB', 2)).toEqual(['33.50', '66.50']);
    expect(allocateByPercent('100.00', ['50', '40'], 'BOB', 2)).toBeNull();
    expect(allocateByPercent('100.00', ['x'], 'BOB', 2)).toBeNull();
  });
});

describe('fechas en la zona del workspace', () => {
  it('hoy y hora local en La Paz, e instante UTC de una hora local', () => {
    const at = new Date('2026-10-01T02:30:00Z'); // 30/09 22:30 en La Paz
    expect(todayIn('America/La_Paz', at)).toBe('2026-09-30');
    expect(localDateTimeIn('America/La_Paz', at)).toBe('2026-09-30T22:30');
    expect(zonedLocalToInstant('2026-09-30T14:42', 'America/La_Paz')).toBe('2026-09-30T18:42:00Z');
    expect(zonedLocalToInstant('2026-03-10T09:00', 'Europe/Madrid')).toBe('2026-03-10T08:00:00Z');
    expect(zonedLocalToInstant('ayer', 'America/La_Paz')).toBeNull();
  });

  it('rango del mes de una fecha de negocio', () => {
    expect(monthRange('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});
