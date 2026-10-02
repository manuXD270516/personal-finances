import { Module, type DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { ReadinessProbe } from '@pf/platform/health';
import type { Logger } from '@pf/platform/logging';
import {
  HealthController,
  JOB_QUEUE,
  LOGGER,
  OtelRouteInterceptor,
  READINESS_PROBE,
} from '@pf/platform/nest';
import type { JobQueue } from '@pf/platform/queue';
import { PlatformDiagnosticsController } from './platform-diagnostics.controller.js';

export interface ApiModuleDeps {
  readonly probe: ReadinessProbe;
  readonly queue: JobQueue;
  readonly logger: Logger;
  /** Habilita `/internal/platform/*` (solo local/ci). */
  readonly diagnostics: boolean;
}

/**
 * Composition root HTTP. Sin módulos de negocio todavía: cada bounded context se registrará aquí con
 * `<Contexto>Module.register({...})` (SPIKE-04).
 */
@Module({})
export class ApiModule {
  static register(deps: ApiModuleDeps): DynamicModule {
    return {
      module: ApiModule,
      controllers: [HealthController, ...(deps.diagnostics ? [PlatformDiagnosticsController] : [])],
      providers: [
        { provide: READINESS_PROBE, useValue: deps.probe },
        { provide: JOB_QUEUE, useValue: deps.queue },
        { provide: LOGGER, useValue: deps.logger },
        { provide: APP_INTERCEPTOR, useClass: OtelRouteInterceptor },
      ],
    };
  }
}
