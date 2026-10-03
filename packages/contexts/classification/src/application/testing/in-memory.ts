import type { AuditEntry } from '@pf/audit/contracts';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Category, CategoryGroup } from '../../domain/category.js';
import { Counterparty } from '../../domain/counterparty.js';
import { Tag } from '../../domain/tag.js';
import type {
  CategoryArchivedEvent,
  ClassificationDeps,
  DefaultCatalog,
  Repository,
  RlsContext,
} from '../ports/index.js';

interface Persistable {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
}

/** Repositorio en memoria: guarda snapshots (leer devuelve copias; los cambios no persisten sin `update`). */
class MemoryRepo<T extends Persistable, S> implements Repository<T> {
  readonly rows = new Map<string, S>();
  constructor(
    private readonly snap: (t: T) => S,
    private readonly restore: (s: S) => T,
  ) {}

  async findById(workspaceId: string, id: string): Promise<T | null> {
    const s = this.rows.get(id);
    if (!s) return null;
    const t = this.restore(s);
    return t.workspaceId === workspaceId ? t : null;
  }

  async listAll(workspaceId: string): Promise<T[]> {
    return [...this.rows.values()].map((s) => this.restore(s)).filter((t) => t.workspaceId === workspaceId);
  }

  async insert(item: T): Promise<void> {
    if (this.rows.has(item.id)) throw new Error('duplicate id');
    this.rows.set(item.id, this.snap(item));
  }

  async update(item: T, expectedVersion: number): Promise<boolean> {
    const s = this.rows.get(item.id);
    if (!s || this.restore(s).version !== expectedVersion) return false;
    this.rows.set(item.id, this.snap(item));
    return true;
  }
}

/**
 * Fakes en memoria de los puertos de CLASSIFICATION para tests de aplicación. La "transacción" hace snapshot del
 * estado (repos, outbox, auditoría) y lo restaura si `fn` lanza (todo o nada, como la UnitOfWork real).
 */
export class InMemoryClassification {
  readonly clock = new FixedClock(Instant.parse('2026-10-03T12:00:00Z'));
  readonly groups = new MemoryRepo<CategoryGroup, ReturnType<CategoryGroup['snapshot']>>(
    (g) => g.snapshot(),
    (s) => CategoryGroup.restore(s),
  );
  readonly categories = new MemoryRepo<Category, ReturnType<Category['snapshot']>>(
    (c) => c.snapshot(),
    (s) => Category.restore(s),
  );
  readonly tags = new MemoryRepo<Tag, ReturnType<Tag['snapshot']>>(
    (t) => t.snapshot(),
    (s) => Tag.restore(s),
  );
  readonly counterparties = new MemoryRepo<Counterparty, ReturnType<Counterparty['snapshot']>>(
    (c) => c.snapshot(),
    (s) => Counterparty.restore(s),
  );
  readonly events: CategoryArchivedEvent[] = [];
  readonly audits: AuditEntry[] = [];
  readonly contexts: RlsContext[] = [];
  readonly lastUsed = new Map<string, string>();
  private seq = 0;
  private depth = 0;

  constructor(private readonly catalogs: readonly DefaultCatalog[] = []) {}

  nextId(): string {
    this.seq += 1;
    return `0190b000-0000-7000-8000-${this.seq.toString(16).padStart(12, '0')}`;
  }

  deps(): ClassificationDeps {
    const repos = [this.groups, this.categories, this.tags, this.counterparties] as const;
    return {
      uow: {
        run: async <T>(ctx: RlsContext, fn: () => Promise<T>): Promise<T> => {
          this.contexts.push(ctx);
          if (this.depth > 0) return fn();
          const saved = repos.map((r) => new Map(r.rows as Map<string, unknown>));
          const ev = this.events.length;
          const au = this.audits.length;
          this.depth += 1;
          try {
            return await fn();
          } catch (err) {
            repos.forEach((r, i) => {
              (r.rows as Map<string, unknown>).clear();
              for (const [k, v] of saved[i] as Map<string, unknown>)
                (r.rows as Map<string, unknown>).set(k, v);
            });
            this.events.length = ev;
            this.audits.length = au;
            throw err;
          } finally {
            this.depth -= 1;
          }
        },
      },
      groups: this.groups,
      categories: this.categories,
      tags: this.tags,
      counterparties: this.counterparties,
      outbox: { append: async (e) => void this.events.push(e) },
      audit: {
        append: async (a) => {
          if (this.depth === 0) throw new Error('AUDIT_OUTSIDE_UNIT_OF_WORK');
          this.audits.push(a);
        },
      },
      lastCategoryUsed: {
        lastCategoryUsed: async ({ counterpartyId, kind }) =>
          this.lastUsed.get(`${counterpartyId}:${kind}`) ?? null,
      },
      catalogs: { get: (v) => this.catalogs.find((c) => c.version === v) ?? null },
      ids: { next: () => this.nextId() },
      clock: this.clock,
    };
  }
}
