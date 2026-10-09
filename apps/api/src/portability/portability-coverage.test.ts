import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PORTABILITY_EXCLUSIONS, PORTABILITY_SECTIONS } from './portability-wiring.js';

/**
 * Regla de cobertura de tablas, versión estática (openspec add-workspace-export, § "Cobertura de tablas"): toda tabla que
 * una migración crea con una columna `workspace_id` DEBE tener una sección del `PortabilityRegistry` o una exclusión
 * declarada con su motivo. Corre en el gate unitario (sin Docker); el test de integración
 * `workspace-export-contract.int.test.ts` la verifica contra `platform.workspace_scoped_table` de la base real.
 */
const MIGRATIONS = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

/** Tablas con columna `workspace_id` declaradas por las migraciones (sin particiones). */
function tablesWithWorkspaceId(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const up = sql.split('-- migrate:down')[0] ?? '';
    for (const m of up.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+\.[a-z_]+)\s*\(/gu)) {
      const start = (m.index ?? 0) + m[0].length;
      let depth = 1;
      let i = start;
      while (i < up.length && depth > 0) {
        if (up[i] === '(') depth += 1;
        else if (up[i] === ')') depth -= 1;
        i += 1;
      }
      const body = up.slice(start, i - 1);
      if (/(^|[\s,(])workspace_id\s/u.test(body)) found.add(m[1] as string);
    }
    // Columna agregada después a una tabla existente.
    for (const m of up.matchAll(/ALTER TABLE\s+([a-z_]+\.[a-z_]+)\s+ADD COLUMN\s+workspace_id\b/gu))
      found.add(m[1] as string);
  }
  return [...found].sort();
}

describe('[TC-IDENTITY-EXPORT-010] cobertura de tablas del export (estática)', () => {
  it('toda tabla de negocio con workspace_id tiene sección del registro o exclusión con motivo', () => {
    const tables = tablesWithWorkspaceId();
    expect(tables.length).toBeGreaterThan(40);
    const covered = new Set([
      ...PORTABILITY_SECTIONS.map((s) => s.table),
      ...PORTABILITY_EXCLUSIONS.map((e) => e.table),
    ]);
    expect(
      tables.filter((t) => !covered.has(t)),
      'tablas con workspace_id sin sección ni exclusión',
    ).toEqual([]);
  });

  it('las secciones tienen nombre único, orden único por dependencia y los bloqueos de periodo van al final', () => {
    const names = PORTABILITY_SECTIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const orders = PORTABILITY_SECTIONS.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(PORTABILITY_SECTIONS[0]?.name).toBe('workspace');
    expect(PORTABILITY_SECTIONS.at(-1)?.name).toBe('period-locks');
    // Nombres de archivo seguros (kebab-case) y cada sección declara su contexto dueño.
    for (const s of PORTABILITY_SECTIONS) {
      expect(s.name).toMatch(/^[a-z][a-z0-9-]*$/u);
      expect(s.context.length).toBeGreaterThan(0);
    }
  });

  it('la regla detecta una tabla nueva sin sección (simulada)', () => {
    const covered = new Set([
      ...PORTABILITY_SECTIONS.map((s) => s.table),
      ...PORTABILITY_EXCLUSIONS.map((e) => e.table),
    ]);
    expect(covered.has('goals.goal')).toBe(false);
    expect(
      ['planning.budget', 'txn.transaction', 'iam.workspace_membership'].every((t) => covered.has(t)),
    ).toBe(true);
  });
});
