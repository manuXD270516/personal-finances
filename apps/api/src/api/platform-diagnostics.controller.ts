import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { currentCorrelation, type Logger } from '@pf/platform/logging';
import { JOB_QUEUE, LOGGER } from '@pf/platform/nest';
import { PLATFORM_PING_QUEUE, type JobQueue, type PlatformPingPayload } from '@pf/platform/queue';

export interface PlatformPingAccepted {
  readonly jobId: string;
  readonly correlationId: string | undefined;
}

/**
 * Diagnóstico de plataforma (solo PFOS_ENV=local|ci): encola el job no-op `platform.ping` para verificar de
 * extremo a extremo cola + propagación del correlation_id API → worker (TC-PLATFORM-OBS-002).
 * Fuera de `/api/v1`: no es parte del contrato de negocio.
 */
@Controller('internal/platform')
export class PlatformDiagnosticsController {
  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post('ping')
  @HttpCode(202)
  async ping(): Promise<PlatformPingAccepted> {
    this.logger.info({ 'job.queue': PLATFORM_PING_QUEUE }, 'platform ping requested');
    const payload: PlatformPingPayload = { requestedAt: new Date().toISOString() };
    const jobId = await this.queue.send(PLATFORM_PING_QUEUE, payload);
    return { jobId, correlationId: currentCorrelation()?.correlationId };
  }
}
