import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { verifyAccessToken, TokenRejected, type AccessTokenClaims } from './jwt-verifier.js';
import { findRole, RANK, type Role } from './membership.js';

export const PUBLIC = 'pfos:public';
export const REQUIRED_ROLE = 'pfos:required-role';
export const Public = () => SetMetadata(PUBLIC, true);
/** Equivalente en código a `x-required-role` del contrato OpenAPI. */
export const RequireRole = (role: Role) => SetMetadata(REQUIRED_ROLE, role);

export type AuthedRequest = Request & { user?: AccessTokenClaims; workspaceRole?: Role };

// Nota: @Inject explícito porque la API se ejecuta con tsx (esbuild no emite decorator metadata).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const m = /^Bearer ([A-Za-z0-9\-_.]+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new UnauthorizedException({ code: 'AUTH_MISSING_BEARER' });
    try {
      req.user = await verifyAccessToken(m[1]!);
      return true;
    } catch (e) {
      const reason = e instanceof TokenRejected ? e.reason : 'unknown';
      console.warn(JSON.stringify({ msg: 'jwt_rejected', reason, path: req.path }));
      throw new UnauthorizedException({ code: 'AUTH_INVALID_TOKEN', reason });
    }
  }
}

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(REQUIRED_ROLE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const workspaceId = req.params['workspaceId'];
    const sub = req.user?.sub;
    if (!sub || typeof workspaceId !== 'string') throw new ForbiddenException({ code: 'WORKSPACE_FORBIDDEN' });
    const role = findRole(workspaceId, sub); // membership por request; NO se lee del token
    if (!role) throw new ForbiddenException({ code: 'WORKSPACE_NOT_MEMBER' });
    if (RANK[role] < RANK[required]) {
      throw new ForbiddenException({ code: 'WORKSPACE_ROLE_INSUFFICIENT', required, actual: role });
    }
    req.workspaceRole = role;
    return true;
  }
}
