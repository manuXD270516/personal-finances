import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { quarantineKeyOf } from '../../src/application/ports/index.js';
import { Document } from '../../src/domain/document.js';
import { DEFAULT_UPLOAD_LIMITS, validateDeclaration } from '../../src/domain/file-type-policy.js';
import {
  PgAttachmentLinkRepository,
  PgDocumentRepository,
  PgDocumentsUnitOfWork,
  PgMaintenanceScan,
  PgStorageUsageRepository,
} from '../../src/infrastructure/pg-documents.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `documents.*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-document-attachments, tarea 4.1):
// repositorios con control optimista, deduplicación por contenido (índice único parcial), CHECK de coherencia del estado,
// vínculos únicos, candado de la cuota, aislamiento entre workspaces, RLS fail-closed (PF002) y el barrido de
// mantenimiento entre workspaces con `pf_maintenance` (solo columnas operativas, nunca la clave envuelta).
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgDocumentsUnitOfWork;
const documents = new PgDocumentRepository();
const links = new PgAttachmentLinkRepository();
const usage = new PgStorageUsageRepository();
const AT = '2026-10-29T14:00:00.000Z';

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow.run(ws, fn));

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const sha = (n: number): string => n.toString(16).padStart(64, '0');

function requested(ws: string, n: number, name = `doc-${n}.pdf`): Document {
  const id = randomUUID();
  return Document.request({
    id,
    workspaceId: ws,
    declared: validateDeclaration(
      {
        fileName: name,
        contentType: 'application/pdf',
        sizeBytes: 1000 + n,
        sha256: sha(n),
        purpose: 'RECEIPT',
      },
      DEFAULT_UPLOAD_LIMITS,
    ),
    quarantineKey: quarantineKeyOf(ws, id),
    uploadExpiresAt: '2026-10-29T14:05:00.000Z',
    createdBy: user,
    at: AT,
  });
}

const accept = (doc: Document): void =>
  doc.accept(
    {
      detectedFormat: 'PDF',
      detectedContentType: 'application/pdf',
      objectKey: `ws/${doc.workspaceId}/documents/${doc.id}`,
      encryptedSizeBytes: 2000,
      keyId: 'k1',
      wrappedKey: Buffer.alloc(60, 7),
      scanStatus: 'NOT_SCANNED',
      scanEngine: null,
    },
    AT,
  );

/** Inserta, confirma y acepta un documento, guardando cada transición como lo hace el flujo real. */
async function makeAvailable(ws: string, n: number, name?: string): Promise<Document> {
  const doc = requested(ws, n, name);
  await inWs(ws, () => documents.insert(doc));
  doc.confirm(AT);
  expect(await inWs(ws, () => documents.save(doc))).toBe(true);
  accept(doc);
  expect(await inWs(ws, () => documents.save(doc))).toBe(true);
  return doc;
}

