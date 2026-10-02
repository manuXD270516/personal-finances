import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { errorsOf, makeRepo } from './helpers.js';

const check = (root: string) => runCheck({ root, openspec: 'markdown' });

describe('reglas de trazabilidad', () => {
  it('el fixture consistente no produce errores', async () => {
    const result = await check(makeRepo());
    expect(errorsOf(result.findings)).toEqual([]);
  });

  it('[TC-PLATFORM-TRACE-001] falla con R3 cuando un caso automated no tiene ningún test con su id', async () => {
    const result = await check(makeRepo('automated-without-test'));
    const r3 = errorsOf(result.findings, 'R3');
    expect(r3).toHaveLength(1);
    expect(r3[0]?.file).toBe('tests/cases/demo/TC-DEMO-CORE-004.md');
    expect(r3[0]?.message).toContain('TC-DEMO-CORE-004');
  });

  it('[TC-PLATFORM-TRACE-001] falla con R3 cuando automated_tests apunta a un archivo que no contiene el id', async () => {
    const result = await check(makeRepo('automated-test-path-missing'));
    const r3 = errorsOf(result.findings, 'R3');
    expect(r3).toHaveLength(1);
    expect(r3[0]?.message).toContain('packages/demo/src/no-existe.test.ts');
  });

  it('[TC-PLATFORM-TRACE-001] falla con R1 cuando un caso confirmado referencia spec, requirement o scenario inexistentes', async () => {
    const result = await check(makeRepo('broken-reference'));
    const r1 = errorsOf(result.findings, 'R1');
    expect(r1.map((f) => [f.file, f.message])).toEqual(
      expect.arrayContaining([
        ['tests/cases/demo/TC-DEMO-REF-001.md', expect.stringContaining('requirement inexistente')],
        [
          'tests/cases/demo/TC-DEMO-REF-002.md',
          expect.stringContaining("capability inexistente 'demo/no-existe'"),
        ],
        [
          'tests/cases/demo/TC-DEMO-REF-003.md',
          expect.stringContaining("scenario inexistente 'Escenario fantasma'"),
        ],
        // Los changes archivados no cuentan como fuente de requirements.
        ['tests/cases/demo/TC-DEMO-REF-004.md', expect.stringContaining("capability inexistente 'demo/old'")],
      ]),
    );
    expect(r1).toHaveLength(4);
  });

  it('una referencia rota con requirement_status provisional es solo una advertencia', async () => {
    const result = await check(makeRepo('provisional-reference'));
    expect(errorsOf(result.findings)).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: 'R1',
        severity: 'warning',
        file: 'tests/cases/demo/TC-DEMO-PROV-001.md',
      }),
    );
  });

  it('compara requirement normalizando mayúsculas y espacios', async () => {
    // TC-DEMO-CORE-003 declara "requirement   CUBIERTO".
    const result = await check(makeRepo());
    expect(result.findings.filter((f) => f.file === 'tests/cases/demo/TC-DEMO-CORE-003.md')).toEqual([]);
  });

  it('[TC-PLATFORM-TRACE-002] falla con R4 cuando un test referencia un TC-ID inexistente en el catálogo', async () => {
    const result = await check(makeRepo('unknown-id'));
    const r4 = errorsOf(result.findings, 'R4');
    expect(r4).toHaveLength(1);
    expect(r4[0]?.file).toBe('packages/demo/src/unknown.test.ts');
    expect(r4[0]?.message).toContain('TC-LEDGER-FOO-999');
  });

  it('falla con R5 cuando un test referencia un TC deprecado', async () => {
    const result = await check(makeRepo('deprecated-only', 'deprecated-referenced'));
    const r5 = errorsOf(result.findings, 'R5');
    expect(r5).toHaveLength(1);
    expect(r5[0]?.file).toBe('packages/demo/src/deprecated.test.ts');
  });

  it('ignora node_modules y los directorios de fixtures al escanear tests', async () => {
    const root = makeRepo();
    const unknown = `[${['TC', 'DEMO', 'NOPE', '001'].join('-')}]`;
    for (const dir of ['packages/demo/node_modules/x', 'packages/demo/test/fixtures/repo']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'ignored.test.ts'), `it('${unknown} no se escanea', () => {});\n`);
    }
    const result = await check(root);
    expect(errorsOf(result.findings)).toEqual([]);
  });

  it('[TC-PLATFORM-TRACE-003] falla con R2 y lista el requirement Must sin ningún TC', async () => {
    const result = await check(makeRepo('must-uncovered'));
    const r2 = errorsOf(result.findings, 'R2');
    expect(r2).toHaveLength(1);
    expect(r2[0]?.message).toContain('fixture/capability#Requirement sin cobertura');
    expect(r2[0]?.file).toBe('openspec/changes/add-uncovered/specs/fixture/capability/spec.md');
  });

  it('[TC-PLATFORM-TRACE-003] un TC deprecado no cuenta como cobertura de un requirement Must', async () => {
    const result = await check(makeRepo('deprecated-only'));
    const r2 = errorsOf(result.findings, 'R2');
    expect(r2.map((f) => f.message)).toEqual([expect.stringContaining('demo/main#Requirement principal')]);
  });

  it('un requirement Should sin TC no es error', async () => {
    const result = await check(makeRepo());
    expect(result.findings.some((f) => f.message.includes('Requirement opcional'))).toBe(false);
  });
});
