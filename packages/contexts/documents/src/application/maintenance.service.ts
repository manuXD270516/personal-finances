import type { AuditActorDto } from '@pf/audit/contracts';
import { release } from '../domain/storage-quota.js';
import type { DocumentsService } from './documents.service.js';
import type { DocumentRef, DocumentsDeps } from './ports/index.js';
import { quarantineKeyOf } from './ports/index.js';
import { documentChanges, documentEntry, documentSteps, publishRejected, systemActor } from './recorder.js';
import { persist } from './support.js';
import type { UploadsService } from './uploads.service.js';

export interface MaintenanceReport {
  readonly job: string;
  readonly examined: number;
  readonly affected: number;
  readonly failed: number;
}

const JOBS = {
  expire: 'documents.expire-pending-uploads',
  recover: 'documents.recover-stuck-uploads',
  quarantine: 'documents.sweep-quarantine',
  purge: 'documents.purge-unlinked',
  orphans: 'documents.sweep-orphan-objects',
  rewrap: 'documents.rewrap-keys',
  usage: 'documents.recompute-usage',
} as const;

/**
 * Jobs del worker (design decisión 10), todos idempotentes y reintentables: los candidatos se encuentran SIN contexto
 * de workspace con el rol `pf_maintenance` (política `retention_scan`, D308–D310) y cada mutación corre en su propia
 * unidad de trabajo con `SET LOCAL app.workspace_id`. Un documento que falla no detiene a los demás. Los logs llevan
 * solo conteos (NFR-SEC-015).
 */
export class MaintenanceService {
  constructor(
    private readonly deps: DocumentsDeps,
    private readonly uploads: UploadsService,
    private readonly documents: DocumentsService,
  ) {}

  private async each(
    job: string,
    refs: readonly DocumentRef[],
    step: (ref: DocumentRef) => Promise<boolean>,
  ): Promise<MaintenanceReport> {
    let affected = 0;
    let failed = 0;
    for (const ref of refs) {
      try {
        if (await step(ref)) affected += 1;
      } catch {
        failed += 1;
      }
    }
    return { job, examined: refs.length, affected, failed };
  }

  /** `PENDING_UPLOAD` con plazo + gracia vencido ⇒ `REJECTED/UPLOAD_NOT_COMPLETED`, sin cuarentena y sin reserva. */
  async expirePendingUploads(): Promise<MaintenanceReport> {
    const { deps } = this;
    const before = deps.clock.now().plusMillis(-deps.settings.uploadGraceMs).toString();
    const refs = await deps.scan.expiredPending(before);
    return this.each(JOBS.expire, refs, async ({ workspaceId, documentId }) => {
      const actor: AuditActorDto = systemActor(JOBS.expire);
      const expired = await deps.uow.run(workspaceId, async () => {
        const doc = await deps.documents.findById(workspaceId, documentId, { lock: 'update' });
        if (!doc || doc.status !== 'PENDING_UPLOAD') return false;
        const snap = doc.snapshot;
        if (
          snap.uploadExpiresAt === null ||
          Date.parse(snap.uploadExpiresAt) + deps.settings.uploadGraceMs > deps.clock.now().epochMillis
        ) {
          return false;
        }
        const at = deps.clock.now().toString();
        doc.expire(at);
        await persist(deps, doc);
        const usage = await deps.usage.lock(workspaceId);
        await deps.usage.save(workspaceId, release(usage, snap.sizeBytes), at);
        const event = await publishRejected(deps, doc);
        await deps.lifecycle.record(
          documentEntry(doc, 'expired', documentChanges(snap, doc.snapshot), { actor }),
          documentSteps(doc, [event]),
        );
        return true;
      });
      if (expired) {
        await deps.storage.delete(deps.settings.quarantineBucket, quarantineKeyOf(workspaceId, documentId));
      }
      return expired;
    });
  }

  /** `UPLOADED` atascado (la API cayó a mitad) ⇒ reintenta la verificación con el mismo código. */
  async recoverStuckUploads(): Promise<MaintenanceReport> {
    const { deps } = this;
    const before = deps.clock.now().plusMillis(-deps.settings.stuckAfterMs).toString();
    const refs = await deps.scan.stuckUploads(before);
    return this.each(JOBS.recover, refs, async ({ workspaceId, documentId }) => {
      await this.uploads.completeUpload({ workspaceId, documentId, system: JOBS.recover });
      return true;
    });
  }

  /** Red de seguridad: ningún objeto permanece más de 24 h en la cuarentena. */
  async sweepQuarantine(): Promise<MaintenanceReport> {
    const { deps } = this;
    const cutoff = deps.clock.now().epochMillis - deps.settings.quarantineMaxAgeMs;
    let examined = 0;
    let affected = 0;
    let failed = 0;
    for await (const object of deps.storage.list(deps.settings.quarantineBucket, 'ws/')) {
      examined += 1;
      if (object.lastModified.getTime() >= cutoff) continue;
      try {
        await deps.storage.delete(deps.settings.quarantineBucket, object.key);
        affected += 1;
      } catch {
        failed += 1;
      }
    }
    return { job: JOBS.quarantine, examined, affected, failed };
  }

