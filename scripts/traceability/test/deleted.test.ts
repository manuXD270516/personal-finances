import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { FIXTURES, errorsOf, makeRepo } from './helpers.js';

function git(root: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

/** Repo git temporal: commit en la rama `base` y luego los cambios del "PR" aplicados por `mutate`. */
function repoWithPr(mutate: (root: string) => void, ...overlays: string[]): string {
  const root = makeRepo(...overlays);
  git(root, 'init', '-q', '-b', 'base');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'pr');
  mutate(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'pr');
  return root;
}

const tcPath = (root: string, id: string) => join(root, 'tests/cases/demo', `${id}.md`);

describe('borrado de test cases (--base)', () => {
  it('[TC-PLATFORM-TRACE-004] falla cuando la pull request borra un TC que no está deprecado', async () => {
    const root = repoWithPr((r) => rmSync(tcPath(r, 'TC-DEMO-CORE-003')));
    const result = await runCheck({ root, openspec: 'markdown', base: 'base' });
    const errors = errorsOf(result.findings, 'R11');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.file).toBe('tests/cases/demo/TC-DEMO-CORE-003.md');
    expect(errors[0]?.message).toContain('TC-DEMO-CORE-003');
    expect(errors[0]?.message).toContain("status 'draft'");
  });

  it('[TC-PLATFORM-TRACE-004] pasa cuando el TC borrado estaba deprecado con motivo y change', async () => {
    const root = repoWithPr((r) => {
      rmSync(tcPath(r, 'TC-DEMO-CORE-002'));
      // Sin el TC, el requirement principal necesita otro caso activo para no disparar R2.
      const original = readFileSync(join(FIXTURES, 'base/tests/cases/demo/TC-DEMO-CORE-002.md'), 'utf8');
      writeFileSync(
        tcPath(r, 'TC-DEMO-CORE-012'),
        original.replaceAll('TC-DEMO-CORE-002', 'TC-DEMO-CORE-012'),
      );
    }, 'deprecated-only');
    const result = await runCheck({ root, openspec: 'markdown', base: 'base' });
    expect(errorsOf(result.findings)).toEqual([]);
  });

  it('sin --base no se compara contra git', async () => {
    const root = repoWithPr((r) => rmSync(tcPath(r, 'TC-DEMO-CORE-003')));
    const result = await runCheck({ root, openspec: 'markdown' });
    expect(errorsOf(result.findings, 'R11')).toEqual([]);
  });

  it('informa un error de uso si la ref base no existe', async () => {
    const root = repoWithPr(() => undefined);
    await expect(runCheck({ root, openspec: 'markdown', base: 'no-existe' })).rejects.toThrow(/git diff/);
  });
});
