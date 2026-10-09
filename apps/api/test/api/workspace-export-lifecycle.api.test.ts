import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { EXPORT_RETENTION_QUEUE } from '@pf/identity/contracts';
import { ZipReader } from '@pf/identity/interface/identity.module';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  asAdmin,
  buildMini,
  contract,
  downloadExport,
  exportAndWait,
  money,
  s3Client,
  startHarness,
  until,
  w1Api,
  type Harness,
  type Json,
  type Mini,
} from '../support/portability.js';

// Ciclo de vida del export (openspec add-workspace-export; identity/workspace-portability): una exportación en curso por
// workspace, instantánea consistente con escrituras concurrentes, retención y eliminación anticipada, auditoría en orden,
// llavero de claves maestras y aislamiento entre workspaces. Relojes reales en API y worker (el orden de la auditoría
// entre procesos se prueba con el mismo reloj que producción).
const deps = inject('deps');
let h: Harness;
/** Compuerta de la pausa tras la instantánea (TC-IDENTITY-EXPORT-004): el worker espera aquí hasta que el test la abre. */
let gate: Promise<void> | undefined;
let entered: (() => void) | undefined;

beforeAll(async () => {
  h = await startHarness({
    realClock: true,
    worker: {
      portability: {
        scheduleCrons: false,
        afterSnapshot: async () => {
          entered?.();
          await gate;
        },
      },
    },
  });
}, 240_000);

afterAll(async () => {
  await h?.close();
});

const objects = async (ws: string): Promise<string[]> =>
  (
    (
      await s3Client(deps).send(
        new ListObjectsV2Command({ Bucket: deps.exportsBucket, Prefix: `exports/${ws}/` }),
      )
    ).Contents ?? []
  ).map((o) => o.Key as string);

/** Pausa el próximo export justo después de tomar la instantánea; devuelve cómo reanudarlo. */
function pauseNextExport(): { snapshotTaken: Promise<void>; release: () => void } {
  let release!: () => void;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const snapshotTaken = new Promise<void>((resolve) => {
    entered = resolve;
  });
  return { snapshotTaken, release };
}

const requestExport = (m: Mini, key: string = randomUUID()) =>
  h.call('POST', `/api/v1/workspaces/${m.ws}/exports`, {
    token: m.owner.token,
    headers: { 'idempotency-key': key },
  });

describe('Una exportación en curso y la instantánea consistente', () => {
  it('[TC-IDENTITY-EXPORT-001][TC-IDENTITY-EXPORT-004] una segunda exportación en curso ⇒ 409 EXPORT_IN_PROGRESS; las escrituras concurrentes no entran en el archivo', async () => {
    const m = await buildMini(h, 'snap');
    const api = w1Api(h, m);
    const pause = pauseNextExport();
    const first = await requestExport(m);
    expect(first.status, JSON.stringify(first.body)).toBe(202);
    await pause.snapshotTaken;
    // Con el export en curso: otra solicitud (otra clave) ⇒ 409; la misma clave ⇒ la misma operación.
    const second = await requestExport(m);
    expect([second.status, second.body['code']]).toEqual([409, 'EXPORT_IN_PROGRESS']);
    expect(
      contract.validateResponse('requestWorkspaceExport', 409, second.body, 'application/problem+json'),
    ).toEqual([]);
    const running = await h.call(
      'GET',
      `/api/v1/workspaces/${m.ws}/operations/${first.body['operationId'] as string}`,
      {
        token: m.owner.token,
      },
    );
    expect(running.body['status']).toBe('RUNNING');
    // Descargar un export en curso ⇒ 409 EXPORT_NOT_READY.
    const early = await downloadExport(h, m.owner, m.ws, first.body['id'] as string);
    expect([early.status, early.body['code']]).toEqual([409, 'EXPORT_NOT_READY']);
    // Se registra un gasto de 20.00 BOB DESPUÉS de la instantánea y se reanuda el export.
    const spent = await api.post(m.owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-10-05',
      accountId: m.bank,
      amount: money('20.00'),
      description: 'Gasto concurrente',
    });
    expect(spent.status, JSON.stringify(spent.body)).toBe(201);
    pause.release();
    const done = await until(async () => {
      const r = await h.call('GET', `/api/v1/workspaces/${m.ws}/exports/${first.body['id'] as string}`, {
        token: m.owner.token,
      });
      return r.body['status'] === 'READY' || r.body['status'] === 'FAILED' ? r.body : undefined;
    });
    expect(done['status']).toBe('READY');
    const zip = ZipReader.open((await downloadExport(h, m.owner, m.ws, done['id'] as string)).raw);
    const manifest = JSON.parse(zip.read('manifest.json').toString('utf8')) as {
      verification: { accountBalances: { accountId: string; balance: string }[] };
    };
    expect(zip.read('json/transactions.jsonl').toString('utf8')).not.toContain('Gasto concurrente');
    expect(manifest.verification.accountBalances.find((a) => a.accountId === m.bank)?.balance).toBe(
      '3099.10',
    );
    expect(zip.read('json/transactions.jsonl').toString('utf8').trim()).toBe('');
    // El gasto sí existe en la base: solo quedó fuera de la instantánea.
    const live = await api.get(m.owner, '/transactions?limit=10');
    expect(JSON.stringify(live.body)).toContain('Gasto concurrente');
    // Ya terminado, una nueva exportación vuelve a ser posible.
    expect((await requestExport(m)).status).toBe(202);
    gate = undefined;
  }, 120_000);
});