  /** Documentos disponibles, sin vínculos ni archivado desde hace más del plazo de retención ⇒ eliminados (`SYSTEM`). */
  async purgeUnlinkedDocuments(): Promise<MaintenanceReport> {
    const { deps } = this;
    const before = deps.clock.now().plusMillis(-deps.settings.unlinkedRetentionMs).toString();
    const refs = await deps.scan.unlinkedCandidates(before);
    return this.each(JOBS.purge, refs, ({ workspaceId, documentId }) =>
      this.documents.purge(workspaceId, documentId, JOBS.purge),
    );
  }

  /** Objetos del bucket de documentos sin fila que los referencie y con más de 24 h ⇒ borrados con sus versiones. */
  async sweepOrphanObjects(): Promise<MaintenanceReport> {
    const { deps } = this;
    const cutoff = deps.clock.now().epochMillis - deps.settings.quarantineMaxAgeMs;
    const referenced = new Map<string, ReadonlySet<string>>();
    let examined = 0;
    let affected = 0;
    let failed = 0;
    for await (const object of deps.storage.list(deps.settings.documentsBucket, 'ws/')) {
      examined += 1;
      if (object.lastModified.getTime() >= cutoff) continue;
      const workspaceId = object.key.split('/')[1];
      if (!workspaceId) continue;
      try {
        let keys = referenced.get(workspaceId);
        if (!keys) {
          keys = await deps.scan.referencedObjectKeys(workspaceId);
          referenced.set(workspaceId, keys);
        }
        if (keys.has(object.key)) continue;
        await deps.storage.deleteAllVersions(deps.settings.documentsBucket, object.key);
        affected += 1;
      } catch {
        failed += 1;
      }
    }
    return { job: JOBS.orphans, examined, affected, failed };
  }

  /** Rotación: vuelve a envolver las claves de datos con la clave activa, en lotes de 500, sin tocar el contenido. */
  async rewrapDocumentKeys(): Promise<MaintenanceReport> {
    const { deps } = this;
    let examined = 0;
    let affected = 0;
    let failed = 0;
    for (;;) {
      const refs = await deps.scan.withOtherKey(deps.cipher.activeKeyId, 500);
      if (refs.length === 0) break;
      const report = await this.each(JOBS.rewrap, refs, ({ workspaceId, documentId }) =>
        this.documents.rewrapOne(workspaceId, documentId),
      );
      examined += report.examined;
      affected += report.affected;
      failed += report.failed;
      // Si ninguno avanzó (todos fallan), se corta para no iterar sin fin.
      if (report.affected === 0) break;
    }
    return { job: JOBS.rewrap, examined, affected, failed };
  }

  /** Deriva de la cuota: contadores desnormalizados contra la suma real. Devuelve los workspaces con diferencia. */
  async checkUsageDrift(): Promise<{ readonly workspaceId: string; readonly driftBytes: number }[]> {
    const { deps } = this;
    const drifts: { workspaceId: string; driftBytes: number }[] = [];
    for (const workspaceId of await deps.scan.workspacesWithDocuments()) {
      const [stored, actual] = await deps.uow.run(workspaceId, async () => [
        await deps.usage.read(workspaceId),
        await deps.usage.recompute(workspaceId),
      ]);
      const drift = stored.usedBytes + stored.reservedBytes - (actual.usedBytes + actual.reservedBytes);
      if (drift !== 0 || stored.pendingUploads !== actual.pendingUploads) {
        drifts.push({ workspaceId, driftBytes: drift });
      }
    }
    return drifts;
  }

  /** Mantenimiento completo (cron `DOCUMENT_MAINTENANCE_CRON`): cada paso es independiente. */
  async runAll(): Promise<readonly MaintenanceReport[]> {
    const steps: (() => Promise<MaintenanceReport>)[] = [
      () => this.expirePendingUploads(),
      () => this.recoverStuckUploads(),
      () => this.sweepQuarantine(),
      () => this.purgeUnlinkedDocuments(),
      () => this.sweepOrphanObjects(),
      () => this.rewrapDocumentKeys(),
    ];
    const out: MaintenanceReport[] = [];
    for (const step of steps) {
      try {
        out.push(await step());
      } catch {
        out.push({ job: 'documents.maintenance-step', examined: 0, affected: 0, failed: 1 });
      }
    }
    return out;
  }

  /**
   * Verificación de arranque (API y worker): toda `key_id` en uso debe estar en el llavero; si falta, falla con el id
   * faltante (retirar una clave en uso es un error explícito, no una pérdida silenciosa de documentos).
   */
  async assertKeysAvailable(): Promise<void> {
    const inUse = await this.deps.scan.keyIdsInUse();
    const present = new Set(this.deps.cipher.keyIds());
    const missing = inUse.filter((id) => !present.has(id));
    if (missing.length > 0) {
      throw new Error(
        `DOCUMENT_ENCRYPTION_KEYS: falta la clave maestra "${missing[0]}" que protege documentos`,
      );
    }
  }
}

export { JOBS as DOCUMENT_MAINTENANCE_JOBS };
