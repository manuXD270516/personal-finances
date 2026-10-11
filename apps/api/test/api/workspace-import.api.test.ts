import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { ZipReader, ZipWriter } from '@pf/identity/interface/identity.module';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  asAdmin,
  buildMini,
  contract,
  downloadExport,
  exportAndWait,
  importAndWait,
  importZip,
  money,
  s3Client,
  startHarness,
  until,
  w1Api,
  type Harness,
  type Json,
  type Mini,
  type User,
} from '../support/portability.js';

// Importación (openspec add-workspace-export; FR-IDENTITY-017): validación previa sin escribir, rechazo de archivos
// alterados / de versión futura / de workspaces demo / demasiado grandes, verificación atómica contra el manifiesto, y
// seguridad: nunca escribe en un workspace existente ni preserva identificadores.
const deps = inject('deps');
let h: Harness;
let m: Mini;
let zip: Buffer;
let subscriptionId: string;
let loanId: string;
let cardId: string;
let cardPurchaseId: string;
let cardAccountIds: string[];

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Reconstruye el ZIP aplicando `mutate` sobre sus archivos; con `consistent` recalcula las sumas del manifiesto. */
function rebuild(
  source: Buffer,
  mutate: (files: Map<string, Buffer>, manifest: Json) => void,
  options: { consistent?: boolean } = {},
): Buffer {
  const reader = ZipReader.open(source);
  const files = new Map<string, Buffer>(reader.names().map((n) => [n, reader.read(n)]));
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Json;
  mutate(files, manifest);
  if (options.consistent) {
    for (const list of [manifest['sections'], manifest['csv']] as {
      file: string;
      count: number;
      sha256: string;
    }[][]) {
      for (const entry of list) {
        const body = files.get(entry.file);
        if (!body) continue;
        entry.sha256 = sha256(body);
        entry.count = body.toString('utf8').split('\n').filter(Boolean).length;
      }
    }
  }
  if (files.has('manifest.json'))
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  const w = new ZipWriter(new Date('2026-10-09T12:00:00Z'));
  for (const [name, body] of files) w.add(name, body);
  return w.finish();
}

/** Workspace hogar del usuario (el más antiguo): allí se audita lo que no pertenece a ningún workspace. */
const homeOf = async (u: User): Promise<string> =>
  (
    (await h.call('GET', '/api/v1/me', { token: u.token })).body['memberships'] as { workspaceId: string }[]
  )[0]!.workspaceId;
const lines = (b: Buffer) => b.toString('utf8').split('\n').filter(Boolean);
const workspacesOf = async (u: User): Promise<string[]> =>
  (
    (await h.call('GET', '/api/v1/workspaces?limit=200', { token: u.token })).body['data'] as { id: string }[]
  ).map((w) => w.id);
