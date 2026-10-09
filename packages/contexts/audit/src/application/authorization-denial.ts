import type { RateLimitPolicy, RateLimiter } from '@pf/platform/api';
import type { Clock } from '@pf/shared-kernel';
import type { AuthorizationDenialCode, AuthorizationDenialPort, AuditPort } from '../contracts/index.js';
import type { DenialObserver, DenialThrottle, ReadUnitOfWork, WorkspaceExistence } from './ports/index.js';

/** Acción del evento de seguridad (categoría SECURITY en el catálogo de acciones). */
export const AUTHORIZATION_DENIED_ACTION = 'security.authorization.denied';

export interface AuthorizationDenialDeps {
  /** Unidad de trabajo PROPIA (el request rechazado no tiene una): `SET LOCAL app.workspace_id` del workspace objetivo. */
  readonly uow: ReadUnitOfWork;
  readonly audit: AuditPort;
  readonly throttle: DenialThrottle;
  readonly workspaces: WorkspaceExistence;
  readonly observer: DenialObserver;
  readonly clock: Clock;
}

/**
 * `RecordAuthorizationDenial` (openspec add-global-audit-view, design decisión 4; docs/33 D106; FR-AUDIT-005): audita
 * como evento de seguridad (`security.authorization.denied`, actor USER, agregado `Workspace` = el workspace objetivo)
 * el rechazo por `INSUFFICIENT_ROLE` o `WORKSPACE_ACCESS_DENIED`. El diff solo lleva la operación del contrato y el
 * código: nunca el cuerpo de la solicitud (montos, descripciones). Reglas:
 * - Límite de 1 registro por (usuario, workspace, operación) por minuto (los reintentos no amplifican escrituras).
 * - Un workspace inexistente (o retirado) no se audita: no hay dónde escribir y no se siembran filas en workspaces
 *   inventados; el rechazo solo se cuenta en la métrica.
 * - Es la excepción documentada a "auditoría en la misma transacción que la mutación" (INV-029): no hay mutación;
 *   escribe en su propia transacción.
 * - NUNCA lanza: si la escritura falla se registra la falla (logs y métricas) y el rechazo sigue siendo un 403.
 */
export class AuthorizationDenialRecorder implements AuthorizationDenialPort {
  constructor(private readonly deps: AuthorizationDenialDeps) {}

  async record(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly operationId: string;
    readonly code: AuthorizationDenialCode;
  }): Promise<void> {
    const { uow, audit, throttle, workspaces, observer, clock } = this.deps;
    try {
      observer.denied(input.code);
      const key = `${input.userId}:${input.workspaceId}:${input.operationId}`;
      if (!(await throttle.tryAcquire(key, clock.now().toDate()))) return;
      await uow.run({ userId: input.userId, workspaceId: input.workspaceId }, async () => {
        if (!(await workspaces.exists(input.workspaceId))) return;
        await audit.append({
          workspaceId: input.workspaceId,
          action: AUTHORIZATION_DENIED_ACTION,
          aggregateType: 'Workspace',
          aggregateId: input.workspaceId,
          aggregateVersion: null,
          actor: { type: 'USER', userId: input.userId },
          changes: [
            { field: 'operationId', before: null, after: input.operationId },
            { field: 'code', before: null, after: input.code },
          ],
        });
      });
    } catch (err) {
      try {
        observer.writeFailed(err);
      } catch {
        // El observador tampoco puede cambiar el resultado del rechazo.
      }
    }
  }
}

/** Política del registro de fallos de autorización: 1 por (usuario, workspace, operación) por minuto. */
export const DENIAL_POLICY: RateLimitPolicy = { name: 'authz-denied', quota: 1, windowSeconds: 60 };

/** Limitador de fallos de autorización sobre el `RateLimiter` de la plataforma (`RATE_LIMIT_STORE`). */
export class RateLimiterDenialThrottle implements DenialThrottle {
  constructor(private readonly limiter: RateLimiter) {}

  async tryAcquire(key: string, now: Date): Promise<boolean> {
    return (await this.limiter.consume(key, DENIAL_POLICY, now)).allowed;
  }
}
