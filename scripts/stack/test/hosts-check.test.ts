import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepository, scanText } from '../src/lib/hosts-check.js';
import { ROOT } from '../src/lib/paths.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/hardcoded-host', import.meta.url));

describe('chequeo estático de hosts fijos (platform/local-environment)', () => {
  it('[TC-PLATFORM-STACK-005] el repositorio real no tiene localhost ni 127.0.0.1 fijos en apps, packages, docker ni deploy/compose', () => {
    expect(scanRepository(ROOT)).toEqual([]);
  });

  it('[TC-PLATFORM-STACK-005] sobre el fixture con http://localhost:5432 en código de aplicación falla indicando archivo y línea', () => {
    const findings = scanRepository(FIXTURE);
    expect(findings).toContainEqual({
      file: 'apps/api/src/db.ts',
      line: 3,
      text: "connectionString: 'postgres://app@localhost:5432/pfos',",
    });
    // La dirección en `environment:` de compose también es un host fijo; la del healthcheck no.
    expect(findings).toContainEqual(
      expect.objectContaining({ file: 'deploy/compose/compose.yaml', line: 8 }),
    );
    expect(findings.filter((f) => f.file === 'deploy/compose/compose.yaml')).toHaveLength(1);
  });

  it('[TC-PLATFORM-STACK-005] exime HEALTHCHECK de Dockerfile (loopback del propio contenedor) y líneas marcadas', () => {
    const dockerfile = [
      'FROM node',
      'HEALTHCHECK --interval=10s \\',
      '  CMD ["node", "hc.mjs", "http://127.0.0.1:8080/health/ready"]',
      'ENV API=http://localhost:8080',
    ].join('\n');
    expect(scanText('docker/api.Dockerfile', dockerfile)).toEqual([
      { file: 'docker/api.Dockerfile', line: 4, text: 'ENV API=http://localhost:8080' },
    ]);
    const code = ['// pf-allow-loopback: ejemplo documentado', "example: 'http://127.0.0.1:1'"].join('\n');
    expect(scanText('packages/x/src/a.ts', code)).toEqual([]);
  });
});