describe('Retención, eliminación anticipada y auditoría del ciclo', () => {
  it('[TC-IDENTITY-EXPORT-007][TC-IDENTITY-EXPORT-009] solicitar, terminar, descargar dos veces y expirar deja 5 registros de auditoría en orden; el objeto se elimina y la descarga da 410', async () => {
    gate = undefined;
    const m = await buildMini(h, 'ret');
    const e = await exportAndWait(h, m.owner, m.ws);
    const id = e['id'] as string;
    expect(await objects(m.ws)).toHaveLength(1);
    expect((await downloadExport(h, m.owner, m.ws, id)).status).toBe(200);
    expect((await downloadExport(h, m.owner, m.ws, id)).status).toBe(200);
    // Vence: el job de retención (cola real del worker) elimina el objeto y marca EXPIRED.
    const before = await asAdmin(
      h,
      async (c) =>
        (
          await c.query(
            `SELECT size_bytes::text, encode(sha256, 'hex') AS sha FROM iam.workspace_export WHERE id = $1`,
            [id],
          )
        ).rows[0],
    );
    await asAdmin(h, async (c) =>
      c.query(`UPDATE iam.workspace_export SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]),
    );
    // Aún antes del job, un export vencido no se descarga.
    const stale = await downloadExport(h, m.owner, m.ws, id);
    expect([stale.status, stale.body['code']]).toEqual([410, 'EXPORT_EXPIRED']);
    await h.worker!.queue.send(EXPORT_RETENTION_QUEUE, {});
    await until(async () => ((await objects(m.ws)).length === 0 ? true : undefined));
    const after = await h.call('GET', `/api/v1/workspaces/${m.ws}/exports/${id}`, { token: m.owner.token });
    expect(after.body).toMatchObject({ status: 'EXPIRED', errorCode: null });
    expect(after.body['expiredAt']).toEqual(expect.any(String));
    expect([String(after.body['sizeBytes']), after.body['sha256']]).toEqual([
      before?.['size_bytes'],
      before?.['sha'],
    ]);
    const gone = await downloadExport(h, m.owner, m.ws, id);
    expect([gone.status, gone.body['code']]).toEqual([410, 'EXPORT_EXPIRED']);
    expect(
      contract.validateResponse('downloadWorkspaceExport', 410, gone.body, 'application/problem+json'),
    ).toEqual([]);
    // Auditoría: cinco registros en orden, cada uno con su actor o proceso y sin contenido exportado.
    const audit = await h.call(
      'GET',
      `/api/v1/workspaces/${m.ws}/audit-log?aggregateType=WorkspaceExport&aggregateId=${id}&limit=50`,
      { token: m.owner.token },
    );
    const entries = audit.body['data'] as Json[];
    expect(entries.map((x) => x['action'])).toEqual([
      'identity.export.requested',
      'identity.export.completed',
      'identity.export.downloaded',
      'identity.export.downloaded',
      'identity.export.expired',
    ]);
    expect(entries.map((x) => (x['actor'] as Json)['type'])).toEqual([
      'USER',
      'SYSTEM',
      'USER',
      'USER',
      'SYSTEM',
    ]);
    expect((entries[4]!['actor'] as Json)['process']).toBe('identity.export-retention');
    expect(entries.every((x) => x['category'] === 'SECURITY')).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/Bank A|3099/u);
  }, 120_000);

  it('[TC-IDENTITY-EXPORT-008] el OWNER elimina un export terminado: objeto borrado, registro conservado, descarga 410, idempotente y auditado; un EDITOR no puede', async () => {
    const m = await buildMini(h, 'disc');
    const e = await exportAndWait(h, m.owner, m.ws);
    const id = e['id'] as string;
    const base = `/api/v1/workspaces/${m.ws}/exports/${id}/discard`;
    const editor = await h.call('POST', base, {
      token: m.editor.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect([editor.status, editor.body['code']]).toEqual([403, 'INSUFFICIENT_ROLE']);
    const done = await h.call('POST', base, {
      token: m.owner.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(contract.validateResponse('discardWorkspaceExport', 200, done.body)).toEqual([]);
    expect(done.body).toMatchObject({ status: 'DISCARDED', sha256: e['sha256'], sizeBytes: e['sizeBytes'] });
    expect(await objects(m.ws)).toHaveLength(0);
    const again = await h.call('POST', base, {
      token: m.owner.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect([again.status, again.body['status']]).toEqual([200, 'DISCARDED']);
    const gone = await downloadExport(h, m.owner, m.ws, id);
    expect([gone.status, gone.body['code']]).toEqual([410, 'EXPORT_EXPIRED']);
    const audit = await h.call(
      'GET',
      `/api/v1/workspaces/${m.ws}/audit-log?aggregateType=WorkspaceExport&aggregateId=${id}`,
      {
        token: m.owner.token,
      },
    );
    const actions = (audit.body['data'] as Json[]).map((x) => x['action']);
    expect(actions.filter((a) => a === 'identity.export.discarded')).toHaveLength(1);
  }, 120_000);
});

describe('Seguridad del archivo cifrado y aislamiento', () => {
  it('[TC-IDENTITY-EXPORT-005] otra clave maestra no descifra el archivo (422 EXPORT_FILE_CORRUPTED); la rotación conserva el acceso con la clave anterior en el llavero', async () => {
    const m = await buildMini(h, 'keys');
    const e = await exportAndWait(h, m.owner, m.ws);
    const id = e['id'] as string;
    const other = `k9:${Buffer.alloc(32, 7).toString('base64url')}`;
    // Mismo almacenamiento y base, pero un llavero con OTRA clave `k1`: la clave de datos no se desenvuelve.
    const wrong = await startHarness({
      realClock: true,
      apiEnv: { EXPORT_ENCRYPTION_KEYS: other.replace('k9:', 'k1:'), EXPORT_ENCRYPTION_ACTIVE_KEY_ID: 'k1' },
    });
    try {
      const u = await wrong.user(m.owner.sub);
      const r = await wrong.call('GET', `/api/v1/workspaces/${m.ws}/exports/${id}/download`, {
        token: u.token,
      });
      expect([r.status, r.body['code']]).toEqual([422, 'EXPORT_FILE_CORRUPTED']);
      expect(r.raw.subarray(0, 2).toString('ascii')).not.toBe('PK');
      // Una clave k1 inexistente en el llavero (retirada) tampoco descifra.
      expect(r.raw.toString('utf8')).not.toContain('Bank A');
    } finally {
      await wrong.close();
    }
    // Rotación: la clave vigente cambia a k2 pero k1 sigue en el llavero ⇒ el export envuelto con k1 sigue descargándose.
    const rotated = await startHarness({
      realClock: true,
      apiEnv: {
        EXPORT_ENCRYPTION_KEYS: `k2:${Buffer.alloc(32, 9).toString('base64url')},${deps.exportKeys}`,
        EXPORT_ENCRYPTION_ACTIVE_KEY_ID: 'k2',
      },
    });
    try {
      const u = await rotated.user(m.owner.sub);
      const ok = await rotated.call('GET', `/api/v1/workspaces/${m.ws}/exports/${id}/download`, {
        token: u.token,
      });
      expect(ok.status).toBe(200);
      expect(ok.raw.subarray(0, 2).toString('ascii')).toBe('PK');
    } finally {
      await rotated.close();
    }
  }, 180_000);

  it('[TC-IDENTITY-EXPORT-006] la descarga exige el mismo workspace y usuario: otro workspace del OWNER no ve el export (404) y un tercero no entra (403)', async () => {
    const a = await buildMini(h, 'iso-a');
    const b = await buildMini(h, 'iso-b');
    const e = await exportAndWait(h, a.owner, a.ws);
    const id = e['id'] as string;
    // El OWNER de "B" intenta descargar el export de "A" por la ruta de "B": no existe en ese workspace.
    const viaB = await h.call('GET', `/api/v1/workspaces/${b.ws}/exports/${id}/download`, {
      token: b.owner.token,
    });
    expect([viaB.status, viaB.body['code']]).toEqual([404, 'RESOURCE_NOT_FOUND']);
    const viaBlist = await h.call('GET', `/api/v1/workspaces/${b.ws}/exports`, { token: b.owner.token });
    expect(JSON.stringify(viaBlist.body)).not.toContain(id);
    // Y por la ruta de "A", el OWNER de "B" no es miembro.
    const outsider = await downloadExport(h, b.owner, a.ws, id);
    expect([outsider.status, outsider.body['code']]).toEqual([403, 'WORKSPACE_ACCESS_DENIED']);
    // La operación de "A" tampoco es visible desde "B".
    const op = await h.call('GET', `/api/v1/workspaces/${b.ws}/operations/${e['operationId'] as string}`, {
      token: b.owner.token,
    });
    expect(op.status).toBe(404);
  }, 120_000);

  it('el export de un workspace con la exportación deshabilitada responde 503 (sin llavero de claves maestras)', async () => {
    const off = await startHarness({
      realClock: true,
      apiEnv: { EXPORT_ENCRYPTION_KEYS: '', EXPORT_ENCRYPTION_ACTIVE_KEY_ID: '' },
    });
    try {
      const m = await buildMini(off, 'off');
      const r = await off.call('POST', `/api/v1/workspaces/${m.ws}/exports`, {
        token: m.owner.token,
        headers: { 'idempotency-key': randomUUID() },
      });
      expect([r.status, r.body['code']]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    } finally {
      await off.close();
    }
  }, 120_000);
});
