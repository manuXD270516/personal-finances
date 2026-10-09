import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { createObjectStorageClient } from '@pf/platform/storage';
import { FixedClock, Instant, systemClock, type Clock } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { inject } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { connect, enableCurrencies, inTx } from './db.js';
import type { Dependencies } from './global-setup.js';
import { apiConfig, baseEnv, capturingLogger, discardStaleEventBacklog, workerConfig } from './harness.js';

/**
 * La base de la suite es compartida: los eventos sin publicar de otros archivos (miles de asientos) harían esperar al
 * worker de esta suite más de lo razonable. Se descartan TODOS los pendientes antes de arrancarlo.
 */
async function discardAllEventBacklog(deps: Dependencies): Promise<void> {
  await discardStaleEventBacklog(deps);
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    await worker.query(
      `UPDATE platform.outbox SET published_at = clock_timestamp() WHERE published_at IS NULL`,
    );
  } finally {
    await worker.end();
  }
}

/**
 * Soporte común de las pruebas de exportación/importación del workspace (openspec add-workspace-export): API y worker
 * reales sobre PostgreSQL + SeaweedFS (Testcontainers), usuarios con claim `auth_time` controlable y un escenario "W1"
 * con datos de TODOS los contextos (cuentas, ledger, revisiones, conversión, conciliación, cierre y reapertura de mes,
 * templates versionados, presupuesto, preferencias y custom fields).
 */
export const ISSUER = 'https://idp.test/realms/pfos';
export const AUDIENCE = 'finance-api';
/** 2026-11-03 11:00 en La Paz: octubre ya terminó; noviembre no. */
export const CLOCK_START = Instant.parse('2026-11-03T15:00:00Z');
export const contract = ApiContract.fromFile(resolveContractPath());

export type Json = Record<string, unknown>;
export interface Reply {
  status: number;
  headers: Headers;
  body: Json;
  raw: Buffer;
}
export interface User {
  token: string;
  id: string;
  sub: string;
  /** Workspace personal de la sesión (el escenario crea otros). */
  ws: string;
}

export interface Harness {
  readonly deps: Dependencies;
  readonly clock: Clock;
  readonly api: ApiRuntime;
  readonly baseUrl: string;
  readonly apiLog: ReturnType<typeof capturingLogger>;
  worker: WorkerRuntime | undefined;
  /** `discardBacklog: false` conserva los jobs ya encolados (p. ej. una importación recibida con el worker detenido). */
  startWorker(
    options?: Parameters<typeof createWorkerRuntime>[2],
    flags?: { discardBacklog?: boolean },
  ): Promise<WorkerRuntime>;
  stopWorker(): Promise<void>;
  token(sub: string, authAgeSeconds?: number): Promise<string>;
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; headers?: Record<string, string>; form?: FormData },
  ): Promise<Reply>;
  user(sub: string, authAgeSeconds?: number): Promise<User>;
  close(): Promise<void>;
}

