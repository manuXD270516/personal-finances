import { unitOfWorkKysely } from '@pf/platform/api';
import { LocalDate, type Money, type Rate } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { UnitOfWork } from '../application/ports/index.js';
import type { ConversionCostRowDto, ConversionDetailQuery, ConversionRateDto } from '../contracts/index.js';
import { loadConversionDetails } from './pg-conversion-details.js';

/** Identificadores por consulta al cargar los detalles (acota el tamaño de la lista de parámetros). */
const CHUNK = 500;

interface TxRow {
  id: string;
  revision: number;
  business_date: string;
  status: string;
}

const moneyDto = (m: Money) => m.toJSON();
const rateDto = (r: Rate): ConversionRateDto => ({
  base: r.base.code,
  quote: r.quote.code,
  value: r.value.toFixed(),
});

/**
 * `ConversionDetailQuery.listForCostAnalysis` sobre PostgreSQL (add-conversion-cost-analysis, D245; TC-FX-COST-010):
 * la revisión vigente (`txn.transaction.revision`) de las conversiones con asiento activo en el rango de fechas de
 * negocio. Las pendientes nunca entran; las anuladas solo con `includeVoided`. Lee solo el schema dueño (sin joins
 * cross-schema) y en consultas secuenciales sobre el cliente de la unidad de trabajo.
 */
export class PgConversionDetailQuery implements ConversionDetailQuery {
  constructor(private readonly uow: UnitOfWork) {}

  listForCostAnalysis(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
    readonly includeVoided?: boolean;
  }): Promise<readonly ConversionCostRowDto[]> {
    const from = LocalDate.parse(input.from).toString();
    const to = LocalDate.parse(input.to).toString();
    const statuses = input.includeVoided
      ? ['POSTED', 'CLEARED', 'RECONCILED', 'VOIDED']
      : ['POSTED', 'CLEARED', 'RECONCILED'];
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<TxRow>`
        SELECT t.id::text AS id, t.revision, t.transaction_date::text AS business_date, t.status
          FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.kind = 'CONVERSION'
           AND t.status = ANY(${statuses}::text[])
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY t.transaction_date, t.id`.execute(unitOfWorkKysely());
      const out: ConversionCostRowDto[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const maxRevision = new Map(chunk.map((r) => [r.id, Number(r.revision)]));
        const details = await loadConversionDetails(
          input.workspaceId,
          chunk.map((r) => r.id),
          maxRevision,
        );
        for (const r of chunk) {
          const current = details.get(r.id)?.find((d) => d.detail.revision === Number(r.revision));
          if (!current) continue;
          const d = current.detail;
          out.push({
            transactionId: r.id,
            revision: d.revision,
            businessDate: r.business_date,
            executedAt: d.executedAt,
            voided: r.status === 'VOIDED',
            sourceAccountId: d.sourceAccountId,
            targetAccountId: d.targetAccountId,
            counterparty: { counterpartyId: d.provider.counterpartyId, name: d.provider.name },
            sourceAmount: moneyDto(d.sourceAmount),
            convertedSourceAmount: moneyDto(d.convertedSourceAmount),
            grossTargetAmount: moneyDto(d.grossTargetAmount),
            targetAmount: moneyDto(d.targetAmount),
            quotedRate: d.quotedRate ? rateDto(d.quotedRate) : null,
            effectiveRate: rateDto(d.effectiveRate),
            referenceRate: d.referenceRate
              ? {
                  rate: rateDto(d.referenceRate.rate),
                  fxRateId: d.referenceRate.fxRateId,
                  source: d.referenceRate.source,
                  rateType: d.referenceRate.rateType ?? null,
                  asOf: d.referenceRate.asOf ?? null,
                }
              : null,
            spread: d.spread ? { percentage: d.spread.percentage, amount: moneyDto(d.spread.amount) } : null,
            fees: d.fees.map((f) => ({
              type: f.type,
              amount: moneyDto(f.amount),
              paidFromAccountId: f.paidFromAccountId,
            })),
          });
        }
      }
      return out;
    });
  }
}
