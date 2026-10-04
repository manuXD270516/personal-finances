import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, type Instant } from '@pf/shared-kernel';
import type { Role } from '../domain/role.js';
import { Workspace, type DemoStatus } from '../domain/workspace.js';
import type { DemoDataDeps, DemoLoadJob, DemoProgress, DemoPurgeJob, DemoRun } from './ports/index.js';
import { persistNewWorkspace } from './workspace-creation.js';

/** Actor técnico de la carga y la purga (ADR-0026; equivalente a `system:seed`, docs/29 §3). */
export const DEMO_ACTOR_PROCESS = 'system:demo';

/** Estado observable de una carga demo (`DemoDataStatus` del contrato). */
export interface DemoDataStatusView {
  readonly demoWorkspaceId: string;
  readonly originWorkspaceId: string;
  readonly status: DemoStatus;
  readonly datasetVersion: string;
  readonly anchorDate: string;
  readonly progress: DemoProgress | null;
  readonly errorCode: string | null;
  readonly requestedAt: string;
  readonly loadedAt: string | null;
  readonly cleanupRequestedAt: string | null;
  readonly purgedAt: string | null;
}

const accessDenied = () =>
  new DomainError('WORKSPACE_ACCESS_DENIED', 'not an active member of the workspace');
const notFound = () => new DomainError('RESOURCE_NOT_FOUND', 'demo data not found');
const ownerOnly = (role: Role) =>
  new DomainError('INSUFFICIENT_ROLE', `role ${role} does not grant workspace:admin`);

/** Fecha de negocio (YYYY-MM-DD) de un instante en una zona IANA. */
export function localDateIn(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant.toDate());
}

/**
 * Casos de uso de datos de demostración (openspec add-demo-data, design.md decisiones 1, 5, 6 y 10; ADR-0026).
 * Comandos de usuario (`RequestDemoData`, `CleanupDemoData`, `GetDemoDataStatus`) y comandos del worker
 * (`MarkDemoLoaded`, `MarkDemoFailed`, purga). Toda acción del usuario se audita en el workspace REAL de origen; lo que
 * pasa dentro del workspace demo se audita en él (y desaparece con la purga, que es lo esperado).
 */
export class DemoDataService {
  constructor(private readonly deps: DemoDataDeps) {}

  /** `DEMO_DATA_ENABLED` (la UI oculta la acción de carga si es `false`). */
  get enabled(): boolean {
    return this.deps.demo.enabled;
  }

  // ------------------------------------------------------------------ comandos del usuario

  /**
   * `RequestDemoData`: OWNER del origen; carga habilitada; un demo vigente por usuario. Crea en UNA transacción el
   * workspace demo (`LOADING`) con el solicitante como único OWNER y la misma provisión que un workspace nuevo, el
   * registro de la carga, la auditoría en el origen y el job `demo.load`.
   */
  async requestDemoData(userId: string, originWorkspaceId: string): Promise<DemoDataStatusView> {
    const role = await this.activeRole(userId, originWorkspaceId);
    if (role !== 'OWNER') throw ownerOnly(role);
    if (!this.deps.demo.enabled) {
      throw new DomainError('DEMO_DATA_DISABLED', 'demo data loading is disabled in this environment');
    }
    const { uow, workspaces, ids, clock, demo, demoRuns, demoJobs } = this.deps;
    const demoId = ids.next();
    return uow.run({ userId, workspaceId: originWorkspaceId }, async () => {
      const origin = await workspaces.findById(originWorkspaceId);
      if (!origin) throw accessDenied();
      // Sin workspace en contexto: la búsqueda ve todos los workspaces del usuario (RLS por membresía).
      await uow.bind({ userId, workspaceId: null });
      await workspaces.lockDemoRequests(userId);
      if (await workspaces.findActiveDemoFor(userId)) throw alreadyExists();
      const now = clock.now();
      const anchorDate = localDateIn(now, origin.settings.timeZone.value);
      const ws = Workspace.createDemo({
        id: demoId,
        name: demo.workspaceName,
        baseCurrency: origin.settings.baseCurrency,
        timeZone: origin.settings.timeZone.value,
        locale: origin.settings.locale.value,
        ownerUserId: userId,
        originWorkspaceId,
        datasetVersion: demo.datasetVersion,
      });
      await persistNewWorkspace(this.deps, ws, userId, 'USER_CREATED', true);
      const run: DemoRun = {
        workspaceId: demoId,
        originWorkspaceId,
        requestedBy: userId,
        datasetVersion: demo.datasetVersion,
        anchorDate,
        requestedAt: now.toString(),
        loadedAt: null,
        failedAt: null,
        errorCode: null,
        progress: { completedModules: [], totalModules: demo.modules.length },
        cleanupRequestedAt: null,
        purgedAt: null,
        rowsDeleted: null,
      };
      await demoRuns.insert(run);
      await this.auditInOrigin(run, 'identity.demo.load_requested', { type: 'USER', userId }, [
        { field: 'datasetVersion', before: null, after: run.datasetVersion },
        { field: 'anchorDate', before: null, after: anchorDate },
      ]);
      await demoJobs.enqueueLoad({
        demoWorkspaceId: demoId,
        originWorkspaceId,
        requestedBy: userId,
        datasetVersion: run.datasetVersion,
        anchorDate,
      });
      return view(run, 'LOADING');
    });
  }

