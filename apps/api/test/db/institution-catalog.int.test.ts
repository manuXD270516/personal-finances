import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@pf/platform/config';
import { uuidv7 } from '@pf/platform/logging';
import type { Client } from 'pg';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { MINIMAL_INSTITUTION_CATALOG } from '../../src/seed/institution-catalog.js';
import { MINIMAL_USERS, MINIMAL_WORKSPACES, runSeed } from '../../src/seed/run-seed.js';
import { connect, inTx } from '../support/db.js';
import { capturingLogger } from '../support/harness.js';

// Catálogo inicial ficticio de instituciones por workspace (openspec add-accounts-management 2.4, FR-ACCOUNTS-012)
// cargado por la Minimal Seed (v4) contra PostgreSQL real con el rol de la app (bajo RLS).
const deps = inject('deps');
const ISSUER = 'http://localhost:28081/realms/pfos';
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const config = () =>
  loadConfig('seed', { PFOS_ENV: 'ci', DATABASE_URL: deps.databaseUrl, OIDC_ISSUER_URL: ISSUER });

let app: Client;
let ownerId: string;
const [w4, w5] = MINIMAL_WORKSPACES.map((w) => w.id) as [string, string];

const names = (userId: string, ws: string) =>
  inTx(app, { userId, workspaceId: ws }, async () =>
    (
      await app.query<{ name: string }>(
        `SELECT name FROM accounts.institution WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY name`,
        [ws],
      )
    ).rows.map((r) => r.name),
  );

/** Archivos .ts de producción (sin tests) bajo `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory())
      return entry === 'node_modules' || entry === 'dist' ? [] : sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

beforeAll(async () => {
  const logger = capturingLogger('finance-api', 'seed').logger;
  await runSeed(config(), logger, 'minimal');
  app = await connect(deps.databaseUrl);
  const owner = MINIMAL_USERS.find((u) => u.key === 'owner')!;
  ownerId = (
    await app.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
      ISSUER,
      owner.subject,
      'owner@demo.pfos.test',
      owner.name,
    ])
  ).rows[0]!.id;
  return async () => {
    await app.end();
  };
});

describe('[TC-ACCOUNTS-INSTITUTION-002] ninguna institución fija en el producto; el catálogo inicial es editable por workspace', () => {
  it('un workspace nuevo sin catálogo (W3) no tiene instituciones', async () => {
    const w3 = uuidv7();
    const sub = `kc-inst-${randomUUID()}`;
    const user = (
      await app.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
        ISSUER,
        sub,
        `${sub}@pfos.test`,
        'W3 Owner',
      ])
    ).rows[0]!.id;
    await inTx(
      app,
      { userId: user, workspaceId: w3 },
      async () => {
        await app.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W3 sin catálogo', 'BOB', 'America/La_Paz', 'es-BO')`,
          [w3],
        );
        await app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
          [w3, user],
        );
      },
      true,
    );
    expect(await names(user, w3)).toEqual([]);
  });

  it('W4/W5 reciben cada uno sus propias filas del catálogo; renombrar en W4 no cambia W5 ni lo restaura la seed', async () => {
    const catalog = MINIMAL_INSTITUTION_CATALOG.institutions.map((i) => i.name).sort();
    expect(catalog).toContain('Banco Andino Demo');
    expect(await names(ownerId, w4)).toEqual(catalog);
    expect(await names(ownerId, w5)).toEqual(catalog);
    // Filas distintas por workspace (no compartidas).
    const ids = async (ws: string) =>
      inTx(app, { userId: ownerId, workspaceId: ws }, async () =>
        (
          await app.query<{ id: string }>(
            `SELECT id FROM accounts.institution WHERE workspace_id = $1 AND name = 'Banco Andino Demo'`,
            [ws],
          )
        ).rows.map((r) => r.id),
      );
    const [a] = await ids(w4);
    const [b] = await ids(w5);
    expect(a).toBeDefined();
    expect(a).not.toBe(b);

    await inTx(
      app,
      { userId: ownerId, workspaceId: w4 },
      () =>
        app.query(
          `UPDATE accounts.institution SET name = 'Banco Andino', version = version + 1, updated_at = now()
            WHERE workspace_id = $1 AND name = 'Banco Andino Demo'`,
          [w4],
        ),
      true,
    );
    // Re-ejecutar la seed no duplica ni "restaura" el nombre original.
    await runSeed(config(), capturingLogger('finance-api', 'seed').logger, 'minimal');
    const after4 = await names(ownerId, w4);
    expect(after4).toContain('Banco Andino');
    expect(after4).not.toContain('Banco Andino Demo');
    expect(after4).toHaveLength(catalog.length);
    expect(await names(ownerId, w5)).toEqual(catalog);
  });

  it('no existen filas globales (workspace_id es NOT NULL) ni instituciones literales en el código de producto', async () => {
    const { rows } = await app.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'accounts' AND table_name = 'institution' AND column_name = 'workspace_id'`,
    );
    expect(rows).toEqual([{ is_nullable: 'NO' }]);
    // Los nombres del catálogo solo viven en archivos de seed: ni en los contextos (dominio/aplicación/infra), ni en
    // la API fuera de `src/seed` (y del dataset de demostración, que es otro seed: add-demo-data).
    const product = [
      ...sources(join(REPO, 'packages/contexts')),
      ...sources(join(REPO, 'apps/api/src')).filter((f) => !/[\\/](seed|demo)[\\/]/.test(f)),
    ];
    expect(product.length).toBeGreaterThan(50);
    const offenders = product.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return MINIMAL_INSTITUTION_CATALOG.institutions.some((i) => text.includes(i.name));
    });
    expect(offenders).toEqual([]);
  });
});
