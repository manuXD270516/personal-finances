import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.js';

const BASE = {
  WORKER_DATABASE_URL: 'postgres://pf_worker:s3cr3t-w@db.internal:5432/pfos',
  DATABASE_URL: 'postgres://pf_app:s3cr3t-db@db.internal:5432/pfos',
  OBJECT_STORAGE_ENDPOINT: 'http://object-storage:8333',
  OBJECT_STORAGE_BUCKET: 'pfos-ci-documents',
  OBJECT_STORAGE_ACCESS_KEY: 'access',
  OBJECT_STORAGE_SECRET_KEY: 's3cr3t-storage',
};
// Claves de PRUEBA con el formato de las variables (32 bytes en base64url = 43 caracteres); no son de ningún entorno.
const PUBLIC = 'k1:' + 'A'.repeat(43);

function problemsOf(app: 'api' | 'worker', env: Record<string, string>): string[] {
  try {
    loadConfig(app, env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems.map((p) => `${p.variable}: ${p.reason}`);
    throw err;
  }
  return [];
}

describe('configuración de las conexiones con proveedores (add-banking-providers)', () => {
  it('[TC-IMPORTS-BANKING-003] el proveedor simulado habilitado falla la configuración en staging y producción', () => {
    for (const PFOS_ENV of ['staging', 'production']) {
      const problems = problemsOf('api', { ...BASE, PFOS_ENV, IMPORTS_PROVIDER_FAKE_ENABLED: 'true' });
      expect(problems.some((p) => p.startsWith('IMPORTS_PROVIDER_FAKE_ENABLED'))).toBe(true);
    }
    for (const PFOS_ENV of ['local', 'ci']) {
      expect(problemsOf('api', { ...BASE, PFOS_ENV, IMPORTS_PROVIDER_FAKE_ENABLED: 'true' })).toEqual([]);
    }
    // Deshabilitado (por omisión) no molesta en producción.
    const off = problemsOf('api', { ...BASE, PFOS_ENV: 'production' });
    expect(off.some((p) => p.startsWith('IMPORTS_PROVIDER_FAKE_ENABLED'))).toBe(false);
  });

  it('D342: la clave privada en variable solo se admite en local/ci; en cloud va en el archivo montado', () => {
    const priv = 'k1:' + 'B'.repeat(43);
    expect(
      problemsOf('worker', { ...BASE, PFOS_ENV: 'ci', CONNECTION_CREDENTIALS_PRIVATE_KEYS: priv }),
    ).toEqual([]);
    const cloud = problemsOf('worker', {
      ...BASE,
      PFOS_ENV: 'production',
      CONNECTION_CREDENTIALS_PRIVATE_KEYS: priv,
    });
    expect(cloud.some((p) => p.startsWith('CONNECTION_CREDENTIALS_PRIVATE_KEYS:'))).toBe(true);
    // La API no declara las claves privadas: no las lee aunque estén en el entorno.
    const api = loadConfig('api', { ...BASE, PFOS_ENV: 'ci', CONNECTION_CREDENTIALS_PRIVATE_KEYS: priv });
    expect('CONNECTION_CREDENTIALS_PRIVATE_KEYS' in api).toBe(false);
  });

  it('valida el formato de las claves públicas y aplica los límites por omisión (365 días, 10 por minuto)', () => {
    const ok = loadConfig('api', { ...BASE, PFOS_ENV: 'ci', CONNECTION_CREDENTIALS_PUBLIC_KEYS: PUBLIC });
    expect(ok.CONNECTION_CREDENTIALS_PUBLIC_KEYS).toBe(PUBLIC);
    expect(ok.CONNECTION_SYNC_MAX_DAYS).toBe(365);
    expect(ok.CONNECTION_PROVIDER_REQUESTS_PER_MINUTE).toBe(10);
    expect(ok.IMPORTS_PROVIDER_FAKE_ENABLED).toBe(false);
    const bad = problemsOf('api', {
      ...BASE,
      PFOS_ENV: 'ci',
      CONNECTION_CREDENTIALS_PUBLIC_KEYS: 'k1:corta',
    });
    expect(bad.some((p) => p.startsWith('CONNECTION_CREDENTIALS_PUBLIC_KEYS'))).toBe(true);
    expect(loadConfig('api', { ...BASE, PFOS_ENV: 'ci' }).CONNECTION_CREDENTIALS_PUBLIC_KEYS).toBeUndefined();
  });
});