  /**
   * `CleanupDemoData`: OWNER del workspace demo. Archiva al instante (`CLEANING` + `ARCHIVED`: deja de listarse y toda
   * ruta de negocio responde como inexistente), audita en el origen, publica `identity.DemoDataCleaned.v1` (en el
   * origen) y encola `demo.purge`. Un workspace real ⇒ `WORKSPACE_NOT_DEMO`. Idempotente: ya en limpieza ⇒ sin efectos.
   */
  async cleanupDemoData(userId: string, workspaceId: string): Promise<DemoDataStatusView> {
    const role = (await this.activeRole(userId, workspaceId, true)) as Role;
    const { uow, workspaces, clock, demoRuns, demoJobs, outbox, ids } = this.deps;
    return uow.run({ userId, workspaceId }, async () => {
      const ws = await workspaces.findById(workspaceId);
      if (!ws) throw accessDenied();
      if (role !== 'OWNER') throw ownerOnly(role);
      if (!ws.demo)
        throw new DomainError('WORKSPACE_NOT_DEMO', `workspace ${workspaceId} is not a demo workspace`);
      const run = await demoRuns.find(workspaceId);
      if (!run) throw notFound();
      const expectedVersion = ws.version;
      if (!ws.requestDemoCleanup()) return view(run, ws.demo?.status ?? 'PURGED');
      if (!(await workspaces.update(ws, expectedVersion))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the demo workspace was modified concurrently');
      }
      const at = clock.now().toString();
      await demoRuns.update(workspaceId, { cleanupRequestedAt: at });
      const cleaned: DemoRun = { ...run, cleanupRequestedAt: at };
      await uow.bind({ userId, workspaceId: run.originWorkspaceId });
      await outbox.append({
        eventId: ids.next(),
        eventType: 'identity.DemoDataCleaned',
        eventVersion: 1,
        aggregateType: 'Workspace',
        aggregateId: workspaceId,
        aggregateVersion: ws.version,
        workspaceId: run.originWorkspaceId,
        occurredAt: at,
        actor: { type: 'USER', id: userId },
        payload: payloadOf(run),
      });
      await this.auditInOrigin(cleaned, 'identity.demo.cleanup_requested', { type: 'USER', userId }, [
        { field: 'demoStatus', before: run.loadedAt ? 'READY' : 'FAILED', after: 'CLEANING' },
      ]);
      await demoJobs.enqueuePurge({
        demoWorkspaceId: workspaceId,
        originWorkspaceId: run.originWorkspaceId,
        requestedBy: run.requestedBy,
      });
      // El contexto RLS vuelve al workspace de la petición (la idempotencia confirma su respuesta en esta transacción).
      await uow.bind({ userId, workspaceId });
      return view(cleaned, 'CLEANING');
    });
  }

