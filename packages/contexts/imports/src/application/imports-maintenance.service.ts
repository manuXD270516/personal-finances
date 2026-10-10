import type { AuditActorDto, AuditEntry } from '@pf/audit/contracts';
import { Instant } from '@pf/shared-kernel';
import { IMPORTS_EXPIRE_JOB } from '../contracts/index.js';
import type { ImportsDeps } from './ports/index.js';

/** Tamaño de página al barrer jobs por workspace. */
const SWEEP_PAGE = 100;

export interface MaintenanceResult {
  readonly expired: number;
  readonly purged: number;
}

/**
 * Jobs diarios de IMPORTS (decisión 15 de add-basic-csv-import):
 *  - `imports.expire-reviews`: cancela (actor `SYSTEM`, auditado) las importaciones que siguen esperando mapeo o
 *    revisión pasado `IMPORT_REVIEW_TTL` (30 días) y descarta sus celdas crudas.
 *  - `imports.purge-staging`: borra las filas del staging de las importaciones terminadas (`COMPLETED*`) o canceladas
 *    hace más de `IMPORT_STAGING_RETENTION` (90 días). Se conservan el job (conteos, mapeo, checksum) y los vínculos
 *    de idempotencia: reimportar el mismo archivo sigue dando 0 nuevas. Es un dato técnico derivado, no financiero.
 * Ambos son idempotentes: repetirlos o correrlos en paralelo no tiene efecto adicional.
 */
export class ImportsMaintenanceService {
  constructor(private readonly deps: ImportsDeps) {}

  private audit(entry: AuditEntry): Promise<void> {
    return this.deps.audit.append(entry);
  }

  async runWorkspace(workspaceId: string): Promise<MaintenanceResult> {
    const expired = await this.expireReviews(workspaceId);
    const purged = await this.purgeStaging(workspaceId);
    return { expired, purged };
  }

  async expireReviews(workspaceId: string): Promise<number> {
    const { deps } = this;
    const actor: AuditActorDto = { type: 'SYSTEM', process: IMPORTS_EXPIRE_JOB };
    let expired = 0;
    for (;;) {
      const now = deps.clock.now().toString();
      const ids = await deps.uow.run(workspaceId, () =>
        deps.jobs.expiredReviews(workspaceId, now, SWEEP_PAGE),
      );
      if (ids.length === 0) break;
      let progressed = 0;
      for (const id of ids) {
        progressed += await deps.uow.run(workspaceId, async () => {
          const job = await deps.jobs.findById(workspaceId, id, { lock: 'update' });
          const s = job?.state;
          if (!job || !s || (s.status !== 'AWAITING_MAPPING' && s.status !== 'AWAITING_REVIEW')) return 0;
          if (s.expiresAt === null || Instant.parse(s.expiresAt).epochMillis > Instant.parse(now).epochMillis)
            return 0;
          job.cancel({ actor: { type: 'SYSTEM' }, now });
          if (!(await deps.jobs.save(job))) return 0;
          job.markPersisted();
          await deps.staging.deleteAll(workspaceId, id);
          await this.audit({
            workspaceId,
            action: 'imports.import.expired',
            aggregateType: 'ImportJob',
            aggregateId: id,
            aggregateVersion: job.state.version,
            actor,
            origin: 'system',
            changes: [{ field: 'status', before: s.status, after: 'CANCELLED' }],
          });
          return 1;
        });
      }
      expired += progressed;
      if (progressed === 0 || ids.length < SWEEP_PAGE) break;
    }
    return expired;
  }

  async purgeStaging(workspaceId: string): Promise<number> {
    const { deps } = this;
    const cutoff = deps.clock.now().plusMillis(-deps.settings.stagingRetentionMs).toString();
    let purged = 0;
    for (;;) {
      const ids = await deps.uow.run(workspaceId, () => deps.jobs.purgeable(workspaceId, cutoff, SWEEP_PAGE));
      if (ids.length === 0) break;
      for (const id of ids) {
        purged += await deps.uow.run(workspaceId, () => deps.staging.deleteAll(workspaceId, id));
      }
      // `purgeable` solo devuelve jobs que aún tienen filas: tras borrarlas dejan de aparecer.
      if (ids.length < SWEEP_PAGE) break;
    }
    return purged;
  }
}
