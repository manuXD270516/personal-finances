import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WorkerConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import { PinoNestLogger } from '@pf/platform/nest';
import { shutdownTelemetry } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { createJobQueue } from '../runtime/platform-resources.js';
import { WorkerModule } from './platform-jobs.js';

export interface WorkerRuntime {
  readonly context: INestApplicationContext;
  readonly queue: JobQueue;
  /** Apagado ordenado: deja de tomar jobs, espera los activos, cierra la cola y vacía la telemetría. */
  close(): Promise<void>;
}

export async function createWorkerRuntime(config: WorkerConfig, logger: Logger): Promise<WorkerRuntime> {
  const queue = createJobQueue(config, logger, 'consumer');
  const context = await NestFactory.createApplicationContext(
    WorkerModule.register({ queue, logger, concurrency: config.WORKER_CONCURRENCY }),
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  let closed = false;
  return {
    context,
    queue,
    async close() {
      if (closed) return;
      closed = true;
      await queue.drain();
      await context.close();
      await queue.stop();
      await shutdownTelemetry();
    },
  };
}