  /**
   * `GetDemoDataStatus`: sobre un workspace demo (cualquier miembro, también archivado) devuelve su carga; sobre un
   * workspace real, la última carga que el usuario pidió desde él (o 404 si no hay ninguna).
   */
  async getDemoDataStatus(userId: string, workspaceId: string): Promise<DemoDataStatusView> {
    await this.activeRole(userId, workspaceId, true);
    const { uow, workspaces, demoRuns } = this.deps;
    return uow.run({ userId, workspaceId: null }, async () => {
      const ws = await workspaces.findById(workspaceId);
      if (!ws) throw accessDenied();
      const run = ws.demo ? await demoRuns.find(ws.id) : await demoRuns.latestForOrigin(ws.id, userId);
      if (!run) throw notFound();
      if (run.purgedAt) return view(run, 'PURGED');
      const demo = ws.demo ? ws : await workspaces.findById(run.workspaceId);
      return view(run, demo?.demo?.status ?? 'PURGED');
    });
  }

  // ------------------------------------------------------------------ comandos del worker (actor system:demo)

  /**
   * Inicio del job `demo.load`: `true` si el demo está `LOADING` sin progreso previo. Un reintento tras una caída
   * (progreso parcial) NO reanuda: marca `FAILED` (`DEMO_LOAD_INTERRUPTED`) y la UI ofrece limpiar.
   */
  async beginDemoLoad(job: DemoLoadJob): Promise<boolean> {
    const state = await this.deps.uow.run(
      { userId: job.requestedBy, workspaceId: job.demoWorkspaceId },
      async () => {
        const ws = await this.deps.workspaces.findById(job.demoWorkspaceId);
        const run = await this.deps.demoRuns.find(job.demoWorkspaceId);
        return {
          status: ws?.demo?.status ?? null,
          started: (run?.progress.completedModules.length ?? 0) > 0,
        };
      },
    );
    if (state.status !== 'LOADING') return false;
    if (state.started) {
      await this.markDemoFailed(job, 'DEMO_LOAD_INTERRUPTED');
      return false;
    }
    return true;
  }

  async recordDemoProgress(job: DemoLoadJob, progress: DemoProgress): Promise<void> {
    await this.deps.uow.run({ userId: job.requestedBy, workspaceId: job.demoWorkspaceId }, () =>
      this.deps.demoRuns.update(job.demoWorkspaceId, { progress }),
    );
  }

  /** `MarkDemoLoaded`: LOADING → READY, `identity.DemoDataLoaded.v1` (en el demo) y auditoría en el origen. */
  async markDemoLoaded(job: DemoLoadJob): Promise<void> {
    await this.finishLoad(job, 'READY', null);
  }

  /** `MarkDemoFailed`: LOADING → FAILED con código (nunca READY con datos parciales). */
  async markDemoFailed(job: DemoLoadJob, errorCode: string): Promise<void> {
    await this.finishLoad(job, 'FAILED', errorCode);
  }

  /**
   * Job `demo.purge`: purga física acotada (`platform.purge_demo_workspace`, solo workspaces demo en limpieza) y
   * auditoría `identity.demo.purged` en el origen, en UNA transacción (si algo falla no se borra nada y el job
   * reintenta; agotados los reintentos el demo queda archivado e invisible: modo degradado del ADR).
   */
  async purgeDemoWorkspace(job: DemoPurgeJob): Promise<Readonly<Record<string, number>>> {
    const { uow, demoPurge, demoRuns } = this.deps;
    return uow.run({ userId: job.requestedBy, workspaceId: job.originWorkspaceId }, async () => {
      const rows = await demoPurge.purge(job.demoWorkspaceId);
      const run = await demoRuns.find(job.demoWorkspaceId);
      if (!run) throw notFound();
      const total = Object.values(rows).reduce((a, b) => a + b, 0);
      await this.auditInOrigin(run, 'identity.demo.purged', { type: 'SYSTEM', process: DEMO_ACTOR_PROCESS }, [
        { field: 'demoStatus', before: 'CLEANING', after: 'PURGED' },
        { field: 'rowsDeleted', before: null, after: total },
      ]);
      return rows;
    });
  }

  // ------------------------------------------------------------------ helpers

