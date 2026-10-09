import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  Res,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  AUTHORIZATION_DENIAL_PORT,
  type AuthorizationDenialCode,
  type AuthorizationDenialPort,
} from '@pf/audit/contracts';
import {
  ApiProblem,
  DEFAULT_PAGE_LIMIT,
  JwtVerifier,
  MAX_PAGE_LIMIT,
  buildPage,
  type VerifiedAccessToken,
} from '@pf/platform/api';
import {
  API_CONVENTIONS,
  chargeFailedAuthentication,
  ExpectedVersion,
  principalOf,
  setPrincipal,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { DemoDataService, DemoDataStatusView } from '../application/demo-data.service.js';
import type { IdentityService, WorkspaceView } from '../application/identity.service.js';
import type { IdentityDeps, WorkspaceDefaults } from '../application/ports/index.js';
import { isRole, type Role } from '../domain/role.js';
import type { User } from '../domain/user.js';

/** Tokens de inyección del módulo HTTP de IDENTITY. */
export const IDENTITY_SERVICE = Symbol('IDENTITY_SERVICE');
export const IDENTITY_DEPS = Symbol('IDENTITY_DEPS');
export const JWT_VERIFIER = Symbol('JWT_VERIFIER');
export const IDENTITY_DEFAULTS = Symbol('IDENTITY_DEFAULTS');
export const DEMO_DATA_SERVICE = Symbol('DEMO_DATA_SERVICE');

/**
 * Operaciones que siguen disponibles sobre un workspace demo ARCHIVADO (add-demo-data): consultar su estado y repetir
 * la limpieza (idempotente). Cualquier otra ruta de un workspace retirado responde 404 como si no existiera.
 */
const RETIRED_WORKSPACE_OPERATIONS: ReadonlySet<string> = new Set(['getDemoDataStatus', 'cleanupDemoData']);

/** Jerarquía de roles para `x-required-role` (OWNER ⊃ EDITOR ⊃ VIEWER). */
const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const routeOf = (req: ApiRequest): string | undefined =>
  typeof req.route?.path === 'string' ? req.route.path : undefined;

/**
 * Autenticación + autorización por workspace dirigidas por el contrato (tareas 7.1/7.2):
 * 1. Toda operación del contrato exige un access token válido (`JwtVerifier`) ⇒ si no, 401 `UNAUTHENTICATED`.
 *    La identidad verificada se provisiona de forma idempotente (`ProvisionUserFromIdentity`) y fija el `Principal`.
 * 2. Si la operación es de un workspace y su `x-required-role` es VIEWER/EDITOR/OWNER: sin membresía activa ⇒ 403
 *    `WORKSPACE_ACCESS_DENIED`; con rol inferior ⇒ 403 `INSUFFICIENT_ROLE` (docs/31 D2). Corre antes que la
 *    validación de contrato, la idempotencia y el handler.
 */
@Injectable()
export class IdentityAccessGuard implements CanActivate {
  constructor(
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
    @Inject(JWT_VERIFIER) private readonly verifier: JwtVerifier,
    @Inject(IDENTITY_SERVICE) private readonly service: IdentityService,
    @Inject(IDENTITY_DEPS) private readonly deps: IdentityDeps,
    /** Auditoría de los rechazos de autorización (openspec add-global-audit-view); ausente en composiciones sin AUDIT. */
    @Optional() @Inject(AUTHORIZATION_DENIAL_PORT) private readonly denials?: AuthorizationDenialPort,
  ) {}

  /**
   * Audita el rechazo como evento de seguridad en el workspace objetivo (docs/33 D106). Best-effort: el puerto nunca
   * lanza y el rechazo siempre responde 403; solo se audita con un id de workspace bien formado.
   */
  private async audited(
    userId: string,
    workspaceId: string,
    operationId: string,
    code: AuthorizationDenialCode,
  ): Promise<void> {
    if (!this.denials || !UUID.test(workspaceId)) return;
    try {
      await this.denials.record({ userId, workspaceId, operationId, code });
    } catch {
      // El puerto no debe lanzar; si lo hiciera, el rechazo sigue siendo un 403 (nunca un 500).
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const route = routeOf(req);
    const op = route ? this.options.contract.find(req.method ?? 'GET', route) : undefined;
    if (!op) return true; // fuera de la API versionada (health, diagnósticos)

    // Cada 401 consume la cuota por IP del tráfico anónimo y, agotada, se responde 429. El tráfico válido no paga
    // aquí (se cuenta por usuario en `RateLimitInterceptor`), así que los usuarios detrás del BFF no se penalizan.
    let token: VerifiedAccessToken;
    try {
      token = await this.verifier.verify(JwtVerifier.bearer(req.headers.authorization));
    } catch (err) {
      if (err instanceof ApiProblem && err.code === 'UNAUTHENTICATED') {
        await chargeFailedAuthentication(this.options, req);
      }
      throw err;
    }
    const { userId } = await this.service.provision(toIdentity(token));
    setPrincipal(req, { userId });

    const required = op.requiredRole;
    if (op.hasWorkspaceScope && required !== undefined && isRole(required)) {
      const workspaceId = req.params?.['workspaceId'] ?? '';
      const { role, retired } = await this.deps.uow.run({ userId, workspaceId: null }, async () => {
        const active = await this.deps.memberships.activeRole(userId, workspaceId);
        if (active) return { role: active, retired: false };
        return { role: await this.deps.memberships.retiredRole(userId, workspaceId), retired: true };
      });
      if (!role) {
        await this.audited(userId, workspaceId, op.operationId, 'WORKSPACE_ACCESS_DENIED');
        throw new ApiProblem('WORKSPACE_ACCESS_DENIED', 'not an active member of the workspace');
      }
      // Demo limpiado (add-demo-data): deja de existir para toda ruta salvo su estado y la limpieza idempotente.
      if (retired && !RETIRED_WORKSPACE_OPERATIONS.has(op.operationId)) {
        throw new ApiProblem('RESOURCE_NOT_FOUND', 'workspace not found');
      }
      if (RANK[role] < RANK[required]) {
        await this.audited(userId, workspaceId, op.operationId, 'INSUFFICIENT_ROLE');
        throw new ApiProblem('INSUFFICIENT_ROLE', `role ${role} does not satisfy ${required}`);
      }
    }
    return true;
  }
}

function toIdentity(token: VerifiedAccessToken) {
  const verified = token.claims['email_verified'] === true;
  return {
    issuer: token.issuer,
    subject: token.subject,
    // El realm exige email; si faltara, se usa un marcador no entregable (no se envía correo a él).
    email: token.email ?? `${token.subject}@users.invalid`,
    emailVerified: verified,
    displayName: token.displayName ?? token.email ?? token.subject,
  };
}

const userId = (req: ApiRequest): string => {
  const p = principalOf(req);
  if (!p) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return p.userId;
};

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

@Controller()
export class IdentityController {
  constructor(
    @Inject(IDENTITY_SERVICE) private readonly service: IdentityService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
    @Inject(IDENTITY_DEFAULTS) private readonly defaults: WorkspaceDefaults,
    @Inject(DEMO_DATA_SERVICE) private readonly demo: DemoDataService,
  ) {}

  @Get('me')
  async getMe(@Req() req: ApiRequest) {
    const id = userId(req);
    const { user, workspaces } = await this.service.getMe(id);
    return this.me(user, workspaces);
  }

  @Patch('me')
  async updateMe(@Req() req: ApiRequest, @ExpectedVersion() expected: number, @Body() body: Json) {
    const id = userId(req);
    const changes: {
      displayName?: string;
      locale?: string;
      timezone?: string;
      preferences?: Record<string, unknown>;
    } = {};
    const displayName = str(body, 'displayName');
    const locale = str(body, 'locale');
    const timezone = str(body, 'timezone');
    const preferences = body['preferences'];
    if (displayName !== undefined) changes.displayName = displayName;
    if (locale !== undefined) changes.locale = locale;
    if (timezone !== undefined) changes.timezone = timezone;
    if (preferences !== null && typeof preferences === 'object' && !Array.isArray(preferences)) {
      changes.preferences = preferences as Record<string, unknown>;
    }
    await this.service.updateMyPreferences(id, expected, changes);
    const { user, workspaces } = await this.service.getMe(id);
    return this.me(user, workspaces);
  }

  /**
   * Paginación por cursor (docs/10 §5.1): keyset por id de workspace (UUIDv7), `limit` 1..200 (50 por defecto);
   * el cursor firmado vale solo para este recurso y este usuario.
   */
  /**
   * `POST /me/session-events` (`recordSessionEvent`, FR-AUDIT-005): el BFF informa el inicio y el cierre de su
   * sesión; se audita en el workspace activo de la sesión (o el hogar del usuario). 204 sin cuerpo.
   */
  @Post('me/session-events')
  @HttpCode(204)
  async recordSessionEvent(@Req() req: ApiRequest, @Body() body: Json): Promise<void> {
    const event = body['event'] === 'ENDED' ? 'ENDED' : 'STARTED';
    const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : null;
    await this.service.recordSessionEvent(userId(req), event, workspaceId);
  }

  @Get('workspaces')
  async listWorkspaces(@Req() req: ApiRequest) {
    const id = userId(req);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const rawLimit = Number(query['limit'] ?? DEFAULT_PAGE_LIMIT);
    const limit = Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;
    const scope = { resource: 'workspaces', workspaceId: id, filters: {} };
    const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    const afterId = cursor === undefined ? undefined : String(this.options.cursors.decode(cursor, scope)[0]);
    const rows = await this.service.listMyWorkspaces(id, {
      ...(afterId === undefined ? {} : { afterId }),
      limit: limit + 1,
    });
    const page = buildPage(
      rows,
      limit,
      (s) => [s.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    const data = [];
    for (const s of page.data) data.push(this.workspace(await this.service.getWorkspace(id, s.id)));
    return { data, page: page.page };
  }

  @Post('workspaces')
  @HttpCode(201)
  async createWorkspace(
    @Req() req: ApiRequest,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const id = userId(req);
    const fiscal = body['fiscalMonthStartDay'];
    const view = await this.service.createWorkspace(id, {
      name: str(body, 'name') ?? '',
      baseCurrency: str(body, 'baseCurrency') ?? '',
      timezone: str(body, 'timezone') ?? this.defaults.timeZone,
      locale: str(body, 'locale') ?? this.defaults.locale,
      ...(typeof fiscal === 'number' ? { fiscalMonthStartDay: fiscal } : {}),
      ...(typeof body['seedDefaultCategories'] === 'boolean'
        ? { seedDefaultCategories: body['seedDefaultCategories'] }
        : {}),
    });
    res.setHeader('location', `/api/v1/workspaces/${view.workspace.id}`);
    return this.workspace(view);
  }

  @Get('workspaces/:workspaceId')
  async getWorkspace(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    return this.workspace(await this.service.getWorkspace(userId(req), workspaceId));
  }

  @Patch('workspaces/:workspaceId')
  async updateWorkspace(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const cmd: Record<string, unknown> = {};
    for (const k of [
      'name',
      'baseCurrency',
      'timezone',
      'locale',
      'fiscalMonthStartDay',
      'minimumLiquidityReserve',
    ]) {
      if (k in body) cmd[k] = body[k];
    }
    const { view } = await this.service.updateWorkspaceSettings(userId(req), workspaceId, expected, cmd);
    return this.workspace(view);
  }

  // ------------------------------------------------------------------ datos de demostración (add-demo-data)

  /** `POST W/demo-data` (OWNER): crea el workspace demo dedicado y encola la carga. 202 `DemoDataStatus`. */
  @Post('workspaces/:workspaceId/demo-data')
  @HttpCode(202)
  async requestDemoData(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    return demoStatus(await this.demo.requestDemoData(userId(req), workspaceId));
  }

  @Get('workspaces/:workspaceId/demo-data')
  async getDemoDataStatus(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    return demoStatus(await this.demo.getDemoDataStatus(userId(req), workspaceId));
  }

  /** `POST W/demo-data/cleanup` (OWNER del demo): archivo inmediato + purga encolada. 202 `DemoDataStatus`. */
  @Post('workspaces/:workspaceId/demo-data/cleanup')
  @HttpCode(202)
  async cleanupDemoData(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    return demoStatus(await this.demo.cleanupDemoData(userId(req), workspaceId));
  }

  private me(user: User, workspaces: readonly { id: string; name: string; role: Role; isDemo?: boolean }[]) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale.value,
      timezone: user.timeZone?.value ?? this.defaults.timeZone,
      memberships: workspaces.map((w) => ({
        workspaceId: w.id,
        workspaceName: w.name,
        role: w.role,
        isDemo: w.isDemo ?? false,
      })),
      features: { demoData: this.demo.enabled },
      version: user.version,
    };
  }

  private workspace({ workspace: ws, role }: WorkspaceView) {
    const s = ws.settings;
    const reserve = s.minimumLiquidityReserve;
    return {
      id: ws.id,
      name: s.name,
      baseCurrency: s.baseCurrency.code,
      timezone: s.timeZone.value,
      locale: s.locale.value,
      fiscalMonthStartDay: s.fiscalMonthStartDay,
      minimumLiquidityReserve: reserve
        ? { amount: reserve.toFixed(), currency: reserve.currency.code }
        : null,
      status: ws.status,
      role,
      isDemo: ws.isDemo,
      demoStatus: ws.demo?.status ?? null,
      version: ws.version,
      createdAt: ws.createdAt ?? this.options.clock.now().toString(),
    };
  }
}

function demoStatus(v: DemoDataStatusView) {
  return {
    demoWorkspaceId: v.demoWorkspaceId,
    originWorkspaceId: v.originWorkspaceId,
    status: v.status,
    datasetVersion: v.datasetVersion,
    anchorDate: v.anchorDate,
    progress: v.progress
      ? { completedModules: [...v.progress.completedModules], totalModules: v.progress.totalModules }
      : null,
    errorCode: v.errorCode,
    requestedAt: v.requestedAt,
    loadedAt: v.loadedAt,
    cleanupRequestedAt: v.cleanupRequestedAt,
    purgedAt: v.purgedAt,
  };
}
