import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.js';

const API_ENV = {
  PFOS_ENV: 'ci',
  DATABASE_URL: 'postgres://pf_app:s3cr3t-db@db.internal:5432/pfos',
  OBJECT_STORAGE_ENDPOINT: 'http://object-storage:8333',
  OBJECT_STORAGE_BUCKET: 'pfos-ci-documents',
  OBJECT_STORAGE_ACCESS_KEY: 'access',
  OBJECT_STORAGE_SECRET_KEY: 's3cr3t-storage',
};

function captureError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('se esperaba ConfigError');
}

describe('contrato de configuración (docs/19 §0.3)', () => {
  it('aplica los defaults documentados y tipa los valores', () => {
    const config = loadConfig('api', API_ENV);
    expect(config.API_PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.JOB_QUEUE_DRIVER).toBe('pgboss');
    expect(config.JOB_QUEUE_POLLING_INTERVAL_SECONDS).toBe(0.5);
    expect(config.OBJECT_STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(config.OTEL_ENABLED).toBe(false);
    expect(config.OTEL_NODE_RESOURCE_DETECTORS).toBe('env,os,serviceinstance');
    expect(config.VALKEY_URL).toBeUndefined();
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('falla listando TODAS las variables obligatorias faltantes, no solo la primera', () => {
    const err = captureError(() => loadConfig('api', {}));
    expect(err.problems.map((p) => p.variable).sort()).toEqual(
      [
        'DATABASE_URL',
        'OBJECT_STORAGE_ACCESS_KEY',
        'OBJECT_STORAGE_BUCKET',
        'OBJECT_STORAGE_ENDPOINT',
        'OBJECT_STORAGE_SECRET_KEY',
        'PFOS_ENV',
      ].sort(),
    );
    expect(err.message).toContain('DATABASE_URL: falta (obligatoria)');
  });

  it('trata una variable vacía como ausente', () => {
    const err = captureError(() => loadConfig('api', { ...API_ENV, DATABASE_URL: '  ' }));
    expect(err.problems).toEqual([{ variable: 'DATABASE_URL', reason: 'falta (obligatoria)' }]);
  });

  it('reporta valores inválidos sin imprimir el valor (puede ser un secreto)', () => {
    const err = captureError(() =>
      loadConfig('api', { ...API_ENV, DATABASE_URL: 'mysql://user:otro-s3cr3t@h/db', API_PORT: 'abc' }),
    );
    expect(err.problems.map((p) => p.variable).sort()).toEqual(['API_PORT', 'DATABASE_URL']);
    expect(err.message).not.toContain('otro-s3cr3t');
    expect(JSON.stringify(err.problems)).not.toContain('otro-s3cr3t');
  });

  it('exige VALKEY_URL solo cuando JOB_QUEUE_DRIVER=bullmq o SESSION_STORE=valkey', () => {
    expect(() => loadConfig('api', API_ENV)).not.toThrow();
    for (const toggle of [{ JOB_QUEUE_DRIVER: 'bullmq' }, { SESSION_STORE: 'valkey' }]) {
      const err = captureError(() => loadConfig('api', { ...API_ENV, ...toggle }));
      expect(err.problems.map((p) => p.variable)).toEqual(['VALKEY_URL']);
    }
    const config = loadConfig('api', {
      ...API_ENV,
      SESSION_STORE: 'valkey',
      VALKEY_URL: 'redis://valkey:6379/0',
    });
    expect(config.VALKEY_URL).toBe('redis://valkey:6379/0');
  });

  it('rechaza detectores de recurso OTel que filtran PII (SPIKE-10)', () => {
    const err = captureError(() =>
      loadConfig('api', { ...API_ENV, OTEL_NODE_RESOURCE_DETECTORS: 'env,host,process' }),
    );
    expect(err.problems.map((p) => p.variable)).toEqual(['OTEL_NODE_RESOURCE_DETECTORS']);
  });

  it('cada proceso valida solo sus variables (migrate no exige puertos HTTP ni la cola)', () => {
    const config = loadConfig('migrate', {
      ...API_ENV,
      PFOS_ENV: 'local',
      DATABASE_MIGRATOR_URL: 'postgres://pf_migrator:x@db.internal:5432/pfos',
      API_PORT: 'no-se-valida-en-migrate',
    });
    expect(Object.keys(config)).not.toContain('API_PORT');
    expect(Object.keys(config)).not.toContain('JOB_QUEUE_DRIVER');
    expect(config.OBJECT_STORAGE_ENSURE_BUCKET).toBe(false);
    expect(config.DATABASE_URL).toBe(API_ENV.DATABASE_URL);
  });

  it('rechaza OBJECT_STORAGE_ENSURE_BUCKET=true fuera de local/ci', () => {
    const env = {
      ...API_ENV,
      DATABASE_MIGRATOR_URL: 'postgres://pf_migrator:x@db.internal:5432/pfos',
      OBJECT_STORAGE_ENSURE_BUCKET: 'true',
    };
    expect(() => loadConfig('migrate', { ...env, PFOS_ENV: 'ci' })).not.toThrow();
    const err = captureError(() => loadConfig('migrate', { ...env, PFOS_ENV: 'production' }));
    expect(err.problems.map((p) => p.variable)).toEqual(['OBJECT_STORAGE_ENSURE_BUCKET']);
  });

  it('valida la lista de orígenes CORS del bucket', () => {
    const env = { ...API_ENV, DATABASE_MIGRATOR_URL: 'postgres://pf_migrator:x@db.internal:5432/pfos' };
    expect(
      loadConfig('migrate', { ...env, OBJECT_STORAGE_CORS_ORIGINS: 'https://app.example, http://web:3000' })
        .OBJECT_STORAGE_CORS_ORIGINS,
    ).toBe('https://app.example, http://web:3000');
    const err = captureError(() =>
      loadConfig('migrate', { ...env, OBJECT_STORAGE_CORS_ORIGINS: 'https://app.example/path' }),
    );
    expect(err.problems.map((p) => p.variable)).toEqual(['OBJECT_STORAGE_CORS_ORIGINS']);
  });

  it('finance-web exige emisor OIDC, almacén de sesiones con rol pf_bff y clave de cifrado; duraciones en ms', () => {
    const missing = captureError(() => loadConfig('web', { PFOS_ENV: 'ci' }));
    expect(missing.problems.map((p) => p.variable).sort()).toEqual(
      [
        'BFF_DATABASE_URL',
        'BFF_SESSION_ENC_KEY',
        'FINANCE_API_URL',
        'OIDC_CLIENT_SECRET',
        'OIDC_ISSUER_URL',
        'WEB_PUBLIC_URL',
      ].sort(),
    );
    const env = {
      PFOS_ENV: 'ci',
      WEB_PUBLIC_URL: 'https://app.example',
      FINANCE_API_URL: 'http://finance-api:8080',
      OIDC_ISSUER_URL: 'https://auth.example/realms/pfos',
      OIDC_CLIENT_SECRET: 'client-secret-0123456789',
      BFF_DATABASE_URL: 'postgres://pf_bff:s3cr3t-bff@db.internal:5432/pfos',
      BFF_SESSION_ENC_KEY: `k1:${'a'.repeat(32)}`,
    };
    const config = loadConfig('web', env);
    expect(config.SESSION_IDLE_TIMEOUT).toBe(30 * 60_000);
    expect(config.SESSION_ABSOLUTE_TIMEOUT).toBe(12 * 3_600_000);
    expect(config.OIDC_CLIENT_ID).toBe('pfos-web');
    const wrongRole = captureError(() =>
      loadConfig('web', { ...env, BFF_DATABASE_URL: 'postgres://pf_app:x@db.internal:5432/pfos' }),
    );
    expect(wrongRole.problems.map((p) => p.variable)).toEqual(['BFF_DATABASE_URL']);
    const badKey = captureError(() => loadConfig('web', { ...env, BFF_SESSION_ENC_KEY: 'k1:corta' }));
    expect(badKey.problems.map((p) => p.variable)).toEqual(['BFF_SESSION_ENC_KEY']);
    expect(JSON.stringify(badKey.problems)).not.toContain('corta');
  });
});
