import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import { ValidatedQuery, principalOf, type ApiRequest } from '@pf/platform/nest';
import type { SpendingAnomalyQueries } from '../application/spending-anomaly-queries.js';

export const SPENDING_ANOMALY_QUERIES = Symbol('SPENDING_ANOMALY_QUERIES');

type Json = Record<string, unknown>;

const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

const objectOf = (raw: unknown): Json =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Json) : {};

/** Parámetro repetible (`explode: true`): llega como arreglo o como texto separado por comas. */
const list = (b: Json, k: string): string[] | undefined => {
  const v = b[k];
  const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : undefined;
  return raw?.map((x) => x.trim()).filter((x) => x !== '');
};

/** Cursor opaco: `{fecha de la transacción, id}` del último elemento de la página. */
const encodeCursor = (raw: string): string => Buffer.from(raw, 'utf8').toString('base64url');
function decodeCursor(raw: string): { date: string; id: string } {
  const [date, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (date && id && /^\d{4}-\d{2}-\d{2}$/u.test(date) && /^[0-9a-f-]{36}$/iu.test(id)) return { date, id };
  throw new ApiProblem('INVALID_CURSOR', 'the cursor is not valid');
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/** `/api/v1/workspaces/{workspaceId}/spending-anomalies*` (openspec add-spending-anomaly-detection § Contratos). */
@Controller()
export class SpendingAnomaliesController {
  constructor(@Inject(SPENDING_ANOMALY_QUERIES) private readonly anomalies: SpendingAnomalyQueries) {}

  @Get('workspaces/:workspaceId/spending-anomalies')
  async list(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const rawLimit = query['limit'];
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    const cursor = str(query, 'cursor');
    const transactionIds = list(query, 'transactionId');
    const page = await this.anomalies.list({
      workspaceId,
      status: str(query, 'status'),
      from: str(query, 'from'),
      to: str(query, 'to'),
      ...(transactionIds ? { transactionIds } : {}),
      limit,
      cursor: cursor ? decodeCursor(cursor) : undefined,
    });
    return { ...page, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
  }

  @Post('workspaces/:workspaceId/spending-anomalies/:anomalyId/dismiss')
  @HttpCode(204)
  async dismiss(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('anomalyId') anomalyId: string,
    @Body() raw: unknown,
  ): Promise<void> {
    const body = objectOf(raw);
    await this.anomalies.dismiss({
      userId: userIdOf(req),
      workspaceId,
      anomalyId,
      reason: str(body, 'reason'),
      note: str(body, 'note'),
    });
  }

  @Post('workspaces/:workspaceId/spending-anomalies/:anomalyId/restore')
  @HttpCode(204)
  async restore(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('anomalyId') anomalyId: string,
  ): Promise<void> {
    await this.anomalies.restore({ userId: userIdOf(req), workspaceId, anomalyId });
  }
}
