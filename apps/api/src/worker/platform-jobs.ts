import { Inject, Injectable, Module, type DynamicModule, type OnApplicationBootstrap } from '@nestjs/common';
import type { Logger } from '@pf/platform/logging';
import { JOB_QUEUE, LOGGER } from '@pf/platform/nest';
import { PLATFORM_PING_QUEUE, type JobQueue, type PlatformPingPayload } from '@pf/platform/queue';

const WORKER_OPTIONS = Symbol.for('pf.api.WorkerOptions');

export interface WorkerModuleDeps {
  readonly queue: JobQueue;
  readonly logger: Logger;
  readonly concurrency: number;
}

/** Registra los handlers de jobs de plataforma al arrancar el contexto del worker. */
@Injectable()
export class PlatformJobsRegistrar implements OnApplicationBootstrap {
  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(WORKER_OPTIONS) private readonly options: { concurrency: number },
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.start();
    // platform.ping: no-op; existe para verificar cola + correlación de extremo a extremo.
    await this.queue.work<PlatformPingPayload>(
      PLATFORM_PING_QUEUE,
      { concurrency: this.options.concurrency },
      async (job) => {
        this.logger.info({ 'job.queue': job.queue, 'job.id': job.id }, 'platform ping processed');
      },
    );
    this.logger.info({ queues: [PLATFORM_PING_QUEUE] }, 'worker consuming');
  }
}

/** Composition root del proceso worker (misma imagen que la API, otro comando — ADR-0011). */
@Module({})
export class WorkerModule {
  static register(deps: WorkerModuleDeps): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: JOB_QUEUE, useValue: deps.queue },
        { provide: LOGGER, useValue: deps.logger },
        { provide: WORKER_OPTIONS, useValue: { concurrency: deps.concurrency } },
        PlatformJobsRegistrar,
      ],
    };
  }
}
