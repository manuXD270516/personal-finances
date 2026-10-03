import { describe, expect, it } from 'vitest';
import { DomainError, isDomainError, jsonPointer } from './domain-error.js';

describe('DomainError', () => {
  it('[TC-PLATFORM-API-004] lleva un code estable y se ubica en un campo con JSON Pointer', () => {
    const err = new DomainError('AMOUNT_SCALE_EXCEEDED', 'BOB allows 2 decimals');
    const located = err.at(jsonPointer('splits', 0, 'amount'));
    expect(located).not.toBe(err);
    expect(err.violations).toEqual([]);
    expect(located.code).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(located.violations).toEqual([
      { pointer: '/splits/0/amount', code: 'AMOUNT_SCALE_EXCEEDED', detail: 'BOB allows 2 decimals' },
    ]);
    expect(isDomainError(located)).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect(located.name).toBe('DomainError');
  });

  it('escapa segmentos de JSON Pointer (RFC 6901) y rechaza códigos o punteros inválidos', () => {
    expect(jsonPointer('a/b', 'm~n')).toBe('/a~1b/m~0n');
    expect(jsonPointer()).toBe('');
    expect(() => new DomainError('lower_case', 'x')).toThrow(TypeError);
    expect(() => new DomainError('X', 'x').at('splits')).toThrow(TypeError);
    expect(new DomainError('X', 'x').at('').violations[0]?.pointer).toBe('');
    const cause = new Error('root');
    expect(new DomainError('X', 'x', { cause }).at('/a').cause).toBe(cause);
  });
});
