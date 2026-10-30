import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { IMPORTS_EVENTS } from '../contracts/index.js';
import {
  assertRevertAllowed,
  planRevert,
  type BlockedItem,
  type ImportJob,
  type RevertCandidate,
  type RevertPlan,
} from '../domain/index.js';
import { publishJobEvent, recordJob, SYSTEM_ACTOR } from './job-recorder.js';
import type { ImportsDeps, RevertLink } from './ports/index.js';
import { toJobView, type ImportJobView } from './views.js';

/** Transacciones por llamada de `voidBatch` al deshacer (decisión 15). */
export const REVERT_BATCH = 200;

export interface RevertPreviewView {
  readonly toVoid: number;
  readonly alreadyVoided: number;
  readonly blocked: readonly BlockedItem[];
  /** Transacciones que el usuario editó después del import (se anulan igual). */
  readonly editedAfterImport: number;
}

const REVERTIBLE = [
  'COMPLETED',
  'COMPLETED_WITH_DIFFERENCE',
  'COMPLETED_WITH_ERRORS',
  'PARTIALLY_ROLLED_BACK',
];

/**
 * Deshacer un import (openspec add-import-pipeline decisión 15; FR-IMPORTS-012): vista previa (qué se anula, qué ya
 * estaba anulado y qué está bloqueado por reconciliación o periodo cerrado), solicitud (`REVERTING` + evento) y
 * procesamiento en el worker (lotes de 200 con reversa exacta, INV-008; idempotente; sin borrar nada). TODO O NADA por
 * omisión (D328): con bloqueadas y sin deshacer parcial explícito se rechaza con `IMPORT_REVERT_BLOCKED`.
 */
export class RevertImportService {
  constructor(private readonly deps: ImportsDeps) {}

  private async plan(
    workspaceId: string,
    job: ImportJob,
  ): Promise<{ plan: RevertPlan; links: readonly RevertLink[] }> {
    const { deps } = this;
    const links = await deps.links.activeByJob(workspaceId, job.id);
    const created = links.filter((l) => l.kind === 'CREATED');
    const statuses = created.length
      ? await deps.statuses.statusOf({ workspaceId, transactionIds: created.map((l) => l.transactionId) })
      : [];
    const statusOf = new Map(statuses.map((s) => [s.transactionId, s.status] as const));
    const closed = await deps.periods.listClosed(workspaceId);
    const candidates: RevertCandidate[] = created.map((l) => ({
      rowId: l.rowId ?? l.linkId,
      lineNumber: l.lineNumber ?? 0,
      transactionId: l.transactionId,
      status: (statusOf.get(l.transactionId) ?? 'VOIDED') as RevertCandidate['status'],
      inClosedPeriod:
        l.bookingDate !== null &&
        closed.some((p) => p.start <= (l.bookingDate as string) && (l.bookingDate as string) <= p.end),
      editedAfterImport: false,
    }));
    return { plan: planRevert(candidates), links };
  }

