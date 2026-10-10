import { currency, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { SurprisePaymentClassifier, type ResolvedOutflowInput } from './surprise-payments.js';

const BOB = currency('BOB', 2);
const TZ = 'America/La_Paz';

const resolved = (
  name: string,
  transactionDate: string,
  generatedAt: string,
  amount: string,
): ResolvedOutflowInput => ({
  occurrenceId: `occ-${name}`,
  definitionId: `def-${name}`,
  definitionName: name,
  generatedAt,
  transactionId: `txn-${name}`,
  transactionDate,
  amount: Money.parse(amount, BOB),
});

const classify = (r: readonly ResolvedOutflowInput[], today = '2026-10-20', end = '2026-10-31') =>
  SurprisePaymentClassifier.classify({
    resolved: r,
    timeZone: TZ,
    periodStart: '2026-10-01',
    periodEnd: end,
    today,
  });

describe('SurprisePaymentClassifier (SM-07)', () => {
  it('[TC-REPORTING-UPCOMING-021] Seguro modelado el 12 y pagado el 5 es sorpresa; Internet generada en julio no', () => {
    const r = classify([
      resolved('Seguro auto', '2026-10-05', '2026-10-12T15:00:00Z', '350.00'),
      resolved('Internet', '2026-10-22', '2026-07-24T10:00:00Z', '199.00'),
    ]);
    expect(r.items.map((i) => i.name)).toEqual(['Seguro auto']);
    expect(r.items[0]?.amount.toFixed()).toBe('350.00');
    expect(r.items[0]?.generatedOn).toBe('2026-10-12');
    expect(r.partial).toBe(true);
  });

  it('[TC-REPORTING-UPCOMING-021] generada el mismo día del pago cuenta; el día anterior no', () => {
    const same = classify([resolved('A', '2026-10-05', '2026-10-05T18:00:00Z', '10.00')]);
    expect(same.items).toHaveLength(1);
    const before = classify([resolved('B', '2026-10-05', '2026-10-04T18:00:00Z', '10.00')]);
    expect(before.items).toHaveLength(0);
  });

  it('[TC-REPORTING-UPCOMING-021] la fecha de generación es la local: 01:00Z del día 6 es el 5 en La Paz', () => {
    const r = classify([resolved('A', '2026-10-05', '2026-10-06T01:00:00Z', '10.00')]);
    expect(r.items[0]?.generatedOn).toBe('2026-10-05');
  });

  it('[TC-REPORTING-UPCOMING-021] solo cuentan pagos con fecha en el periodo', () => {
    const r = classify([
      resolved('Fuera', '2026-09-30', '2026-10-12T15:00:00Z', '10.00'),
      resolved('Dentro', '2026-10-31', '2026-10-31T15:00:00Z', '10.00'),
    ]);
    expect(r.items.map((i) => i.name)).toEqual(['Dentro']);
  });

  it('[TC-REPORTING-UPCOMING-021] un periodo terminado sin sorpresas informa 0 sin marca de parcial', () => {
    const r = classify([resolved('Internet', '2026-10-22', '2026-07-24T10:00:00Z', '199.00')], '2026-11-05');
    expect(r.items).toHaveLength(0);
    expect(r.partial).toBe(false);
  });

  it('el último día del periodo todavía es parcial', () => {
    expect(classify([], '2026-10-31').partial).toBe(true);
    expect(classify([], '2026-11-01').partial).toBe(false);
  });
});
