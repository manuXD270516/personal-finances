import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx, sqlState } from '../support/db.js';

const deps = inject('deps');

/**
 * Tablas de custom fields (openspec add-custom-fields, tarea 4.1; docs/08 §5.4–§5.5): aislamiento por workspace
 * (RLS forzada), CHECK `num_nonnulls = 1`, clave única solo entre activas, grants sin DELETE en definiciones e
 * ida y vuelta exacta de `numeric(38,18)`.
 */
describe('Custom fields: restricciones, RLS y grants', () => {
  let migrator: Client;
  let app: Client;
  let owner: string;
  let outsider: string;
  const w1 = randomUUID();
  const w2 = randomUUID();
  const account1 = randomUUID();
  const field1 = randomUUID();

  async function provision(label: string): Promise<string> {
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/cf', $1, $2, $3) AS id`,
      [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
    );
    return rows[0]?.id as string;
  }

  const definition = (
    id: string,
    ws: string,
    key: string,
    over: { dataType?: string; options?: string } = {},
  ) =>
    app.query(
      `INSERT INTO classification.custom_field_definition (id, workspace_id, key, label, data_type, target, options)
       VALUES ($1, $2, $3, $3, $4, 'TRANSACTION', $5::jsonb)`,
      [id, ws, key, over.dataType ?? 'TEXT', over.options ?? '[]'],
    );

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    owner = await provision('cf-owner');
    outsider = await provision('cf-outsider');
    for (const [user, ws] of [
      [owner, w1],
      [outsider, w2],
    ] as const) {
      await inTx(
        app,
        { userId: user, workspaceId: ws },
        async () => {
          await app.query(
            `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W', 'BOB', 'America/La_Paz', 'es-BO')`,
            [ws],
          );
          await app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
            [ws, user],
          );
        },
        true,
      );
    }
    await inTx(
      app,
      { userId: owner, workspaceId: w1 },
      async () => {
        await app.query(
          `INSERT INTO accounts.account (id, workspace_id, name, type, classification, currency, liquidity)
           VALUES ($1, $2, 'Bank A', 'BANK', 'ASSET', 'BOB', 'LIQUID')`,
          [account1, w1],
        );
        await definition(field1, w1, 'sucursal');
      },
      true,
    );
  });

  afterAll(async () => {
    await app?.end();
    await migrator?.end();
  });

  const insertValue = (cols: Record<string, unknown>) => {
    const entries = Object.entries(cols);
    return app.query(
      `INSERT INTO accounts.account_custom_field_value (workspace_id, account_id, field_id, ${entries.map(([c]) => c).join(', ')})
       VALUES ($1, $2, $3, ${entries.map((_, i) => `$${i + 4}`).join(', ')})`,
      [w1, account1, randomUUID(), ...entries.map(([, v]) => v)],
    );
  };

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] CHECK num_nonnulls = 1: ninguna o dos columnas de valor se rechazan (23514)', async () => {
    const ctx = { userId: owner, workspaceId: w1 };
    expect(await inTx(app, ctx, () => sqlState(() => insertValue({ value_text: 'x' })))).toBeUndefined();
    expect(
      await inTx(app, ctx, () => sqlState(() => insertValue({ value_text: 'x', value_bool: true }))),
    ).toBe('23514');
    expect(
      await inTx(app, ctx, () =>
        sqlState(() =>
          app.query(
            `INSERT INTO accounts.account_custom_field_value (workspace_id, account_id, field_id) VALUES ($1, $2, $3)`,
            [w1, account1, randomUUID()],
          ),
        ),
      ),
    ).toBe('23514');
    expect(await inTx(app, ctx, () => sqlState(() => insertValue({ value_text: '' })))).toBe('23514');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] numeric(38,18) conserva decimales exactos (PBT: string → numeric → string sin pérdida)', async () => {
    const decimal = fc
      .tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 20n - 1n }), fc.stringMatching(/^[0-9]{1,18}$/u))
      .map(([neg, whole, frac]) => `${neg ? '-' : ''}${whole}.${frac}`);
    await inTx(app, { userId: owner, workspaceId: w1 }, async () => {
      await fc.assert(
        fc.asyncProperty(decimal, async (text) => {
          const { rows } = await app.query<{ v: string }>(`SELECT ($1::numeric(38,18))::text AS v`, [text]);
          const [whole = '', frac = ''] = text.replace('-', '').split('.');
          const expected = `${text.startsWith('-') && /[1-9]/u.test(whole + frac) ? '-' : ''}${whole}.${frac.padEnd(18, '0')}`;
          expect(rows[0]!.v).toBe(expected);
        }),
        { numRuns: 60 },
      );
    });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-002] la clave es única SOLO entre activas: archivar la libera; dos activas iguales ⇒ 23505', async () => {
    const ctx = { userId: owner, workspaceId: w1 };
    expect(await inTx(app, ctx, () => sqlState(() => definition(randomUUID(), w1, 'sucursal')))).toBe(
      '23505',
    );
    await inTx(
      app,
      ctx,
      async () => {
        await app.query(
          `UPDATE classification.custom_field_definition SET archived_at = now(), version = version + 1 WHERE id = $1`,
          [field1],
        );
        await definition(randomUUID(), w1, 'sucursal');
      },
      false,
    );
  });

  it('CHECK de opciones: SELECT exige al menos una; los demás tipos, ninguna; la clave y el tipo validan su forma', async () => {
    const ctx = { userId: owner, workspaceId: w1 };
    const bad = (key: string, over: { dataType?: string; options?: string }) =>
      inTx(app, ctx, () => sqlState(() => definition(randomUUID(), w1, key, over)));
    expect(await bad('sel_vacio', { dataType: 'SELECT', options: '[]' })).toBe('23514');
    expect(
      await bad('texto_con', { dataType: 'TEXT', options: '[{"key":"a","label":"A","position":0}]' }),
    ).toBe('23514');
    expect(await bad('multi', { dataType: 'MULTI_SELECT' })).toBe('23514');
    expect(await bad('Mayuscula', {})).toBe('23514');
    expect(
      await bad('ok_select', { dataType: 'SELECT', options: '[{"key":"a","label":"A","position":0}]' }),
    ).toBeUndefined();
  });

  it('[TC-SECURITY-RLS-001] RLS: otro workspace no ve ni inserta definiciones ni valores; sin contexto ⇒ PF002', async () => {
    await inTx(
      app,
      { userId: owner, workspaceId: w1 },
      () =>
        app.query(
          `INSERT INTO accounts.account_custom_field_value (workspace_id, account_id, field_id, value_text) VALUES ($1, $2, $3, 'visible')`,
          [w1, account1, field1],
        ),
      true,
    );
    const seen = await inTx(app, { userId: outsider, workspaceId: w2 }, async () => [
      (await app.query(`SELECT 1 FROM classification.custom_field_definition`)).rowCount,
      (await app.query(`SELECT 1 FROM accounts.account_custom_field_value`)).rowCount,
      (await app.query(`SELECT 1 FROM txn.split_custom_field_value`)).rowCount,
    ]);
    expect(seen).toEqual([0, 0, 0]);
    // INSERT con workspace ajeno ⇒ viola la política WITH CHECK.
    expect(
      await inTx(app, { userId: outsider, workspaceId: w2 }, () =>
        sqlState(() => definition(randomUUID(), w1, 'intruso')),
      ),
    ).toBe('42501');
    expect(await sqlState(() => app.query(`SELECT 1 FROM classification.custom_field_definition`))).toBe(
      'PF002',
    );
  });

  it('grants: pf_app no borra definiciones (archivado suave, INV-019) y sí puede borrar valores (tabla de enlace)', async () => {
    const ctx = { userId: owner, workspaceId: w1 };
    expect(
      await inTx(app, ctx, () =>
        sqlState(() =>
          app.query(`DELETE FROM classification.custom_field_definition WHERE id = $1`, [field1]),
        ),
      ),
    ).toBe('42501');
    expect(
      await inTx(app, ctx, () =>
        sqlState(() =>
          app.query(`DELETE FROM accounts.account_custom_field_value WHERE account_id = $1`, [account1]),
        ),
      ),
    ).toBeUndefined();
  });

  it('las tres tablas están registradas en platform.workspace_scoped_table (purga del workspace demo)', async () => {
    const { rows } = await migrator.query<{ t: string; purge_order: number }>(
      `SELECT schema_name || '.' || table_name AS t, purge_order FROM platform.workspace_scoped_table
        WHERE table_name IN ('custom_field_definition', 'split_custom_field_value', 'account_custom_field_value')
        ORDER BY t`,
    );
    expect(rows.map((r) => r.t)).toEqual([
      'accounts.account_custom_field_value',
      'classification.custom_field_definition',
      'txn.split_custom_field_value',
    ]);
    const order = (t: string) => rows.find((r) => r.t === t)!.purge_order;
    // Los valores se borran antes que su split/cuenta (hijas con orden menor).
    expect(order('txn.split_custom_field_value')).toBeLessThan(30);
    expect(order('accounts.account_custom_field_value')).toBeLessThan(90);
  });
});
