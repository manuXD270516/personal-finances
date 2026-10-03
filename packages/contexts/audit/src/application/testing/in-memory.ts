import { createHash } from 'node:crypto';
import type { AuditRecord } from '../../domain/audit-record.js';
import type {
  AuditAmbient,
  AuditEnvironment,
  AuditLogPageQuery,
  AuditLogStore,
  IdGenerator,
  IpHasher,
  ReadUnitOfWork,
  WorkspaceTimeZones,
} from '../ports/index.js';

/**
 * Dobles en memoria de los puertos de AUDIT para tests de aplicación. La "unidad de trabajo" es un flag: el almacén
 * descarta lo escrito si la función de la unidad lanza (rollback), igual que la transacción real.
 */
export class InMemoryAudit implements AuditEnvironment, AuditLogStore, ReadUnitOfWork {
  readonly rows: AuditRecord[] = [];
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
    const previous = this.rlsWorkspace;
    this.depth += 1;
    this.rlsWorkspace = ctx.workspaceId;
    try {
      return await fn();
    } catch (err) {
      if (this.depth === 1) this.rows.length = snapshot;
      throw err;
    } finally {
      this.depth -= 1;
      this.rlsWorkspace = previous;
    }
  }

  async insert(record: AuditRecord): Promise<void> {
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
      .filter((r) => !q.from || r.occurredAt.epochMillis >= q.from.getTime())
      .filter((r) => !q.to || r.occurredAt.epochMillis < q.to.getTime())
      .filter((r) => !after || (q.ascending ? key(r) > after : key(r) < after))
      .sort((a, b) => (q.ascending ? 1 : -1) * key(a).localeCompare(key(b)))
      .slice(0, q.limit);
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
