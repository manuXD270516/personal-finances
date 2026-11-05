/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { generateCredentialKeyPair } from '@pf/imports/interface/imports.module';
import { ZipReader } from '@pf/identity/interface/identity.module';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, enableCurrencies, inTx, sqlState } from '../support/db.js';
import {
  contract,
  downloadExport,
  exportAndWait,
  importAndWait,
  money,
  startHarness,
  until,
  type Harness,
  type Json,
  type Reply,
  type User,
} from '../support/portability.js';

// Conexiones con un exchange de extremo a extremo (openspec add-banking-providers; imports/banking-providers): API real,
// worker real (verificación, sincronización y pipeline) y PostgreSQL con RLS y grants por columna, con el proveedor
// simulado `FAKE_EXCHANGE` (sin red). El secreto de la prueba NUNCA debe aparecer en respuestas, base, auditoría,
// idempotencia ni export. Datos ficticios (SINTETICO).
const deps = inject('deps');
const KEYS = generateCredentialKeyPair();
const PUBLIC = `k1:${KEYS.publicKey}`;
const PRIVATE = `k1:${KEYS.privateKey}`;
const SECRET = {
  keyId: 'AKIA-API-TEST-0000-a1b2',
  secret: ['sk', 'api', 'test', 'secreto', 'que', 'no', 'debe', 'salir', '7c1d'].join('-'),
};

let h: Harness;
let owner: User;
let editor: User;
let viewer: User;
let usdt: string;
let btc: string;
let connectionId: string;
const W = (u: User = owner) => `/api/v1/workspaces/${u.ws}`;

