import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSectionSchema, loadColumns, renderSchema } from '@pf/identity/interface/identity.module';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PORTABILITY_EXCLUSIONS, PORTABILITY_SECTIONS } from '../../src/portability/portability-wiring.js';
import { connect } from '../support/db.js';

const deps = inject('deps');
const SCHEMA_DIR = fileURLToPath(new URL('../../../../contracts/export/v1/', import.meta.url));

/**
 * Cobertura de tablas y esquemas del export (openspec add-workspace-export, requirement "Contenido completo del export"
 * y § "Cobertura de tablas"): TODA tabla de `platform.workspace_scoped_table` DEBE tener una sección del
 * `PortabilityRegistry` o una exclusión declarada con motivo; un change futuro que agregue una tabla de negocio sin
 * sección rompe este test. Los esquemas JSON publicados en `contracts/export/v1` se comparan con los que se generan desde
 * el catálogo de la base (`UPDATE_EXPORT_SCHEMAS=1` los regenera).
 */
describe('portabilidad del workspace: cobertura de tablas y esquemas (TC-IDENTITY-EXPORT-010, -003)', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect(deps.migratorUrl);
  });
  afterAll(async () => {
    await client?.end();
  });

  it('[TC-IDENTITY-EXPORT-010] toda tabla acotada por workspace tiene sección o exclusión declarada', async () => {
    const { rows } = await client.query<{ t: string }>(
      `SELECT schema_name || '.' || table_name AS t FROM platform.workspace_scoped_table ORDER BY 1`,
    );
    const scoped = rows.map((r) => r.t);
    const covered = new Set([
      ...PORTABILITY_SECTIONS.map((s) => s.table),
      ...PORTABILITY_EXCLUSIONS.map((e) => e.table),
    ]);
    expect(
      scoped.filter((t) => !covered.has(t)),
      'tablas sin sección ni exclusión',
    ).toEqual([]);
    // Y al revés: nada declarado que no exista (salvo la propia `iam.workspace`, que no está en el catálogo de purga).
    const known = new Set([...scoped, 'iam.workspace']);
    expect(
      [...covered].filter((t) => !known.has(t)),
      'declaraciones de tablas inexistentes',
    ).toEqual([]);
    // Ninguna tabla es a la vez sección y exclusión.
    const sectionTables = PORTABILITY_SECTIONS.map((s) => s.table);
    expect(PORTABILITY_EXCLUSIONS.filter((e) => sectionTables.includes(e.table))).toEqual([]);
    expect(new Set(sectionTables).size).toBe(sectionTables.length);
    expect(new Set(PORTABILITY_SECTIONS.map((s) => s.name)).size).toBe(PORTABILITY_SECTIONS.length);
    for (const e of PORTABILITY_EXCLUSIONS) expect(e.reason.length, e.table).toBeGreaterThan(10);
  });

  it('las declaraciones de cada sección son consistentes con la tabla real (columnas, orden y tipos soportados)', async () => {
    for (const s of PORTABILITY_SECTIONS) {
      const columns = await loadColumns(client, s.table, s);
      const names = new Set(columns.map((c) => c.name));
      const ws = s.workspaceColumn ?? 'workspace_id';
      expect(names.has(ws), `${s.table} columna ${ws}`).toBe(true);
      for (const col of [
        ...s.orderBy,
        ...(s.omit ?? []),
        ...Object.keys(s.money ?? {}),
        ...(s.selfRefs ?? []),
        ...(s.textRefs ?? []),
        ...(s.idColumns ?? []),
      ]) {
        expect(names.has(col), `${s.table}.${col}`).toBe(true);
      }
      if (s.importerColumn) expect(names.has(s.importerColumn), `${s.table}.${s.importerColumn}`).toBe(true);
      // Lo omitido debe poder tomar su DEFAULT al importar (nulable o con valor por defecto).
      for (const o of s.omit ?? []) {
        const { rows } = await client.query<{ ok: boolean }>(
          `SELECT (NOT a.attnotnull OR a.atthasdef OR a.attidentity <> '') AS ok FROM pg_attribute a
            WHERE a.attrelid = $1::regclass AND a.attname = $2`,
          [s.table, o],
        );
        // La sección `workspace` se inserta con SQL propio (no usa el INSERT genérico).
        if (s.name !== 'workspace')
          expect(rows[0]?.ok, `${s.table}.${o} omitida pero obligatoria`).toBe(true);
      }
    }
  });

  it('[TC-IDENTITY-EXPORT-003] los esquemas JSON publicados coinciden con los generados desde la base', async () => {
    mkdirSync(SCHEMA_DIR, { recursive: true });
    const expected = new Map<string, string>();
    for (const s of PORTABILITY_SECTIONS) {
      const columns = await loadColumns(client, s.table, s);
      expected.set(`${s.name}.schema.json`, renderSchema(buildSectionSchema(s, columns)));
    }
    if (process.env['UPDATE_EXPORT_SCHEMAS'] === '1') {
      for (const [file, text] of expected) writeFileSync(join(SCHEMA_DIR, file), text, 'utf8');
    }
    for (const [file, text] of expected) {
      const path = join(SCHEMA_DIR, file);
      expect(existsSync(path), `${file} no está publicado (UPDATE_EXPORT_SCHEMAS=1)`).toBe(true);
      expect(
        readFileSync(path, 'utf8').replace(/\r\n/gu, '\n'),
        `${file} desactualizado (UPDATE_EXPORT_SCHEMAS=1)`,
      ).toBe(text);
    }
    const published = readdirSync(SCHEMA_DIR).filter(
      (f) => f.endsWith('.schema.json') && f !== 'manifest.schema.json',
    );
    expect(
      published.filter((f) => !expected.has(f)),
      'esquemas publicados sin sección',
    ).toEqual([]);
  });
});
