import { loadConfig } from '@pf/platform/config';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MINIMAL_USERS, MINIMAL_WORKSPACES, runSeed } from '../../src/seed/run-seed.js';
import { connect, inTx } from '../support/db.js';
import { capturingLogger } from '../support/harness.js';

// Minimal Seed de IDENTITY (tarea 8.5, docs/29 §2.1) contra PostgreSQL real con el rol de la app (bajo RLS).
const deps = inject('deps');
const ISSUER = 'http://localhost:28081/realms/pfos';

const config = () =>
  loadConfig('seed', {
    PFOS_ENV: 'ci',
    DATABASE_URL: deps.databaseUrl,
    OIDC_ISSUER_URL: ISSUER,
  });

describe('Minimal Seed: identidades, W1/W2, membresías y provisión de workspace (docs/29)', () => {
  const logger = capturingLogger('finance-api', 'seed').logger;
  let ids: Map<string, string>;

  beforeAll(async () => {
    await runSeed(config(), logger, 'minimal');
    await runSeed(config(), logger, 'minimal'); // idempotente
    const app = await connect(deps.databaseUrl);
    try {
      ids = new Map();
      for (const u of MINIMAL_USERS) {
        const r = await app.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
          ISSUER,
          u.subject,
          `${u.key}@demo.pfos.test`,
          u.name,
        ]);
        ids.set(u.key, r.rows[0]!.id);
      }
    } finally {
      await app.end();
    }
  });

  afterAll(() => undefined);

  it('W1 tiene owner (OWNER), editor (EDITOR) y viewer (VIEWER); W2 tiene owner y outsider (OWNER); sin duplicados', async () => {
    const app = await connect(deps.databaseUrl);
    try {
      for (const ws of MINIMAL_WORKSPACES) {
        const owner = ids.get('owner')!;
        const rows = await inTx(
          app,
          { userId: owner, workspaceId: ws.id },
          async () =>
            (
              await app.query<{ user_id: string; role: string; name: string }>(
                `SELECT m.user_id, m.role, w.name FROM iam.workspace_membership m
                 JOIN iam.workspace w ON w.id = m.workspace_id
                WHERE m.workspace_id = $1 AND m.status = 'ACTIVE' ORDER BY m.role, m.user_id`,
                [ws.id],
              )
            ).rows,
        );
        expect(rows.map((r) => r.name)).toEqual(ws.members.map(() => ws.name));
        expect(rows.map((r) => [r.user_id, r.role]).sort()).toEqual(
          ws.members.map((m) => [ids.get(m.user), m.role]).sort(),
        );
      }
    } finally {
      await app.end();
    }
  });

  it('W1/W2 quedan provisionados como al crear un workspace: categorías de sistema, catálogo es-BO y monedas (idempotente)', async () => {
    const app = await connect(deps.databaseUrl);
    try {
      for (const ws of MINIMAL_WORKSPACES) {
        const owner = ids.get('owner')!;
        const { system, total, uncategorized, currencies } = await inTx(
          app,
          { userId: owner, workspaceId: ws.id },
          async () => {
            const cats = await app.query<{ system_code: string | null; name: string }>(
              'SELECT system_code, name FROM classification.category WHERE workspace_id = $1',
              [ws.id],
            );
            const ccy = await app.query<{ currency_code: string }>(
              'SELECT currency_code FROM fx.workspace_currency WHERE workspace_id = $1 ORDER BY currency_code',
              [ws.id],
            );
            return {
              system: cats.rows.filter((c) => c.system_code !== null).length,
              total: cats.rows.length,
              uncategorized: cats.rows.find((c) => c.system_code === 'UNCATEGORIZED')?.name,
              currencies: ccy.rows.map((r) => r.currency_code),
            };
          },
        );
        // Las 11 de sistema, una sola vez aunque la seed corra dos veces, más el catálogo sugerido.
        expect(system).toBe(11);
        expect(total).toBeGreaterThan(system);
        expect(uncategorized).toBe('Sin categoría');
        expect(currencies).toEqual(['BOB', 'USD', 'USDT']);
      }
    } finally {
      await app.end();
    }
  });

  it('los usuarios sembrados no tienen workspace personal (viewer solo ve W1)', async () => {
    const app = await connect(deps.databaseUrl);
    try {
      const viewer = ids.get('viewer')!;
      const visible = await inTx(app, { userId: viewer, workspaceId: null }, async () =>
        (await app.query<{ name: string }>('SELECT name FROM iam.workspace ORDER BY name')).rows.map(
          (r) => r.name,
        ),
      );
      expect(visible).toEqual(['W1 Personal Demo']);
    } finally {
      await app.end();
    }
  });
});
