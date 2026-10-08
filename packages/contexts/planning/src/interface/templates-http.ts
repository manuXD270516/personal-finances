import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ValidatedQuery,
  type ApiConventionsOptions,
  type ApiResponse,
} from '@pf/platform/nest';
import { DomainError } from '@pf/shared-kernel';
import type { BudgetsService } from '../application/budgets.service.js';
import type { PropagationService } from '../application/propagation.service.js';
import type { TemplateQueries } from '../application/template.queries.js';
import type { TemplatesService } from '../application/templates.service.js';
import type { TemplateStatus } from '../domain/index.js';
import { BUDGETS_SERVICE } from './budgets-http.js';

export const TEMPLATES_SERVICE = Symbol('TEMPLATES_SERVICE');
export const TEMPLATE_QUERIES = Symbol('TEMPLATE_QUERIES');
export const PROPAGATION_SERVICE = Symbol('PROPAGATION_SERVICE');

type Json = Record<string, unknown>;
const str = (q: Json, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;

const TEMPLATE_PAGE_DEFAULT = 50;
const TEMPLATE_PAGE_MAX = 100;

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? TEMPLATE_PAGE_DEFAULT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), TEMPLATE_PAGE_MAX) : DEFAULT_PAGE_LIMIT;
}

function versionNoOf(raw: string): number {
  const n = Number(raw);
  if (!/^[1-9][0-9]{0,8}$/.test(raw) || !Number.isInteger(n)) {
    throw new DomainError('VALIDATION_FAILED', 'versionNo must be a positive integer').at('/versionNo');
  }
  return n;
}

/**
 * `/api/v1/workspaces/{workspaceId}/templates*` y `/budget-propagations/*` (openspec add-budget-templates § Contratos,
 * tarea 5.1). Autenticación y `x-required-role` (VIEWER lee; EDITOR escribe) los aplica el guard global de IDENTITY;
 * validación de contrato, Problem Details e `Idempotency-Key` (en la transacción del comando), las convenciones
 * globales de `@pf/platform/nest`. Un template no se borra: `DELETE` responde 405 (se archiva, decisión 8).
 */
@Controller()
export class TemplatesController {
  constructor(
    @Inject(TEMPLATES_SERVICE) private readonly service: TemplatesService,
    @Inject(TEMPLATE_QUERIES) private readonly queries: TemplateQueries,
    @Inject(PROPAGATION_SERVICE) private readonly propagation: PropagationService,
    @Inject(BUDGETS_SERVICE) private readonly budgets: BudgetsService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  /** `listTemplates`: predeterminado primero, luego por nombre. */
  @Get('workspaces/:workspaceId/templates')
  async listTemplates(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const status = str(query, 'status') as TemplateStatus | undefined;
    const limit = limitOf(query);
    const scope = { resource: 'templates', workspaceId, filters: { status: status ?? null } };
    const all = await this.queries.list(workspaceId, status);
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const rows = all.slice(offset, offset + limit + 1).map((t, i) => ({ t, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => r.t), page: page.page };
  }

  /** `createTemplate` (EDITOR, `Idempotency-Key`): versión 1; `NAME_TAKEN` si el nombre ya es de un activo. */
  @Post('workspaces/:workspaceId/templates')
  @HttpCode(201)
  async createTemplate(
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const template = await this.service.createTemplate({
      workspaceId,
      name: body['name'],
      description: body['description'],
      lines: body['lines'] ?? [],
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/templates/${template.id}`);
    return template;
  }

  @Get('workspaces/:workspaceId/templates/:templateId')
  getTemplate(@Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string) {
    return this.queries.get(workspaceId, templateId);
  }

  /** Sin `DELETE`: los templates se archivan (405, decisión 8). */
  @Delete('workspaces/:workspaceId/templates/:templateId')
  deleteTemplate(): never {
    throw new ApiProblem('METHOD_NOT_ALLOWED', 'templates are archived, never deleted; use POST …/archive', {
      headers: { allow: 'GET' },
    });
  }

  @Get('workspaces/:workspaceId/templates/:templateId/versions/:versionNo')
  getTemplateVersion(
    @Param('workspaceId') workspaceId: string,
    @Param('templateId') templateId: string,
    @Param('versionNo') versionNo: string,
  ) {
    return this.queries.getVersion(workspaceId, templateId, versionNoOf(versionNo));
  }

  /** `publishTemplateVersion` (EDITOR, `Idempotency-Key`): instantánea completa N+1. */
  @Post('workspaces/:workspaceId/templates/:templateId/versions')
  @HttpCode(201)
  async publishTemplateVersion(
    @Param('workspaceId') workspaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const template = await this.service.publishVersion({
      workspaceId,
      templateId,
      baseVersionNo: body['baseVersionNo'],
      lines: body['lines'] ?? [],
      changeNote: body['changeNote'],
    });
    res.setHeader(
      'location',
      `/api/v1/workspaces/${workspaceId}/templates/${templateId}/versions/${template.currentVersionNo}`,
    );
    return template;
  }

  @Post('workspaces/:workspaceId/templates/:templateId/clone')
  @HttpCode(201)
  async cloneTemplate(
    @Param('workspaceId') workspaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const template = await this.service.cloneTemplate({
      workspaceId,
      templateId,
      name: body['name'],
      versionNo: body['versionNo'],
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/templates/${template.id}`);
    return template;
  }

  @Post('workspaces/:workspaceId/templates/:templateId/archive')
  @HttpCode(200)
  archiveTemplate(@Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string) {
    return this.service.archive({ workspaceId, templateId });
  }

  @Post('workspaces/:workspaceId/templates/:templateId/unarchive')
  @HttpCode(200)
  unarchiveTemplate(@Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string) {
    return this.service.unarchive({ workspaceId, templateId });
  }

  @Post('workspaces/:workspaceId/templates/:templateId/set-default')
  @HttpCode(200)
  setDefaultTemplate(@Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string) {
    return this.service.setDefault({ workspaceId, templateId });
  }

  /** `applyTemplate` (EDITOR, `Idempotency-Key`): atajo de `createBudget` con `source.kind = TEMPLATE`. */
  @Post('workspaces/:workspaceId/templates/:templateId/apply')
  @HttpCode(201)
  async applyTemplate(
    @Param('workspaceId') workspaceId: string,
    @Param('templateId') templateId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const periodId = str(body, 'periodId');
    if (periodId === undefined) {
      throw new DomainError('VALIDATION_FAILED', 'periodId is required').at('/periodId');
    }
    const budget = await this.budgets.createBudget({
      workspaceId,
      periodId,
      source: { kind: 'TEMPLATE', templateId, versionNo: body['versionNo'] },
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/budgets/${budget.id}`);
    return budget;
  }

  /** `previewBudgetPropagation`: vista previa sin efectos (EDITOR). */
  @Post('workspaces/:workspaceId/budget-propagations/preview')
  @HttpCode(200)
  previewBudgetPropagation(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    return this.propagation.preview({ workspaceId, source: body['source'] });
  }

  /** `confirmBudgetPropagation` (EDITOR, `Idempotency-Key`): `BUDGET_PROPAGATION_STALE` si algo cambió. */
  @Post('workspaces/:workspaceId/budget-propagations/confirm')
  @HttpCode(200)
  confirmBudgetPropagation(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    return this.propagation.confirm({
      workspaceId,
      source: body['source'],
      token: body['token'],
      changeNote: body['changeNote'],
    });
  }
}
