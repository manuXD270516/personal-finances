import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

/**
 * oasdiff fijado por versión y digest (misma política que el resto de imágenes, docs/20 §3). Se ejecuta en un
 * contenedor efímero (`--rm`, sin red) para no depender de un binario del host.
 */
export const OASDIFF_IMAGE =
  'tufin/oasdiff:v1.32.1@sha256:3b14fe0112e5d1bf862f91ab234a4bcd161a3f399e98f8b0b665ce70857694ac';

export interface BreakingResult {
  /** `true` si oasdiff encontró cambios incompatibles de nivel ERR. */
  readonly breaking: boolean;
  readonly output: string;
}

/**
 * `oasdiff breaking <base> <revision> --fail-on ERR` (design §7, NFR-MAINT-009). Ambos archivos deben estar en el
 * mismo directorio (se monta en solo lectura).
 */
export function oasdiffBreaking(basePath: string, revisionPath: string): BreakingResult {
  const dir = dirname(resolve(basePath));
  if (dirname(resolve(revisionPath)) !== dir)
    throw new Error('base y revisión deben estar en el mismo directorio');
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${dir}:/specs:ro`,
      OASDIFF_IMAGE,
      'breaking',
      `/specs/${basename(basePath)}`,
      `/specs/${basename(revisionPath)}`,
      '--fail-on',
      'ERR',
      '--format',
      'text',
    ],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`oasdiff falló (código ${String(result.status)}): ${output}`);
  }
  return { breaking: result.status === 1, output };
}
