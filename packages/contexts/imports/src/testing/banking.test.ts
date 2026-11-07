import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { codeOf } from './pipeline-harness.js';
import type { ExternalRecord } from '../domain/index.js';
import { FAKE_HOST, FakeExchangeBackend, sampleRecords } from '../infrastructure/banking/fake-exchange.js';
import {
  A_BTC,
  A_USDT,
  SECRET,
  USER,
  WS,
  activeConnection,
  setupBanking,
  type BankingCtx,
} from './banking-harness.js';

const record = (
  over: Partial<ExternalRecord> & Pick<ExternalRecord, 'type' | 'externalId'>,
): ExternalRecord => ({
  executedAt: '2026-10-02T15:30:00.000Z',
  legs: [],
  fees: [],
  description: null,
  raw: {},
  ...over,
});

const deposit = (id: string, day: string, amount: string): ExternalRecord =>
  record({
    type: 'DEPOSIT',
    externalId: id,
    executedAt: `${day}T13:00:00.000Z`,
    legs: [{ asset: 'USDT', amount, direction: 'IN' }],
    description: `Deposito ${id}`,
  });

/** Sincroniza (API + worker) y devuelve el import en vista previa. */
async function syncToReview(ctx: BankingCtx, connectionId: string, from?: string) {
  const started = await ctx.service.sync({ workspaceId: WS, userId: USER, connectionId, from });
  const outcome = await ctx.jobs.sync({ workspaceId: WS, connectionId, importJobId: started.importJobId });
  return { started, outcome };
}

async function preview(ctx: BankingCtx, importId: string) {
  return (await ctx.queries.preview(WS, importId, { limit: 5000 })).rows;
}

async function approve(ctx: BankingCtx, importId: string) {
  const job = await ctx.queries.get(WS, importId);
  await ctx.imports.approve({ workspaceId: WS, userId: USER, importId, expectedVersion: job.version });
  await ctx.persist.persist({ workspaceId: WS, importId });
  return ctx.queries.get(WS, importId);
}

