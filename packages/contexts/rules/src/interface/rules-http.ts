import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import {
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import { isDomainError } from '@pf/shared-kernel';
import type { DryRunChange, RuleDryRunService } from '../application/dry-run.service.js';
import type { RuleVersionRecord } from '../application/ports/index.js';
import type { RulesQueries, RuleView } from '../application/rules.queries.js';
import type { RulesService } from '../application/rules.service.js';
import { RULE_TRIGGERS, type RuleState, type RuleTrigger } from '../domain/index.js';

export const RULES_SERVICE = Symbol('RULES_SERVICE');
export const RULES_QUERIES = Symbol('RULES_QUERIES');
export const RULES_DRY_RUN = Symbol('RULES_DRY_RUN');

type Json = Record<string, unknown>;
const body = (b: unknown): Json => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Json) : {});
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

/** Los `details` de un error de dominio viajan como extensión `details` del problem (RFC 9457). */
async function withDetails<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isDomainError(err) && Object.keys(err.details).length > 0) {
      throw new ApiProblem(err.code as never, err.message, {
        extensions: { details: err.details },
        cause: err,
      });
    }
    throw err;
  }
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

export function ruleDto(
  rule: RuleState,
  extra: Partial<Pick<RuleView, 'needsAttention' | 'stats' | 'status'>> = {},
) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    priority: rule.priority,
    enabled: rule.enabled,
    status: extra.status ?? (rule.archivedAt !== null ? 'ARCHIVED' : rule.enabled ? 'ACTIVE' : 'INACTIVE'),
    triggers: rule.triggers,
    matchMode: rule.matchMode,
    conditions: rule.conditions,
    actions: rule.actions,
    stopProcessing: rule.stopProcessing,
    version: rule.version,
    rowVersion: rule.rowVersion,
    needsAttention: extra.needsAttention ?? rule.needsAttention,
    archivedAt: rule.archivedAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    ...(extra.stats ? { stats: extra.stats } : {}),
  };
}

const viewDto = (v: RuleView) => ruleDto(v.rule, v);

const versionDto = (v: RuleVersionRecord) => ({
  ruleId: v.ruleId,
  version: v.version,
  createdAt: v.createdAt,
  createdBy: v.createdBy,
  name: v.snapshot.name,
  triggers: v.snapshot.triggers,
  matchMode: v.snapshot.matchMode,
  conditions: v.snapshot.conditions,
  actions: v.snapshot.actions,
  stopProcessing: v.snapshot.stopProcessing,
  schemaVersion: v.snapshot.schemaVersion,
});

const changeDto = (c: DryRunChange) => ({
  field: c.field,
  before: c.before,
  after: c.after,
  ruleId: c.ruleId,
  ruleVersion: c.ruleVersion,
});

function triggerOf(raw: string | undefined): RuleTrigger | undefined {
  if (raw === undefined) return undefined;
  if (!(RULE_TRIGGERS as readonly string[]).includes(raw)) {
    throw new ApiProblem('VALIDATION_FAILED', 'unknown trigger');
  }
  return raw as RuleTrigger;
}

/** `/api/v1/workspaces/{workspaceId}/rules*` (openspec add-rule-engine § Contratos). */
@Controller()
export class RulesController {
  constructor(
    @Inject(RULES_SERVICE) private readonly rules: RulesService,
    @Inject(RULES_QUERIES) private readonly queries: RulesQueries,
    @Inject(RULES_DRY_RUN) private readonly dryRuns: RuleDryRunService,
  ) {}

  @Get('workspaces/:workspaceId/rules')
  async listRules(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const flag = (k: string): boolean | undefined =>
      query[k] === undefined ? undefined : query[k] === true || query[k] === 'true';
    const trigger = triggerOf(str(query, 'trigger'));
    const views = await this.queries.list(workspaceId, {
      ...(flag('enabled') !== undefined ? { enabled: flag('enabled') as boolean } : {}),
      ...(trigger ? { trigger } : {}),
      includeArchived: flag('includeArchived') === true,
      ...(flag('needsAttention') !== undefined ? { needsAttention: flag('needsAttention') as boolean } : {}),
    });
    return { data: views.map(viewDto) };
  }