  preview(workspaceId: string, importId: string): Promise<RevertPreviewView> {
    return this.deps.uow.run(workspaceId, async () => {
      const job = await this.deps.jobs.findById(workspaceId, importId);
      if (!job) throw new DomainError('RESOURCE_NOT_FOUND', `import ${importId} not found`);
      if (!REVERTIBLE.includes(job.state.status) && job.state.status !== 'REVERTING') {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `an import in ${job.state.status} has nothing to revert`,
        );
      }
      const { plan } = await this.plan(workspaceId, job);
      return {
        toVoid: plan.toVoid.length,
        alreadyVoided: plan.alreadyVoided.length,
        blocked: plan.blocked,
        editedAfterImport: plan.editedAfterImport,
      };
    });
  }

  /** `RevertImport`: pasa a `REVERTING`, audita al usuario y publica `imports.ImportRevertRequested.v1`. */
  revert(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly expectedVersion: number;
    readonly allowPartial: boolean;
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await deps.jobs.findById(cmd.workspaceId, cmd.importId, { lock: 'update' });
      if (!job) throw new DomainError('RESOURCE_NOT_FOUND', `import ${cmd.importId} not found`);
      if (job.state.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: job.state.version },
        });
      }
      if (!REVERTIBLE.includes(job.state.status)) {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `an import in ${job.state.status} cannot be reverted`,
        );
      }
      const { plan } = await this.plan(cmd.workspaceId, job);
      assertRevertAllowed(plan, cmd.allowPartial);
      const before = job.state.status;
      job.requestRevert({
        userId: cmd.userId,
        allowPartial: cmd.allowPartial,
        requested: plan.toVoid.length,
        blocked: plan.blocked.length,
        now: deps.clock.now().toString(),
      });
      if (!(await deps.jobs.save(job))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
      }
      job.markPersisted();
      const event = await publishJobEvent(deps, job, IMPORTS_EVENTS.revertRequested, {
        allowPartial: cmd.allowPartial,
        toVoid: plan.toVoid.length,
        blocked: plan.blocked.length,
      });
      const changes: AuditChangeInput[] = [
        { field: 'status', before, after: 'REVERTING' },
        { field: 'allowPartial', before: null, after: cmd.allowPartial },
        { field: 'voided', before: null, after: plan.toVoid.length },
        { field: 'blocked', before: null, after: plan.blocked.length },
      ];
      await recordJob(deps, job, 'revert_requested', { events: [event], changes });
      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      return toJobView(job.state, account?.currency ?? '');
    });
  }

  /** `ProcessRevert` (consumidor `imports.persist`): anula por lotes de 200; idempotente ante reentregas. */
  async process(input: {
    readonly workspaceId: string;
    readonly importId: string;
  }): Promise<'DONE' | 'SKIPPED'> {
    const { deps } = this;
    const { workspaceId, importId } = input;
    const started = await deps.uow.run(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, importId);
      if (!job || job.state.status !== 'REVERTING') return null;
      const { plan } = await this.plan(workspaceId, job);
      return { state: job.state, plan };
    });
    if (!started) return 'SKIPPED';

    const actor = started.state.revert?.requestedBy ?? started.state.createdBy;
    const ids = started.plan.toVoid.map((c) => c.transactionId);
    const blockedAtRuntime = new Set<string>();
    for (let i = 0; i < ids.length; i += REVERT_BATCH) {
      const chunk = ids.slice(i, i + REVERT_BATCH);
      await deps.uow.runDetached(workspaceId, async () => {
        const result = await deps.imported.voidBatch({
          workspaceId,
          accountId: started.state.accountId,
          importJobId: importId,
          actorUserId: actor,
          transactionIds: chunk,
          reason: 'IMPORT_REVERTED',
          allowBlocked: true,
        });
        for (const b of result.blocked) blockedAtRuntime.add(b.transactionId);
        const job = await deps.jobs.findById(workspaceId, importId, { lock: 'update' });
        if (!job) return;
        job.recordRevertBatch({
          voided: result.voided.length,
          alreadyVoided: result.alreadyVoided.length,
          now: deps.clock.now().toString(),
        });
        if (!(await deps.jobs.save(job))) {
          throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
        }
        job.markPersisted();
      });
    }

    await deps.uow.runDetached(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, importId, { lock: 'update' });
      if (!job || job.state.status !== 'REVERTING') return;
      const keep = [...started.plan.blocked.map((b) => b.transactionId), ...blockedAtRuntime];
      // Los vínculos de lo anulado (y los fusionados) dejan de bloquear: reimportar vuelve a crear las filas.
      await deps.links.supersedeByJob(workspaceId, importId, deps.clock.now().toString(), keep);
      const blocked = started.plan.blocked.length + blockedAtRuntime.size;
      const before = job.state.status;
      const status = job.finishRevert({ blocked, now: deps.clock.now().toString() });
      if (!(await deps.jobs.save(job))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
      }
      job.markPersisted();
      const event = await publishJobEvent(deps, job, IMPORTS_EVENTS.reverted, {
        voided: job.state.revert?.voided ?? 0,
        alreadyVoided: job.state.revert?.alreadyVoided ?? 0,
        blocked,
        status,
      });
      await recordJob(deps, job, 'reverted', {
        actor: SYSTEM_ACTOR,
        events: [event],
        changes: [
          { field: 'status', before, after: status },
          { field: 'voided', before: null, after: job.state.revert?.voided ?? 0 },
          { field: 'blocked', before: null, after: blocked },
        ],
      });
    });
    return 'DONE';
  }
}
