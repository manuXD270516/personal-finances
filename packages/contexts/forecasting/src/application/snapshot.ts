import { createHash } from 'node:crypto';
import { canonicalJson, type ForecastRequestV1 } from '../domain/index.js';

/** `sha256:` + hash del JSON canónico de la petición SIN `requestId` ni `seed` (el conjunto es el mismo entre intentos). */
export function datasetSnapshotId(request: ForecastRequestV1): string {
  const { requestId: _omit, seed: _seed, ...rest } = request;
  return `sha256:${createHash('sha256').update(canonicalJson(rest)).digest('hex')}`;
}

/**
 * Generador pseudoaleatorio determinista a partir de un texto (el id de la corrida): las referencias opacas son
 * estables entre los reintentos de UNA corrida y distintas entre corridas.
 */
export function seededRandom(seed: string): () => number {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla de la corrida (0 a 2^31 - 1) derivada de su id: estable entre reintentos y guardada con la corrida. */
export function seedOf(runId: string): number {
  return createHash('sha256').update(`seed:${runId}`).digest().readUInt32LE(0) & 0x7fffffff;
}
