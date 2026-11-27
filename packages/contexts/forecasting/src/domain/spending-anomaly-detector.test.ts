import { dec, type Decimal } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  mainCategoryOf,
  SpendingAnomalyDetector,
  type ExpenseHistory,
  type ExpenseSubject,
} from './spending-anomaly-detector.js';

const d = (xs: readonly (string | number)[]) => xs.map((x) => dec(String(x)));
const RESTAURANTS = d([60, 65, 70, 75, 78, 80, 80, 82, 85, 90, 95, 100]);
const PIZZERIA = d([80, 85, 87, 92, 95, 95, 103, 103, 105, 110]); // mediana 95.00, MAD 8.00
const CAT = 'cat-restaurantes';
const CP = 'cp-pizzeria';

const history = (over: {
  category?: Record<string, Decimal[]>;
  counterparty?: Record<string, Decimal[]>;
  /** Clave `contraparte|categoría`. */
  counterpartyInCategory?: Record<string, Decimal[]>;
  workspace?: Decimal[];
}): ExpenseHistory => ({
  category: (id) => over.category?.[id] ?? [],
  counterparty: (id) => over.counterparty?.[id] ?? [],
  counterpartyInCategory: (id, categoryId) => over.counterpartyInCategory?.[`${id}|${categoryId}`] ?? [],
  workspace: () => over.workspace ?? [],
});

const expense = (
  value: string,
  categoryId: string | null = CAT,
  counterpartyId: string | null = null,
): ExpenseSubject => ({
  portions: [{ categoryId, value: dec(value) }],
  counterpartyId,
  total: dec(value),
});

const detect = (subject: ExpenseSubject, h: ExpenseHistory) =>
  SpendingAnomalyDetector.detect(subject, h, DEFAULT_ANOMALY_THRESHOLDS, 2);

