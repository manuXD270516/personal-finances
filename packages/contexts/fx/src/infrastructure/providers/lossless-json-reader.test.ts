import fc from 'fast-check';
import { MoneyDecimal } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { canonicalRateValue, ProviderError } from '../../domain/index.js';
import { fixture } from './fixture-server.test-support.js';
import { isJsonObject, JsonNumber, LosslessJsonReader } from './lossless-json-reader.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ProviderError) return err.code;
    throw err;
  }
  return undefined;
};

const medianOf = (body: string): string => {
  const doc = LosslessJsonReader.read(body);
  if (!isJsonObject(doc) || !(doc['median'] instanceof JsonNumber)) {
    throw new ProviderError('PROVIDER_PAYLOAD_INVALID', 'median is not a number');
  }
  return canonicalRateValue(doc['median'].text);
};

describe('LosslessJsonReader (fx/market-rate-providers, INV-001)', () => {
  it('[TC-FX-PROVIDER-003] median 12.020000000000000001 se lee EXACTO (JSON.parse daría 12.02)', () => {
    const body = fixture('paralelo-bo/rate.18-decimals.json');
    expect(medianOf(body)).toBe('12.020000000000000001');
    // Contraejemplo documentado: el float binario pierde el último decimal.
    expect(String((JSON.parse(body) as { median: number }).median)).toBe('12.02');
  });

  it('[TC-FX-PROVIDER-003] propiedad: todo decimal positivo con ≤ 18 decimales se lee sin pérdida (texto → Decimal → texto)', () => {
    const decimalText = fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 20n - 1n }), fc.integer({ min: 0, max: 18 }))
      .map(([units, scale]) =>
        new MoneyDecimal(units.toString()).div(new MoneyDecimal(10).pow(scale)).toFixed(),
      );
    fc.assert(
      fc.property(decimalText, fc.integer({ min: 0, max: 3 }), (text, zeros) => {
        // El provider puede publicar ceros finales: el valor canónico es el mismo decimal.
        const published = text.includes('.') && zeros > 0 ? `${text}${'0'.repeat(zeros)}` : text;
        const read = medianOf(`{"timestamp":"2026-10-02T09:00:00Z","median":${published}}`);
        expect(new MoneyDecimal(read).equals(new MoneyDecimal(text))).toBe(true);
        expect(read).toBe(new MoneyDecimal(text).toFixed());
      }),
      { numRuns: 1000 },
    );
  });

  it('[TC-FX-PROVIDER-003] respeta notación exponencial, espacios y respuestas multilínea (bo.dolarapi.com)', () => {
    expect(medianOf('{ "median" : 1.202e1 }')).toBe('12.02');
    const doc = LosslessJsonReader.read(fixture('dolarapi-bo/dolares.recorded-2026-10-03.json'));
    expect(Array.isArray(doc) && doc.length).toBe(2);
  });

  it('[TC-FX-PROVIDER-004] nulo, no numérico, ≤ 0 o > 18 decimales ⇒ PROVIDER_PAYLOAD_INVALID', () => {
    expect(codeOf(() => medianOf(fixture('paralelo-bo/rate.median-null.json')))).toBe(
      'PROVIDER_PAYLOAD_INVALID',
    );
    expect(codeOf(() => canonicalRateValue('N/A'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => canonicalRateValue('0'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => canonicalRateValue('-12.02'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => canonicalRateValue('12.0200000000000000001'))).toBe('PROVIDER_PAYLOAD_INVALID');
    // 19 decimales con un cero final sí son 18 exactos.
    expect(canonicalRateValue('12.0200000000000000010')).toBe('12.020000000000000001');
  });

  it('[TC-FX-PROVIDER-004] un cuerpo truncado o que no es JSON ⇒ PROVIDER_PAYLOAD_INVALID', () => {
    expect(codeOf(() => LosslessJsonReader.read(fixture('paralelo-bo/rate.truncated.json')))).toBe(
      'PROVIDER_PAYLOAD_INVALID',
    );
    expect(codeOf(() => LosslessJsonReader.read('<html>503</html>'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => LosslessJsonReader.read('{"a":1} trailing'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => LosslessJsonReader.read('{"a":01}'))).toBe('PROVIDER_PAYLOAD_INVALID');
  });

  it('decodifica strings con escapes y no contamina prototipos', () => {
    const doc = LosslessJsonReader.read(
      '{"s":"a\\"b\\u00e9\\n","__proto__":{"x":true},"n":[1,-2.5,true,null]}',
    );
    expect(isJsonObject(doc)).toBe(true);
    if (!isJsonObject(doc)) return;
    expect(doc['s']).toBe('a"bé\n');
    expect(Object.getPrototypeOf(doc)).toBeNull();
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    const n = doc['n'] as unknown[];
    expect((n[1] as JsonNumber).text).toBe('-2.5');
  });
});