describe('Conexiones: creación, mapeo y credenciales', () => {
  it('[TC-IMPORTS-BANKING-004] crea la conexión con dos mapeos, queda pendiente y la verificación la activa', async () => {
    const ctx = setupBanking();
    const created = await ctx.service.create({
      workspaceId: WS,
      userId: USER,
      providerId: 'FAKE_EXCHANGE',
      name: 'Exchange principal',
      assetMappings: [
        { asset: 'USDT', accountId: A_USDT },
        { asset: 'BTC', accountId: A_BTC },
      ],
      credential: SECRET,
    });
    expect(created.status).toBe('PENDING_VERIFICATION');
    expect(created.assetMappings).toHaveLength(2);
    expect(ctx.queue.verify).toHaveLength(1);
    expect(await ctx.jobs.verify({ workspaceId: WS, connectionId: created.id })).toBe('VERIFIED');
    const active = await ctx.service.get(WS, created.id);
    expect(active.status).toBe('ACTIVE');
    expect(active.credential).toMatchObject({ fingerprint: '…a1b2', kid: 'k1' });
    expect(active.credential?.permissions).toMatchObject({ read: true, trade: false, withdraw: false });
  });

  it('[TC-IMPORTS-BANKING-006] mapear BTC a la cuenta de USDT se rechaza con CURRENCY_MISMATCH', async () => {
    const ctx = setupBanking();
    const code = await codeOf(
      ctx.service.create({
        workspaceId: WS,
        userId: USER,
        providerId: 'FAKE_EXCHANGE',
        name: 'X',
        assetMappings: [{ asset: 'BTC', accountId: A_USDT }],
        credential: SECRET,
      }),
    );
    expect(code).toBe('CURRENCY_MISMATCH');
    expect(ctx.connections.rows.size).toBe(0);
  });

  it('[TC-IMPORTS-BANKING-002] un proveedor con términos pendientes se rechaza con BANKING_PROVIDER_NOT_AVAILABLE', async () => {
    const ctx = setupBanking();
    const code = await codeOf(
      ctx.service.create({
        workspaceId: WS,
        userId: USER,
        providerId: 'EXCHANGE_API_BINANCE',
        name: 'Binance',
        assetMappings: [],
        credential: SECRET,
      }),
    );
    expect(code).toBe('BANKING_PROVIDER_NOT_AVAILABLE');
    const catalog = ctx.service.providers();
    expect(catalog.find((p) => p.id === 'EXCHANGE_API_BINANCE')?.availability).toBe('PENDING_VERIFICATION');
  });

  it('[TC-IMPORTS-BANKING-007] las lecturas muestran solo la huella enmascarada y la base guarda el sobre cifrado', async () => {
    const ctx = setupBanking();
    const view = await activeConnection(ctx);
    const text = JSON.stringify([view, await ctx.service.list(WS)]);
    expect(text).toContain('…a1b2');
    expect(text).not.toContain(SECRET.secret);
    expect(text).not.toContain(SECRET.keyId);
    const stored = ctx.connections.creds.get(view.id)?.sealed;
    expect(stored?.ciphertext.length).toBeGreaterThan(0);
    const raw = Buffer.concat([
      Buffer.from(stored?.ciphertext ?? new Uint8Array()),
      Buffer.from(stored?.wrappedDek ?? new Uint8Array()),
    ]).toString('latin1');
    expect(raw).not.toContain(SECRET.secret);
  });

  it('[TC-IMPORTS-BANKING-008] el proceso de la API (solo clave pública) cifra pero no puede descifrar', async () => {
    const ctx = setupBanking({ apiOnly: true });
    const created = await ctx.service.create({
      workspaceId: WS,
      userId: USER,
      providerId: 'FAKE_EXCHANGE',
      name: 'Solo API',
      assetMappings: [],
      credential: SECRET,
    });
    // Sin clave privada, verificar no puede descifrar: la conexión pasa a atención y nunca se llama al proveedor.
    expect(await ctx.jobs.verify({ workspaceId: WS, connectionId: created.id })).toBe('NEEDS_ATTENTION');
    expect(ctx.backend.requests).toHaveLength(0);
  });

  it('[TC-IMPORTS-BANKING-011] una clave con permiso de retiro se rechaza y su credencial se destruye', async () => {
    const ctx = setupBanking();
    ctx.backend.permissions = {
      read: true,
      trade: false,
      withdraw: true,
      transfer: false,
      ipRestricted: null,
    };
    const created = await ctx.service.create({
      workspaceId: WS,
      userId: USER,
      providerId: 'FAKE_EXCHANGE',
      name: 'Con retiro',
      assetMappings: [],
      credential: SECRET,
    });
    expect(await ctx.jobs.verify({ workspaceId: WS, connectionId: created.id })).toBe('REJECTED');
    const view = await ctx.service.get(WS, created.id);
    expect(view.status).toBe('REJECTED');
    expect(view.lastError).toEqual({ code: 'CONNECTION_CREDENTIAL_NOT_READ_ONLY' });
    expect(view.credential).toBeNull();
    expect(await ctx.connections.loadSealed(WS, created.id)).toBeNull();
  });

  it('[TC-IMPORTS-BANKING-034] la auditoría de la creación lleva proveedor, huella y mapeos, sin el secreto', async () => {
    const ctx = setupBanking();
    const view = await activeConnection(ctx);
    const created = ctx.world.lifecycle.find((l) => l.entry.action === 'imports.connection.created');
    expect(created).toBeDefined();
    const fields = Object.fromEntries((created?.entry.changes ?? []).map((c) => [c.field, c.after]));
    expect(fields['providerId']).toBe('FAKE_EXCHANGE');
    expect(fields['fingerprint']).toBe('…a1b2');
    expect(String(fields['assetMappings'])).toContain(A_USDT);
    expect(created?.steps[0]).toMatchObject({
      kind: 'TRANSITION',
      transition: 'CREATE',
      toState: 'PENDING_VERIFICATION',
    });
    const all = JSON.stringify([ctx.world.lifecycle, ctx.world.audit, ctx.world.events, view]);
    expect(all).not.toContain(SECRET.secret);
    expect(all).not.toContain(SECRET.keyId);
  });
});