export async function startHarness(options: {
  /** Relojes reales (API y worker): para probar el orden cronológico de la auditoría entre procesos. */
  readonly realClock?: boolean;
  /** Emisor OIDC de los tokens (por defecto `ISSUER`): una semilla cargada con otro emisor (`seed --profile=large`). */
  readonly issuer?: string;
  readonly apiEnv?: Record<string, string>;
  readonly worker?: boolean | Parameters<typeof createWorkerRuntime>[2];
}): Promise<Harness> {
  const deps = inject('deps');
  const clock: Clock = options.realClock ? systemClock : new FixedClock(CLOCK_START);
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  const apiLog = capturingLogger('finance-api', 'api');
  const api = await createApiRuntime(apiConfig(baseEnv(deps, options.apiEnv)), apiLog.logger, {
    ...(options.realClock ? {} : { clock }),
    identity: {
      jwt: {
        issuer: options.issuer ?? ISSUER,
        audience: AUDIENCE,
        requiredScope: 'pfos.api',
        jwks: { keys: [jwk] },
      },
    },
  });
  const baseUrl = await api.listen(0, '127.0.0.1');

  const token = async (sub: string, authAgeSeconds = 60): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: options.issuer ?? ISSUER,
      aud: AUDIENCE,
      sub,
      iat: now - 5,
      exp: now + 600,
      typ: 'Bearer',
      scope: 'openid pfos.api',
      email: `${sub}@pfos.test`,
      email_verified: true,
      name: sub,
      // `auth_time` relativo al reloj fijo de la API (la política de re-autenticación usa ese reloj).
      auth_time: Math.floor(clock.now().epochMillis / 1000) - authAgeSeconds,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
      .sign(pair.privateKey);
  };

  const call: Harness['call'] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.token) headers['authorization'] = `Bearer ${o.token}`;
    let payload: string | FormData | undefined;
    if (o.form) payload = o.form;
    else if (o.body !== undefined) {
      payload = JSON.stringify(o.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
    const raw = Buffer.from(await res.arrayBuffer());
    let body: Json = {};
    if ((res.headers.get('content-type') ?? '').includes('json') && raw.length > 0) {
      body = JSON.parse(raw.toString('utf8')) as Json;
    }
    return { status: res.status, headers: res.headers, body, raw };
  };

  const h: Harness = {
    deps,
    clock,
    api,
    baseUrl,
    apiLog,
    worker: undefined,
    async startWorker(extra, flags) {
      if (h.worker) return h.worker;
      if (flags?.discardBacklog !== false) await discardAllEventBacklog(deps);
      h.worker = await createWorkerRuntime(
        workerConfig(baseEnv(deps)),
        capturingLogger('finance-worker', 'worker').logger,
        {
          ...(options.realClock ? {} : { clock }),
          ledgerMaintenanceOnStart: false,
          fxGapFillOnStart: false,
          lifecycleBackfillOnStart: false,
          planningPeriodsOnStart: false,
          portability: { scheduleCrons: false },
          notifications: { scheduleCrons: false, sweepOnStart: false },
          ...extra,
        },
      );
      return h.worker;
    },
    async stopWorker() {
      await h.worker?.close();
      h.worker = undefined;
    },
    token,
    call,
    async user(sub, authAgeSeconds = 60) {
      const t = await token(sub, authAgeSeconds);
      const me = await call('GET', '/api/v1/me', { token: t });
      if (me.status !== 200) throw new Error(`me ${me.status} ${JSON.stringify(me.body)}`);
      const memberships = me.body['memberships'] as { workspaceId: string }[];
      return { token: t, id: me.body['id'] as string, sub, ws: memberships[0]!.workspaceId };
    },
    async close() {
      await h.stopWorker();
      await api.close();
    },
  };
  if (options.worker) await h.startWorker(options.worker === true ? {} : options.worker);
  return h;
}

export const money = (amount: string, currency = 'BOB') => ({ amount, currency });

export function s3Client(deps: Harness['deps']) {
  return createObjectStorageClient({
    OBJECT_STORAGE_ENDPOINT: deps.s3Endpoint,
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_ACCESS_KEY: deps.s3AccessKey,
    OBJECT_STORAGE_SECRET_KEY: deps.s3SecretKey,
    OBJECT_STORAGE_FORCE_PATH_STYLE: true,
  });
}

/** Espera a que una operación asíncrona termine (SUCCEEDED/FAILED). */
export async function until<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 90_000,
  stepMs = 250,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() - started > timeoutMs) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** Escenario W1 de la spec (docs TC-IDENTITY-RESTORE-002): "Bank A" 3099.10 BOB, "Wallet USDT" 50.000000, "Visa" deuda 520.00, tasa USDT/BOB 12.02. */
export interface W1 {
  owner: User;
  editor: User;
  viewer: User;
  ws: string;
  bank: string;
  wallet: string;
  visa: string;
  expenseId: string;
  periods: Record<string, { id: string; version: number }>;
  categories: { restaurants: string; supermarket: string };
}