describe('SpendingAnomalyDetector', () => {
  it('[TC-FORECAST-ANOMALY-001] 304.00 contra una mediana de 80.00 se marca por categoría con razón 3.8', () => {
    const reasons = detect(expense('304'), history({ category: { [CAT]: RESTAURANTS } }));
    expect(reasons).toEqual([
      {
        kind: 'CATEGORY_OUTLIER',
        categoryId: CAT,
        counterpartyId: null,
        reference: '80.00',
        ratio: '3.8',
        robustScore: '20.15',
        sampleSize: 12,
      },
    ]);
  });

  it('[TC-FORECAST-ANOMALY-002] 200.00 (razón 2.5) no se marca aunque el puntaje robusto supere 3.5', () => {
    expect(detect(expense('200'), history({ category: { [CAT]: RESTAURANTS } }))).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-003] con 5 gastos de historia no se evalúa por categoría', () => {
    const gifts = d([100, 120, 90, 110, 100]);
    expect(detect(expense('900', 'cat-regalos'), history({ category: { 'cat-regalos': gifts } }))).toEqual(
      [],
    );
  });

  it('[TC-FORECAST-ANOMALY-004] con MAD igual a cero alcanza la razón con la mediana (132.00 / 40.00 = 3.3)', () => {
    const forty = d(Array.from({ length: 10 }, () => 40));
    const [reason] = detect(expense('132', 'cat-lav'), history({ category: { 'cat-lav': forty } }));
    expect(reason).toMatchObject({
      kind: 'CATEGORY_OUTLIER',
      ratio: '3.3',
      robustScore: null,
      reference: '40.00',
    });
  });

  it('[TC-FORECAST-ANOMALY-004] con MAD igual a cero y razón menor que 3 no se marca', () => {
    const forty = d(Array.from({ length: 10 }, () => 40));
    expect(detect(expense('119', 'cat-lav'), history({ category: { 'cat-lav': forty } }))).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-005] un gasto atípico por categoría y por contraparte es uno con dos motivos', () => {
    const reasons = detect(
      expense('304', CAT, CP),
      history({
        category: { [CAT]: RESTAURANTS },
        counterparty: { [CP]: PIZZERIA },
        counterpartyInCategory: { [`${CP}|${CAT}`]: PIZZERIA },
      }),
    );
    expect(reasons.map((r) => [r.kind, r.ratio, r.categoryId])).toEqual([
      ['CATEGORY_OUTLIER', '3.8', CAT],
      ['COUNTERPARTY_OUTLIER', '3.2', CAT],
    ]);
    expect(reasons[1]).toMatchObject({ reference: '95.00', robustScore: '17.62', sampleSize: 10 });
  });

  it('[TC-FORECAST-ANOMALY-006] contraparte nueva sobre el percentil 99.5 del workspace', () => {
    const base = d(Array.from({ length: 198 }, (_, i) => 100 + i * 3)); // 100..691
    const sample = [...base, dec('900'), dec('1000')]; // percentil 99.5 de 200 = posición 199 = 900
    const [reason] = detect(expense('1450', null, 'cp-nueva'), history({ workspace: sample }));
    expect(reason).toMatchObject({
      kind: 'NEW_COUNTERPARTY_HIGH_AMOUNT',
      counterpartyId: 'cp-nueva',
      ratio: null,
      robustScore: null,
      sampleSize: 200,
      reference: '900.00',
    });
  });

  it('[TC-FORECAST-ANOMALY-007] contraparte nueva con un monto común no se marca', () => {
    const workspace = d(Array.from({ length: 20 }, (_, i) => (i + 1) * 50));
    expect(detect(expense('120', null, 'cp-nueva'), history({ workspace }))).toEqual([]);
    // Con el percentil 99.5 un gasto entre el percentil 95 y el 99.5 ya no se marca (D513).
    const wide = d(Array.from({ length: 200 }, (_, i) => (i + 1) * 5)); // 5..1000
    expect(detect(expense('960', null, 'cp-nueva'), history({ workspace: wide }))).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-007] sin contraparte o con menos de 8 gastos en el workspace no se evalúa como nueva', () => {
    expect(
      detect(expense('99999', null, null), history({ workspace: d([1, 2, 3, 4, 5, 6, 7, 8, 9]) })),
    ).toEqual([]);
    expect(detect(expense('99999', null, 'cp-nueva'), history({ workspace: d([1, 2, 3]) }))).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-003] una contraparte con 1 a 7 gastos previos no es nueva ni se evalúa', () => {
    const h = history({ counterparty: { [CP]: d([10, 11, 12]) }, workspace: d([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    expect(detect(expense('99999', null, CP), h)).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-027] 450.00 contra mediana 100.00 y MAD 40.00 (razón 4.5, puntaje 5.90) no se marca con el umbral 15', () => {
    const sparse = d([
      40, 55, 60, 65, 70, 75, 80, 90, 95, 100, 100, 105, 120, 130, 140, 150, 160, 165, 170, 190,
    ]);
    expect(DEFAULT_ANOMALY_THRESHOLDS.robustZ.toString()).toBe('15');
    expect(DEFAULT_ANOMALY_THRESHOLDS.newCounterpartyPercentile).toBe(99.5);
    expect(detect(expense('450', 'cat-regalos'), history({ category: { 'cat-regalos': sparse } }))).toEqual(
      [],
    );
    // Con el umbral anterior de D473 (3.5) sí se marcaría: el cambio de umbral es el que lo silencia.
    expect(
      SpendingAnomalyDetector.detect(
        expense('450', 'cat-regalos'),
        history({ category: { 'cat-regalos': sparse } }),
        { ...DEFAULT_ANOMALY_THRESHOLDS, robustZ: dec('3.5') },
        2,
      ).map((r) => r.kind),
    ).toEqual(['CATEGORY_OUTLIER']);
  });

  it('[TC-FORECAST-ANOMALY-028] una contraparte con historia en otra categoría no se evalúa por contraparte ni como nueva', () => {
    const supermarket = d(Array.from({ length: 20 }, (_, i) => 140 + (i % 5) * 5)); // mediana 150
    const h = history({
      counterparty: { hipermaxi: supermarket },
      counterpartyInCategory: { 'hipermaxi|cat-super': supermarket },
      workspace: d(Array.from({ length: 50 }, (_, i) => (i + 1) * 10)),
    });
    expect(detect(expense('900', 'cat-electro', 'hipermaxi'), h)).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-029] con varias porciones la contraparte se evalúa en la categoría de la porción mayor', () => {
    const hist = d(Array.from({ length: 10 }, (_, i) => 100 + i * 2)); // mediana 109, MAD 2.5
    const subject: ExpenseSubject = {
      portions: [
        { categoryId: 'cat-limpieza', value: dec('120') },
        { categoryId: 'cat-super', value: dec('380') },
      ],
      counterpartyId: 'hipermaxi',
      total: dec('500'),
    };
    const h = history({
      counterparty: { hipermaxi: hist },
      counterpartyInCategory: { 'hipermaxi|cat-super': hist },
    });
    const reasons = detect(subject, h);
    expect(reasons).toEqual([
      expect.objectContaining({
        kind: 'COUNTERPARTY_OUTLIER',
        categoryId: 'cat-super',
        counterpartyId: 'hipermaxi',
      }),
    ]);
    expect(mainCategoryOf(subject.portions)).toBe('cat-super');
  });

  it('[TC-FORECAST-ANOMALY-029] categoría principal: con empate la primera porción; sin categorizar no hay', () => {
    expect(
      mainCategoryOf([
        { categoryId: 'a', value: dec('50') },
        { categoryId: 'b', value: dec('50') },
      ]),
    ).toBe('a');
    expect(
      mainCategoryOf([
        { categoryId: null, value: dec('900') },
        { categoryId: 'b', value: dec('5') },
      ]),
    ).toBe('b');
    expect(mainCategoryOf([{ categoryId: null, value: dec('900') }])).toBeNull();
    // Un gasto sin porciones categorizadas con una contraparte conocida no se evalúa por contraparte.
    const hist = d(Array.from({ length: 10 }, () => 40));
    expect(detect(expense('999', null, CP), history({ counterparty: { [CP]: hist } }))).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-001] las porciones sin categoría no se evalúan por categoría', () => {
    expect(detect(expense('99999', null), history({}))).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-001] un gasto con dos porciones se evalúa por porción y solo marca la atípica', () => {
    const subject: ExpenseSubject = {
      portions: [
        { categoryId: CAT, value: dec('304') },
        { categoryId: 'cat-otra', value: dec('20') },
      ],
      counterpartyId: null,
      total: dec('324'),
    };
    const reasons = detect(
      subject,
      history({ category: { [CAT]: RESTAURANTS, 'cat-otra': d([20, 21, 19, 20, 22, 18, 20, 20]) } }),
    );
    expect(reasons.map((r) => r.categoryId)).toEqual([CAT]);
  });

  it('[TC-FORECAST-ANOMALY-002] PBT: ningún gasto por debajo de 3 veces la mediana se marca, sea cual sea la historia', () => {
    const money = fc.integer({ min: 100, max: 1_000_000 }).map((n) => dec((n / 100).toFixed(2)));
    fc.assert(
      fc.property(
        fc.array(money, { minLength: 8, maxLength: 30 }),
        fc.integer({ min: 0, max: 299 }),
        (xs, hundredths) => {
          const sorted = [...xs].sort((a, b) => a.comparedTo(b));
          const mid = sorted.length >> 1;
          const median =
            sorted.length % 2 === 1
              ? (sorted[mid] as Decimal)
              : (sorted[mid - 1] as Decimal).plus(sorted[mid] as Decimal).div(2);
          const value = median.times(dec(String(hundredths)).div(100));
          return detect(expense(value.toFixed(8)), history({ category: { [CAT]: xs } })).length === 0;
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);
});
