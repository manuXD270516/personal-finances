import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  Res,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiProblem, JwtVerifier, type VerifiedAccessToken } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  principalOf,
  setPrincipal,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { IdentityService, WorkspaceView } from '../application/identity.service.js';
import type { IdentityDeps, WorkspaceDefaults } from '../application/ports/index.js';
import { isRole, type Role } from '../domain/role.js';
import type { User } from '../domain/user.js';

/** Tokens de inyección del módulo HTTP de IDENTITY. */
export const IDENTITY_SERVICE = Symbol('IDENTITY_SERVICE');
export const IDENTITY_DEPS = Symbol('IDENTITY_DEPS');
export const JWT_VERIFIER = Symbol('JWT_VERIFIER');
export const IDENTITY_DEFAULTS = Symbol('IDENTITY_DEFAULTS');

/** Jerarquía de roles para `x-required-role` (OWNER ⊃ EDITOR ⊃ VIEWER). */
const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

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
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const route = routeOf(req);
    const op = route ? this.options.contract.find(req.method ?? 'GET', route) : undefined;
    if (!op) return true; // fuera de la API versionada (health, diagnósticos)

    const token = await this.verifier.verify(JwtVerifier.bearer(req.headers.authorization));
    const { userId } = await this.service.provision(toIdentity(token));
    setPrincipal(req, { userId });

    const required = op.requiredRole;
    if (op.hasWorkspaceScope && required !== undefined && isRole(required)) {
      const workspaceId = req.params?.['workspaceId'] ?? '';
      const role = await this.deps.uow.run({ userId, workspaceId: null }, () =>
        this.deps.memberships.activeRole(userId, workspaceId),
      );
      if (!role) throw new ApiProblem('WORKSPACE_ACCESS_DENIED', 'not an active member of the workspace');
      if (RANK[role] < RANK[required]) {
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
    const changes: { locale?: string; timezone?: string } = {};
    const locale = str(body, 'locale');
    const timezone = str(body, 'timezone');
    if (locale !== undefined) changes.locale = locale;
    if (timezone !== undefined) changes.timezone = timezone;
    await this.service.updateMyPreferences(id, expected, changes);
    const { user, workspaces } = await this.service.getMe(id);
    return this.me(user, workspaces);
  }

  @Get('workspaces')
  async listWorkspaces(@Req() req: ApiRequest) {
    const id = userId(req);
    const summaries = await this.service.listMyWorkspaces(id);
    const data = [];
    for (const s of summaries) data.push(this.workspace(await this.service.getWorkspace(id, s.id)));
    return { data, page: { limit: data.length, hasMore: false, nextCursor: null } };
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

  private me(user: User, workspaces: readonly { id: string; name: string; role: Role }[]) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale.value,
      timezone: user.timeZone?.value ?? this.defaults.timeZone,
      memberships: workspaces.map((w) => ({ workspaceId: w.id, workspaceName: w.name, role: w.role })),
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
      version: ws.version,
      createdAt: ws.createdAt ?? this.options.clock.now().toString(),
    };
  }
}
