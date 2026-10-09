import { createHash } from 'node:crypto';
import { isSecurityAction } from '../../domain/audit-action-category.js';
import type { AuditRecord } from '../../domain/audit-record.js';
import { lifecycleEntry, type LifecycleEntry } from '../../domain/lifecycle-entry.js';
import type {
  AuditAmbient,
  AuditEnvironment,
  AuditLogPageQuery,
  AuditLogStore,
  IdGenerator,
  IpHasher,
  LifecycleBackfillSource,
  LifecycleStore,
  ReadUnitOfWork,
  WorkspaceTimeZones,
} from '../ports/index.js';

/**
 * Dobles en memoria de los puertos de AUDIT para tests de aplicación. La "unidad de trabajo" es un flag: el almacén
 * descarta lo escrito si la función de la unidad lanza (rollback), igual que la transacción real.
 */
export class InMemoryAudit
  implements AuditEnvironment, AuditLogStore, ReadUnitOfWork, LifecycleStore, LifecycleBackfillSource
{
  readonly rows: AuditRecord[] = [];
  /** Filas de `audit.lifecycle_transition` (append-only; UNIQUE por agregado + sequence como la tabla). */
  readonly lifecycle: LifecycleEntry[] = [];
  failLifecycleInserts = false;
  ambientContext: AuditAmbient = {};
  /** Workspace del contexto RLS de la unidad en curso (`null` fuera de una). */
  private rlsWorkspace: string | null = null;
  private depth = 0;
  failInserts = false;

  ambient(): AuditAmbient {
    return this.ambientContext;
  }

  inUnitOfWork(): boolean {
    return this.depth > 0;
  }

  async run<T>(ctx: { workspaceId: string | null }, fn: () => Promise<T>): Promise<T> {
    const snapshot = this.rows.length;
    const lifecycleSnapshot = this.lifecycle.length;
    const previous = this.rlsWorkspace;
    this.depth += 1;
    this.rlsWorkspace = ctx.workspaceId;
    try {
      return await fn();
    } catch (err) {
      if (this.depth === 1) {
        this.rows.length = snapshot;
        this.lifecycle.length = lifecycleSnapshot;
      }
      throw err;
    } finally {
      this.depth -= 1;
      this.rlsWorkspace = previous;
    }
  }

  private async insertAudit(record: AuditRecord): Promise<void> {
    if (this.failInserts) throw new Error('audit store unavailable (fault injected)');
    if (record.workspaceId !== this.rlsWorkspace) throw new Error('RLS: workspace mismatch');
    this.rows.push(record);
  }

  async page(q: AuditLogPageQuery): Promise<readonly AuditRecord[]> {
    if (this.rlsWorkspace === null) throw new Error('PF002: workspace context not set');
    const key = (r: AuditRecord) => `${r.occurredAt.toString()}|${r.id}`;
    const after = q.after ? `${new Date(q.after.occurredAt).toISOString()}|${q.after.id}` : undefined;
    return this.rows
      .filter((r) => r.workspaceId === this.rlsWorkspace && r.workspaceId === q.workspaceId)
      .filter(
        (r) =>
          q.entities.length === 0 ||
          q.entities.some((e) => e.aggregateType === r.aggregateType && e.aggregateId === r.aggregateId),
      )
      .filter((r) => q.aggregateType === undefined || r.aggregateType === q.aggregateType)
      .filter((r) => q.actorUserId === undefined || r.actor.userId === q.actorUserId)
      .filter((r) => q.actions === undefined || q.actions.includes(r.action))
      .filter((r) => q.origin === undefined || r.origin === q.origin)
      .filter((r) => q.correlationId === undefined || r.correlationId === q.correlationId)
      .filter(
        (r) => q.category === undefined || isSecurityAction(r.action) === (q.category.kind === 'SECURITY'),
      )
      .filter((r) => !q.from || r.occurredAt.epochMillis >= q.from.getTime())
      .filter((r) => !q.to || r.occurredAt.epochMillis < q.to.getTime())
      .filter((r) => !after || (q.ascending ? key(r) > after : key(r) < after))
      .sort((a, b) => (q.ascending ? 1 : -1) * key(a).localeCompare(key(b)))
      .slice(0, q.limit);
  }

  // ------------------------------------------------------------------ LifecycleStore

  async nextSequence(workspaceId: string, aggregateType: string, aggregateId: string): Promise<number> {
    const own = this.lifecycle.filter(
      (e) =>
        e.workspaceId === workspaceId && e.aggregateType === aggregateType && e.aggregateId === aggregateId,
    );
    return own.reduce((max, e) => Math.max(max, e.sequence), 0) + 1;
  }

  async insert(entry: AuditRecord | LifecycleEntry): Promise<void> {
    if ('sequence' in entry) return this.insertLifecycle(entry);
    return this.insertAudit(entry);
  }

  /** Inserciones multi-fila: todo o nada, como una sola sentencia SQL. */
  async insertMany(entries: readonly (AuditRecord | LifecycleEntry)[]): Promise<void> {
    const audit = this.rows.length;
    const lifecycle = this.lifecycle.length;
    try {
      for (const e of entries) await this.insert(e);
    } catch (err) {
      this.rows.length = audit;
      this.lifecycle.length = lifecycle;
      throw err;
    }
  }

  async nextSequences(
    workspaceId: string,
    aggregates: readonly { readonly aggregateType: string; readonly aggregateId: string }[],
  ): Promise<readonly number[]> {
    return Promise.all(aggregates.map((a) => this.nextSequence(workspaceId, a.aggregateType, a.aggregateId)));
  }

  private async insertLifecycle(entry: LifecycleEntry): Promise<void> {
    if (this.failLifecycleInserts) throw new Error('lifecycle store unavailable (fault injected)');
    if (entry.workspaceId !== this.rlsWorkspace) throw new Error('RLS: workspace mismatch');
    // Igual que la tabla: CHECKs del dominio, UNIQUE (workspace, agregado, sequence).
    const valid = lifecycleEntry(entry);
    const clash = this.lifecycle.some(
      (e) =>
        e.workspaceId === valid.workspaceId &&
        e.aggregateType === valid.aggregateType &&
        e.aggregateId === valid.aggregateId &&
        e.sequence === valid.sequence,
    );
    if (clash) throw Object.assign(new Error('duplicate lifecycle sequence'), { code: '23505' });
    this.lifecycle.push(valid);
  }

  async entriesOf(
    workspaceId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<readonly LifecycleEntry[]> {
    if (this.rlsWorkspace === null) throw new Error('PF002: workspace context not set');
    return this.lifecycle
      .filter(
        (e) =>
          e.workspaceId === this.rlsWorkspace &&
          e.workspaceId === workspaceId &&
          e.aggregateType === aggregateType &&
          e.aggregateId === aggregateId,
      )
      .sort((a, b) => a.sequence - b.sequence);
  }

  // ------------------------------------------------------------------ LifecycleBackfillSource

  async aggregatesWithoutLifecycle(
    input: Parameters<LifecycleBackfillSource['aggregatesWithoutLifecycle']>[0],
  ) {
    if (this.rlsWorkspace !== input.workspaceId) throw new Error('RLS: workspace mismatch');
    const covered = new Set(this.lifecycle.map((e) => e.auditLogId));
    const keys = new Map<string, { aggregateType: string; aggregateId: string }>();
    for (const r of this.rows) {
      if (r.workspaceId !== input.workspaceId || !input.aggregateTypes.includes(r.aggregateType)) continue;
      if (covered.has(r.id)) continue;
      if (input.afterAggregateId !== null && r.aggregateId <= input.afterAggregateId) continue;
      keys.set(`${r.aggregateId}|${r.aggregateType}`, {
        aggregateType: r.aggregateType,
        aggregateId: r.aggregateId,
      });
    }
    return [...keys.values()]
      .sort((a, b) => a.aggregateId.localeCompare(b.aggregateId))
      .slice(0, input.limit);
  }

  async auditOf(workspaceId: string, aggregateType: string, aggregateId: string) {
    return this.page({
      workspaceId,
      entities: [{ aggregateType, aggregateId }],
      ascending: true,
      limit: 10_000,
    });
  }
}

export const sha256IpHasher: IpHasher = {
  hash: (ip) => new Uint8Array(createHash('sha256').update(`test:${ip}`).digest()),
};

/** UUIDs secuenciales con forma de UUIDv7 (ordenables). */
export function sequentialIds(prefix = '0190a000-0000-7000-8000-'): IdGenerator {
  let n = 0;
  return { next: () => `${prefix}${(++n).toString(16).padStart(12, '0')}` };
}

export const fixedTimeZones = (timeZone: string): WorkspaceTimeZones => ({
  timeZoneOf: async () => timeZone,
});