  private async finishLoad(
    job: DemoLoadJob,
    to: 'READY' | 'FAILED',
    errorCode: string | null,
  ): Promise<void> {
    const { uow, workspaces, demoRuns, clock, outbox, ids } = this.deps;
    await uow.run({ userId: job.requestedBy, workspaceId: job.demoWorkspaceId }, async () => {
      const ws = await workspaces.findById(job.demoWorkspaceId);
      if (!ws) throw notFound();
      const run = await demoRuns.find(job.demoWorkspaceId);
      if (!run) throw notFound();
      const expectedVersion = ws.version;
      if (to === 'READY') ws.markDemoLoaded();
      else ws.markDemoFailed();
      if (!(await workspaces.update(ws, expectedVersion))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the demo workspace was modified concurrently');
      }
      const at = clock.now().toString();
      await demoRuns.update(
        job.demoWorkspaceId,
        to === 'READY' ? { loadedAt: at } : { failedAt: at, errorCode },
      );
      if (to === 'READY') {
        await outbox.append({
          eventId: ids.next(),
          eventType: 'identity.DemoDataLoaded',
          eventVersion: 1,
          aggregateType: 'Workspace',
          aggregateId: ws.id,
          aggregateVersion: ws.version,
          workspaceId: ws.id,
          occurredAt: at,
          actor: { type: 'SYSTEM', id: DEMO_ACTOR_PROCESS },
          payload: payloadOf(run),
        });
      }
      await uow.bind({ userId: job.requestedBy, workspaceId: run.originWorkspaceId });
      await this.auditInOrigin(
        run,
        to === 'READY' ? 'identity.demo.loaded' : 'identity.demo.load_failed',
        { type: 'SYSTEM', process: DEMO_ACTOR_PROCESS },
        [{ field: 'demoStatus', before: 'LOADING', after: to }],
      );
    });
  }

  /** Auditoría en el workspace real de origen (sobrevive a la purga): `aggregateId` = workspace demo. */
  private async auditInOrigin(
    run: DemoRun,
    action: string,
    actor: { type: 'USER'; userId: string } | { type: 'SYSTEM'; process: string },
    changes: readonly AuditChangeInput[],
  ): Promise<void> {
    await this.deps.uow.bind({ userId: run.requestedBy, workspaceId: run.originWorkspaceId });
    await this.deps.audit.append({
      workspaceId: run.originWorkspaceId,
      action,
      aggregateType: 'Workspace',
      aggregateId: run.workspaceId,
      changes: [{ field: 'demoWorkspaceId', before: null, after: run.workspaceId }, ...changes],
      actor,
      origin: actor.type === 'USER' ? 'ui' : 'system',
    });
  }

  /**
   * Rol del usuario: activo en un workspace no retirado o (con `allowRetired`) en un demo archivado. Sin membresía
   * ⇒ `WORKSPACE_ACCESS_DENIED`.
   */
  private async activeRole(userId: string, workspaceId: string, allowRetired = false): Promise<Role> {
    const { uow, memberships } = this.deps;
    const role = await uow.run({ userId, workspaceId: null }, async () => {
      const active = await memberships.activeRole(userId, workspaceId);
      if (active || !allowRetired) return active;
      return memberships.retiredRole(userId, workspaceId);
    });
    if (role === null) throw accessDenied();
    return role;
  }
}

function alreadyExists(): DomainError {
  return new DomainError('DEMO_WORKSPACE_ALREADY_EXISTS', 'the user already has a demo workspace');
}

function payloadOf(run: DemoRun) {
  return {
    workspaceId: run.workspaceId,
    originWorkspaceId: run.originWorkspaceId,
    datasetVersion: run.datasetVersion,
  };
}

function view(run: DemoRun, status: DemoStatus): DemoDataStatusView {
  return {
    demoWorkspaceId: run.workspaceId,
    originWorkspaceId: run.originWorkspaceId,
    status,
    datasetVersion: run.datasetVersion,
    anchorDate: run.anchorDate,
    progress: status === 'LOADING' || status === 'FAILED' ? run.progress : null,
    errorCode: run.errorCode,
    requestedAt: run.requestedAt,
    loadedAt: run.loadedAt,
    cleanupRequestedAt: run.cleanupRequestedAt,
    purgedAt: run.purgedAt,
  };
}
