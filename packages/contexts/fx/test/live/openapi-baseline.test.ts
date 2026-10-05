import { describe, expect, it } from 'vitest';
import { PARALELO_BO_BASE_URL } from '../../src/infrastructure/providers/paralelo-bo.provider.js';
import { compareBaseline, formatBaseline, PARALELO_OPENAPI_PATH, parseBaseline } from './openapi-baseline.js';

// Línea base del spec de paralelo.bo del smoke en vivo (docs/31 D46; sin red).
const URL_V1 = `${PARALELO_BO_BASE_URL}${PARALELO_OPENAPI_PATH}`;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('línea base de openapi.json de paralelo.bo (smoke en vivo)', () => {
  it('la URL canónica es https://paralelo.bo/api/v1/openapi.json (D46)', () => {
    expect(URL_V1).toBe('https://paralelo.bo/api/v1/openapi.json');
  });

  it('graba y relee el hash junto con su URL', () => {
    const text = formatBaseline({ sha256: A, url: URL_V1 });
    expect(text).toBe(`${A}  ${URL_V1}\n`);
    expect(parseBaseline(text)).toEqual({ sha256: A, url: URL_V1 });
    expect(compareBaseline({ sha256: A, url: URL_V1 }, text)).toMatchObject({ ok: true });
  });

  it('falla si el hash cambió, si no hay línea base o si se grabó para otra URL', () => {
    const recorded = formatBaseline({ sha256: A, url: URL_V1 });
    expect(compareBaseline({ sha256: B, url: URL_V1 }, recorded)).toMatchObject({ ok: false });
    expect(compareBaseline({ sha256: A, url: URL_V1 }, '')).toMatchObject({ ok: false });
    // Formato anterior (solo el hash) o grabado para /openapi.json: hay que regrabar.
    expect(parseBaseline(`${A}\n`)).toBeNull();
    const legacy = formatBaseline({ sha256: A, url: `${PARALELO_BO_BASE_URL}/openapi.json` });
    const other = compareBaseline({ sha256: A, url: URL_V1 }, legacy);
    expect(other.ok).toBe(false);
    expect(other.detail).toContain('regrabar');
  });
});