  @Post('workspaces/:workspaceId/rules')
  @HttpCode(201)
  async createRule(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const created = await withDetails(() =>
      this.rules.createRule(userIdOf(req), workspaceId, { name: undefined, ...body(raw) }),
    );
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/rules/${created.id}`);
    res.setHeader('etag', `"${created.rowVersion}"`);
    return ruleDto(created);
  }

  // Rutas literales antes de `:ruleId`.
  @Put('workspaces/:workspaceId/rules/order')
  async reorderRules(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() raw: unknown,
  ) {
    const ids = body(raw)['ruleIds'];
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
      throw new ApiProblem('VALIDATION_FAILED', 'ruleIds must be a list of ids');
    }
    const ordered = await this.rules.reorderRules(userIdOf(req), workspaceId, ids as string[]);
    return { data: ordered.map((r) => ruleDto(r)) };
  }

  @Post('workspaces/:workspaceId/rules/preview')
  @HttpCode(200)
  async previewRule(@Param('workspaceId') workspaceId: string, @Body() raw: unknown) {
    const b = body(raw);
    const subject = body(b['subject']);
    const trigger = triggerOf(str(b, 'trigger'));
    const mode = str(b, 'mode');
    if (mode !== undefined && mode !== 'FILL_EMPTY' && mode !== 'OVERWRITE') {
      throw new ApiProblem('VALIDATION_FAILED', 'unknown mode');
    }
    const transactionId = str(subject, 'transactionId');
    const result = await withDetails(() =>
      this.queries.preview(workspaceId, {
        ...(str(b, 'ruleId') ? { ruleId: str(b, 'ruleId') as string } : {}),
        ...(b['definition'] ? { definition: body(b['definition']) } : {}),
        subject: transactionId
          ? { transactionId }
          : {
              sample: body(subject['sample']) as unknown as {
                amount: { amount: string; currency: string };
              },
            },
        ...(trigger ? { trigger } : {}),
        ...(mode ? { mode } : {}),
      }),
    );
    return result;
  }

  @Post('workspaces/:workspaceId/rules/dry-run')
  @HttpCode(200)
  async dryRunRules(@Param('workspaceId') workspaceId: string, @Body() raw: unknown) {
    const b = body(raw);
    const mode = str(b, 'mode') ?? 'FILL_EMPTY';
    if (mode !== 'FILL_EMPTY' && mode !== 'OVERWRITE')
      throw new ApiProblem('VALIDATION_FAILED', 'unknown mode');
    const result = await this.dryRuns.dryRun(workspaceId, {
      ...(Array.isArray(b['ruleIds']) ? { ruleIds: b['ruleIds'] as string[] } : {}),
      from: str(b, 'from') as string,
      to: str(b, 'to') as string,
      ...(Array.isArray(b['accountIds']) ? { accountIds: b['accountIds'] as string[] } : {}),
      mode,
    });
    return { ...result, items: result.items.map((i) => ({ ...i, changes: i.changes.map(changeDto) })) };
  }

  @Post('workspaces/:workspaceId/rules/dry-run/apply')
  @HttpCode(200)
  async applyRuleDryRun(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() raw: unknown,
  ) {
    const b = body(raw);
    const mode = str(b, 'mode') ?? 'FILL_EMPTY';
    if (mode !== 'FILL_EMPTY' && mode !== 'OVERWRITE')
      throw new ApiProblem('VALIDATION_FAILED', 'unknown mode');
    return this.dryRuns.apply(userIdOf(req), workspaceId, {
      token: str(b, 'token') as string,
      ...(Array.isArray(b['ruleIds']) ? { ruleIds: b['ruleIds'] as string[] } : {}),
      mode,
      items: (Array.isArray(b['items']) ? b['items'] : []) as { transactionId: string; version: number }[],
    });
  }

  @Get('workspaces/:workspaceId/rules/coverage')
  async getRuleCoverage(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const c = await this.queries.coverage(workspaceId, {
      ...(str(query, 'from') ? { from: str(query, 'from') as string } : {}),
      ...(str(query, 'to') ? { to: str(query, 'to') as string } : {}),
      ...(str(query, 'importJobId') ? { importJobId: str(query, 'importJobId') as string } : {}),
    });
    return {
      count: c.count,
      byOrigin: {
        rule: c.byOrigin.RULE,
        counterpartyDefault: c.byOrigin.COUNTERPARTY_DEFAULT,
        manual: c.byOrigin.MANUAL,
        systemDefault: c.byOrigin.SYSTEM_DEFAULT,
        unknown: c.byOrigin.UNKNOWN,
      },
      ruleCoverage: c.ruleCoverage,
      target: c.target,
      meetsTarget: c.meetsTarget,
      byRule: c.byRule,
    };
  }

  @Get('workspaces/:workspaceId/rules/:ruleId')
  async getRule(
    @Param('workspaceId') workspaceId: string,
    @Param('ruleId') ruleId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const view = await this.queries.get(workspaceId, ruleId);
    res.setHeader('etag', `"${view.rule.rowVersion}"`);
    return viewDto(view);
  }

  @Put('workspaces/:workspaceId/rules/:ruleId')
  async updateRule(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('ruleId') ruleId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const updated = await withDetails(() =>
      this.rules.updateRule(userIdOf(req), workspaceId, ruleId, expectedVersion, body(raw)),
    );
    res.setHeader('etag', `"${updated.rowVersion}"`);
    return viewDto(await this.queries.get(workspaceId, ruleId));
  }

  @Delete('workspaces/:workspaceId/rules/:ruleId')
  deleteRule(): never {
    // Las reglas se archivan, nunca se eliminan (las transacciones clasificadas las siguen referenciando).
    throw new ApiProblem('METHOD_NOT_ALLOWED', 'rules are archived, never deleted; use POST …/archive', {
      headers: { allow: 'GET, PUT' },
    });
  }

  @Post('workspaces/:workspaceId/rules/:ruleId/enable')
  @HttpCode(200)
  async enableRule(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('ruleId') ruleId: string,
    @ExpectedVersion() expectedVersion: number,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const s = await withDetails(() =>
      this.rules.enableRule(userIdOf(req), workspaceId, ruleId, expectedVersion),
    );
    res.setHeader('etag', `"${s.rowVersion}"`);
    return viewDto(await this.queries.get(workspaceId, ruleId));
  }

  @Post('workspaces/:workspaceId/rules/:ruleId/disable')
  @HttpCode(200)
  async disableRule(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('ruleId') ruleId: string,
    @ExpectedVersion() expectedVersion: number,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const s = await withDetails(() =>
      this.rules.disableRule(userIdOf(req), workspaceId, ruleId, expectedVersion),
    );
    res.setHeader('etag', `"${s.rowVersion}"`);
    return viewDto(await this.queries.get(workspaceId, ruleId));
  }

  @Post('workspaces/:workspaceId/rules/:ruleId/archive')
  @HttpCode(200)
  async archiveRule(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('ruleId') ruleId: string,
    @ExpectedVersion() expectedVersion: number,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const s = await withDetails(() =>
      this.rules.archiveRule(userIdOf(req), workspaceId, ruleId, expectedVersion),
    );
    res.setHeader('etag', `"${s.rowVersion}"`);
    return viewDto(await this.queries.get(workspaceId, ruleId));
  }

  @Get('workspaces/:workspaceId/rules/:ruleId/versions')
  async listRuleVersions(@Param('workspaceId') workspaceId: string, @Param('ruleId') ruleId: string) {
    return { data: (await this.queries.versions(workspaceId, ruleId)).map(versionDto) };
  }
}
