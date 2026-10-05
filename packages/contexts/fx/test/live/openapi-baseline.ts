/**
 * Línea base del spec OpenAPI de paralelo.bo para el smoke en vivo (`pnpm fx:smoke-live`). URL canónica decidida por
 * el owner el 2026-10-05 (docs/31 D46): `https://paralelo.bo/api/v1/openapi.json` (`/openapi.json` responde 404).
 *
 * El archivo grabado (`test/fixtures/providers/paralelo-bo/openapi.sha256`) tiene el formato de `sha256sum`:
 * `<sha256-hex>  <url>`. Guardar la URL junto al hash hace que un cambio de URL canónica invalide la línea base en
 * lugar de compararse contra el hash de otro documento.
 */
export const PARALELO_OPENAPI_PATH = '/api/v1/openapi.json';

export interface OpenapiBaseline {
  readonly sha256: string;
  readonly url: string;
}

export type BaselineComparison =
  { readonly ok: true; readonly detail: string } | { readonly ok: false; readonly detail: string };

const HEX64 = /^[0-9a-f]{64}$/;

/** Línea del archivo para `hash` y `url` (con salto de línea final). */
export const formatBaseline = (b: OpenapiBaseline): string => `${b.sha256}  ${b.url}\n`;

/** Lee la línea base; `null` si el texto está vacío o no tiene el formato `<sha256>  <url>`. */
export function parseBaseline(text: string): OpenapiBaseline | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const [sha256, url, ...rest] = line.split(/\s+/);
  if (!sha256 || !url || rest.length > 0 || !HEX64.test(sha256)) return null;
  return { sha256, url };
}

/** Compara el hash de la respuesta actual con la línea base grabada para la MISMA URL. */
export function compareBaseline(current: OpenapiBaseline, recorded: string): BaselineComparison {
  const baseline = parseBaseline(recorded);
  if (!baseline) {
    return {
      ok: false,
      detail: `sha256 ${current.sha256}: sin línea base válida (grabar con --update-baseline)`,
    };
  }
  if (baseline.url !== current.url) {
    return {
      ok: false,
      detail: `línea base grabada para ${baseline.url}, no para ${current.url}: regrabar con --update-baseline`,
    };
  }
  return baseline.sha256 === current.sha256
    ? { ok: true, detail: `sha256 ${current.sha256} (sin cambios)` }
    : {
        ok: false,
        detail: `sha256 ${current.sha256} ≠ grabado ${baseline.sha256}: revisar el adapter de paralelo.bo`,
      };
}
