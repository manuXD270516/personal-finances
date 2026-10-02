import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { currentCorrelation, type Logger } from '@pf/platform/logging';
import { JOB_QUEUE, LOGGER } from '@pf/platform/nest';
import {
  PLATFORM_PING_QUEUE,
  PLATFORM_PROBE_QUEUE,
  type JobQueue,
  type PlatformPingPayload,
  type PlatformProbePayload,
} from '@pf/platform/queue';

export interface PlatformJobAccepted {
  readonly jobId: string;
  readonly correlationId: string | undefined;
}

const PROBE_KEY = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Diagnóstico de plataforma (solo PFOS_ENV=local|ci). Fuera de `/api/v1`: no es parte del contrato de negocio.
 * - `POST /internal/platform/ping`: job no-op `platform.ping` (cola + correlación API → worker, TC-PLATFORM-OBS-002).
 * - `POST /internal/platform/probe`: job `platform.probe` que tarda `durationMs` y confirma un efecto idempotente
 *   (apagado ordenado del worker, TC-PLATFORM-STACK-006).
 */
@Controller('internal/platform')
export class PlatformDiagnosticsController {
  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post('ping')
  @HttpCode(202)
  async ping(): Promise<PlatformJobAccepted> {
    this.logger.info({ 'job.queue': PLATFORM_PING_QUEUE }, 'platform ping requested');
    const payload: PlatformPingPayload = { requestedAt: new Date().toISOString() };
    const jobId = await this.queue.send(PLATFORM_PING_QUEUE, payload);
    return { jobId, correlationId: currentCorrelation()?.correlationId };
  }

  @Post('probe')
  @HttpCode(202)
  async probe(@Body() body: unknown): Promise<PlatformJobAccepted> {
    const { key, durationMs } = (body ?? {}) as Partial<Record<keyof PlatformProbePayload, unknown>>;
    if (typeof key !== 'string' || !PROBE_KEY.test(key)) {
      throw new BadRequestException('key: 1-100 caracteres [A-Za-z0-9._-]');
    }
    if (
      typeof durationMs !== 'number' ||
      !Number.isInteger(durationMs) ||
      durationMs < 0 ||
      durationMs > 20_000
    ) {
      throw new BadRequestException('durationMs: entero entre 0 y 20000');
    }
    const payload: PlatformProbePayload = { key, durationMs };
    const jobId = await this.queue.send(PLATFORM_PROBE_QUEUE, payload);
    this.logger.info({ 'job.queue': PLATFORM_PROBE_QUEUE, 'job.id': jobId }, 'platform probe requested');
    return { jobId, correlationId: currentCorrelation()?.correlationId };
  }
}
