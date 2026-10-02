import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Public, RequireRole, type AuthedRequest } from './guards.js';

type Tx = { id: string; workspaceId: string; description: string; amount: string; createdBy: string };
const transactions: Tx[] = [];

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

@Controller('api/v1')
export class MeController {
  @Get('me')
  me(@Req() req: AuthedRequest) {
    const u = req.user!;
    // Nunca devolvemos el token; solo metadatos (iat/exp) para evidenciar el refresh.
    return { sub: u.sub, email: u.email, azp: u.azp, groups: u.groups ?? [], token: { iat: u.iat, exp: u.exp } };
  }
}

@Controller('api/v1/workspaces/:workspaceId')
export class WorkspaceController {
  @Get('accounts')
  @RequireRole('VIEWER')
  accounts(@Param('workspaceId') ws: string, @Req() req: AuthedRequest) {
    return {
      workspaceId: ws,
      role: req.workspaceRole,
      items: [{ id: 'acc-1', name: 'Cuenta corriente', balance: '1520.75', currency: 'CLP' }],
    };
  }

  @Get('transactions')
  @RequireRole('VIEWER')
  list(@Param('workspaceId') ws: string) {
    return { items: transactions.filter((t) => t.workspaceId === ws) };
  }

  @Post('transactions')
  @RequireRole('EDITOR')
  @HttpCode(201)
  create(
    @Param('workspaceId') ws: string,
    @Body() body: { description?: string; amount?: string } | undefined,
    @Req() req: AuthedRequest,
  ) {
    const t: Tx = {
      id: randomUUID(),
      workspaceId: ws,
      description: String(body?.description ?? ''),
      amount: String(body?.amount ?? '0'),
      createdBy: req.user!.sub,
    };
    transactions.push(t);
    return t;
  }

  @Post('periods/:periodId/reopen')
  @RequireRole('OWNER')
  @HttpCode(200)
  reopen(@Param('workspaceId') ws: string, @Param('periodId') periodId: string) {
    return { workspaceId: ws, periodId, status: 'OPEN' };
  }
}