describe('Conexiones: solo lectura, revocación y credencial rechazada', () => {
  it('[TC-IMPORTS-BANKING-012] permisos ampliados detienen la sincronización sin leer movimientos', async () => {
    const ctx = setupBanking();
    const c = await activeConnection(ctx);
    ctx.backend.permissions = {
      read: true,
      trade: true,
      withdraw: false,
      transfer: false,
      ipRestricted: null,
    };
    const { outcome } = await syncToReview(ctx, c.id, '2026-07-01');
    expect(outcome).toBe('FAILED');
    expect((await ctx.service.get(WS, c.id)).status).toBe('NEEDS_ATTENTION');
    expect((await ctx.service.get(WS, c.id)).lastError).toEqual({
      code: 'CONNECTION_CREDENTIAL_NOT_READ_ONLY',
    });
    expect(ctx.backend.historyCalls).toBe(0);
  });

  it('[TC-IMPORTS-BANKING-013] revocar destruye la credencial, no sincroniza más y conserva lo importado', async () => {
    const ctx = setupBanking({
      backend: new FakeExchangeBackend([deposit('D-1', '2026-10-01', '10.000000')]),
    });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    await approve(ctx, started.importJobId);
    const imported = ctx.world.transactions.length;
    expect(imported).toBe(1);
    const current = await ctx.service.get(WS, c.id);
    const revoked = await ctx.service.revoke({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      expectedVersion: current.version,
    });
    expect(revoked.status).toBe('REVOKED');
    expect(await ctx.connections.loadSealed(WS, c.id)).toBeNull();
    expect(await codeOf(ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: c.id }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(ctx.world.transactions).toHaveLength(imported);
    expect(ctx.world.lifecycle.some((l) => l.entry.action === 'imports.connection.revoked')).toBe(true);
    // Un If-Match viejo se rechaza.
    expect(
      await codeOf(
        ctx.service.revoke({
          workspaceId: WS,
          userId: USER,
          connectionId: c.id,
          expectedVersion: current.version,
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
  });

  it('revocar con una sincronización sin aprobar cancela su import y no mueve el cursor', async () => {
    const ctx = setupBanking({
      backend: new FakeExchangeBackend([deposit('D-1', '2026-10-01', '10.000000')]),
    });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    expect((await ctx.queries.get(WS, started.importJobId)).status).toBe('AWAITING_REVIEW');
    const current = await ctx.service.get(WS, c.id);
    await ctx.service.revoke({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      expectedVersion: current.version,
    });
    expect((await ctx.queries.get(WS, started.importJobId)).status).toBe('CANCELLED');
    const after = await ctx.service.get(WS, c.id);
    expect(after).toMatchObject({ status: 'REVOKED', syncCursor: null, syncInProgress: false });
    expect(ctx.world.transactions).toHaveLength(0);
  });

  it('[TC-IMPORTS-BANKING-014] una clave rechazada falla con IMPORT_CONNECTION_EXPIRED y se recupera al reemplazarla', async () => {
    const ctx = setupBanking();
    const c = await activeConnection(ctx);
    ctx.backend.rejectCredential = true;
    const { started, outcome } = await syncToReview(ctx, c.id, '2026-07-01');
    expect(outcome).toBe('FAILED');
    const job = await ctx.queries.get(WS, started.importJobId);
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure).toMatchObject({ code: 'IMPORT_CONNECTION_EXPIRED' });
    const attention = await ctx.service.get(WS, c.id);
    expect(attention.status).toBe('NEEDS_ATTENTION');
    expect(attention.lastError).toEqual({ code: 'IMPORT_CONNECTION_EXPIRED' });
    // Reemplaza por una clave válida de solo lectura: se verifica de nuevo y la conexión vuelve a activa.
    ctx.backend.rejectCredential = false;
    const replaced = await ctx.service.replaceCredential({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      expectedVersion: attention.version,
      credential: {
        keyId: 'AKIA-NEW-KEY-0000-c3d4',
        secret: ['otro', 'secreto', 'de', 'prueba', '123'].join('-'),
      },
    });
    expect(replaced.status).toBe('PENDING_VERIFICATION');
    expect(replaced.credential?.fingerprint).toBe('…c3d4');
    expect(await ctx.jobs.verify({ workspaceId: WS, connectionId: c.id })).toBe('VERIFIED');
    expect((await ctx.service.get(WS, c.id)).status).toBe('ACTIVE');
  });

  it('[TC-IMPORTS-BANKING-015] la rotación vuelve a envolver las claves de datos sin descifrar los secretos', async () => {
    const ctx = setupBanking();
    const ids: string[] = [];
    for (const name of ['Uno', 'Dos', 'Tres']) ids.push((await activeConnection(ctx, name)).id);
    expect(ids.map((id) => ctx.connections.creds.get(id)?.sealed?.kid)).toEqual(['k1', 'k1', 'k1']);
    // k2 pasa a ser la vigente; k1 sigue en el llavero hasta rotar.
    const { ConnectionJobs } = await import('../application/banking/connection-jobs.js');
    const rotated = new ConnectionJobs(
      ctx.deps,
      { ...bankingOf(ctx), vault: ctx.vaultOf('k2') },
      ctx.process,
    );
    expect(await rotated.rewrap({ workspaceId: WS })).toEqual({ rewrapped: 3, flagged: 0 });
    expect(ids.map((id) => ctx.connections.creds.get(id)?.sealed?.kid)).toEqual(['k2', 'k2', 'k2']);
    // k1 se retira: el llavero solo con k2 sigue descifrando y las sincronizaciones funcionan.
    const onlyK2 = new ConnectionJobs(
      ctx.deps,
      { ...bankingOf(ctx), vault: ctx.vaultOf('k2', 'k2') },
      ctx.process,
    );
    const started = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: ids[0] as string,
      from: '2026-07-01',
    });
    expect(
      await onlyK2.sync({
        workspaceId: WS,
        connectionId: ids[0] as string,
        importJobId: started.importJobId,
      }),
    ).toBe('READY');
  });

  it('[TC-IMPORTS-BANKING-016] una credencial con clave maestra ausente no detiene a las demás', async () => {
    const ctx = setupBanking();
    const good = await activeConnection(ctx, 'Buena');
    const bad = await activeConnection(ctx, 'Mala');
    const sealed = ctx.connections.creds.get(bad.id)?.sealed;
    // La envoltura quedó con una clave maestra que ya no existe en el llavero.
    ctx.connections.creds.set(bad.id, {
      ...(ctx.connections.creds.get(bad.id) as NonNullable<ReturnType<typeof ctx.connections.creds.get>>),
      sealed: { ...(sealed as NonNullable<typeof sealed>), kid: 'k0' },
    });
    const s1 = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: bad.id,
      from: '2026-07-01',
    });
    expect(await ctx.jobs.sync({ workspaceId: WS, connectionId: bad.id, importJobId: s1.importJobId })).toBe(
      'FAILED',
    );
    expect((await ctx.service.get(WS, bad.id)).status).toBe('NEEDS_ATTENTION');
    const s2 = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: good.id,
      from: '2026-07-01',
    });
    expect(await ctx.jobs.sync({ workspaceId: WS, connectionId: good.id, importJobId: s2.importJobId })).toBe(
      'READY',
    );
  });
});

