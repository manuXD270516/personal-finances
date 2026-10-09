import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  RecordValidators,
  ZipReader,
  identityWorkspaceTimeZones,
  inspectArchive,
} from '@pf/identity/interface/identity.module';
import { createLedgerMaintenance } from '@pf/ledger/interface/ledger.module';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { PORTABILITY_SECTIONS, resolveExportContractsDir } from '../../src/portability/portability-wiring.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';
import {
  asAdmin,
  buildW1,
  contract,
  downloadExport,
  exportAndWait,
  importAndWait,
  money,
  s3Client,
  startHarness,
  until,
  w1Api,
  type Harness,
  type Json,
  type W1,
} from '../support/portability.js';

// Exportación del workspace e ida y vuelta export → import de extremo a extremo (openspec add-workspace-export;
// identity/workspace-portability): API real (JWT de prueba con `auth_time`), worker real (jobs sobre pg-boss) y
// PostgreSQL + SeaweedFS reales con RLS. Criterio de salida de Phase 2: "export→import round-trip reproduce saldos".
const deps = inject('deps');
let h: Harness;
let w: W1;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  h = await startHarness({ worker: true });
  w = await buildW1(h, 'rt');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Exportación del workspace', () => {
  let exported: Json;
  let zip: Buffer;

  it('[TC-IDENTITY-EXPORT-001] el OWNER con autenticación reciente solicita el export: 202, operación vigilable e idempotente', async () => {
    const key = randomUUID();
    const r = await h.call('POST', `/api/v1/workspaces/${w.ws}/exports`, {
      token: w.owner.token,
      headers: { 'idempotency-key': key },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(contract.validateResponse('requestWorkspaceExport', 202, r.body)).toEqual([]);
    expect(r.headers.get('location')).toBe(
      `/api/v1/workspaces/${w.ws}/operations/${r.body['operationId'] as string}`,
    );
    const replay = await h.call('POST', `/api/v1/workspaces/${w.ws}/exports`, {
      token: w.owner.token,
      headers: { 'idempotency-key': key },
    });
    expect(replay.status).toBe(202);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['id']).toBe(r.body['id']);
    const op = await until(async () => {
      const o = await h.call(
        'GET',
        `/api/v1/workspaces/${w.ws}/operations/${r.body['operationId'] as string}`,
        {
          token: w.owner.token,
        },
      );
      expect(contract.validateResponse('getOperation', 200, o.body)).toEqual([]);
      return o.body['status'] === 'SUCCEEDED' || o.body['status'] === 'FAILED' ? o.body : undefined;
    });
    expect(op, JSON.stringify(op)).toMatchObject({ kind: 'EXPORT', status: 'SUCCEEDED', progressPct: 100 });
    const read = await h.call('GET', `/api/v1/workspaces/${w.ws}/exports/${r.body['id'] as string}`, {
      token: w.owner.token,
    });
    expect(contract.validateResponse('getWorkspaceExport', 200, read.body)).toEqual([]);
    exported = read.body;
    expect(exported).toMatchObject({ status: 'READY', formatVersion: 1 });
    const list = await h.call('GET', `/api/v1/workspaces/${w.ws}/exports`, { token: w.owner.token });
    expect(contract.validateResponse('listWorkspaceExports', 200, list.body)).toEqual([]);
    expect((list.body['data'] as Json[]).map((e) => e['id'])).toContain(exported['id']);
  });

  it('[TC-IDENTITY-EXPORT-001] solo el OWNER con autenticación reciente: EDITOR/VIEWER 403 INSUFFICIENT_ROLE; login de hace 45 min 403 REAUTHENTICATION_REQUIRED sin operación', async () => {
    const before = await asAdmin(h, async (c) => countOperations(c, w.ws));
    for (const u of [w.editor, w.viewer]) {
      const r = await h.call('POST', `/api/v1/workspaces/${w.ws}/exports`, {
        token: u.token,
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(r.status).toBe(403);
      expect(r.body['code']).toBe('INSUFFICIENT_ROLE');
      expect((await h.call('GET', `/api/v1/workspaces/${w.ws}/exports`, { token: u.token })).status).toBe(
        403,
      );
    }
    const stale = await h.token(w.owner.sub, 45 * 60);
    const r = await h.call('POST', `/api/v1/workspaces/${w.ws}/exports`, {
      token: stale,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body['code']).toBe('REAUTHENTICATION_REQUIRED');
    expect(
      contract.validateResponse('requestWorkspaceExport', 403, r.body, 'application/problem+json'),
    ).toEqual([]);
    // Sin la clave `auth_time` también se exige re-autenticación (por defecto seguro).
    expect(await asAdmin(h, async (c) => countOperations(c, w.ws))).toBe(before);
    // Un usuario ajeno al workspace no puede ni ver que existe.
    const outsider = await h.user(`kc-ex-outsider-${randomUUID()}`);
    const o = await h.call('POST', `/api/v1/workspaces/${w.ws}/exports`, {
      token: outsider.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect([o.status, o.body['code']]).toEqual([403, 'WORKSPACE_ACCESS_DENIED']);
  });

  it('[TC-IDENTITY-EXPORT-006] el OWNER descarga el ZIP en claro con su SHA-256 (Repr-Digest) y la descarga queda auditada; EDITOR 403; sin autenticación reciente 403', async () => {
    const id = exported['id'] as string;
    const dl = await downloadExport(h, w.owner, w.ws, id);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/zip');
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment; filename="pfos-export-.+\.zip"$/u);
    zip = dl.raw;
    expect(zip.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(sha256(zip)).toBe(exported['sha256']);
    expect(dl.headers.get('repr-digest')).toBe(
      `sha-256=:${Buffer.from(sha256(zip), 'hex').toString('base64')}:`,
    );
    expect(exported['sizeBytes']).toBe(zip.length);
    const editor = await downloadExport(h, w.editor, w.ws, id);
    expect([editor.status, editor.body['code']]).toEqual([403, 'INSUFFICIENT_ROLE']);
    const stale = await h.token(w.owner.sub, 3600);
    const old = await h.call('GET', `/api/v1/workspaces/${w.ws}/exports/${id}/download`, { token: stale });
    expect([old.status, old.body['code']]).toEqual([403, 'REAUTHENTICATION_REQUIRED']);
    const audit = await h.call(
      'GET',
      `/api/v1/workspaces/${w.ws}/audit-log?aggregateType=WorkspaceExport&aggregateId=${id}`,
      { token: w.owner.token },
    );
    const actions = (audit.body['data'] as Json[]).map((e) => e['action']);
    // (el orden cronológico entre la API y el worker se prueba con relojes reales en workspace-export-lifecycle)
    expect([...actions].sort()).toEqual([
      'identity.export.completed',
      'identity.export.downloaded',
      'identity.export.requested',
    ]);
    const requested = (audit.body['data'] as Json[]).find(
      (e) => e['action'] === 'identity.export.requested',
    )!;
    expect(requested['category']).toBe('SECURITY');
    expect(JSON.stringify(audit.body)).not.toMatch(/Bank A|3099/u);
  });

  it('[TC-IDENTITY-EXPORT-003] manifiesto, SHA-256 por archivo, esquema de cada registro, montos exactos y CSV neutralizado', async () => {
    const { manifest, reader } = inspectArchive(zip, new Set(PORTABILITY_SECTIONS.map((s) => s.name)));
    expect(manifest).toMatchObject({
      format: 'pfos-export',
      formatVersion: 1,
      workspaceId: w.ws,
      workspaceName: 'W1',
      baseCurrency: 'BOB',
      timezone: 'America/La_Paz',
      isDemo: false,
    });
    const validators = new RecordValidators(resolveExportContractsDir());
    for (const s of manifest.sections) {
      let n = 0;
      for (const line of reader.read(s.file).toString('utf8').split('\n')) {
        if (!line) continue;
        n += 1;
        expect(validators.check(s.name, JSON.parse(line)), `${s.name} #${n}`).toBeNull();
      }
      expect(n, s.name).toBe(s.count);
    }
    const tx = reader.read('json/transactions.jsonl').toString('utf8');
    expect(tx).toContain('"amount":"45.90"');
    expect(tx).toContain('"amount":"100.000000"');
    const csv = reader.read('csv/transactions.csv').toString('utf8');
    expect(csv).toContain('45.90');
    expect(csv).toContain('100.000000');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/u);
    const balances = reader.read('csv/account-balances.csv').toString('utf8');
    expect(balances).toContain('Bank A');
    expect(balances).toContain('3099.10');
    const bank = manifest.verification.accountBalances.find(
      (a) => a.accountId === w.bank && a.currency === 'BOB',
    );
    expect(bank?.balance).toBe('3099.10');
    expect(manifest.verification.accountBalances.find((a) => a.accountId === w.wallet)?.balance).toBe(
      '50.000000',
    );
    const sums = new Map<string, bigint>();
    for (const l of manifest.verification.trialBalance) {
      const [i = '0', f = ''] = l.balance.replace('-', '').split('.');
      const v = BigInt(`${i}${f.padEnd(6, '0')}`) * (l.balance.startsWith('-') ? -1n : 1n);
      sums.set(l.currency, (sums.get(l.currency) ?? 0n) + v);
    }
    expect([...sums.values()].every((v) => v === 0n)).toBe(true);
    expect(manifest.actors.map((a) => a.userId)).toEqual(
      expect.arrayContaining([w.owner.id, w.editor.id, w.viewer.id]),
    );
  });

  it('[TC-IDENTITY-EXPORT-010] el manifiesto informa conteos exactos de cada sección, iguales a la base', async () => {
    const { manifest } = inspectArchive(zip, new Set(PORTABILITY_SECTIONS.map((s) => s.name)));
    const db = await asAdmin(h, async (c) => {
      const out: Record<string, number> = {};
      for (const s of PORTABILITY_SECTIONS) {
        const col = s.workspaceColumn ?? 'workspace_id';
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${s.table} t WHERE t.${col} = $1${s.where ? ` AND (${s.where})` : ''}`,
          [w.ws],
        );
        out[s.name] = Number(rows[0]!.n);
      }
      return out;
    });
    // El log de auditoría sigue creciendo después de la instantánea (descargas, otros exports): solo no puede encogerse.
    for (const s of manifest.sections) {
      if (s.name === 'audit-log' || s.name === 'lifecycle-transitions')
        expect(s.count, s.name).toBeLessThanOrEqual(db[s.name]!);
      else expect(s.count, s.name).toBe(db[s.name]);
    }
    expect(manifest.sections.map((s) => s.name)).toEqual(PORTABILITY_SECTIONS.map((s) => s.name));
    // 120-ish: aquí hay 4 transacciones de gasto/conversión y varias de todo lo demás.
    expect(manifest.sections.find((s) => s.name === 'transactions')?.count).toBe(4);
    expect(manifest.sections.find((s) => s.name === 'close-snapshots')?.count).toBe(2);
    expect(manifest.sections.find((s) => s.name === 'budget-template-versions')?.count).toBe(3);
  });

  it('[TC-IDENTITY-EXPORT-002] el export no contiene secretos: sin hashes de IP, claves de idempotencia, outbox ni sesiones', async () => {
    const reader = ZipReader.open(zip);
    const all = reader
      .names()
      .map((n) => reader.read(n).toString('utf8'))
      .join('\n');
    const audit = reader.read('json/audit-log.jsonl').toString('utf8');
    expect(audit.length).toBeGreaterThan(100);
    for (const col of [
      'client_ip_hash',
      'idempotency_key',
      'user_agent',
      'request_id',
      'prev_hash',
      'row_hash',
    ]) {
      expect(audit, col).not.toContain(`"${col}"`);
    }
    const keys = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ key: string }>(
        `SELECT key FROM platform.idempotency_key WHERE workspace_id = $1 OR user_id = $2`,
        [w.ws, w.owner.id],
      );
      return rows.map((r) => r.key);
    });
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) expect(all, `idempotency-key ${k}`).not.toContain(k);
    expect(all).not.toContain(w.owner.token);
    expect(
      reader
        .names()
        .some((n) => /outbox|inbox|session|idempotency|dead_letter|notification\.|delivery/iu.test(n)),
    ).toBe(false);
    expect(all).not.toMatch(/"envelope"|trace_context|sid_hash|tokens_enc|csrf_secret/u);
  });

  it('[TC-IDENTITY-EXPORT-005] el objeto del almacenamiento está cifrado: sin firma ZIP ni texto reconocible, sin la clave maestra', async () => {
    const s3 = s3Client(deps);
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: deps.exportsBucket, Prefix: `exports/${w.ws}/` }),
    );
    const key = list.Contents?.find((o) => o.Key?.includes(exported['id'] as string))?.Key;
    expect(key).toBeDefined();
    const obj = await s3.send(new GetObjectCommand({ Bucket: deps.exportsBucket, Key: key as string }));
    const raw = Buffer.from(
      await (obj.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
    );
    expect(raw.subarray(0, 2).toString('ascii')).not.toBe('PK');
    expect(raw.subarray(0, 4).toString('ascii')).toBe('PFXE');
    for (const needle of [
      'Bank A',
      '3099.10',
      'Wallet USDT',
      'manifest.json',
      'pfos-export',
      'transactions.jsonl',
    ]) {
      expect(raw.includes(Buffer.from(needle)), needle).toBe(false);
    }
    expect(raw.includes(Buffer.from(deps.exportKeys.split(':')[1] as string))).toBe(false);
    const row = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ key_id: string; wrapped_key: Buffer; object_key: string }>(
        `SELECT key_id, wrapped_key, object_key FROM iam.workspace_export WHERE id = $1`,
        [exported['id']],
      );
      return rows[0]!;
    });
    expect(row.key_id).toBe('k1');
    expect(row.wrapped_key).toHaveLength(60);
    expect(row.object_key).toBe(key);
    expect(raw.includes(row.wrapped_key)).toBe(false);
  });

  it('[TC-IDENTITY-EXPORT-005] un byte alterado en el almacenamiento ⇒ 422 EXPORT_FILE_CORRUPTED sin entregar contenido; el objeto original sigue descargable al restaurarlo', async () => {
    const e = await exportAndWait(h, w.owner, w.ws);
    const id = e['id'] as string;
    const s3 = s3Client(deps);
    const key = (
      await s3.send(new ListObjectsV2Command({ Bucket: deps.exportsBucket, Prefix: `exports/${w.ws}/${id}` }))
    ).Contents![0]!.Key as string;
    const get = async () =>
      Buffer.from(
        await (
          (
            await s3.send(new GetObjectCommand({ Bucket: deps.exportsBucket, Key: key }))
          ).Body as {
            transformToByteArray(): Promise<Uint8Array>;
          }
        ).transformToByteArray(),
      );
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const original = await get();
    for (const pos of [0, 20, Math.floor(original.length / 2), original.length - 1]) {
      const bad = Buffer.from(original);
      bad[pos] = (bad[pos] as number) ^ 0x01;
      await s3.send(new PutObjectCommand({ Bucket: deps.exportsBucket, Key: key, Body: bad }));
      const r = await downloadExport(h, w.owner, w.ws, id);
      expect([r.status, r.body['code']], `byte ${pos}`).toEqual([422, 'EXPORT_FILE_CORRUPTED']);
      expect(r.raw.subarray(0, 2).toString('ascii'), `byte ${pos}`).not.toBe('PK');
    }
    await s3.send(new PutObjectCommand({ Bucket: deps.exportsBucket, Key: key, Body: original }));
    expect((await downloadExport(h, w.owner, w.ws, id)).status).toBe(200);
  });
});

describe('Importación en un workspace nuevo (ida y vuelta)', () => {
  let restored: string;
  let originalZip: Buffer;
  let copy: W1;
  let countsBefore: Record<string, number>;

  beforeAll(async () => {
    const e = await exportAndWait(h, w.owner, w.ws);
    originalZip = (await downloadExport(h, w.owner, w.ws, e['id'] as string)).raw;
    countsBefore = await asAdmin(h, async (c) => rowCounts(c, w.ws));
    const done = await importAndWait(h, w.owner, originalZip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED', errorCode: null });
    expect(contract.validateResponse('getWorkspaceImport', 200, done)).toEqual([]);
    restored = done['workspaceId'] as string;
    copy = { ...w, ws: restored };
  }, 240_000);

  it('[TC-IDENTITY-RESTORE-001] crea "W1 (restaurado)" con el importador como OWNER, ids nuevos y deja "W1" intacto', async () => {
    expect(restored).not.toBe(w.ws);
    const ws = await h.call('GET', `/api/v1/workspaces/${restored}`, { token: w.owner.token });
    expect(ws.body).toMatchObject({
      name: 'W1 (restaurado)',
      role: 'OWNER',
      status: 'ACTIVE',
      baseCurrency: 'BOB',
    });
    const row = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ restored_from_export: Json; members: string }>(
        `SELECT restored_from_export, (SELECT count(*)::text FROM iam.workspace_membership WHERE workspace_id = $1) AS members
           FROM iam.workspace WHERE id = $1`,
        [restored],
      );
      return rows[0]!;
    });
    expect(row.restored_from_export).toMatchObject({ sourceWorkspaceId: w.ws });
    expect(row.members).toBe('1');
    expect(await asAdmin(h, async (c) => rowCounts(c, w.ws))).toEqual(countsBefore);
    const copied = await asAdmin(h, async (c) => rowCounts(c, restored));
    const skip = new Set([
      'audit.audit_log',
      'audit.lifecycle_transition',
      'iam.workspace_membership',
      'platform.operation',
      'iam.workspace_export',
      'ledger.balance_snapshot',
      'reporting.workspace_data_version',
      'notifications.notification',
      'notifications.notification_delivery',
    ]);
    for (const [table, n] of Object.entries(countsBefore)) {
      if (skip.has(table)) continue;
      expect(copied[table], table).toBe(n);
    }
    // Ningún id coincide con los del original, en ninguna tabla con id.
    const clash = await asAdmin(h, async (c) => {
      const out: string[] = [];
      for (const s of PORTABILITY_SECTIONS) {
        if (s.name === 'workspace' || (s.idColumns && s.idColumns.length === 0)) continue;
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${s.table} a JOIN ${s.table} b ON a.id = b.id
            WHERE a.workspace_id = $1 AND b.workspace_id = $2`,
          [w.ws, restored],
        );
        if (Number(rows[0]!.n) > 0) out.push(s.name);
      }
      return out;
    });
    expect(clash).toEqual([]);
    // La restauración queda auditada en el workspace nuevo (evento de seguridad) y se emite WorkspaceRestored.
    const audit = await h.call('GET', `/api/v1/workspaces/${restored}/audit-log?category=SECURITY`, {
      token: w.owner.token,
    });
    expect((audit.body['data'] as Json[]).map((e) => e['action'])).toContain('identity.workspace.restored');
    const events = await asAdmin(
      h,
      async (c) =>
        (
          await c.query(
            `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = 'identity.WorkspaceRestored'`,
            [restored],
          )
        ).rows,
    );
    expect(events).toHaveLength(1);
  });

  it('[TC-IDENTITY-RESTORE-002] la ida y vuelta reproduce saldos, balance de comprobación y patrimonio (3180.10 BOB), sin violaciones del ledger', async () => {
    const a = w1Api(h, { ws: w.ws });
    const b = w1Api(h, { ws: restored });
    const balances = async (api: ReturnType<typeof w1Api>) => {
      const r = await api.get(w.owner, '/accounts?limit=100');
      return Object.fromEntries(
        (r.body['data'] as { name: string; balance: Json }[]).map((x) => [x.name, JSON.stringify(x.balance)]),
      );
    };
    const orig = await balances(a);
    const rest = await balances(b);
    expect(rest).toEqual(orig);
    expect(Object.keys(rest).sort()).toEqual(['Bank A', 'Visa', 'Wallet USDT']);
    expect(JSON.parse(rest['Bank A']!)).toMatchObject({ amount: '3099.10', currency: 'BOB' });
    expect(JSON.parse(rest['Wallet USDT']!)).toMatchObject({ amount: '50.000000', currency: 'USDT' });
    const trial = await b.get(w.owner, '/ledger/trial-balance');
    expect(trial.status, JSON.stringify(trial.body)).toBe(200);
    for (const row of (trial.body['byCurrency'] ?? trial.body['currencies'] ?? []) as {
      total?: { amount: string };
    }[]) {
      expect(Number(row.total?.amount ?? 0)).toBe(0);
    }
    const nwOrig = await a.get(w.owner, '/reports/summary?month=2026-11');
    const nwRest = await b.get(w.owner, '/reports/summary?month=2026-11');
    expect(nwRest.status, JSON.stringify(nwRest.body)).toBe(200);
    expect(nwRest.body['netWorth']).toEqual(nwOrig.body['netWorth']);
    expect((nwRest.body['netWorth'] as { netWorth: Json }).netWorth).toMatchObject({
      amount: '3180.10',
      currency: 'BOB',
    });
    // Integridad del ledger (invariant checker) sin violaciones para el workspace restaurado.
    const pool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    try {
      const maintenance = createLedgerMaintenance({
        pool,
        clock: h.clock,
        logger: capturingLogger('finance-worker', 'worker').logger,
        metrics: { increment: () => undefined },
      });
      const { violations } = await maintenance.verifyLedgerIntegrity();
      expect(JSON.stringify(violations)).not.toContain(restored);
    } finally {
      await pool.end();
    }
  });

  it('[TC-IDENTITY-RESTORE-005] revisiones, reversas y recorrido: revisión 2 con los mismos tres asientos y fechas, y los diffs de auditoría con ids remapeados', async () => {
    const inspect = async (ws: string) =>
      asAdmin(h, async (c) => {
        const tx = (
          await c.query<{ id: string; revision: number }>(
            `SELECT id, revision FROM txn.transaction WHERE workspace_id = $1 AND description = 'Compra del mes'`,
            [ws],
          )
        ).rows[0]!;
        const entries = (
          await c.query<{ entry_date: string; entry_type: string; amount: string }>(
            `SELECT e.entry_date::text, e.entry_type, (SELECT sum(abs(p.amount))::text FROM ledger.posting p WHERE p.journal_entry_id = e.id) AS amount
               FROM ledger.journal_entry e WHERE e.workspace_id = $1 AND e.source_id = $2 ORDER BY e.sequence`,
            [ws, tx.id],
          )
        ).rows;
        const audit = (
          await c.query<{ action: string }>(
            `SELECT action FROM audit.audit_log WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY occurred_at, id`,
            [ws, tx.id],
          )
        ).rows.map((r) => r.action);
        return { id: tx.id, revision: tx.revision, entries, audit };
      });
    const a = await inspect(w.ws);
    const b = await inspect(restored);
    expect(a.revision).toBe(2);
    expect(b.revision).toBe(2);
    expect(b.entries).toHaveLength(3);
    expect(b.entries).toEqual(a.entries);
    expect(b.audit).toEqual(a.audit);
    expect(b.id).not.toBe(a.id);
    // Recorrido: mismas transiciones en el mismo orden con el asiento remapeado.
    const lifeA = await h.call('GET', `/api/v1/workspaces/${w.ws}/transactions/${a.id}/lifecycle`, {
      token: w.owner.token,
    });
    const lifeB = await h.call('GET', `/api/v1/workspaces/${restored}/transactions/${b.id}/lifecycle`, {
      token: w.owner.token,
    });
    expect(lifeB.status, JSON.stringify(lifeB.body)).toBe(200);
    const steps = (r: Json) =>
      (r['items'] as { kind: string; transition?: string }[]).map(
        (t) => `${t.kind}:${String(t.transition ?? '')}`,
      );
    expect(steps(lifeB.body)).toEqual(steps(lifeA.body));
    expect(steps(lifeB.body).length).toBeGreaterThanOrEqual(2);
    expect(lifeB.body['path']).toEqual(lifeA.body['path']);
    expect(lifeB.body['historyComplete']).toBe(lifeA.body['historyComplete']);
    // Ningún id del workspace original sobrevive dentro de los JSON restaurados (auditoría, recorridos, snapshots).
    const originalIds = await asAdmin(h, async (c) => {
      const ids = new Set<string>();
      for (const s of PORTABILITY_SECTIONS) {
        if (s.name === 'workspace' || (s.idColumns && s.idColumns.length === 0)) continue;
        const { rows } = await c.query<{ id: string }>(
          `SELECT id::text FROM ${s.table} WHERE workspace_id = $1`,
          [w.ws],
        );
        for (const r of rows) ids.add(r.id);
      }
      // (el id del workspace de origen SÍ queda en la auditoría de la restauración: es su procedencia)
      return ids;
    });
    const jsonTexts = await asAdmin(h, async (c) => {
      const out: string[] = [];
      const labels: string[] = [];
      const queries = [
        `SELECT changes::text AS t FROM audit.audit_log WHERE workspace_id = $1`,
        `SELECT journal_entries::text || detail_refs::text AS t FROM audit.lifecycle_transition WHERE workspace_id = $1`,
        `SELECT flows::text || net_worth::text || checklist::text || coalesce(budget_vs_actual::text, '') AS t FROM planning.close_snapshot WHERE workspace_id = $1`,
        `SELECT code AS t FROM ledger.ledger_account WHERE workspace_id = $1`,
      ];
      for (const q of queries) {
        for (const r of (await c.query<{ t: string }>(q, [restored])).rows) {
          out.push(r.t);
          labels.push(q.slice(0, 60));
        }
      }
      (globalThis as { __labels?: string[] }).__labels = labels;
      return out;
    });
    expect(jsonTexts.length).toBeGreaterThan(20);
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
    const labels = (globalThis as { __labels?: string[] }).__labels ?? [];
    const leaked = jsonTexts.flatMap((t, i) =>
      (t.match(uuid) ?? [])
        .filter((x) => originalIds.has(x))
        .map((x) => `${labels[i]} :: ${t.slice(Math.max(0, t.indexOf(x) - 60), t.indexOf(x) + 50)}`),
    );
    expect(leaked).toEqual([]);
  });

  it('[TC-IDENTITY-EXPORT-012] datos de Phase 2: mes cerrado dos veces, reapertura, template v3, plan, cruce de umbral, aviso y preferencias; sin notificaciones', async () => {
    const b = w1Api(h, copy);
    const periods = await b.get(w.owner, '/periods?limit=100');
    const oct = (periods.body['data'] as Json[]).find((p) => p['label'] === '2026-10')!;
    expect(oct).toMatchObject({ status: 'CLOSED', closeCount: 2, reopenCount: 1 });
    const snaps = await b.get(w.owner, `/periods/${oct['id'] as string}/close-snapshots`);
    expect((snaps.body['items'] as Json[]).map((s) => s['closeNo'])).toEqual([1, 2]);
    const reopen = await asAdmin(
      h,
      async (c) =>
        (await c.query(`SELECT reason FROM planning.period_reopening WHERE workspace_id = $1`, [restored]))
          .rows,
    );
    expect(reopen).toEqual([{ reason: 'Faltó la comisión' }]);
    const tpl = await b.get(w.owner, '/templates');
    expect((tpl.body['data'] as Json[])[0]).toMatchObject({ name: 'Mensual', currentVersionNo: 3 });
    const nov = (periods.body['data'] as Json[]).find((p) => p['label'] === '2026-11')!;
    const plan = await b.get(w.owner, `/periods/${nov['id'] as string}/budget`);
    expect(plan.body['templateVersion']).toMatchObject({ name: 'Mensual' });
    const crossings = await asAdmin(h, async (c) => {
      const q = async (ws: string) =>
        (
          await c.query(
            `SELECT threshold::text FROM planning.budget_threshold_crossing WHERE workspace_id = $1 ORDER BY threshold`,
            [ws],
          )
        ).rows;
      return { source: await q(w.ws), copy: await q(restored) };
    });
    expect(crossings.copy).toEqual(crossings.source);
    expect(crossings.copy.map((r: Json) => r['threshold'])).toContain('90.00');
    expect((await asAdmin(h, async (c) => rowCounts(c, restored)))['planning.close_pending_notice']).toBe(1);
    const prefs = await b.get(w.owner, '/notification-preferences');
    expect((prefs.body['types'] as Json[]).find((t) => t['type'] === 'BUDGET_THRESHOLD')).toMatchObject({
      email: false,
    });
    const counts = await asAdmin(h, async (c) => rowCounts(c, restored));
    expect(counts['notifications.notification']).toBe(0);
    expect(counts['notifications.notification_delivery']).toBe(0);
    // El verificador de cierres valida el hash recalculado de los snapshots restaurados (sin HASH_MISMATCH).
    const pool = new Pool({ connectionString: deps.databaseUrl, max: 4 });
    try {
      const audit = createAuditRuntime({
        pool,
        clock: h.clock,
        policies: AUDIT_POLICIES,
        timeZones: identityWorkspaceTimeZones(pool),
        machines: LIFECYCLE_MACHINES,
      });
      const r = financeRuntimes({
        pool,
        clock: h.clock,
        audit: audit.port,
        lifecycle: audit.lifecycle,
        lifecycleQuery: audit.lifecycleQuery,
        history: audit.history,
        logger: capturingLogger('finance-api', 'api').logger,
        config: apiConfig(baseEnv(deps)),
      });
      expect(await r.planning.verifier!.verify(restored)).toEqual([]);
      expect(await r.planning.verifier!.verify(w.ws)).toEqual([]);
    } finally {
      await pool.end();
    }
    // El mes cerrado sigue cerrado: un gasto de octubre se rechaza; uno de noviembre se acepta sin re-emitir el umbral 90 %.
    const rejected = await b.post(w.owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-10-15',
      accountId: await accountIdByName(restored, 'Bank A'),
      amount: money('30.00'),
    });
    expect([rejected.status, rejected.body['code']]).toEqual([409, 'PERIOD_CLOSED']);
    const novRestaurants = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM classification.category WHERE workspace_id = $1 AND name = 'Restaurantes'`,
            [restored],
          )
        ).rows[0]!.id,
    );
    const accepted = await b.post(w.owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-11-20',
      accountId: await accountIdByName(restored, 'Bank A'),
      amount: money('10.00'),
      splits: [{ amount: money('10.00'), categoryId: novRestaurants }],
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    await until(async () => {
      const done = await asAdmin(
        h,
        async (c) =>
          (
            await c.query(
              `SELECT 1 FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 AND published_at IS NOT NULL LIMIT 1`,
              [restored, accepted.body['id']],
            )
          ).rows,
      );
      return done.length > 0 ? true : undefined;
    });
    await new Promise((r) => setTimeout(r, 1500));
    const events = await asAdmin(
      h,
      async (c) =>
        (
          await c.query(
            `SELECT 1 FROM platform.outbox WHERE workspace_id = $1 AND event_type = 'planning.BudgetThresholdReached'`,
            [restored],
          )
        ).rows,
    );
    expect(events).toHaveLength(0);
  }, 120_000);

  async function accountIdByName(ws: string, name: string): Promise<string> {
    return asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM accounts.account WHERE workspace_id = $1 AND name = $2`,
            [ws, name],
          )
        ).rows[0]!.id,
    );
  }

  it('[TC-IDENTITY-RESTORE-002] importar dos veces el mismo export crea dos workspaces independientes (nunca fusiona ni reutiliza ids)', async () => {
    const second = await importAndWait(h, w.owner, originalZip);
    expect(second['status']).toBe('SUCCEEDED');
    expect(second['workspaceId']).not.toBe(restored);
    const ids = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ n: string }>(
            `SELECT count(DISTINCT id)::text AS n FROM txn.transaction WHERE workspace_id = ANY($1)`,
            [[w.ws, restored, second['workspaceId']]],
          )
        ).rows[0]!.n,
    );
    expect(Number(ids)).toBe(13);
  }, 120_000);
});

async function countOperations(c: Client, ws: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM platform.operation WHERE workspace_id = $1`,
    [ws],
  );
  return Number(rows[0]!.n);
}

/** Conteo de filas por tabla del catálogo de purga para un workspace (sin tablas de infraestructura de eventos). */
async function rowCounts(c: Client, ws: string): Promise<Record<string, number>> {
  const { rows: tables } = await c.query<{ t: string }>(
    `SELECT schema_name || '.' || table_name AS t FROM platform.workspace_scoped_table WHERE purge_action = 'DELETE' ORDER BY 1`,
  );
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    if (['platform.idempotency_key', 'platform.outbox', 'platform.inbox', 'platform.dead_letter'].includes(t))
      continue;
    const [schema, table] = t.split('.') as [string, string];
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${schema}"."${table}" WHERE workspace_id = $1`,
      [ws],
    );
    out[t] = Number(rows[0]!.n);
  }
  return out;
}