const ok = (r: Reply, status = 200): Json => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code'], JSON.stringify(r.body)).toBe(code);
};
const get = (u: User, path: string) => h.call('GET', `${W(u)}${path}`, { token: u.token });
const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const withVersion = (
  u: User,
  method: 'PUT' | 'PATCH' | 'POST',
  path: string,
  body: unknown,
  version: number,
) =>
  h.call(method, `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'if-match': `"${version}"` },
  });

const asMember = async <T>(role: 'app' | 'worker', u: User, fn: (c: Client) => Promise<T>): Promise<T> => {
  const c = await connect(role === 'app' ? deps.databaseUrl : deps.workerDatabaseUrl);
  try {
    return await inTx(c, { userId: u.id, workspaceId: u.ws }, () => fn(c));
  } finally {
    await c.end();
  }
};
/** Lectura cruda como superusuario (ignora RLS y grants): solo para comprobar qué quedó guardado. */
const asMigrator = async <T>(_u: User, fn: (c: Client) => Promise<T>): Promise<T> => {
  const c = await connect(deps.superuserUrl);
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

async function addMember(member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: owner.ws };
}

async function account(name: string, currency: string): Promise<string> {
  const r = await post(owner, '/accounts', {
    name,
    type: 'CRYPTO_WALLET',
    currency,
    openingBalance: {
      amount: money(currency === 'USDT' ? '0.000000' : '0.00000000', currency),
      date: '2026-01-01',
    },
  });
  return ok(r, 201)['id'] as string;
}

const connectionBody = (name: string, extra: Record<string, unknown> = {}) => ({
  providerId: 'FAKE_EXCHANGE',
  name,
  assetMappings: [
    { asset: 'USDT', accountId: usdt },
    { asset: 'BTC', accountId: btc },
  ],
  credential: SECRET,
  ...extra,
});

async function connection(id: string, u: User = owner): Promise<any> {
  const r = await get(u, `/imports/connections/${id}`);
  ok(r);
  expect(contract.validateResponse('getConnection', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body;
}
const waitConnection = (id: string, status: string) =>
  until(async () => {
    const c = await connection(id);
    return c.status === status ? c : undefined;
  }, 60_000);

async function job(id: string, u: User = owner): Promise<any> {
  const r = await get(u, `/imports/${id}`);
  ok(r);
  expect(contract.validateResponse('getImport', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body;
}
const waitJob = async (id: string, statuses: string[]) => {
  try {
    return await until(async () => {
      const j = await job(id);
      if (j.status === 'PARSE_FAILED' && !statuses.includes('PARSE_FAILED')) {
        throw new Error(`import falló: ${JSON.stringify(j.failure)}`);
      }
      return statuses.includes(j.status) ? j : undefined;
    }, 90_000);
  } catch (error) {
    const j = await job(id);
    const tail = (h.workerLog?.lines ?? [])
      .filter((l) => /error|warn|connection|imports/i.test(l))
      .slice(-8)
      .join(' | ');
    throw new Error(
      `${(error as Error).message}: status=${j.status} stage=${j.stage} failure=${JSON.stringify(j.failure)} worker=${tail.slice(0, 3000)}`,
      { cause: error },
    );
  }
};

const rowsOf = async (id: string) => {
  const r = await get(owner, `/imports/${id}/preview?limit=200`);
  ok(r);
  // `ImportProposedField.value` es un `oneOf` donde un id también es un texto (defecto previo del contrato, anotado en
  // docs/38): se descartan solo esos errores de la validación.
  const errors = contract
    .validateResponse('getImportPreview', 200, r.body)
    .filter((e) => !/\/proposal\/\w+\/value /.test(e));
  expect(errors, JSON.stringify(errors)).toEqual([]);
  return r.body['rows'] as any[];
};

const balanceOf = (accountId: string) =>
  asMember('app', owner, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance;
  });

beforeAll(async () => {
  const common = {
    IMPORTS_PROVIDER_FAKE_ENABLED: 'true',
    CONNECTION_CREDENTIALS_PUBLIC_KEYS: PUBLIC,
    RATE_LIMIT_WRITES_PER_MIN: '100000',
    RATE_LIMIT_READS_PER_MIN: '100000',
  };
  h = await startHarness({
    worker: true,
    apiEnv: common,
    // La clave PRIVADA solo existe en el worker (D342): la API no la recibe.
    workerEnv: { ...common, CONNECTION_CREDENTIALS_PRIVATE_KEYS: PRIVATE },
  });
  owner = await h.user(`kc-conn-owner-${randomUUID()}`);
  editor = await addMember(await h.user(`kc-conn-editor-${randomUUID()}`), 'EDITOR');
  viewer = await addMember(await h.user(`kc-conn-viewer-${randomUUID()}`), 'VIEWER');
  await enableCurrencies(deps.databaseUrl, { userId: owner.id, workspaceId: owner.ws }, ['BTC']);
  usdt = await account('Exchange USDT', 'USDT');
  btc = await account('Exchange BTC', 'BTC');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Catálogo y alta de conexiones', () => {
  it('[TC-IMPORTS-BANKING-002] un proveedor real con términos pendientes se ve «pendiente de verificación» y no admite conexiones', async () => {
    const providers = ok(await get(viewer, '/imports/providers'));
    expect(
      contract.validateResponse('listBankingProviders', 200, providers),
      JSON.stringify(providers),
    ).toEqual([]);
    const byId = new Map((providers['data'] as any[]).map((p) => [p.id, p]));
    expect(byId.get('EXCHANGE_API_BINANCE')?.availability).toBe('PENDING_VERIFICATION');
    expect(byId.get('FAKE_EXCHANGE')?.availability).toBe('AVAILABLE');
    problem(
      await post(owner, '/imports/connections', {
        providerId: 'EXCHANGE_API_BINANCE',
        name: 'Binance',
        assetMappings: [],
        credential: SECRET,
      }),
      422,
      'BANKING_PROVIDER_NOT_AVAILABLE',
    );
  });

  it('[TC-IMPORTS-BANKING-006] mapear BTC a la cuenta de USDT se rechaza con CURRENCY_MISMATCH', async () => {
    problem(
      await post(
        owner,
        '/imports/connections',
        connectionBody('Mal mapeo', { assetMappings: [{ asset: 'BTC', accountId: usdt }] }),
      ),
      422,
      'CURRENCY_MISMATCH',
    );
  });

  it('[TC-IMPORTS-BANKING-004][TC-IMPORTS-BANKING-007][TC-IMPORTS-BANKING-009][TC-IMPORTS-BANKING-034] crea, el worker verifica solo lectura y el secreto no sale por ningún lado', async () => {
    const key = randomUUID();
    const created = await post(owner, '/imports/connections', connectionBody('Exchange principal'), {
      'idempotency-key': key,
    });
    ok(created, 202);
    expect(
      contract.validateResponse('createConnection', 202, created.body),
      JSON.stringify(created.body),
    ).toEqual([]);
    expect(created.body['status']).toBe('PENDING_VERIFICATION');
    expect(created.body['credential']).toMatchObject({ fingerprint: '…a1b2', kid: 'k1' });
    connectionId = created.body['id'] as string;

    const active = await waitConnection(connectionId, 'ACTIVE');
    expect(active.credential.permissions).toMatchObject({
      read: true,
      trade: false,
      withdraw: false,
      transfer: false,
    });
    expect(active.assetMappings).toHaveLength(2);

    // Una repetición con la misma clave se reproduce (la clave se calcula con la huella, no con el secreto).
    const replay = await post(owner, '/imports/connections', connectionBody('Exchange principal'), {
      'idempotency-key': key,
    });
    expect(replay.status).toBe(202);
    expect(replay.body['id']).toBe(connectionId);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');

    // Nada de lo que sale de la API ni de lo que se guarda contiene el secreto.
    const list = ok(await get(viewer, '/imports/connections'));
    expect(contract.validateResponse('listConnections', 200, list), JSON.stringify(list)).toEqual([]);
    const everythingApi = JSON.stringify([created.body, active, list, replay.body]);
    expect(everythingApi).not.toContain(SECRET.secret);
    expect(everythingApi).not.toContain(SECRET.keyId);

    const stored = await asMigrator(owner, async (c) => {
      const cred = await c.query(
        `SELECT key_fingerprint, kid, length(wrapped_dek) AS w, length(ciphertext) AS ct,
                encode(ciphertext, 'escape') || encode(wrapped_dek, 'escape') AS blob
           FROM imports.connection_credential WHERE connection_id = $1`,
        [connectionId],
      );
      const audit = await c.query(
        `SELECT coalesce(string_agg(a::text, '|'), '') AS t FROM audit.audit_log a WHERE a.workspace_id = $1`,
        [owner.ws],
      );
      const lifecycle = await c.query(
        `SELECT coalesce(string_agg(l::text, '|'), '') AS t FROM audit.lifecycle_transition l WHERE l.workspace_id = $1`,
        [owner.ws],
      );
      const idem = await c.query(
        `SELECT coalesce(string_agg(i::text, '|'), '') AS t FROM platform.idempotency_key i`,
      );
      const outbox = await c.query(
        `SELECT coalesce(string_agg(o::text, '|'), '') AS t FROM platform.outbox o`,
      );
      return {
        cred: cred.rows[0],
        audit: audit.rows[0].t,
        lifecycle: lifecycle.rows[0].t,
        idem: idem.rows[0].t,
        outbox: outbox.rows[0].t,
      };
    });
    expect(stored.cred).toMatchObject({ key_fingerprint: '…a1b2', kid: 'k1' });
    expect(Number(stored.cred.w)).toBeGreaterThan(0);
    expect(Number(stored.cred.ct)).toBeGreaterThan(0);
    for (const text of [
      String(stored.cred.blob),
      stored.audit,
      stored.lifecycle,
      stored.idem,
      stored.outbox,
    ]) {
      expect(text).not.toContain(SECRET.secret);
      expect(text).not.toContain(SECRET.keyId);
    }
    // [TC-IMPORTS-BANKING-034] la auditoría de la creación lleva proveedor, huella y mapeos.
    expect(stored.audit).toContain('imports.connection.created');
    expect(stored.audit).toContain('…a1b2');
    expect(stored.lifecycle).toContain('PENDING_VERIFICATION');
    // Ni los logs de la API ni los del worker (nunca el secreto).
    const logs = [...h.apiLog.lines, ...(h.workerLog?.lines ?? [])].join('\n');
    expect(logs).not.toContain(SECRET.secret);
    expect(logs).not.toContain(SECRET.keyId);
  }, 180_000);

  it('[TC-IMPORTS-BANKING-008] pf_app cifra y destruye pero no puede leer wrapped_dek ni ciphertext; el worker sí', async () => {
    const select = (col: string) => (c: Client) =>
      c.query(`SELECT ${col} FROM imports.connection_credential WHERE connection_id = $1`, [connectionId]);
    expect(await sqlState(() => asMember('app', owner, select('wrapped_dek')))).toBe('42501');
    expect(await sqlState(() => asMember('app', owner, select('ciphertext')))).toBe('42501');
    expect(await sqlState(() => asMember('app', owner, select('*')))).toBe('42501');
    expect(
      await sqlState(() => asMember('app', owner, select('key_fingerprint, kid, permissions'))),
    ).toBeUndefined();
    const fromWorker = await asMember(
      'worker',
      owner,
      async (c) => (await select('wrapped_dek, ciphertext')(c)).rows[0],
    );
    expect(fromWorker?.['wrapped_dek']).toBeTruthy();
  });

  it('[TC-IMPORTS-BANKING-033] solo el OWNER gestiona credenciales y revoca; OWNER y EDITOR sincronizan; VIEWER solo lee', async () => {
    const current = await connection(connectionId);
    problem(
      await post(editor, '/imports/connections', connectionBody('Del editor')),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await withVersion(
        editor,
        'PUT',
        `/imports/connections/${connectionId}/credential`,
        SECRET,
        current.version,
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await withVersion(
        editor,
        'POST',
        `/imports/connections/${connectionId}/revoke`,
        undefined,
        current.version,
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    ok(await get(viewer, '/imports/connections'));
    problem(
      await post(viewer, `/imports/connections/${connectionId}/sync`, { from: '2026-09-01' }),
      403,
      'INSUFFICIENT_ROLE',
    );
    expect((await connection(connectionId)).status).toBe('ACTIVE');
  });

  it('DELETE responde 405 y un If-Match viejo, 412', async () => {
    const r = await h.call('DELETE', `${W()}/imports/connections/${connectionId}`, { token: owner.token });
    problem(r, 405, 'METHOD_NOT_ALLOWED');
    const current = await connection(connectionId);
    problem(
      await withVersion(
        owner,
        'PATCH',
        `/imports/connections/${connectionId}`,
        { name: 'Otro nombre' },
        current.version + 5,
      ),
      412,
      'PRECONDITION_FAILED',
    );
  });
});

describe('Sincronización con el proveedor simulado', () => {
  let importId: string;

  it('[TC-IMPORTS-BANKING-019][TC-IMPORTS-BANKING-033] el EDITOR sincroniza; una segunda sincronización a la vez es CONNECTION_SYNC_IN_PROGRESS', async () => {
    // La primera vez la fecha de inicio es obligatoria.
    problem(
      await post(editor, `/imports/connections/${connectionId}/sync`, {}),
      400 as number,
      'VALIDATION_FAILED',
    );
    const first = await post(editor, `/imports/connections/${connectionId}/sync`, { from: '2026-09-01' });
    ok(first, 202);
    expect(contract.validateResponse('syncConnection', 202, first.body), JSON.stringify(first.body)).toEqual(
      [],
    );
    importId = first.body['importJobId'] as string;
    problem(
      await post(editor, `/imports/connections/${connectionId}/sync`, { from: '2026-09-01' }),
      409,
      'CONNECTION_SYNC_IN_PROGRESS',
    );
    const review = await waitJob(importId, ['AWAITING_REVIEW']);
    expect(review).toMatchObject({ source: 'EXCHANGE_API', connectionId });
  }, 180_000);

  it('[TC-IMPORTS-BANKING-023][TC-IMPORTS-BANKING-024][TC-IMPORTS-BANKING-025] la vista previa propone conversión, gasto con señal, comisión Fees y excluye el P2P; aprobar cuadra por moneda', async () => {
    const rows = await rowsOf(importId);
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    expect([...byId.keys()].sort()).toEqual([
      'DEPOSIT:D-1001',
      'FEE:W-1001:network',
      'P2P:P-1001',
      'REWARD:R-1001',
      'TRADE:T-1001',
      'WITHDRAWAL:W-1001',
    ]);
    expect(byId.get('TRADE:T-1001')).toMatchObject({
      kind: 'CONVERSION',
      amount: { amount: '975.000000', currency: 'USDT' },
      conversion: { counterAmount: { amount: '0.01498500', currency: 'BTC' } },
    });
    expect(byId.get('WITHDRAWAL:W-1001').issues.map((i: any) => i.code)).toContain('POSSIBLE_TRANSFER');
    expect(byId.get('DEPOSIT:D-1001').issues.map((i: any) => i.code)).toContain('POSSIBLE_TRANSFER');
    expect(byId.get('P2P:P-1001')).toMatchObject({ classification: 'INVALID' });
    expect(byId.get('P2P:P-1001').issues.map((i: any) => i.code)).toContain('CONNECTION_RECORD_UNSUPPORTED');
    expect(byId.get('FEE:W-1001:network').proposal.categoryId.value).toBeTruthy();

    const current = await job(importId);
    const approved = await h.call('POST', `${W()}/imports/${importId}/approve`, {
      token: owner.token,
      headers: { 'if-match': `"${current.version}"`, 'idempotency-key': randomUUID() },
    });
    ok(approved, 202);
    const done = await waitJob(importId, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE', 'PARTIALLY_FAILED']);
    expect(done.status, JSON.stringify([done.errors, done.counters])).toBe('COMPLETED');

    // 1200 − 975 − 200 − 1 + 1.5 = 25.5 USDT; 0.015 − 0.000015 = 0.014985 BTC.
    expect(Number(await balanceOf(usdt))).toBeCloseTo(25.5, 6);
    expect(Number(await balanceOf(btc))).toBeCloseTo(0.014985, 8);
    // Cada asiento cuadra por moneda (INV-004).
    const unbalanced = await asMember(
      'app',
      owner,
      async (c) =>
        (
          await c.query(
            `SELECT journal_entry_id FROM ledger.posting GROUP BY journal_entry_id, currency HAVING sum(amount) <> 0`,
          )
        ).rowCount,
    );
    expect(unbalanced).toBe(0);
    // El detalle de la conversión: comisión PROVIDER de 0.00001500 BTC y tasa cotizada 65000.00.
    const detail = await asMember(
      'app',
      owner,
      async (c) =>
        (
          await c.query(
            `SELECT f.fee_type, f.amount::text AS fee_amount, f.currency AS fee_currency,
                  d.quoted_rate::text AS quoted_rate, d.executed_at::text AS executed_at
             FROM txn.conversion_detail d
             JOIN txn.conversion_fee f ON f.transaction_id = d.transaction_id AND f.revision = d.revision`,
          )
        ).rows[0],
    );
    expect(detail).toMatchObject({ fee_type: 'PROVIDER', fee_currency: 'BTC' });
    expect(Number(detail?.['fee_amount'])).toBeCloseTo(0.000015, 8);
    expect(Number(detail?.['quoted_rate'])).toBeCloseTo(65000, 2);
    // [TC-IMPORTS-BANKING-017] el cursor confirmado avanzó al terminar el import.
    const after = await connection(connectionId);
    expect(after.syncCursor).toBe('2026-11-03');
    expect(after.syncInProgress).toBe(false);
  }, 240_000);

  it('[TC-IMPORTS-BANKING-020][TC-IMPORTS-BANKING-022] volver a sincronizar una ventana solapada marca todo como ya importado y no crea nada', async () => {
    const before = await balanceOf(usdt);
    const again = await post(editor, `/imports/connections/${connectionId}/sync`, { from: '2026-09-01' });
    ok(again, 202);
    const second = again.body['importJobId'] as string;
    await waitJob(second, ['AWAITING_REVIEW']);
    const rows = await rowsOf(second);
    const valid = rows.filter((r) => r.classification !== 'INVALID');
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.every((r) => r.classification === 'DUPLICATE_EXACT')).toBe(true);
    const current = await job(second);
    ok(
      await h.call('POST', `${W()}/imports/${second}/approve`, {
        token: owner.token,
        headers: { 'if-match': `"${current.version}"`, 'idempotency-key': randomUUID() },
      }),
      202,
    );
    await waitJob(second, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE']);
    expect(await balanceOf(usdt)).toBe(before);
  }, 240_000);
});

describe('Aislamiento, exportación y revocación', () => {
  it('[TC-IMPORTS-BANKING-035] las conexiones de un workspace no se ven en otro y sin contexto la base falla cerrada', async () => {
    const other = await h.user(`kc-conn-other-${randomUUID()}`);
    const list = ok(await get(other, '/imports/connections'));
    expect(list['data']).toEqual([]);
    problem(await get(other, `/imports/connections/${connectionId}`), 404, 'RESOURCE_NOT_FOUND');
    const c = await connect(deps.databaseUrl);
    try {
      expect(await sqlState(() => c.query('SELECT count(*) FROM imports.connection'))).toBe('PF002');
      expect(await sqlState(() => c.query('SELECT count(*) FROM imports.connection_credential'))).toBe(
        'PF002',
      );
    } finally {
      await c.end();
    }
  });

  it('[TC-IMPORTS-BANKING-036] el export lleva la conexión sin credenciales y al importar queda «requiere credencial»', async () => {
    const exported = await exportAndWait(h, owner, owner.ws);
    const file = await downloadExport(h, owner, owner.ws, exported['id'] as string);
    expect(file.status).toBe(200);
    const reader = ZipReader.open(file.raw);
    const connections = reader
      .read('json/import-connections.jsonl')
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Json);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ provider_id: 'FAKE_EXCHANGE', status: 'ACTIVE' });
    const all = JSON.stringify([...Array(1)].map(() => connections)) + file.raw.toString('latin1');
    expect(all).not.toContain(SECRET.secret);
    expect(all).not.toContain('wrapped_dek');
    expect(() => reader.read('json/connection-credentials.jsonl')).toThrow();

    const done = await importAndWait(h, owner, file.raw);
    expect(done['status'], JSON.stringify(done)).toBe('SUCCEEDED');
    const restored = { ...owner, ws: done['workspaceId'] as string };
    const list = ok(await get(restored, '/imports/connections'));
    const restoredConn = (list['data'] as any[])[0];
    expect(restoredConn).toMatchObject({ status: 'NEEDS_CREDENTIAL', credential: null });
    // Los mapeos se reescriben a las cuentas del workspace restaurado.
    expect(restoredConn.assetMappings.map((m: any) => m.accountId)).not.toContain(usdt);
    // Sincronizar antes de cargar la credencial no es posible.
    problem(
      await post(restored, `/imports/connections/${restoredConn.id}/sync`, { from: '2026-09-01' }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
  }, 300_000);

  it('[TC-IMPORTS-BANKING-013] revocar destruye la credencial, no sincroniza más y conserva lo importado', async () => {
    const current = await connection(connectionId);
    const imported = await asMember('app', owner, async (c) =>
      Number((await c.query(`SELECT count(*) AS n FROM txn.transaction WHERE source = 'IMPORT'`)).rows[0].n),
    );
    expect(imported).toBeGreaterThan(0);
    const revoked = await withVersion(
      owner,
      'POST',
      `/imports/connections/${connectionId}/revoke`,
      undefined,
      current.version,
    );
    ok(revoked);
    expect(
      contract.validateResponse('revokeConnection', 200, revoked.body),
      JSON.stringify(revoked.body),
    ).toEqual([]);
    expect(revoked.body['status']).toBe('REVOKED');
    expect(revoked.body['credential']).toBeNull();
    const row = await asMember(
      'worker',
      owner,
      async (c) =>
        (
          await c.query(
            `SELECT wrapped_dek IS NULL AS no_dek, ciphertext IS NULL AS no_ct, destroyed_at IS NOT NULL AS destroyed
             FROM imports.connection_credential WHERE connection_id = $1`,
            [connectionId],
          )
        ).rows[0],
    );
    expect(row).toEqual({ no_dek: true, no_ct: true, destroyed: true });
    problem(
      await post(owner, `/imports/connections/${connectionId}/sync`, { from: '2026-09-01' }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    const after = await asMember('app', owner, async (c) =>
      Number((await c.query(`SELECT count(*) AS n FROM txn.transaction WHERE source = 'IMPORT'`)).rows[0].n),
    );
    expect(after).toBe(imported);
    // La revocación quedó auditada y sin secretos.
    const audit = await asMigrator(
      owner,
      async (c) =>
        (
          await c.query(
            `SELECT string_agg(a::text, '|') AS t FROM audit.audit_log a WHERE a.action = 'imports.connection.revoked'`,
          )
        ).rows[0].t,
    );
    expect(String(audit)).toContain('imports.connection.revoked');
    expect(String(audit)).not.toContain(SECRET.secret);
  }, 120_000);
});
