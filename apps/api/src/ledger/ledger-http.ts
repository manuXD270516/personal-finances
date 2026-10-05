import { Controller, Get, Inject, Module, Param, type DynamicModule } from '@nestjs/common';
import type { BalanceQuery, LedgerAccountNatureDto, MoneyDto, TrialBalanceDto } from '@pf/ledger/contracts';
import { API_CONVENTIONS, ValidatedQuery, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError } from '@pf/shared-kernel';

export const LEDGER_BALANCE_QUERY = Symbol('LEDGER_BALANCE_QUERY');

/** `TrialBalanceLine` del contrato HTTP (saldo contable con signo: débito +, crédito −). */
export interface TrialBalanceLineBody {
  readonly ledgerAccountId: string;
  readonly code: string;
  readonly nature: LedgerAccountNatureDto;
  readonly accountId: string | null;
  readonly balance: MoneyDto;
}

/** `TrialBalance` del contrato HTTP (`getLedgerTrialBalance`). */
export interface TrialBalanceBody {
  readonly asOf: string;
  readonly currencies: readonly {
    readonly currency: string;
    readonly lines: readonly TrialBalanceLineBody[];
    readonly total: MoneyDto;
  }[];
}

const byCode = (a: { code: string }, b: { code: string }) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * Proyección del `TrialBalanceDto` interno al cuerpo del contrato: solo el saldo contable de cada cuenta (sin el
 * presentado por naturaleza), monedas y líneas en orden estable por código. El total por moneda lo calcula el ledger
 * en decimal exacto a la escala de la moneda (INV-004: siempre cero).
 */
export function toTrialBalanceBody(trial: TrialBalanceDto, asOf: string): TrialBalanceBody {
  return {
    asOf,
    currencies: [...trial.currencies]
      .sort((a, b) => byCode({ code: a.currency }, { code: b.currency }))
      .map((c) => ({
        currency: c.currency,
        lines: [...c.lines].sort(byCode).map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          code: l.code,
          nature: l.nature,
          accountId: l.accountId,
          balance: l.balance,
        })),
        total: c.total,
      })),
  };
}

/**
 * `GET /api/v1/workspaces/{workspaceId}/ledger/trial-balance` (`getLedgerTrialBalance`, `x-required-role: VIEWER`,
 * docs/31 D44; openspec add-ledger-core 6.3). Autenticación, membresía/rol y validación de `asOf` las aplican las
 * convenciones globales con el contrato; la lectura usa la API pública de LEDGER (`BalanceQuery.getTrialBalance`, bajo
 * RLS en su unidad de trabajo). Sin `asOf`, el corte es hoy en la zona horaria del workspace. Vive en el composition
 * root (como el resto del cableado del ledger, que no tiene módulo HTTP propio).
 */
@Controller()
export class LedgerController {
  constructor(@Inject(LEDGER_BALANCE_QUERY) private readonly balances: BalanceQuery) {}

  @Get('workspaces/:workspaceId/ledger/trial-balance')
  async getLedgerTrialBalance(
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Record<string, unknown>,
  ): Promise<TrialBalanceBody> {
    const requested = typeof query['asOf'] === 'string' ? query['asOf'] : undefined;
    const trial = await this.balances.getTrialBalance({
      workspaceId,
      ...(requested ? { asOf: requested } : {}),
    });
    if (trial.asOf === null) throw new DomainError('REFERENCE_NOT_FOUND', 'workspace not found');
    return toTrialBalanceBody(trial, trial.asOf);
  }
}

/** Módulo HTTP de la vista técnica del ledger (solo `getLedgerTrialBalance`). */
@Module({})
export class LedgerHttpModule {
  static register(options: {
    readonly balances: BalanceQuery;
    readonly conventions: ApiConventionsOptions;
  }): DynamicModule {
    return {
      module: LedgerHttpModule,
      controllers: [LedgerController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: LEDGER_BALANCE_QUERY, useValue: options.balances },
      ],
    };
  }
}
