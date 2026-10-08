import { requireSqlExecutor } from '@pf/platform/api';
import { currentCorrelation, uuidv7 } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import type { EmailDispatchScheduler } from '../application/ports/index.js';
import { EMAIL_DISPATCH_QUEUE, type EmailDispatchJob } from '../contracts/index.js';

/**
 * Encola `notifications.email-dispatch` en la MISMA transacción que la entrega (design decisión 7): el trabajo existe
 * solo si la entrega se confirma. El primer trabajo de una entrega usa `id = deliveryId` (un id repetido se ignora);
 * los siguientes (reintento, horario de silencio, barrido) usan un id nuevo. `startAfter` difiere el trabajo.
 */
export class PgBossEmailScheduler implements EmailDispatchScheduler {
  constructor(private readonly queue: JobQueue) {}

  async schedule(input: {
    readonly deliveryId: string;
    readonly workspaceId: string;
    readonly startAfter: Date | null;
    readonly first: boolean;
  }): Promise<void> {
    const payload: EmailDispatchJob = { workspaceId: input.workspaceId, deliveryId: input.deliveryId };
    await this.queue.enqueueInTransaction(
      EMAIL_DISPATCH_QUEUE,
      [
        {
          id: input.first ? input.deliveryId : uuidv7(),
          payload,
          correlationId: currentCorrelation()?.correlationId ?? uuidv7(),
          traceContext: {},
          ...(input.startAfter ? { startAfter: input.startAfter } : {}),
        },
      ],
      requireSqlExecutor(),
    );
  }
}