export function w1Api(h: Harness, w: Pick<W1, 'ws'>) {
  const base = `/api/v1/workspaces/${w.ws}`;
  const withKey = (headers: Record<string, string> = {}) => ({ 'idempotency-key': randomUUID(), ...headers });
  return {
    base,
    get: (u: User, path: string) => h.call('GET', `${base}${path}`, { token: u.token }),
    post: (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      h.call('POST', `${base}${path}`, {
        token: u.token,
        ...(body === undefined ? {} : { body }),
        headers: withKey(headers),
      }),
    put: (u: User, path: string, body: unknown, version: number) =>
      h.call('PUT', `${base}${path}`, { token: u.token, body, headers: { 'if-match': `"${version}"` } }),
    patch: (u: User, path: string, body: unknown, version: number) =>
      h.call('PATCH', `${base}${path}`, {
        token: u.token,
        body,
        headers: { 'content-type': 'application/merge-patch+json', 'if-match': `"${version}"` },
      }),
  };
}

const ok = (r: Reply, status = 201): Json => {
  if (r.status !== status)
    throw new Error(`esperaba ${status}, llegó ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

async function addMember(
  h: Harness,
  owner: User,
  wsId: string,
  member: User,
  role: 'EDITOR' | 'VIEWER',
): Promise<User> {
  const app = await connect(h.deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: wsId },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [wsId, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: wsId };
}

/** Ejecuta SQL como superusuario (ignora RLS): solo para sembrar hechos que la API no produce en la prueba y para comparar. */
export async function asAdmin<T>(h: Harness, fn: (c: Client) => Promise<T>): Promise<T> {
  const admin = await connect(h.deps.superuserUrl);
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

/**
 * Arma el workspace "W1" con datos de todos los contextos. Reloj fijo 2026-11-03: octubre ya terminó.
 * Saldos finales: Bank A 3099.10 BOB, Wallet USDT 50.000000 USDT, Visa deuda 520.00 BOB (patrimonio 3180.10 BOB a 12.02).
 */
export async function buildW1(h: Harness, label: string): Promise<W1> {
  const owner0 = await h.user(`kc-ex-${label}-owner-${randomUUID()}`);
  const created = ok(
    await h.call('POST', '/api/v1/workspaces', {
      token: owner0.token,
      body: { name: 'W1', baseCurrency: 'BOB', timezone: 'America/La_Paz', locale: 'es-BO' },
      headers: { 'idempotency-key': randomUUID() },
    }),
  );
  const ws = created['id'] as string;
  const owner: User = { ...owner0, ws };
  const editor = await addMember(
    h,
    owner,
    ws,
    await h.user(`kc-ex-${label}-editor-${randomUUID()}`),
    'EDITOR',
  );
  const viewer = await addMember(
    h,
    owner,
    ws,
    await h.user(`kc-ex-${label}-viewer-${randomUUID()}`),
    'VIEWER',
  );
  await enableCurrencies(h.deps.databaseUrl, { userId: owner.id, workspaceId: ws }, ['USDT']);
  const api = w1Api(h, { ws });

  const bank = ok(
    await api.post(owner, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('3165.00'), date: '2026-10-01' },
    }),
  )['id'] as string;
  const wallet = ok(
    await api.post(owner, '/accounts', {
      name: 'Wallet USDT',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: { amount: money('150.000000', 'USDT'), date: '2026-10-01' },
    }),
  )['id'] as string;
  const visa = ok(
    await api.post(owner, '/accounts', {
      name: 'Visa',
      type: 'CREDIT_CARD',
      currency: 'BOB',
      openingBalance: { amount: money('520.00'), date: '2026-10-01' },
    }),
  )['id'] as string;
  ok(
    await api.post(owner, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '12.02',
      rateType: 'PARALLEL',
      asOf: '2026-11-03T12:00:00Z',
      sourceLabel: 'Paralelo',
    }),
  );
  ok(await api.post(owner, '/periods', { through: '2026-12-31' }), 200);

  // Catálogos: grupo, categorías, contraparte, etiqueta y un custom field con valor.
  const group = ok(await api.post(owner, '/category-groups', { name: 'Gastos (W1)', kind: 'EXPENSE' }))[
    'id'
  ] as string;
  const supermarket = ok(await api.post(owner, '/categories', { groupId: group, name: 'Supermercado' }))[
    'id'
  ] as string;
  const restaurants = ok(await api.post(owner, '/categories', { groupId: group, name: 'Restaurantes' }))[
    'id'
  ] as string;
  const counterparty = ok(
    await api.post(owner, '/counterparties', { name: 'Mercado Rodríguez', kind: 'MERCHANT' }),
  )['id'] as string;
  const tag = ok(await api.post(owner, '/tags', { name: 'Fiesta' }))['id'] as string;
  ok(
    await api.post(owner, '/custom-fields', {
      key: 'centro_costo',
      label: 'Centro de costo',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      required: false,
      options: [
        { key: 'casa', label: 'Casa' },
        { key: 'oficina', label: 'Oficina' },
      ],
    }),
  );

  // Conciliación de Bank A ANTES de los gastos (statement = saldo inicial).
  const started = ok(
    await api.post(owner, '/reconciliations', {
      accountId: bank,
      statementDate: '2026-10-05',
      statementBalance: '3165.00',
    }),
  );
  const recId = started['id'] as string;
  const current = await api.get(owner, `/reconciliations/${recId}`);
  ok(
    await api.post(
      owner,
      `/reconciliations/${recId}/complete`,
      {},
      { 'if-match': `"${String(current.body['version'])}"` },
    ),
    200,
  );

  // Gasto de 150.00 corregido a 155.00 (revisión 2: asiento original, reversa y asiento nuevo).
  const expense = ok(
    await api.post(owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-10-10',
      accountId: bank,
      amount: money('150.00'),
      description: 'Compra del mes',
      splits: [{ amount: money('150.00'), categoryId: supermarket }],
    }),
  );
  const expenseId = expense['id'] as string;
  ok(
    await api.patch(
      owner,
      `/transactions/${expenseId}`,
      { amount: money('155.00'), splits: [{ amount: money('155.00'), categoryId: supermarket }] },
      expense['version'] as number,
    ),
    200,
  );
  // Descripción con fórmula (CSV injection) y monto con centavos.
  ok(
    await api.post(owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-10-12',
      accountId: bank,
      amount: money('45.90'),
      description: '=HYPERLINK("x")',
      counterpartyId: counterparty,
      splits: [
        {
          amount: money('45.90'),
          categoryId: restaurants,
          tagIds: [tag],
          customFields: { centro_costo: 'casa' },
        },
      ],
    }),
  );
  // Conversión USDT → BOB: 100.000000 USDT por 685.00 BOB (comisión 5.00).
  ok(
    await api.post(owner, '/conversions', {
      transactionDate: '2026-10-15',
      sourceAccountId: wallet,
      targetAccountId: bank,
      sourceAmount: money('100.000000', 'USDT'),
      targetAmount: money('685.00'),
      quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
      fees: [{ type: 'PROVIDER', amount: money('5.00') }],
      provider: { name: 'Binance P2P' },
      executedAt: '2026-10-15T18:42:00Z',
    }),
  );

  // Cierre de octubre (relaja "cuentas sin conciliar"), reapertura con motivo y re-cierre (snapshots 1 y 2).
  const policy = await api.get(owner, '/planning/closing-policy');
  const severities = { ...(policy.body['severities'] as Json), UNRECONCILED_ACCOUNTS: 'WARNING' };
  ok(await api.put(owner, '/planning/closing-policy', { severities }, policy.body['version'] as number), 200);
  const periods: W1['periods'] = {};
  const refresh = async () => {
    const list = await api.get(owner, '/periods?limit=100');
    for (const p of list.body['data'] as { id: string; label: string; version: number }[]) {
      periods[p.label] = { id: p.id, version: p.version };
    }
  };
  await refresh();
  const closeOct = async () =>
    api.post(
      owner,
      `/periods/${periods['2026-10']!.id}/close`,
      { acknowledgeWarnings: true },
      { 'if-match': `"${periods['2026-10']!.version}"` },
    );
  ok(await closeOct(), 200);
  await refresh();
  ok(
    await api.post(
      owner,
      `/periods/${periods['2026-10']!.id}/reopen`,
      { reason: 'Faltó la comisión' },
      { 'if-match': `"${periods['2026-10']!.version}"` },
    ),
    200,
  );
  await refresh();
  ok(await closeOct(), 200);
  await refresh();

  // Template "Mensual" con 3 versiones y plan de 2026-11 desde la versión 3.
  const line = (categoryId: string, planned: string) => ({
    target: { kind: 'CATEGORY', id: categoryId },
    kind: 'MAXIMUM',
    planned: money(planned),
  });
  const tpl = ok(
    await api.post(owner, '/templates', { name: 'Mensual', lines: [line(supermarket, '1500.00')] }),
  );
  const tplId = tpl['id'] as string;
  ok(
    await api.post(owner, `/templates/${tplId}/versions`, {
      baseVersionNo: 1,
      lines: [line(supermarket, '1500.00'), line(restaurants, '500.00')],
      changeNote: 'Agrega restaurantes',
    }),
  );
  ok(
    await api.post(owner, `/templates/${tplId}/versions`, {
      baseVersionNo: 2,
      lines: [line(supermarket, '1500.00'), line(restaurants, '600.00')],
      changeNote: 'Restaurantes 600',
    }),
  );
  ok(
    await api.post(owner, '/budgets', {
      periodId: periods['2026-11']!.id,
      source: { kind: 'TEMPLATE', templateId: tplId },
    }),
  );

  // Gasto de noviembre en "Restaurantes" (550.00 de 600.00 ⇒ cruza el 90 %): lo registra el consumidor de umbrales del worker.
  ok(
    await api.post(owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-11-02',
      accountId: bank,
      amount: money('550.00'),
      description: 'Cena de fin de mes',
      splits: [{ amount: money('550.00'), categoryId: restaurants }],
    }),
  );
  await until(async () => {
    const rows = await asAdmin(
      h,
      async (admin) =>
        (
          await admin.query(
            `SELECT 1 FROM planning.budget_threshold_crossing WHERE workspace_id = $1 AND threshold = 90`,
            [ws],
          )
        ).rows,
    );
    return rows.length > 0 ? true : undefined;
  });
  // Hecho que la API no produce en la prueba (lo publica el job de cierre pendiente tras N días): aviso de cierre pendiente.
  await asAdmin(h, async (admin) => {
    await admin.query(
      `INSERT INTO planning.close_pending_notice (workspace_id, period_id, event_id) VALUES ($1, $2, $3)`,
      [ws, periods['2026-10']!.id, randomUUID()],
    );
  });
  const prefs = await api.get(owner, '/notification-preferences');
  ok(
    await api.put(
      owner,
      '/notification-preferences',
      {
        types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
        quietHours: null,
        includeDetailsInEmail: false,
      },
      prefs.body['version'] as number,
    ),
    200,
  );
  return {
    owner,
    editor,
    viewer,
    ws,
    bank,
    wallet,
    visa,
    expenseId,
    periods,
    categories: { restaurants, supermarket },
  };
}

/** Solicita el export, espera a la operación y devuelve el export terminado. */
export async function exportAndWait(h: Harness, u: User, ws: string): Promise<Json> {
  const requested = await h.call('POST', `/api/v1/workspaces/${ws}/exports`, {
    token: u.token,
    headers: { 'idempotency-key': randomUUID() },
  });
  if (requested.status !== 202)
    throw new Error(`export ${requested.status} ${JSON.stringify(requested.body)}`);
  const opId = requested.body['operationId'] as string;
  await until(async () => {
    const op = await h.call('GET', `/api/v1/workspaces/${ws}/operations/${opId}`, { token: u.token });
    if (op.body['status'] === 'FAILED') throw new Error(`export falló: ${JSON.stringify(op.body)}`);
    return op.body['status'] === 'SUCCEEDED' ? op.body : undefined;
  });
  return (
    await h.call('GET', `/api/v1/workspaces/${ws}/exports/${requested.body['id'] as string}`, {
      token: u.token,
    })
  ).body;
}

export async function downloadExport(h: Harness, u: User, ws: string, exportId: string): Promise<Reply> {
  return h.call('GET', `/api/v1/workspaces/${ws}/exports/${exportId}/download`, { token: u.token });
}

export function uploadForm(zip: Buffer, name = 'export.zip'): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), name);
  return form;
}

export async function importZip(
  h: Harness,
  u: User,
  zip: Buffer,
  key: string = randomUUID(),
): Promise<Reply> {
  return h.call('POST', '/api/v1/workspace-imports', {
    token: u.token,
    form: uploadForm(zip),
    headers: { 'idempotency-key': key },
  });
}

export async function importAndWait(h: Harness, u: User, zip: Buffer): Promise<Json> {
  const accepted = await importZip(h, u, zip);
  if (accepted.status !== 202) throw new Error(`import ${accepted.status} ${JSON.stringify(accepted.body)}`);
  const id = accepted.body['id'] as string;
  return until(async () => {
    const r = await h.call('GET', `/api/v1/workspace-imports/${id}`, { token: u.token });
    if (r.body['status'] !== 'SUCCEEDED' && r.body['status'] !== 'FAILED') return undefined;
    if (r.body['status'] === 'FAILED') {
      // Solo para depurar pruebas: el motivo detallado vive en la base (el contrato publica solo el código).
      const row = await asAdmin(
        h,
        async (c) => (await c.query(`SELECT error FROM iam.workspace_import WHERE id = $1`, [id])).rows[0],
      );
      return { ...r.body, _detail: row?.['error'] };
    }
    return r.body;
  });
}

/** Workspace mínimo: "Bank A" con 3099.10 BOB (saldo inicial) y un gasto; relojes reales. */
export interface Mini {
  owner: User;
  editor: User;
  ws: string;
  bank: string;
}

export async function buildMini(h: Harness, label: string): Promise<Mini> {
  const owner0 = await h.user(`kc-ex-${label}-owner-${randomUUID()}`);
  const created = ok(
    await h.call('POST', '/api/v1/workspaces', {
      token: owner0.token,
      body: { name: `Mini ${label}`, baseCurrency: 'BOB', timezone: 'America/La_Paz', locale: 'es-BO' },
      headers: { 'idempotency-key': randomUUID() },
    }),
  );
  const ws = created['id'] as string;
  const owner: User = { ...owner0, ws };
  const editor = await addMember(
    h,
    owner,
    ws,
    await h.user(`kc-ex-${label}-editor-${randomUUID()}`),
    'EDITOR',
  );
  const api = w1Api(h, { ws });
  const bank = ok(
    await api.post(owner, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('3099.10'), date: '2026-10-01' },
    }),
  )['id'] as string;
  return { owner, editor, ws, bank };
}
