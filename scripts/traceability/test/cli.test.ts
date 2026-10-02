import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runCli } from './helpers.js';

describe('CLI', () => {
  it.each([
    ['unknown-id', 'R4'],
    ['automated-without-test', 'R3'],
    ['broken-reference', 'R1'],
    ['must-uncovered', 'R2'],
    ['missing-requirement', 'R6'],
  ])(
    '[TC-PLATFORM-TRACE-001] check sobre el fixture inconsistente %s termina con código ≠ 0 y reporta %s',
    async (overlay, rule) => {
      const run = await runCli(['check', '--root', makeRepo(overlay), '--openspec', 'markdown']);
      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(new RegExp(`ERROR \\[${rule}\\] \\S+: `));
    },
  );

  it('[TC-PLATFORM-TRACE-001] el fixture consistente pasa el check y genera matrix.md y matrix.json', async () => {
    const root = makeRepo();
    const check = await runCli(['check', '--root', root, '--openspec', 'markdown']);
    expect(check.stderr).toBe('');
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('Trazabilidad OK');
    const matrix = await runCli(['matrix', '--root', root, '--openspec', 'markdown']);
    expect(matrix.code).toBe(0);
    expect(existsSync(join(root, 'tests/traceability/matrix.md'))).toBe(true);
    expect(existsSync(join(root, 'tests/traceability/matrix.json'))).toBe(true);
  });

  it('el check usa el CLI de OpenSpec por defecto', async () => {
    const run = await runCli(['check', '--root', makeRepo()]);
    expect(run.code).toBe(0);
  });

  it('las advertencias no cambian el código de salida', async () => {
    const run = await runCli([
      'check',
      '--root',
      makeRepo('provisional-reference'),
      '--openspec',
      'markdown',
    ]);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('ADVERTENCIA [R1]');
  });

  it('un comando desconocido o una opción inválida termina con código 2 y muestra la ayuda', async () => {
    expect((await runCli(['nada'])).code).toBe(2);
    expect((await runCli(['check', '--openspec', 'otro'])).code).toBe(2);
    const help = await runCli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Uso:');
  });
});
