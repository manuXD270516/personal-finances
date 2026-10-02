import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate/dbmate.js';
import { connect, inTx, sqlState } from '../support/db.js';

const deps = inject('deps');
const FX_MIGRATION = '20261002140000_fx_currency.sql';

const REFERENCE = [
  { code: 'BOB', kind: 'FIAT', scale: 2 },
  { code: 'BTC', kind: 'CRYPTO', scale: 8 },
  { code: 'ETH', kind: 'CRYPTO', scale: 18 },
  { code: 'USD', kind: 'FIAT', scale: 2 },
  { code: 'USDT', kind: 'CRYPTO', scale: 6 },
];

describe('fx.currency: catálogo de monedas y FK de iam.workspace (add-workspace-identity, grupo 1)', () => {
  let migrator: Client;
  let app: Client;

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
  });
  afterAll(async () => {
    await app?.end();
    await migrator?.end();
  });

  const catalog = async (c: Client) =>
    (await c.query('SELECT code, kind, scale FROM fx.currency ORDER BY code')).rows as typeof REFERENCE;

  it('tras migrate contiene exactamente BOB 2, USD 2, USDT 6, BTC 8 y ETH 18; pf_app solo lee', async () => {
    expect(await catalog(migrator)).toEqual(REFERENCE);
    expect(await catalog(app)).toEqual(REFERENCE);
    expect(
      await sqlState(() =>
        app.query(`INSERT INTO fx.currency (code, kind, name, scale) VALUES ('XX', 'FIAT', 'x', 2)`),
      ),
    ).toBe('42501');
    expect(await sqlState(() => app.query(`UPDATE fx.currency SET scale = 3 WHERE code = 'BOB'`))).toBe(
      '42501',
    );
    expect(await sqlState(() => app.query(`DELETE FROM fx.currency WHERE code = 'BOB'`))).toBe('42501');
  });

  it('la migración es idempotente: re-ejecutar su bloque up no cambia el catálogo', async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, FX_MIGRATION), 'utf8');
    const up = sql.split('-- migrate:up')[1]?.split('-- migrate:down')[0] ?? '';
    expect(up).toContain('ON CONFLICT (code) DO NOTHING');
    await migrator.query('BEGIN');
    try {
      await migrator.query(up);
      expect(await catalog(migrator)).toEqual(REFERENCE);
    } finally {
      await migrator.query('ROLLBACK');
    }
  });

  it('iam.workspace.base_currency y la moneda de la reserva referencian fx.currency (FK)', async () => {
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/fx', $1, $2, 'FK') AS id`,
      [`sub-${randomUUID()}`, `fk-${randomUUID()}@demo.pfos.test`],
    );
    const userId = rows[0]?.id as string;
    const insert = (wsId: string, base: string, reserveCurrency: string | null = null) =>
      inTx(app, { userId, workspaceId: wsId }, async () => {
        await app.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale,
                                      min_liquidity_reserve_amount, min_liquidity_reserve_currency)
           VALUES ($1, 'FK', $2, 'America/La_Paz', 'es-BO', $3::numeric, $4)`,
          [wsId, base, reserveCurrency === null ? null : '1500.00', reserveCurrency],
        );
        await app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [wsId, userId],
        );
        await app.query('SET CONSTRAINTS ALL IMMEDIATE');
      });

    await expect(insert(randomUUID(), 'BOB', 'USD')).resolves.toBeUndefined();
    expect(await sqlState(() => insert(randomUUID(), 'XYZ'))).toBe('23503');
    expect(await sqlState(() => insert(randomUUID(), 'BOB', 'XYZ'))).toBe('23503');
  });
});
