// Harness de plataforma para `platform/api-conventions` (design: "si este change se aplica antes que
// add-workspace-identity, los TC se ejecutan contra controllers de prueba"). Los controllers implementan
// operaciones REALES del contrato (createWorkspace, getWorkspace, updateWorkspace, listWorkspaces, getMe,
// createTransaction, listTransactions) con persistencia mínima, más dos operaciones de fixture (`/_test/*`).
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Res,
  type DynamicModule,
} from '@nestjs/common';
import {
  ApiContract,
  ApiProblem,
  DependencyUnavailableError,
  buildPage,
  concurrencyConflict,
  currentSqlExecutor,
  preconditionFailed,
  type CursorPosition,
} from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  setPrincipal,
  type ApiConventionsOptions,
  type ApiRequest,
} from '@pf/platform/nest';
import { DomainError, LocalDate, Money, currency, jsonPointer } from '@pf/shared-kernel';
import { resolveContractPath } from '../../src/api/api-conventions.js';

export const SCALES: Record<string, number> = { BOB: 2, USD: 2, USDT: 6 };
const scaleOf = (code: string) => {
  const scale = SCALES[code];
  if (scale === undefined) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} not enabled`);
  return scale;
};

/** Contrato real + operaciones de fixture (`/_test/boom`, `/_test/deprecated`) que no existen en producción. */
export function harnessContract(): ApiContract {
  const doc = ApiContract.readDocument(resolveContractPath());
  const paths = doc['paths'] as Record<string, unknown>;
  const errors = {
    '401': { $ref: '#/components/responses/Unauthorized' },
    '500': { $ref: '#/components/responses/InternalServerError' },
    '503': { $ref: '#/components/responses/ServiceUnavailable' },
  };
  paths['/_test/boom'] = {
    get: {
      operationId: 'testBoom',
      'x-required-role': 'AUTHENTICATED',
      responses: { '200': { description: 'never' }, ...errors },
    },
  };
  paths['/_test/deprecated'] = {
    get: {
      operationId: 'testDeprecated',
      deprecated: true,
      'x-deprecated-at': '2026-10-02',
      'x-sunset': '2026-12-31',
      'x-required-role': 'AUTHENTICATED',
      responses: {
        '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } },
        ...errors,
      },
    },
  };
  return ApiContract.fromDocument(doc);
}

/** Middleware de prueba: `x-test-user` fija el usuario autenticado hasta que exista add-workspace-identity. */
export function testPrincipalMiddleware(req: ApiRequest, _res: unknown, next: () => void): void {
  const user = req.headers['x-test-user'];
  if (typeof user === 'string') setPrincipal(req, { userId: user });
  next();
}

export interface HarnessState {
  /** Próxima ejecución de createTransaction falla como si PostgreSQL no estuviera disponible. */
  failNextWithDbDown: boolean;
  /** Demora (ms) del comando createTransaction dentro de su transacción (TC-PLATFORM-API-009). */
  commandDelayMs: number;
  /** Simula una escritura concurrente entre el chequeo de versión y el UPDATE (TC-PLATFORM-API-014). */
  raceOnNextUpdate: boolean;
  createdWorkspaces: number;
  readonly workspaces: Map<string, WorkspaceRecord>;
  readonly listItems: Map<string, { id: string; currency: string; transactionDate: string }[]>;
  readonly userWorkspaces: Map<string, string[]>;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  baseCurrency: string;
  version: number;
  minimumLiquidityReserve: Money | null;
  createdAt: string;
}

export const newHarnessState = (): HarnessState => ({
  failNextWithDbDown: false,
  commandDelayMs: 0,
  raceOnNextUpdate: false,
  createdWorkspaces: 0,
  workspaces: new Map(),
  listItems: new Map(),
  userWorkspaces: new Map(),
});

const STATE = Symbol.for('pf.test.HarnessState');

const workspaceJson = (w: WorkspaceRecord) => ({
  id: w.id,
  name: w.name,
  baseCurrency: w.baseCurrency,
  timezone: 'America/La_Paz',
  locale: 'es-BO',
  fiscalMonthStartDay: 1,
  minimumLiquidityReserve: w.minimumLiquidityReserve,
  status: 'ACTIVE',
  role: 'OWNER',
  version: w.version,
  createdAt: w.createdAt,
});

interface StatusRes {
  setHeader(name: string, value: string): void;
}

@Controller()
class HarnessController {
  constructor(
    @Inject(STATE) private readonly state: HarnessState,
    @Inject(API_CONVENTIONS) private readonly conventions: ApiConventionsOptions,
  ) {}

  @Get('me')
  me() {
    return {
      id: randomUUID(),
      email: 'owner@pfos.test',
      displayName: 'Owner',
      locale: 'es-BO',
      timezone: 'America/La_Paz',
      memberships: [],
      version: 1,
    };
  }

  @Get('_test/boom')
  boom(): never {
    throw new Error('relation "iam.workspace" does not exist (SELECT * FROM iam.workspace)');
  }

  @Get('_test/deprecated')
  deprecated() {
    return { ok: true };
  }

  @Post('workspaces')
  createWorkspace(@Body() body: { name: string; baseCurrency: string }) {
    this.state.createdWorkspaces += 1;
    const w: WorkspaceRecord = {
      id: randomUUID(),
      name: body.name,
      baseCurrency: body.baseCurrency,
      version: 1,
      minimumLiquidityReserve: null,
      createdAt: this.conventions.clock.now().toString(),
    };
    this.state.workspaces.set(w.id, w);
    return workspaceJson(w);
  }

  @Get('workspaces')
  listWorkspaces(@ValidatedQuery() query: { limit?: number; cursor?: string }) {
    // Sin identidad aún: la colección es la sembrada en `userWorkspaces` para el usuario de prueba.
    const ids = [...(this.state.userWorkspaces.get('*') ?? [])].sort();
    const scope = { resource: 'workspaces', workspaceId: 'user', filters: {} };
    const limit = query.limit ?? 50;
    const after = query.cursor ? this.conventions.cursors.decode(query.cursor, scope) : undefined;
    const rows = ids.filter((id) => !after || id > String(after[0])).slice(0, limit + 1);
    const page = buildPage(
      rows,
      limit,
      (id): CursorPosition => [id],
      (pos) => this.conventions.cursors.encode(scope, pos),
    );
    return {
      data: page.data.map((id) => workspaceJson(this.state.workspaces.get(id) as WorkspaceRecord)),
      page: page.page,
    };
  }

  @Get('workspaces/:workspaceId')
  getWorkspace(@Param('workspaceId') id: string) {
    const w = this.state.workspaces.get(id);
    if (!w) throw new ApiProblem('RESOURCE_NOT_FOUND');
    return workspaceJson(w);
  }

  @Patch('workspaces/:workspaceId')
  updateWorkspace(
    @Param('workspaceId') id: string,
    @ExpectedVersion() expected: number,
    @Body() body: { name?: string; minimumLiquidityReserve?: { amount: string; currency: string } | null },
  ) {
    const w = this.state.workspaces.get(id);
    if (!w) throw new ApiProblem('RESOURCE_NOT_FOUND');
    if (w.version !== expected) throw preconditionFailed(w.version);
    let reserve = w.minimumLiquidityReserve;
    if (body.minimumLiquidityReserve !== undefined) {
      try {
        reserve =
          body.minimumLiquidityReserve === null
            ? null
            : Money.fromJson(body.minimumLiquidityReserve, scaleOf);
      } catch (err) {
        throw err instanceof DomainError ? err.at('/minimumLiquidityReserve/amount') : err;
      }
    }
    if (this.state.raceOnNextUpdate) {
      // Otra escritura confirmó entre el chequeo y el UPDATE ⇒ `UPDATE … WHERE version = $expected` afecta 0 filas.
      this.state.raceOnNextUpdate = false;
      w.version += 1;
      throw concurrencyConflict(w.version);
    }
    w.name = body.name ?? w.name;
    w.minimumLiquidityReserve = reserve;
    w.version += 1;
    return workspaceJson(w);
  }

  @Post('workspaces/:workspaceId/transactions')
  @HttpCode(201)
  async createTransaction(
    @Param('workspaceId') workspaceId: string,
    @Body()
    body: {
      kind: string;
      transactionDate: string;
      accountId: string;
      amount: { amount: string; currency: string };
      splits?: { amount: { amount: string; currency: string } }[];
    },
    @Res({ passthrough: true }) res: StatusRes,
  ) {
    const located = <T>(pointer: string, fn: () => T): T => {
      try {
        return fn();
      } catch (err) {
        throw err instanceof DomainError ? err.at(pointer) : err;
      }
    };
    const amount = located('/amount/amount', () => Money.fromJson(body.amount, scaleOf));
    (body.splits ?? []).forEach((s, i) =>
      located(jsonPointer('splits', i, 'amount'), () => Money.fromJson(s.amount, scaleOf)),
    );
    const date = LocalDate.parse(body.transactionDate);

    const tx = currentSqlExecutor();
    if (!tx) throw new Error('createTransaction requiere la transacción del comando');
    if (this.state.failNextWithDbDown) {
      this.state.failNextWithDbDown = false;
      throw new DependencyUnavailableError('postgres');
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO platform.test_expense (id, workspace_id, amount, currency) VALUES ($1, $2, $3, $4)`,
      [id, workspaceId, amount.toFixed(), amount.currency.code],
    );
    await tx.query(
      `INSERT INTO platform.test_balance (account_id, balance) VALUES ($1, 1000.00 - $2::numeric)
       ON CONFLICT (account_id) DO UPDATE SET balance = test_balance.balance - $2::numeric`,
      [body.accountId, amount.toFixed()],
    );
    if (this.state.commandDelayMs > 0) await new Promise((r) => setTimeout(r, this.state.commandDelayMs));
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/transactions/${id}`);
    return {
      id,
      kind: body.kind,
      transactionDate: date,
      amount,
      createdAt: this.conventions.clock.now(),
      version: 1,
    };
  }

  @Get('workspaces/:workspaceId/transactions')
  listTransactions(
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: { limit?: number; cursor?: string; currency?: string; sort?: string },
  ) {
    const { limit = 50, cursor, ...filters } = query;
    const scope = {
      resource: 'transactions',
      workspaceId,
      filters: { sort: '-transactionDate', ...filters },
    };
    const after = cursor ? this.conventions.cursors.decode(cursor, scope) : undefined;
    const items = (this.state.listItems.get(workspaceId) ?? [])
      .filter((t) => !filters.currency || t.currency === filters.currency)
      .sort((a, b) =>
        a.transactionDate === b.transactionDate
          ? a.id.localeCompare(b.id)
          : b.transactionDate.localeCompare(a.transactionDate),
      );
    const rest = after
      ? items.filter(
          (t) =>
            t.transactionDate < String(after[0]) ||
            (t.transactionDate === after[0] && t.id > String(after[1])),
        )
      : items;
    return buildPage(
      rest.slice(0, limit + 1),
      limit,
      (t): CursorPosition => [t.transactionDate, t.id],
      (pos) => this.conventions.cursors.encode(scope, pos),
    );
  }
}

@Module({})
export class HarnessModule {
  static register(state: HarnessState, conventions: ApiConventionsOptions): DynamicModule {
    return {
      module: HarnessModule,
      controllers: [HarnessController],
      providers: [
        { provide: STATE, useValue: state },
        { provide: API_CONVENTIONS, useValue: conventions },
      ],
    };
  }
}

export const currencyOf = (code: string) => currency(code, scaleOf(code));
