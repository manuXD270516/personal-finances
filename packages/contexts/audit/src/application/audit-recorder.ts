import type { Clock } from '@pf/shared-kernel';
import type { AuditEntry, AuditPort } from '../contracts/index.js';
import { AuditError } from '../domain/audit-error.js';
import { isAuditOrigin, type AuditOrigin } from '../domain/audit-origin.js';
import { AuditRecord } from '../domain/audit-record.js';
import type { RedactionPolicy } from '../domain/redaction-policy.js';
import type { AuditEnvironment, AuditLogStore, IdGenerator, IpHasher } from './ports/index.js';

export interface AuditRecorderDeps {
  readonly env: AuditEnvironment;
  readonly store: AuditLogStore;
  readonly ipHasher: IpHasher;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly policy: RedactionPolicy;
}

/**
 * `AuditRecorder` (design §1, §3): implementación de `AuditPort`. Completa el registro con el contexto de la petición
 * o del job (actor, origen, correlación, request, idempotency key, HMAC de IP, user agent) y el `Clock`, aplica la
 * política de redacción y lo escribe con el almacén de la MISMA unidad de trabajo. Fuera de una unidad de trabajo
 * lanza `AUDIT_OUTSIDE_UNIT_OF_WORK` (nunca abre una transacción propia); cualquier fallo se propaga y la unidad de
 * trabajo revierte el comando completo (INV-029).
 */
export class AuditRecorder implements AuditPort {
  constructor(private readonly deps: AuditRecorderDeps) {}

  async append(entry: AuditEntry): Promise<void> {
    const { env, ids, clock, policy, ipHasher, store } = this.deps;
    if (!env.inUnitOfWork()) {
      throw new AuditError(
        'AUDIT_OUTSIDE_UNIT_OF_WORK',
        `${entry.action} must be audited inside the command's unit of work`,
      );
    }
    const ambient = env.ambient();
    const actor = entry.actor ?? ambient.actor;
    if (!actor) throw new AuditError('AUDIT_ACTOR_MISSING', `${entry.action} has no actor`);
    const origin: AuditOrigin =
      entry.origin ??
      (isAuditOrigin(ambient.origin) ? ambient.origin : actor.type === 'USER' ? 'api' : 'system');
    const record = AuditRecord.create({
      id: entry.id ?? ids.next(),
      workspaceId: entry.workspaceId,
      occurredAt: clock.now(),
      actor,
      action: entry.action,
      aggregateType: entry.aggregateType,
      aggregateId: entry.aggregateId,
      aggregateVersion: entry.aggregateVersion ?? null,
      changes: policy.apply(entry.aggregateType, entry.changes ?? []),
      reason: entry.reason ?? null,
      origin,
      // Un trabajo sin correlación ambiental (p. ej. un script) recibe una propia: nunca queda vacía.
      correlationId: ambient.correlationId ?? ids.next(),
      requestId: ambient.requestId ?? null,
      idempotencyKey: ambient.idempotencyKey ?? null,
      clientIpHash: ambient.clientIp ? ipHasher.hash(ambient.clientIp) : null,
      userAgent: ambient.userAgent ?? null,
    });
    await store.insert(record);
  }
}
