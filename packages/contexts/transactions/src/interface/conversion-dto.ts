import type { ConversionCostDto } from '@pf/fx/contracts';
import type { Rate } from '@pf/shared-kernel';
import type { ConversionDetail } from '../domain/index.js';

/** `Rate` del contrato: tasas ingresadas con su valor exacto; derivadas con 18 decimales HALF_EVEN. */
export const rateDto = (r: Rate, exact = false) => ({
  base: r.base.code,
  quote: r.quote.code,
  value: exact ? r.value.toFixed() : r.toPersisted(),
});

/** `ConversionDetail` del contrato (montos como string decimal; `totalCost` solo en respuestas). */
export function conversionDetailDto(d: ConversionDetail, totalCost?: ConversionCostDto | null) {
  return {
    revision: d.revision,
    sourceAccountId: d.sourceAccountId,
    targetAccountId: d.targetAccountId,
    sourceAmount: d.sourceAmount.toJSON(),
    convertedSourceAmount: d.convertedSourceAmount.toJSON(),
    grossTargetAmount: d.grossTargetAmount.toJSON(),
    targetAmount: d.targetAmount.toJSON(),
    quotedRate: d.quotedRate ? rateDto(d.quotedRate, true) : null,
    effectiveRate: rateDto(d.effectiveRate),
    referenceRate: d.referenceRate
      ? {
          rate: rateDto(d.referenceRate.rate, true),
          fxRateId: d.referenceRate.fxRateId,
          source: d.referenceRate.source,
          ...(d.referenceRate.rateType ? { rateType: d.referenceRate.rateType } : {}),
          ...(d.referenceRate.asOf ? { asOf: d.referenceRate.asOf } : {}),
        }
      : null,
    spread: d.spread ? { percentage: d.spread.percentage, amount: d.spread.amount.toJSON() } : null,
    quotedRateDeviation: d.quotedRateDeviation?.toJSON() ?? null,
    ...(totalCost
      ? {
          totalCost: {
            amount: totalCost.amount,
            complete: totalCost.complete,
            missingValuations: [...totalCost.missingValuations],
          },
        }
      : {}),
    fees: d.fees.map((f) => ({
      type: f.type,
      amount: f.amount.toJSON(),
      paidFromAccountId: f.paidFromAccountId,
    })),
    provider: {
      ...(d.provider.counterpartyId ? { counterpartyId: d.provider.counterpartyId } : {}),
      ...(d.provider.name ? { name: d.provider.name } : {}),
    },
    executedAt: d.executedAt,
    externalRef: d.externalRef,
  };
}