async function workspace(label: string): Promise<string> {
  const ws = randomUUID();
  await new PgUnitOfWork(app).run({ userId: user, workspaceId: ws }, async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws, label],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, user],
    );
  });
  return ws;
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 8 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgDocumentsUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/documents', $1, $2, 'U1') AS id`,
    [`sub-docs-${randomUUID()}`, `docs-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await new PgUnitOfWork(app).run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Docs', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    });
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgDocumentRepository', () => {
  it('round-trip con control optimista por versión; la clave envuelta se guarda como bytes', async () => {
    const doc = await makeAvailable(w1, 1);
    const stored = (await inWs(w1, () => documents.findById(w1, doc.id)))!;
    expect(stored.snapshot).toMatchObject({
      status: 'AVAILABLE',
      sizeBytes: 1001,
      sha256: sha(1),
      version: 3,
    });
    expect(Buffer.from(stored.snapshot.wrappedKey!).equals(Buffer.alloc(60, 7))).toBe(true);
    // Un cambio con la versión vieja pierde.
    const stale = Document.rehydrate(stored.snapshot);
    stale.archive(user, AT);
    const winner = Document.rehydrate(stored.snapshot);
    winner.archive(user, AT);
    expect(await inWs(w1, () => documents.save(winner))).toBe(true);
    expect(await inWs(w1, () => documents.save(stale))).toBe(false);
  });

  it('[TC-DOCUMENTS-ATTACH-007] solo un documento AVAILABLE por suma y workspace (índice único parcial); otro workspace puede repetirla', async () => {
    await makeAvailable(w1, 2);
    const other = requested(w1, 2, 'copia.pdf');
    await inWs(w1, () => documents.insert(other));
    other.confirm(AT);
    expect(await inWs(w1, () => documents.save(other))).toBe(true);
    accept(other);
    expect(await sqlState(() => inWs(w1, () => documents.save(other)))).toBe('23505');
    expect((await inWs(w1, () => documents.findAvailableBySha256(w1, sha(2))))?.id).toBeDefined();
    const c = requested(w2, 2);
    await inWs(w2, () => documents.insert(c));
    expect(await inWs(w2, () => documents.findAvailableBySha256(w2, sha(2)))).toBeNull();
  });

  it('los CHECK de coherencia impiden un AVAILABLE sin clave, un REJECTED sin motivo y una clave sin su identificador', async () => {
    const doc = requested(w1, 3);
    await inWs(w1, () => documents.insert(doc));
    const client = await app.connect();
    try {
      for (const sql of [
        `UPDATE documents.document SET status = 'AVAILABLE' WHERE id = $1`,
        `UPDATE documents.document SET status = 'REJECTED' WHERE id = $1`,
        `UPDATE documents.document SET key_id = 'k1' WHERE id = $1`,
      ]) {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
          [user, w1],
        );
        expect(await sqlState(() => client.query(sql, [doc.id])), sql).toBe('23514');
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
    }
  });

  it('aislamiento entre workspaces y RLS fail-closed: sin contexto PF002 y con otro workspace no ve filas', async () => {
    const doc = requested(w1, 4);
    await inWs(w1, () => documents.insert(doc));
    expect(await inWs(w2, () => documents.findById(w2, doc.id))).toBeNull();
    expect(await inWs(w2, () => documents.findById(w1, doc.id))).toBeNull();
    const client = await app.connect();
    try {
      for (const table of ['documents.document', 'documents.attachment_link', 'documents.storage_usage']) {
        expect(await sqlState(() => client.query(`SELECT count(*) FROM ${table}`)), table).toBe('PF002');
      }
    } finally {
      client.release();
    }
  });

  it('listado: por defecto solo documentos usables; filtra por destino, pagina por cursor y rechaza un cursor inválido', async () => {
    const ws = await workspace('Lista');
    const made: Document[] = [];
    for (let i = 0; i < 5; i += 1) made.push(await makeAvailable(ws, 100 + i));
    await inWs(ws, () => documents.insert(requested(ws, 200)));
    expect((await inWs(ws, () => documents.list(ws, {}))).items).toHaveLength(5);
    expect((await inWs(ws, () => documents.list(ws, { status: 'PENDING_UPLOAD' }))).items).toHaveLength(1);
    const page1 = await inWs(ws, () => documents.list(ws, { limit: 2 }));
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await inWs(ws, () => documents.list(ws, { limit: 2, cursor: page1.nextCursor! }));
    expect(page2.items).toHaveLength(2);
    expect(page2.items.map((d) => d.id)).not.toContain(page1.items[0]!.id);
    const target = randomUUID();
    const first = made[0]!;
    await inWs(ws, () =>
      links.insert({
        id: randomUUID(),
        workspaceId: ws,
        documentId: first.id,
        targetType: 'ACCOUNT',
        targetId: target,
        createdBy: user,
        createdAt: AT,
      }),
    );
    const onTarget = await inWs(ws, () => documents.list(ws, { target: { type: 'ACCOUNT', id: target } }));
    expect(onTarget.items.map((d) => d.id)).toEqual([first.id]);
    expect(await sqlState(() => inWs(ws, () => documents.list(ws, { cursor: 'no-es-un-cursor' })))).toBe(
      'INVALID_CURSOR',
    );
  });
});

describe('PgAttachmentLinkRepository', () => {
  it('vínculo único por documento y destino; contar, listar por documento y borrar', async () => {
    const doc = await makeAvailable(w1, 10);
    const target = randomUUID();
    const link = (id = randomUUID()) => ({
      id,
      workspaceId: w1,
      documentId: doc.id,
      targetType: 'TRANSACTION' as const,
      targetId: target,
      createdBy: user,
      createdAt: AT,
    });
    await inWs(w1, () => links.insert(link()));
    expect(await sqlState(() => inWs(w1, () => links.insert(link())))).toBe('23505');
    expect(await inWs(w1, () => links.countOf(w1, doc.id))).toBe(1);
    expect(
      (await inWs(w1, () => links.lockTarget(w1, 'TRANSACTION', target))).map((l) => l.documentId),
    ).toEqual([doc.id]);
    const found = await inWs(w1, () => links.find(w1, doc.id, 'TRANSACTION', target));
    expect(found).not.toBeNull();
    await inWs(w1, () => links.delete(w1, found!.id));
    expect(await inWs(w1, () => links.countOf(w1, doc.id))).toBe(0);
  });

  it('un destino de tipo no soportado se rechaza con el CHECK de la tabla', async () => {
    const doc = await makeAvailable(w1, 11);
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [user, w1],
      );
      expect(
        await sqlState(() =>
          client.query(
            `INSERT INTO documents.attachment_link (id, workspace_id, document_id, target_type, target_id, created_by)
             VALUES ($1, $2, $3, 'GOAL', $4, $5)`,
            [randomUUID(), w1, doc.id, randomUUID(), user],
          ),
        ),
      ).toBe('23514');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});

describe('PgStorageUsageRepository', () => {
  it('el candado de fila serializa las solicitudes concurrentes del mismo workspace (cada tarea con su conexión)', async () => {
    const ws = await workspace('Cuota');
    const reserve = (): Promise<number> =>
      inWs(ws, async () => {
        const current = await usage.lock(ws);
        await new Promise((r) => setTimeout(r, 60));
        await usage.save(
          ws,
          {
            ...current,
            reservedBytes: current.reservedBytes + 1000,
            pendingUploads: current.pendingUploads + 1,
          },
          AT,
        );
        return current.reservedBytes;
      });
    const seen = await Promise.all([reserve(), reserve(), reserve()]);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1000, 2000]);
    expect(await inWs(ws, () => usage.read(ws))).toEqual({
      usedBytes: 0,
      reservedBytes: 3000,
      pendingUploads: 3,
    });
  });

  it('recompute suma los documentos por estado', async () => {
    const ws = await workspace('Recalculo');
    await makeAvailable(ws, 300);
    await inWs(ws, () => documents.insert(requested(ws, 301)));
    const recomputed = await inWs(ws, () => usage.recompute(ws));
    expect(recomputed).toEqual({ usedBytes: 1300, reservedBytes: 1301, pendingUploads: 1 });
  });
});

describe('PgMaintenanceScan (pf_maintenance)', () => {
  it('encuentra candidatos entre workspaces sin contexto y sin acceso a la clave envuelta', async () => {
    const scan = new PgMaintenanceScan(uow);
    const expired = await scan.expiredPending('2026-12-31T00:00:00.000Z');
    expect(expired.length).toBeGreaterThan(0);
    expect(new Set(expired.map((r) => r.workspaceId))).toContain(w1);
    expect(await scan.keyIdsInUse()).toContain('k1');
    expect((await scan.workspacesWithDocuments()).length).toBeGreaterThanOrEqual(2);
    expect((await scan.withOtherKey('k2', 10)).length).toBeGreaterThan(0);
    const referenced = await scan.referencedObjectKeys(w1);
    expect(referenced.size).toBeGreaterThan(0);
    expect([...referenced].every((k) => k.startsWith(`ws/${w1}/documents/`))).toBe(true);
    // Una purga candidata: disponible, sin vínculos y sin archivar desde antes del corte.
    const candidates = await scan.unlinkedCandidates('2027-01-01T00:00:00.000Z');
    expect(candidates.length).toBeGreaterThan(0);
    // El rol de mantenimiento no puede leer la clave envuelta ni el nombre, ni escribir.
    const client = await app.connect();
    try {
      for (const sql of [
        'SELECT wrapped_key FROM documents.document LIMIT 1',
        'SELECT original_name FROM documents.document LIMIT 1',
        'SELECT object_key FROM documents.document LIMIT 1',
        'UPDATE documents.document SET status = status',
        'DELETE FROM documents.attachment_link',
      ]) {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE pf_maintenance');
        expect(await sqlState(() => client.query(sql)), sql).toBe('42501');
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
    }
  });
});
