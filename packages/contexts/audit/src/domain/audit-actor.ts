import { AuditError } from './audit-error.js';

export type AuditActorType = 'USER' | 'SYSTEM' | 'WORKER';

/**
 * VO `AuditActor` (design §1): un usuario (`userId`) o un proceso del sistema/worker (`process`), nunca ambos. Un
 * actor USER sin usuario o un actor SYSTEM/WORKER sin proceso es inválido (TC-AUDIT-ACTOR-001).
 */
export type AuditActor =
  | { readonly type: 'USER'; readonly userId: string; readonly process: null }
  | { readonly type: 'SYSTEM' | 'WORKER'; readonly userId: null; readonly process: string };

export type AuditActorInput =
  | { readonly type: 'USER'; readonly userId: string }
  | { readonly type: 'SYSTEM' | 'WORKER'; readonly process: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Nombre de proceso: job, consumidor, regla o importador (`audit.ensure-partitions`, `ledger.system-accounts`). */
const PROCESS = /^[a-z][a-z0-9_.:-]{0,99}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const AuditActor = {
  of(input: AuditActorInput): AuditActor {
    const raw = input as { type?: unknown; userId?: unknown; process?: unknown };
    if (raw.type === 'USER') {
      if (!isUuid(raw.userId)) throw new AuditError('AUDIT_INVALID_RECORD', 'USER actor requires a userId');
      return Object.freeze({ type: 'USER', userId: raw.userId, process: null });
    }
    if (raw.type === 'SYSTEM' || raw.type === 'WORKER') {
      if (typeof raw.process !== 'string' || !PROCESS.test(raw.process)) {
        throw new AuditError('AUDIT_INVALID_RECORD', `${raw.type} actor requires a process name`);
      }
      return Object.freeze({ type: raw.type, userId: null, process: raw.process });
    }
    throw new AuditError('AUDIT_INVALID_RECORD', 'unknown actor type');
  },
  user(userId: string): AuditActor {
    return AuditActor.of({ type: 'USER', userId });
  },
  system(process: string): AuditActor {
    return AuditActor.of({ type: 'SYSTEM', process });
  },
  worker(process: string): AuditActor {
    return AuditActor.of({ type: 'WORKER', process });
  },
};
