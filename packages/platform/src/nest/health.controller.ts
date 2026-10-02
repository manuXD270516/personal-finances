import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import {
  LIVENESS_REPORT,
  type LivenessReport,
  type ReadinessProbe,
  type ReadinessReport,
} from '../health/index.js';
import { READINESS_PROBE } from './tokens.js';

interface StatusResponse {
  status(code: number): unknown;
}

/**
 * Probes operativos fuera de `/api/v1` (proposal: no forman parte del contrato de negocio ni requieren auth).
 * - `GET /health/live`: 200 si el proceso atiende; no toca dependencias.
 * - `GET /health/ready`: 200 si todas las dependencias críticas responden; 503 indicando cuáles fallan.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_PROBE) private readonly probe: ReadinessProbe) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): LivenessReport {
    return LIVENESS_REPORT;
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(@Res({ passthrough: true }) res: StatusResponse): Promise<ReadinessReport> {
    const report = await this.probe.evaluate();
    res.status(report.status === 'ready' ? 200 : 503);
    return report;
  }
}