const importRows = async (u: User): Promise<number> =>
  asAdmin(h, async (c) =>
    Number(
      (
        await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM iam.workspace_import WHERE requested_by = $1`,
          [u.id],
        )
      ).rows[0]!.n,
    ),
  );
const importObjects = async (u: User): Promise<string[]> =>
  (
    (
      await s3Client(deps).send(
        new ListObjectsV2Command({ Bucket: deps.exportsBucket, Prefix: `imports/${u.id}/` }),
      )
    ).Contents ?? []
  ).map((o) => o.Key as string);

beforeAll(async () => {
  // Sin worker al inicio: los rechazos síncronos y la importación en curso no lo necesitan.
  h = await startHarness({ realClock: true, worker: false });
  m = await buildMini(h, 'imp');
  const api = w1Api(h, m);
  const spent = await api.post(m.owner, '/transactions', {
    kind: 'EXPENSE',
    transactionDate: '2026-10-05',
    accountId: m.bank,
    amount: money('45.90'),
    description: 'Almuerzo',
  });
  expect(spent.status, JSON.stringify(spent.body)).toBe(201);
  // Una suscripción con dos precios (openspec add-subscriptions): su definición administrada, el historial y la
  // referencia `managed_ref` viajan en el export y se remapean al importar.
  const provider = (await api.post(m.owner, '/counterparties', { name: 'Streamly (export)' })).body[
    'id'
  ] as string;
  const subscribed = await api.post(m.owner, '/subscriptions', {
    counterpartyId: provider,
    name: 'Streamly',
    planName: 'Premium',
    price: money('59.90'),
    billingCycle: { cadence: 'MONTHLY' },
    firstRenewalOn: '2027-01-15',
    paymentAccountId: m.bank,
    materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
  });
  expect(subscribed.status, JSON.stringify(subscribed.body)).toBe(201);
  subscriptionId = subscribed.body['id'] as string;
  const repriced = await h.call('POST', `${api.base}/subscriptions/${subscriptionId}/prices`, {
    token: m.owner.token,
    body: { price: money('69.90'), effectiveFrom: '2027-06-15' },
    headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(subscribed.body['version'])}"` },
  });
  expect(repriced.status, JSON.stringify(repriced.body)).toBe(201);
  // Un préstamo desembolsado con un pago (openspec add-loans): cronograma, imputaciones y la definición de cuotas
  // administrada viajan en el export y se remapean al importar.
  const loan = await api.post(m.owner, '/loans', {
    name: 'Préstamo (export)',
    account: { create: { name: 'Préstamo respaldo' } },
    disbursementAccountId: m.bank,
    principal: money('1000.00'),
    annualRate: '0.12',
    termInstallments: 3,
    disbursementDate: '2026-10-01',
    firstDueDate: '2026-11-01',
    disburseNow: true,
  });
  expect(loan.status, JSON.stringify(loan.body)).toBe(201);
  loanId = loan.body['id'] as string;
  const installmentPaid = await api.post(m.owner, `/loans/${loanId}/payments`, {
    amount: money('340.02'),
    businessDate: '2026-10-05',
    accountId: m.bank,
  });
  expect(installmentPaid.status, JSON.stringify(installmentPaid.body)).toBe(201);
  // Una tarjeta bimoneda con plan de pago y una compra en cuotas (openspec add-credit-cards, tarea 4.4): sus nueve
  // tablas viajan en el export y las cuentas, la definición del plan y la compra se remapean al importar.
  const usd = (amount: string) => money(amount, 'USD');
  const visaBob = (
    await api.post(m.owner, '/accounts', {
      name: 'Visa Oro BOB (export)',
      type: 'CREDIT_CARD',
      currency: 'BOB',
      openingBalance: { amount: money('500.00'), date: '2026-10-01' },
    })
  ).body['id'] as string;
  const visaUsd = (
    await api.post(m.owner, '/accounts', {
      name: 'Visa Oro USD (export)',
      type: 'CREDIT_CARD',
      currency: 'USD',
      openingBalance: { amount: usd('100.00'), date: '2026-10-01' },
    })
  ).body['id'] as string;
  cardAccountIds = [visaBob, visaUsd];
  // "Hoy" en la zona del workspace (el reloj es real): en UTC puede ser ya el día siguiente.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const laptop = await api.post(m.owner, '/transactions', {
    kind: 'EXPENSE',
    transactionDate: today,
    accountId: visaBob,
    amount: money('900.00'),
    description: 'Laptop (export)',
  });
  expect(laptop.status, JSON.stringify(laptop.body)).toBe(201);
  cardPurchaseId = laptop.body['id'] as string;
  const card = await api.post(m.owner, '/credit-cards', {
    name: 'Visa Oro (export)',
    statementDay: 25,
    dueDay: 15,
    accounts: [
      {
        accountId: visaBob,
        creditLimit: money('10000.00'),
        minimumRule: { type: 'PERCENT', percent: '5.00', floor: money('50.00') },
        paymentPlan: { sourceAccountId: m.bank },
      },
      {
        accountId: visaUsd,
        creditLimit: usd('2000.00'),
        minimumRule: { type: 'FIXED', amount: usd('25.00') },
      },
    ],
  });
  expect(card.status, JSON.stringify(card.body)).toBe(201);
  cardId = card.body['id'] as string;
  const installments = await api.post(m.owner, `/credit-cards/${cardId}/installment-plans`, {
    purchaseTransactionId: cardPurchaseId,
    installmentCount: 3,
  });
  expect(installments.status, JSON.stringify(installments.body)).toBe(201);
  await h.startWorker();
  const exported = await exportAndWait(h, m.owner, m.ws);
  zip = (await downloadExport(h, m.owner, m.ws, exported['id'] as string)).raw;
  await h.stopWorker();
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Validación previa del archivo (sin worker: no se crea nada)', () => {
  it('[TC-IDENTITY-RESTORE-004] un monto cambiado a mano (45.90 → 4.59) ⇒ 422 EXPORT_FILE_CORRUPTED y no se crea ningún workspace', async () => {
    const before = {
      workspaces: await workspacesOf(m.owner),
      imports: await importRows(m.owner),
      objects: await importObjects(m.owner),
    };
    const tampered = rebuild(zip, (files) => {
      const key = 'json/transactions.jsonl';
      files.set(
        key,
        Buffer.from(files.get(key)!.toString('utf8').replace('"amount":"45.90"', '"amount":"4.59"'), 'utf8'),
      );
    });
    const r = await importZip(h, m.owner, tampered);
    expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([422, 'EXPORT_FILE_CORRUPTED']);
    expect(
      contract.validateResponse('requestWorkspaceImport', 422, r.body, 'application/problem+json'),
    ).toEqual([]);
    expect(await workspacesOf(m.owner)).toEqual(before.workspaces);
    expect(await importRows(m.owner)).toBe(before.imports);
    expect(await importObjects(m.owner)).toEqual(before.objects);
  });

  it('[TC-IDENTITY-RESTORE-004] sin manifiesto ⇒ EXPORT_FILE_CORRUPTED; versión 99 ⇒ EXPORT_FORMAT_UNSUPPORTED; no es un ZIP, archivo extra o sección desconocida', async () => {
    const before = await workspacesOf(m.owner);
    const noManifest = rebuild(zip, (files) => files.delete('manifest.json'));
    const r1 = await importZip(h, m.owner, noManifest);
    expect([r1.status, r1.body['code']]).toEqual([422, 'EXPORT_FILE_CORRUPTED']);
    const future = rebuild(zip, (_files, manifest) => {
      manifest['formatVersion'] = 99;
    });
    const r2 = await importZip(h, m.owner, future);
    expect([r2.status, r2.body['code']]).toEqual([422, 'EXPORT_FORMAT_UNSUPPORTED']);
    const r3 = await importZip(h, m.owner, Buffer.from('esto no es un zip'));
    expect([r3.status, r3.body['code']]).toEqual([422, 'EXPORT_FILE_CORRUPTED']);
    const extra = rebuild(zip, (files) => files.set('json/evil.jsonl', Buffer.from('{"x":1}\n')));
    const r4 = await importZip(h, m.owner, extra);
    expect([r4.status, r4.body['code']]).toEqual([422, 'EXPORT_FILE_CORRUPTED']);
    const unknown = rebuild(
      zip,
      (files, manifest) => {
        files.set('json/secret-stuff.jsonl', Buffer.from('{"x":1}\n'));
        (manifest['sections'] as Json[]).push({
          name: 'secret-stuff',
          file: 'json/secret-stuff.jsonl',
          schema: 'https://x/y',
          count: 1,
          sha256: '0'.repeat(64),
        });
      },
      { consistent: true },
    );
    const r5 = await importZip(h, m.owner, unknown);
    expect([r5.status, r5.body['code']]).toEqual([422, 'EXPORT_FORMAT_UNSUPPORTED']);
    expect(await workspacesOf(m.owner)).toEqual(before);
  });

  it('[TC-IDENTITY-RESTORE-006] el export de un workspace de demostración se rechaza, no crea nada y la solicitud queda auditada sin contenido', async () => {
    const before = await workspacesOf(m.owner);
    const demo = rebuild(zip, (_files, manifest) => {
      manifest['isDemo'] = true;
      manifest['workspaceName'] = 'Demo secreto';
    });
    const r = await importZip(h, m.owner, demo);
    expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([422, 'EXPORT_FORMAT_UNSUPPORTED']);
    expect(await workspacesOf(m.owner)).toEqual(before);
    const audit = await h.call(
      'GET',
      `/api/v1/workspaces/${await homeOf(m.owner)}/audit-log?aggregateType=WorkspaceImport&limit=20`,
      {
        token: m.owner.token,
      },
    );
    const rejected = (audit.body['data'] as Json[]).filter((e) => e['action'] === 'identity.import.rejected');
    expect(rejected.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected)).not.toContain('Demo secreto');
    expect(JSON.stringify(rejected)).toContain('EXPORT_FORMAT_UNSUPPORTED');
  });

  it('[TC-IDENTITY-RESTORE-007] un archivo de 210 MB ⇒ 413 UPLOAD_TOO_LARGE sin crear ningún workspace ni registro, y sin almacenar el archivo', async () => {
    const before = {
      workspaces: await workspacesOf(m.owner),
      imports: await importRows(m.owner),
      objects: await importObjects(m.owner),
    };
    const big = Buffer.alloc(220_200_960, 1);
    const r = await importZip(h, m.owner, big);
    expect([r.status, r.body['code']]).toEqual([413, 'UPLOAD_TOO_LARGE']);
    expect(
      contract.validateResponse('requestWorkspaceImport', 413, r.body, 'application/problem+json'),
    ).toEqual([]);
    expect(await workspacesOf(m.owner)).toEqual(before.workspaces);
    expect(await importRows(m.owner)).toBe(before.imports);
    expect(await importObjects(m.owner)).toEqual(before.objects);
  }, 120_000);

  it('importar exige autenticación reciente (403 REAUTHENTICATION_REQUIRED), un cuerpo multipart con el campo "file" y no acepta partes extra', async () => {
    const stale = await h.token(m.owner.sub, 3600);
    const old = await h.call('POST', '/api/v1/workspace-imports', {
      token: stale,
      form: (() => {
        const f = new FormData();
        f.append('file', new Blob([new Uint8Array(zip)]), 'x.zip');
        return f;
      })(),
      headers: { 'idempotency-key': randomUUID() },
    });
    expect([old.status, old.body['code']]).toEqual([403, 'REAUTHENTICATION_REQUIRED']);
    const noKey = await h.call('POST', '/api/v1/workspace-imports', { token: m.owner.token });
    expect(noKey.status).toBe(428);
    const wrongField = new FormData();
    wrongField.append('archivo', new Blob([new Uint8Array(zip)]), 'x.zip');
    const r = await h.call('POST', '/api/v1/workspace-imports', {
      token: m.owner.token,
      form: wrongField,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect([r.status, r.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
    expect(await importObjects(m.owner)).toEqual([]);
  });

  it('una segunda importación mientras hay una en curso ⇒ 409 IMPORT_IN_PROGRESS (una por usuario) y el archivo en tránsito queda cifrado', async () => {
    const first = await importZip(h, m.owner, zip);
    expect(first.status, JSON.stringify(first.body)).toBe(202);
    expect(contract.validateResponse('requestWorkspaceImport', 202, first.body)).toEqual([]);
    expect(first.headers.get('location')).toBe(`/api/v1/workspace-imports/${first.body['id'] as string}`);
    expect(first.body).toMatchObject({ status: 'RECEIVED', workspaceId: null });
    const second = await importZip(h, m.owner, zip);
    expect([second.status, second.body['code']]).toEqual([409, 'IMPORT_IN_PROGRESS']);
    const keys = await importObjects(m.owner);
    expect(keys).toHaveLength(1);
    const obj = await s3Client(deps).send(
      new GetObjectCommand({ Bucket: deps.exportsBucket, Key: keys[0]! }),
    );
    const raw = Buffer.from(
      await (obj.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
    );
    expect(raw.subarray(0, 4).toString('ascii')).toBe('PFXE');
    expect(raw.includes(Buffer.from('Almuerzo'))).toBe(false);
    // Otro usuario no ve esta importación.
    const other = await h.user(`kc-ex-imp-other-${randomUUID()}`);
    const peek = await h.call('GET', `/api/v1/workspace-imports/${first.body['id'] as string}`, {
      token: other.token,
    });
    expect([peek.status, peek.body['code']]).toEqual([404, 'RESOURCE_NOT_FOUND']);
    // [MAC inválido] el objeto almacenado se altera antes de que corra el job: la importación termina FAILED sin escribir nada.
    const bad = Buffer.from(raw);
    bad[Math.floor(bad.length / 2)] = (bad[Math.floor(bad.length / 2)] as number) ^ 0x01;
    await s3Client(deps).send(new PutObjectCommand({ Bucket: deps.exportsBucket, Key: keys[0]!, Body: bad }));
    const workspacesBefore = await workspacesOf(m.owner);
    await h.startWorker({}, { discardBacklog: false });
    const done = await until(async () => {
      const r = await h.call('GET', `/api/v1/workspace-imports/${first.body['id'] as string}`, {
        token: m.owner.token,
      });
      return r.body['status'] === 'FAILED' || r.body['status'] === 'SUCCEEDED' ? r.body : undefined;
    });
    expect(done).toMatchObject({ status: 'FAILED', errorCode: 'EXPORT_FILE_CORRUPTED', workspaceId: null });
    expect(await workspacesOf(m.owner)).toEqual(workspacesBefore);
    expect(await importObjects(m.owner)).toEqual([]);
  }, 120_000);
});

describe('Importación con worker', () => {
  it('[TC-IDENTITY-RESTORE-003] una verificación fallida no deja ningún workspace ni fila: un posting omitido (asiento sin balance) y un saldo del manifiesto distinto', async () => {
    const workspacesBefore = await workspacesOf(m.owner);
    // (a) posting omitido: el archivo es coherente consigo mismo (sumas recalculadas) pero el asiento queda desbalanceado.
    const noPosting = rebuild(
      zip,
      (files) => {
        const rows = lines(files.get('json/postings.jsonl')!);
        files.set('json/postings.jsonl', Buffer.from(`${rows.slice(0, -1).join('\n')}\n`, 'utf8'));
      },
      { consistent: true },
    );
    const a = await importAndWait(h, m.owner, noPosting);
    expect(a, JSON.stringify(a)).toMatchObject({
      status: 'FAILED',
      errorCode: 'EXPORT_VERIFICATION_FAILED',
      workspaceId: null,
    });
    // (b) saldo del manifiesto alterado: los registros son válidos pero no reproducen lo declarado.
    const wrongBalance = rebuild(zip, (_files, manifest) => {
      const bal = (manifest['verification'] as { accountBalances: { balance: string }[] })
        .accountBalances[0]!;
      bal.balance = '3099.11';
    });
    const b = await importAndWait(h, m.owner, wrongBalance);
    expect(b, JSON.stringify(b)).toMatchObject({
      status: 'FAILED',
      errorCode: 'EXPORT_VERIFICATION_FAILED',
      workspaceId: null,
    });
    expect(await workspacesOf(m.owner)).toEqual(workspacesBefore);
    const leftovers = await asAdmin(
      h,
      async (c) =>
        (
          await c.query(
            `SELECT w.id FROM iam.workspace w WHERE w.name LIKE 'Mini imp (restaurado)%' AND w.id NOT IN (SELECT workspace_id FROM iam.workspace_membership WHERE user_id = $1 AND false)`,
            [m.owner.id],
          )
        ).rows,
    );
    expect(leftovers).toEqual([]);
    const audit = await h.call(
      'GET',
      `/api/v1/workspaces/${await homeOf(m.owner)}/audit-log?aggregateType=WorkspaceImport&limit=50`,
      {
        token: m.owner.token,
      },
    );
    expect(
      (audit.body['data'] as Json[]).filter((e) => e['action'] === 'identity.import.failed').length,
    ).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it('un registro que no valida contra su esquema (campo extra) se rechaza antes de escribir (EXPORT_FILE_CORRUPTED en el job)', async () => {
    const extraField = rebuild(
      zip,
      (files) => {
        const rows = lines(files.get('json/accounts.jsonl')!).map((l) => ({
          ...JSON.parse(l),
          injected: 'x',
        }));
        files.set(
          'json/accounts.jsonl',
          Buffer.from(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8'),
        );
      },
      { consistent: true },
    );
    const r = await importAndWait(h, m.owner, extraField);
    expect(r).toMatchObject({ status: 'FAILED', errorCode: 'EXPORT_FILE_CORRUPTED', workspaceId: null });
  }, 120_000);

  it('[TC-IDENTITY-RESTORE-001] seguridad: aunque el archivo diga que sus filas pertenecen a OTRO workspace existente y repita sus ids, solo se escribe en el workspace nuevo con ids nuevos', async () => {
    const victim = await buildMini(h, 'victim');
    const vApi = w1Api(h, victim);
    const vTx = (
      await vApi.post(victim.owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-06',
        accountId: victim.bank,
        amount: money('10.00'),
        description: 'Dato de la víctima',
      })
    ).body['id'] as string;
    const snapshotOf = async (ws: string) =>
      asAdmin(h, async (c) => {
        const out: Record<string, unknown[]> = {};
        for (const t of [
          'txn.transaction',
          'accounts.account',
          'ledger.journal_entry',
          'ledger.posting',
          'audit.audit_log',
        ]) {
          // Planning provisiona periodos de la víctima en segundo plano (consumidor de asientos, D62/D64) y los
          // audita: esas filas dependen de cuándo corre el worker, no de la importación.
          const own = t === 'audit.audit_log' ? ` AND action NOT LIKE 'planning.%'` : '';
          out[t] = (
            await c.query(`SELECT to_jsonb(x) AS r FROM ${t} x WHERE workspace_id = $1${own} ORDER BY 1`, [
              ws,
            ])
          ).rows.map((r) => r.r);
        }
        return out;
      });
    const victimBefore = await snapshotOf(victim.ws);
    // El atacante reescribe el archivo: workspace_id de todas las filas = víctima, y la transacción y la cuenta usan los ids de la víctima.
    const ownTx = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM txn.transaction WHERE workspace_id = $1 AND description = 'Almuerzo'`,
            [m.ws],
          )
        ).rows[0]!.id,
    );
    const malicious = rebuild(
      zip,
      (files, manifest) => {
        manifest['workspaceId'] = victim.ws;
        for (const [name, body] of files) {
          if (!name.startsWith('json/')) continue;
          files.set(
            name,
            Buffer.from(
              body
                .toString('utf8')
                .split(m.ws)
                .join(victim.ws)
                .split(ownTx)
                .join(vTx)
                .split(m.bank)
                .join(victim.bank),
              'utf8',
            ),
          );
        }
        const verification = JSON.stringify(manifest['verification']).split(m.bank).join(victim.bank);
        manifest['verification'] = JSON.parse(verification);
      },
      { consistent: true },
    );
    const done = await importAndWait(h, m.owner, malicious);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const created = done['workspaceId'] as string;
    expect(created).not.toBe(victim.ws);
    expect(await snapshotOf(victim.ws)).toEqual(victimBefore);
    const ids = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ id: string; workspace_id: string }>(
            `SELECT id, workspace_id FROM txn.transaction WHERE id = $1 OR workspace_id = $2`,
            [vTx, created],
          )
        ).rows,
    );
    expect(ids.filter((r) => r.workspace_id !== created && r.workspace_id !== victim.ws)).toEqual([]);
    expect(ids.filter((r) => r.workspace_id === created).map((r) => r.id)).not.toContain(vTx);
    // La víctima no es miembro de nada nuevo y el importador no ganó acceso a la víctima.
    const noAccess = await h.call('GET', `/api/v1/workspaces/${victim.ws}/transactions`, {
      token: m.owner.token,
    });
    expect(noAccess.status).toBe(403);
  }, 120_000);

  it('[TC-IDENTITY-RESTORE-001] el importador queda como único OWNER: no se restauran las membresías ni las preferencias de otros usuarios', async () => {
    const other = await h.user(`kc-ex-imp-foreign-${randomUUID()}`);
    const foreign = await importAndWait(h, other, zip);
    expect(foreign).toMatchObject({ status: 'SUCCEEDED' });
    const ws = foreign['workspaceId'] as string;
    const members = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ user_id: string; role: string }>(
            `SELECT user_id, role FROM iam.workspace_membership WHERE workspace_id = $1`,
            [ws],
          )
        ).rows,
    );
    expect(members).toEqual([{ user_id: other.id, role: 'OWNER' }]);
    // El autor original no tiene acceso al workspace restaurado por otra persona.
    const original = await h.call('GET', `/api/v1/workspaces/${ws}`, { token: m.owner.token });
    expect(original.status).toBe(403);
  }, 120_000);
});

describe('Suscripciones en el round-trip', () => {
  it('[TC-IDENTITY-RESTORE-001] una suscripción con su historial de precios y su definición administrada se restaura con ids nuevos y referencias remapeadas', async () => {
    const reader = ZipReader.open(zip);
    expect(reader.names()).toEqual(
      expect.arrayContaining(['json/subscriptions.jsonl', 'json/subscription-prices.jsonl']),
    );
    expect(lines(reader.read('json/subscription-prices.jsonl'))).toHaveLength(2);
    const done = await importAndWait(h, m.owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const created = done['workspaceId'] as string;
    const list = await h.call('GET', `/api/v1/workspaces/${created}/subscriptions`, { token: m.owner.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const [imported] = list.body['data'] as { id: string; name: string; definitionId: string }[];
    expect(imported).toMatchObject({ name: 'Streamly' });
    expect(imported!.id).not.toBe(subscriptionId);
    const detail = await h.call('GET', `/api/v1/workspaces/${created}/subscriptions/${imported!.id}`, {
      token: m.owner.token,
    });
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(
      (
        detail.body['priceHistory'] as { effectiveFrom: string; price: { amount: string }; origin: string }[]
      ).map((p) => [p.effectiveFrom, p.price.amount, p.origin]),
    ).toEqual([
      ['2027-01-15', '59.90', 'INITIAL'],
      ['2027-06-15', '69.90', 'MANUAL'],
    ]);
    const definition = await h.call(
      'GET',
      `/api/v1/workspaces/${created}/recurring/${imported!.definitionId}`,
      { token: m.owner.token },
    );
    expect(definition.body).toMatchObject({ managedBy: 'SUBSCRIPTION', managedRef: imported!.id });
    // la suscripción de origen sigue intacta
    const original = await h.call('GET', `/api/v1/workspaces/${m.ws}/subscriptions/${subscriptionId}`, {
      token: m.owner.token,
    });
    expect(original.status).toBe(200);
  }, 120_000);
});

describe('Préstamos en el round-trip', () => {
  it('[TC-DEBT-LOAN-032] [TC-IDENTITY-RESTORE-001] un préstamo con pagos se restaura con ids nuevos, referencias remapeadas y el mismo principal pendiente', async () => {
    const reader = ZipReader.open(zip);
    expect(reader.names()).toEqual(
      expect.arrayContaining([
        'json/loans.jsonl',
        'json/loan-installments.jsonl',
        'json/loan-payments.jsonl',
        'json/loan-payment-allocations.jsonl',
      ]),
    );
    expect(lines(reader.read('json/loan-payments.jsonl'))).toHaveLength(1);
    const done = await importAndWait(h, m.owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const created = done['workspaceId'] as string;
    const list = await h.call('GET', `/api/v1/workspaces/${created}/loans`, { token: m.owner.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const [imported] = list.body['data'] as { id: string; name: string; recurringDefinitionId: string }[];
    expect(imported).toMatchObject({ name: 'Préstamo (export)' });
    expect(imported!.id).not.toBe(loanId);
    const detail = await h.call('GET', `/api/v1/workspaces/${created}/loans/${imported!.id}`, {
      token: m.owner.token,
    });
    expect(detail.body['outstandingPrincipal']).toEqual(money('669.98'));
    expect(detail.body['accountBalance']).toEqual(money('669.98'));
    const payments = await h.call('GET', `/api/v1/workspaces/${created}/loans/${imported!.id}/payments`, {
      token: m.owner.token,
    });
    expect((payments.body['data'] as unknown[]).length).toBe(1);
    const definition = await h.call(
      'GET',
      `/api/v1/workspaces/${created}/recurring/${imported!.recurringDefinitionId}`,
      { token: m.owner.token },
    );
    expect(definition.body).toMatchObject({ managedBy: 'DEBT', managedRef: imported!.id });
    const original = await h.call('GET', `/api/v1/workspaces/${m.ws}/loans/${loanId}`, {
      token: m.owner.token,
    });
    expect(original.status).toBe(200);
  }, 120_000);
});

describe('Tarjetas en el round-trip', () => {
  it('[TC-DEBT-CARD-003] [TC-IDENTITY-RESTORE-001] una tarjeta bimoneda con plan de pago y cuotas se restaura con ids nuevos y referencias remapeadas', async () => {
    const reader = ZipReader.open(zip);
    expect(reader.names()).toEqual(
      expect.arrayContaining([
        'json/credit-cards.jsonl',
        'json/credit-card-terms.jsonl',
        'json/credit-card-accounts.jsonl',
        'json/card-installment-plans.jsonl',
        'json/card-installments.jsonl',
        'json/card-utilization-states.jsonl',
      ]),
    );
    expect(lines(reader.read('json/credit-card-accounts.jsonl'))).toHaveLength(2);
    expect(lines(reader.read('json/card-installments.jsonl'))).toHaveLength(3);
    const done = await importAndWait(h, m.owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const created = done['workspaceId'] as string;
    const list = await h.call('GET', `/api/v1/workspaces/${created}/credit-cards`, { token: m.owner.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const [imported] = list.body['data'] as { id: string; name: string }[];
    expect(imported).toMatchObject({ name: 'Visa Oro (export)' });
    expect(imported!.id).not.toBe(cardId);
    const detail = (
      await h.call('GET', `/api/v1/workspaces/${created}/credit-cards/${imported!.id}`, {
        token: m.owner.token,
      })
    ).body as Json & {
      accounts: {
        accountId: string;
        currency: string;
        balance: Json;
        creditLimit: Json;
        minimumRule: Json;
        paymentPlan: { definitionId: string; sourceAccountId: string } | null;
      }[];
    };
    expect(detail.accounts.map((a) => [a.currency, a.balance])).toEqual([
      ['BOB', money('1400.00')],
      ['USD', money('100.00', 'USD')],
    ]);
    // Las cuentas de la tarjeta importada son las del workspace nuevo, no las del origen.
    const importedAccounts = (
      await h.call('GET', `/api/v1/workspaces/${created}/accounts?limit=200`, { token: m.owner.token })
    ).body['data'] as { id: string; name: string }[];
    const importedIds = new Set(importedAccounts.map((a) => a.id));
    for (const a of detail.accounts) {
      expect(importedIds.has(a.accountId), `cuenta ${a.accountId}`).toBe(true);
      expect(cardAccountIds).not.toContain(a.accountId);
    }
    const bob = detail.accounts.find((a) => a.currency === 'BOB')!;
    expect(bob.creditLimit).toEqual(money('10000.00'));
    expect(bob.minimumRule).toMatchObject({ type: 'PERCENT', percent: '5.00', floor: money('50.00') });
    expect(importedIds.has(bob.paymentPlan!.sourceAccountId)).toBe(true);
    // La definición del plan viaja remapeada: CARD_PAYMENT administrada por DEBT hacia la cuenta importada.
    const definition = await h.call(
      'GET',
      `/api/v1/workspaces/${created}/recurring/${bob.paymentPlan!.definitionId}`,
      { token: m.owner.token },
    );
    expect(definition.body).toMatchObject({ kind: 'CARD_PAYMENT', managedBy: 'DEBT' });
    expect((definition.body['current'] as { toAccountId: string }).toAccountId).toBe(bob.accountId);
    // El plan de cuotas apunta a la compra importada.
    const plans = (
      await h.call('GET', `/api/v1/workspaces/${created}/credit-cards/${imported!.id}/installment-plans`, {
        token: m.owner.token,
      })
    ).body['data'] as { purchaseTransactionId: string; status: string; installments: { total: Json }[] }[];
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ status: 'ACTIVE' });
    expect(plans[0]!.installments.map((i) => (i.total as { amount: string }).amount)).toEqual([
      '300.00',
      '300.00',
      '300.00',
    ]);
    expect(plans[0]!.purchaseTransactionId).not.toBe(cardPurchaseId);
    const purchase = await h.call(
      'GET',
      `/api/v1/workspaces/${created}/transactions/${plans[0]!.purchaseTransactionId}`,
      { token: m.owner.token },
    );
    expect(purchase.status, JSON.stringify(purchase.body)).toBe(200);
    expect(purchase.body['description']).toBe('Laptop (export)');
    // El `scope_key` de los umbrales (texto con el id de la cuenta de tarjeta) se remapea con el mismo mapa.
    const scopes = await asAdmin(h, async (c) => {
      const keys = await c.query<{ scope_key: string }>(
        `SELECT DISTINCT scope_key FROM debt.card_utilization_state WHERE card_id = $1`,
        [imported!.id],
      );
      const accounts = await c.query<{ id: string }>(
        `SELECT id::text FROM debt.credit_card_account WHERE card_id = $1`,
        [imported!.id],
      );
      return { keys: keys.rows.map((r) => r.scope_key), accounts: accounts.rows.map((r) => r.id) };
    });
    expect(scopes.keys.length).toBeGreaterThan(0);
    for (const key of scopes.keys) expect(scopes.accounts).toContain(key);
    // La tarjeta de origen sigue intacta.
    const original = await h.call('GET', `/api/v1/workspaces/${m.ws}/credit-cards/${cardId}`, {
      token: m.owner.token,
    });
    expect(original.status).toBe(200);
  }, 120_000);
});

describe('Locale del workspace importado', () => {
  it('[TC-IDENTITY-AUTH-009] un locale no soportado en el archivo (fr-FR) se normaliza a APP_DEFAULT_LOCALE al importar', async () => {
    const frFR = rebuild(
      zip,
      (files) => {
        const key = 'json/workspace.jsonl';
        const text = files.get(key)!.toString('utf8');
        expect(text).toContain('"locale":"es-BO"');
        files.set(key, Buffer.from(text.replace('"locale":"es-BO"', '"locale":"fr-FR"'), 'utf8'));
      },
      { consistent: true },
    );
    const other = await h.user(`kc-ex-imp-locale-${randomUUID()}`);
    await h.startWorker();
    try {
      const done = await importAndWait(h, other, frFR);
      expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
      const locale = await asAdmin(
        h,
        async (c) =>
          (
            await c.query<{ locale: string }>(`SELECT locale FROM iam.workspace WHERE id = $1`, [
              done['workspaceId'],
            ])
          ).rows[0]?.locale,
      );
      expect(locale).toBe('es-BO');
    } finally {
      await h.stopWorker();
    }
  }, 120_000);
});

describe('Idempotencia de la importación con archivo', () => {
  it('[TC-PLATFORM-API-022] la misma clave con otro archivo ⇒ 422 IDEMPOTENCY_KEY_REUSED y solo existe la importación de A; repetir A reproduce la primera respuesta', async () => {
    const other = await h.user(`kc-ex-imp-idem-${randomUUID()}`);
    const exportB = rebuild(
      zip,
      (files) => {
        const key = 'json/workspace.jsonl';
        files.set(
          key,
          Buffer.from(
            files.get(key)!.toString('utf8').replace('"locale":"es-BO"', '"locale":"en-US"'),
            'utf8',
          ),
        );
      },
      { consistent: true },
    );
    expect(sha256(exportB)).not.toBe(sha256(zip));
    const key = 'K-IMP-0001-0001-0001';
    const first = await importZip(h, other, zip, key);
    expect(first.status, JSON.stringify(first.body)).toBe(202);

    const reused = await importZip(h, other, exportB, key);
    expect([reused.status, reused.body['code']], JSON.stringify(reused.body)).toEqual([
      422,
      'IDEMPOTENCY_KEY_REUSED',
    ]);
    expect(await importRows(other)).toBe(1);

    const replay = await importZip(h, other, zip, key);
    expect(replay.status).toBe(202);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['id']).toBe(first.body['id']);
    expect(await importRows(other)).toBe(1);
  }, 120_000);
});