const bankingOf = (ctx: BankingCtx) => ctx.bankingDeps;

describe('Sincronización: ventana, cursor y reanudación', () => {
  it('[TC-IMPORTS-BANKING-017] la segunda sincronización continúa desde el cursor confirmado', async () => {
    const ctx = setupBanking({
      backend: new FakeExchangeBackend([deposit('D-1', '2026-10-01', '10.000000')]),
    });
    const c = await activeConnection(ctx);
    const first = await syncToReview(ctx, c.id, '2026-07-01');
    expect(first.outcome).toBe('READY');
    expect((await ctx.service.get(WS, c.id)).syncCursor).toBeNull();
    await approve(ctx, first.started.importJobId);
    expect((await ctx.service.get(WS, c.id)).syncCursor).toBe('2026-10-20');
    ctx.world.clock.advance(7 * 86_400_000);
    const second = await syncToReview(ctx, c.id);
    expect(second.started.window).toEqual({ from: '2026-10-20', to: '2026-10-27' });
    const history = ctx.backend.requests.filter((r) => r.url.includes('/v1/history'));
    expect(history.at(-1)?.url).toContain('from=2026-10-20');
    expect((await ctx.queries.get(WS, second.started.importJobId)).status).toBe('AWAITING_REVIEW');
  });

  it('[TC-IMPORTS-BANKING-018] cancelar la vista previa no mueve el cursor confirmado', async () => {
    const ctx = setupBanking({
      backend: new FakeExchangeBackend([deposit('D-1', '2026-10-01', '10.000000')]),
    });
    const c = await activeConnection(ctx);
    const first = await syncToReview(ctx, c.id, '2026-07-01');
    const job = await ctx.queries.get(WS, first.started.importJobId);
    await ctx.imports.cancel({ workspaceId: WS, userId: USER, importId: job.id });
    const after = await ctx.service.get(WS, c.id);
    expect(after.syncCursor).toBeNull();
    expect(after.syncInProgress).toBe(false);
    // La siguiente sincronización vuelve a pedir la fecha de inicio y a traer los mismos registros.
    expect(await codeOf(ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: c.id }))).toBe(
      'VALIDATION_FAILED',
    );
    const again = await syncToReview(ctx, c.id, '2026-07-01');
    expect(
      (await preview(ctx, again.started.importJobId)).filter((r) => r.classification === 'NEW'),
    ).toHaveLength(1);
  });

  it('[TC-IMPORTS-BANKING-019] una conexión no admite dos sincronizaciones en curso', async () => {
    const ctx = setupBanking();
    const c = await activeConnection(ctx);
    await ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: c.id, from: '2026-07-01' });
    expect(
      await codeOf(
        ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: c.id, from: '2026-07-01' }),
      ),
    ).toBe('CONNECTION_SYNC_IN_PROGRESS');
  });

  it('la primera sincronización admite hasta 365 días hacia atrás; más es VALIDATION_FAILED', async () => {
    const ctx = setupBanking();
    const c = await activeConnection(ctx);
    expect(
      await codeOf(
        ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: c.id, from: '2025-10-19' }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: c.id, from: '2025-10-20' }),
      ),
    ).toBe('OK');
  });

  it('[TC-IMPORTS-BANKING-029] un 429 con Retry-After: 120 pausa, persiste la espera y reanuda sin repetir', async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      deposit(`D-${i + 1}`, '2026-10-01', `${10 + i}.000000`),
    );
    const backend = new FakeExchangeBackend(records);
    backend.pageSize = 1;
    backend.failOnPage(4, { status: 429, retryAfter: '120' });
    const ctx = setupBanking({ backend, requestsPerMinute: 100 });
    const c = await activeConnection(ctx);
    const started = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      from: '2026-07-01',
    });
    const args = { workspaceId: WS, connectionId: c.id, importJobId: started.importJobId };
    expect(await ctx.jobs.sync(args)).toBe('WAITING');
    const waiting = await ctx.service.get(WS, c.id);
    expect(
      Date.parse(waiting.retryNotBefore as string) - ctx.world.clock.now().epochMillis,
    ).toBeGreaterThanOrEqual(120_000);
    const queued = ctx.queue.sync.at(-1);
    expect(queued?.startAfter?.getTime()).toBeGreaterThanOrEqual(ctx.world.clock.now().epochMillis + 120_000);
    // Antes de que pase la espera, el job se reprograma sin llamar al proveedor.
    const callsBefore = ctx.backend.historyCalls;
    expect(await ctx.jobs.sync(args)).toBe('WAITING');
    expect(ctx.backend.historyCalls).toBe(callsBefore);
    ctx.world.clock.advance(120_000);
    expect(await ctx.jobs.sync(args)).toBe('READY');
    const rows = await preview(ctx, started.importJobId);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(10);
  });

  it('[TC-IMPORTS-BANKING-030] una caída a mitad de la sincronización se reanuda sin duplicados ni import completo', async () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      deposit(`D-${i + 1}`, '2026-10-01', `${10 + i}.000000`),
    );
    const backend = new FakeExchangeBackend(records);
    backend.pageSize = 2;
    backend.failOnPage(2, { status: 500 });
    const ctx = setupBanking({ backend, requestsPerMinute: 100 });
    const c = await activeConnection(ctx);
    const started = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      from: '2026-07-01',
    });
    const args = { workspaceId: WS, connectionId: c.id, importJobId: started.importJobId };
    // Primer intento: escribe 2 páginas y se cae en la 3.ª (falla transitoria: la cola reintenta).
    await expect(ctx.jobs.sync({ ...args, attempt: 1 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect((await ctx.queries.get(WS, started.importJobId)).status).toBe('PROCESSING');
    expect((await ctx.service.get(WS, c.id)).syncInProgress).toBe(true);
    expect(ctx.world.staged.filter((s) => s.jobId === started.importJobId)).toHaveLength(4);
    // Reintento: reanuda desde la página 3, sin repetir las ya escritas.
    expect(await ctx.jobs.sync({ ...args, attempt: 2 })).toBe('READY');
    const rows = await preview(ctx, started.importJobId);
    expect(rows.map((r) => r.externalId).sort()).toEqual(
      records.map((r) => `DEPOSIT:${r.externalId}`).sort(),
    );
  });

  it('una falla transitoria que agota los intentos deja el import FALLIDO con PROVIDER_UNAVAILABLE, nunca completo', async () => {
    const backend = new FakeExchangeBackend([deposit('D-1', '2026-10-01', '10.000000')]);
    backend.failOnPage(0, { status: 500 });
    const ctx = setupBanking({ backend });
    const c = await activeConnection(ctx);
    const started = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      from: '2026-07-01',
    });
    const outcome = await ctx.jobs.sync({
      workspaceId: WS,
      connectionId: c.id,
      importJobId: started.importJobId,
      attempt: 3,
    });
    expect(outcome).toBe('FAILED');
    const job = await ctx.queries.get(WS, started.importJobId);
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect((await ctx.service.get(WS, c.id)).syncCursor).toBeNull();
  });
});

