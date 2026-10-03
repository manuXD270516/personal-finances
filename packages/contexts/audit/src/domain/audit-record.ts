import type { Instant } from '@pf/shared-kernel';
import { AuditActor, isUuid, type AuditActorInput } from './audit-actor.js';
import { aggregateType as checkAggregateType, auditAction } from './audit-action.js';
import { AuditError } from './audit-error.js';
import { isAuditOrigin, type AuditOrigin } from './audit-origin.js';
import type { AuditChange } from './change-set.js';

export interface AuditRecordProps {
  readonly id: string;
  readonly workspaceId: string;
  readonly occurredAt: Instant;
  readonly actor: AuditActorInput;
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | null;
  readonly changes: readonly AuditChange[];
  readonly reason: string | null;
  readonly origin: AuditOrigin;
  readonly correlationId: string;
  readonly requestId: string | null;
  readonly idempotencyKey: string | null;
  /** HMAC-SHA256 de la IP (32 bytes); nunca la IP. */
  readonly clientIpHash: Uint8Array | null;
  readonly userAgent: string | null;
}

const MAX_REASON = 500;
const MAX_USER_AGENT = 512;
const MAX_IDEMPOTENCY_KEY = 255;

const invalid = (what: string) => new AuditError('AUDIT_INVALID_RECORD', what);

function uuid(value: string, what: string): string {
  if (!isUuid(value)) throw invalid(`${what} must be a lowercase UUID`);
  return value;
}

/**
 * AR `AuditRecord` (docs/04 §3.17, FR-AUDIT-002): inmutable desde su creación (sin setters, congelado). Una corrección
 * de un cambio genera OTRO registro (FR-AUDIT-003).
 */
export class AuditRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly occurredAt: Instant;
  readonly actor: AuditActor;
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | null;
  readonly changes: readonly AuditChange[];
  readonly reason: string | null;
  readonly origin: AuditOrigin;
  readonly correlationId: string;
  readonly requestId: string | null;
  readonly idempotencyKey: string | null;
  readonly clientIpHash: Uint8Array | null;
  readonly userAgent: string | null;

  private constructor(p: AuditRecordProps) {
    this.id = uuid(p.id, 'id');
    this.workspaceId = uuid(p.workspaceId, 'workspaceId');
    this.occurredAt = p.occurredAt;
    this.actor = AuditActor.of(p.actor);
    this.action = auditAction(p.action);
    this.aggregateType = checkAggregateType(p.aggregateType);
    this.aggregateId = uuid(p.aggregateId, 'aggregateId');
    if (p.aggregateVersion !== null && (!Number.isInteger(p.aggregateVersion) || p.aggregateVersion < 1)) {
      throw invalid('aggregateVersion must be a positive integer or null');
    }
    this.aggregateVersion = p.aggregateVersion;
    this.changes = Object.freeze([...p.changes]);
    if (p.reason !== null && (p.reason.trim().length === 0 || p.reason.length > MAX_REASON)) {
      throw invalid(`reason must have 1..${MAX_REASON} characters`);
    }
    this.reason = p.reason;
    if (!isAuditOrigin(p.origin)) throw invalid(`unknown origin '${String(p.origin)}'`);
    this.origin = p.origin;
    this.correlationId = uuid(p.correlationId, 'correlationId');
    this.requestId = p.requestId === null ? null : uuid(p.requestId, 'requestId');
    this.idempotencyKey =
      p.idempotencyKey === null ? null : p.idempotencyKey.slice(0, MAX_IDEMPOTENCY_KEY) || null;
    if (p.clientIpHash !== null && p.clientIpHash.length !== 32) {
      throw invalid('clientIpHash must be 32 bytes');
    }
    this.clientIpHash = p.clientIpHash === null ? null : Uint8Array.from(p.clientIpHash);
    this.userAgent = p.userAgent === null ? null : p.userAgent.slice(0, MAX_USER_AGENT) || null;
    Object.freeze(this);
  }

  static create(props: AuditRecordProps): AuditRecord {
    return new AuditRecord(props);
  }

  /** Rehidratación desde el almacenamiento (mismas invariantes). */
  static restore(props: AuditRecordProps): AuditRecord {
    return new AuditRecord(props);
  }
}