describe('Privacidad de las solicitudes', () => {
  it('[TC-IMPORTS-BANKING-031] una redirección a un host no permitido se bloquea sin enviarle la credencial', async () => {
    const backend = new FakeExchangeBackend([deposit('D-1', '2026-10-01', '10.000000')]);
    backend.failOnPage(0, { status: 302, location: 'https://evil.test/steal' });
    const ctx = setupBanking({ backend });
    const c = await activeConnection(ctx);
    const { started, outcome } = await syncToReview(ctx, c.id, '2026-07-01');
    expect(outcome).toBe('FAILED');
    expect((await ctx.queries.get(WS, started.importJobId)).status).toBe('PARSE_FAILED');
    // Ninguna solicitud salió hacia otro host: el servidor del host no permitido no recibió nada.
    expect(backend.requests.every((r) => new URL(r.url).hostname === FAKE_HOST)).toBe(true);
    expect(backend.requests.some((r) => r.url.includes('evil.test'))).toBe(false);
  });

  it('[TC-IMPORTS-BANKING-032] las solicitudes llevan solo la credencial, la ventana y el cursor', async () => {
    const backend = new FakeExchangeBackend(
      Array.from({ length: 4 }, (_, i) => deposit(`D-${i + 1}`, '2026-10-01', `${10 + i}.000000`)),
    );
    const ctx = setupBanking({ backend });
    const c = await activeConnection(ctx, 'Cuenta personal de Ana');
    await syncToReview(ctx, c.id, '2026-07-01');
    expect(backend.requests.length).toBeGreaterThan(2);
    for (const r of backend.requests) {
      const url = new URL(r.url);
      expect([...url.searchParams.keys()].every((k) => ['from', 'to', 'cursor'].includes(k))).toBe(true);
      expect(Object.keys(r.headers).sort()).toEqual(['accept', 'x-api-key', 'x-api-secret']);
      const text = JSON.stringify(r);
      for (const forbidden of [WS, A_USDT, A_BTC, 'Ana', 'Cuenta personal', 'Deposito', c.id]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it('[TC-IMPORTS-BANKING-009] el secreto no aparece en el staging, el recorrido, la auditoría ni los eventos de una corrida completa', async () => {
    const ctx = setupBanking({ backend: new FakeExchangeBackend(sampleRecords()) });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    await approve(ctx, started.importJobId);
    const current = await ctx.service.get(WS, c.id);
    await ctx.service.revoke({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      expectedVersion: current.version,
    });
    const everything = JSON.stringify([
      ctx.world.audit,
      ctx.world.lifecycle,
      ctx.world.events,
      ctx.world.staged,
      await ctx.service.list(WS),
      await preview(ctx, started.importJobId),
      [...ctx.connections.rows.values()],
    ]);
    expect(everything).not.toContain(SECRET.secret);
    expect(everything).not.toContain(SECRET.keyId);
  });
});

describe('Registros del exchange en la vista previa y la persistencia', () => {
  const trade = record({
    type: 'TRADE',
    externalId: 'T-1001',
    legs: [
      { asset: 'USDT', amount: '975.000000', direction: 'OUT' },
      { asset: 'BTC', amount: '0.01500000', direction: 'IN' },
    ],
    fees: [{ asset: 'BTC', amount: '0.00001500', kind: 'PROVIDER' }],
    quotedPrice: { base: 'BTC', quote: 'USDT', price: '65000.00' },
  });

  it('[TC-IMPORTS-BANKING-023] un trade se propone como conversión con el detalle del exchange y se crea con montos exactos', async () => {
    const ctx = setupBanking({ backend: new FakeExchangeBackend([trade]) });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    const rows = await preview(ctx, started.importJobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'CONVERSION',
      classification: 'NEW',
      amount: { amount: '975.000000', currency: 'USDT' },
    });
    const done = await approve(ctx, started.importJobId);
    expect(done.status).toBe('COMPLETED');
    const tx = ctx.world.transactions[0];
    expect(tx).toMatchObject({
      kind: 'CONVERSION',
      accountId: A_USDT,
      currency: 'USDT',
      signed: '-975.000000',
      externalRef: { namespace: 'imports.provider:FAKE:TRADE', id: 'T-1001' },
    });
    expect(tx?.conversion).toMatchObject({
      counterAccountId: A_BTC,
      counterAmount: { amount: '0.01498500', currency: 'BTC' },
      fee: { amount: '0.00001500', currency: 'BTC' },
      quotedRate: { base: 'BTC', quote: 'USDT', value: '65000.00' },
    });
    // El instante de ejecución es el del exchange.
    expect((tx?.conversion as { executedAt: string }).executedAt).toBe('2026-10-02T15:30:00.000Z');
  });

  it('[TC-IMPORTS-BANKING-024] un retiro se propone como gasto con señal y su comisión de red como gasto Fees aparte', async () => {
    const withdrawal = record({
      type: 'WITHDRAWAL',
      externalId: 'W-1',
      legs: [{ asset: 'USDT', amount: '200.000000', direction: 'OUT' }],
      fees: [{ asset: 'USDT', amount: '1.000000', kind: 'NETWORK' }],
    });
    const ctx = setupBanking({ backend: new FakeExchangeBackend([withdrawal]) });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    const rows = await preview(ctx, started.importJobId);
    expect(rows).toHaveLength(2);
    const main = rows.find((r) => r.externalId === 'WITHDRAWAL:W-1');
    const fee = rows.find((r) => r.externalId === 'FEE:W-1:network');
    expect(main?.amount).toEqual({ amount: '200.000000', currency: 'USDT' });
    expect(main?.issues.map((w) => w.code)).toContain('POSSIBLE_TRANSFER');
    expect(fee?.amount).toEqual({ amount: '1.000000', currency: 'USDT' });
    expect(fee?.proposal?.categoryId?.value).toBe('cat-fees');
    await approve(ctx, started.importJobId);
    const total = ctx.world.transactions.reduce((sum, t) => sum.plus(dec(t.signed)), dec('0'));
    expect(total.equals(dec('-201'))).toBe(true);
    expect(ctx.world.transactions.find((t) => t.externalRef?.id === 'W-1:network')?.categoryName).toBe(
      'cat-fees',
    );
  });

  it('[TC-IMPORTS-BANKING-025] una orden P2P queda excluida con CONNECTION_RECORD_UNSUPPORTED y no crea nada', async () => {
    const p2p = record({
      type: 'P2P',
      externalId: 'P-1',
      legs: [{ asset: 'USDT', amount: '100.000000', direction: 'OUT' }],
    });
    const ctx = setupBanking({ backend: new FakeExchangeBackend([p2p]) });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    const rows = await preview(ctx, started.importJobId);
    expect(rows[0]?.classification).toBe('INVALID');
    expect(rows[0]?.issues.map((i) => i.code)).toContain('CONNECTION_RECORD_UNSUPPORTED');
    await approve(ctx, started.importJobId);
    expect(ctx.world.transactions).toHaveLength(0);
  });

  it('[TC-IMPORTS-BANKING-005] un depósito de 12.500000 TRX sin mapear llega como fila no importable', async () => {
    const trx = record({
      type: 'DEPOSIT',
      externalId: 'D-TRX',
      legs: [{ asset: 'TRX', amount: '12.500000', direction: 'IN' }],
    });
    const ctx = setupBanking({ backend: new FakeExchangeBackend([trx]) });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    const rows = await preview(ctx, started.importJobId);
    expect(rows[0]?.issues.map((i) => i.code)).toContain('CONNECTION_ASSET_UNMAPPED');
    expect(rows[0]?.classification).toBe('INVALID');
    await approve(ctx, started.importJobId);
    expect(ctx.world.transactions).toHaveLength(0);
  });

  it('[TC-IMPORTS-BANKING-026] recompensas y depósitos pasan por las reglas del workspace', async () => {
    const ctx = setupBanking({
      backend: new FakeExchangeBackend([
        record({
          type: 'REWARD',
          externalId: 'R-1',
          legs: [{ asset: 'USDT', amount: '1.500000', direction: 'IN' }],
          description: 'Staking',
        }),
        deposit('D-1', '2026-10-01', '50.000000'),
      ]),
    });
    ctx.world.categories.set('cat-rend', 'INCOME');
    ctx.world.ruleOutcomes.push((s) =>
      (s.description ?? '').includes('Staking')
        ? {
            category: { categoryId: 'cat-rend', origin: { ruleId: 'rule-staking', ruleVersion: 1 } },
            matched: [{ ruleId: 'rule-staking', ruleVersion: 1 }],
          }
        : null,
    );
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    const rows = await preview(ctx, started.importJobId);
    const reward = rows.find((r) => r.externalId === 'REWARD:R-1');
    const dep = rows.find((r) => r.externalId === 'DEPOSIT:D-1');
    expect(reward?.proposal?.categoryId).toMatchObject({
      value: 'cat-rend',
      origin: 'RULE',
      ruleId: 'rule-staking',
    });
    expect(dep?.proposal?.categoryId ?? null).toBeNull();
    expect(dep?.issues.map((w) => w.code)).toContain('POSSIBLE_TRANSFER');
  });

  it('[TC-IMPORTS-BANKING-020] una ventana solapada no crea duplicados: 9 ya importados, 9 nuevos y 29 en total', async () => {
    const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
    const first = Array.from({ length: 20 }, (_, i) => deposit(`D-${i + 1}`, day(i + 1), `${10 + i}.000000`));
    const backend = new FakeExchangeBackend(first);
    const ctx = setupBanking({ backend, requestsPerMinute: 100 });
    const c = await activeConnection(ctx);
    const s1 = await syncToReview(ctx, c.id, '2026-09-01');
    await approve(ctx, s1.started.importJobId);
    expect(ctx.world.transactions).toHaveLength(20);
    // El exchange suma 9 registros nuevos (21..29 de septiembre); la ventana pedida empieza el 12.
    for (let i = 21; i <= 29; i += 1) backend.records.push(deposit(`D-${i}`, day(i), `${10 + i}.000000`));
    const s2 = await syncToReview(ctx, c.id, '2026-09-12');
    const rows = await preview(ctx, s2.started.importJobId);
    expect(rows).toHaveLength(18);
    expect(rows.filter((r) => r.classification === 'DUPLICATE_EXACT')).toHaveLength(9);
    expect(rows.filter((r) => r.classification === 'NEW')).toHaveLength(9);
    await approve(ctx, s2.started.importJobId);
    expect(ctx.world.transactions).toHaveLength(29);
  });

  it('[TC-IMPORTS-BANKING-021] un registro ya importado por el otro camino no crea otra conversión (referencia compartida)', async () => {
    const ctx = setupBanking({ backend: new FakeExchangeBackend([trade]) });
    // El archivo del mismo exchange ya creó la conversión con la MISMA referencia externa.
    ctx.world.addTransaction({
      accountId: A_USDT,
      date: '2026-10-02',
      signed: '-975.000000',
      currency: 'USDT',
      kind: 'CONVERSION',
      source: 'IMPORT',
      externalRef: { namespace: 'imports.provider:FAKE:TRADE', id: 'T-1001' },
    });
    const c = await activeConnection(ctx);
    const { started } = await syncToReview(ctx, c.id, '2026-07-01');
    // El pipeline lo avisa como posible duplicado; aun decidido «crear», la referencia compartida evita la segunda conversión.
    const [row] = await preview(ctx, started.importJobId);
    const job0 = await ctx.queries.get(WS, started.importJobId);
    await ctx.imports.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: started.importJobId,
      rowId: row?.id as string,
      expectedVersion: job0.version,
      decision: 'CREATE',
    });
    await approve(ctx, started.importJobId);
    expect(ctx.world.transactions).toHaveLength(1);
    const job = await ctx.queries.get(WS, started.importJobId);
    expect(job.counters.created).toBe(0);
  });
});
