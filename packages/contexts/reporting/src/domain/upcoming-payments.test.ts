import { currency, dec, DomainError, Instant, LocalDate, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  UpcomingPaymentsAssembler,
  UpcomingWindow,
  type AccountClass,
  type OccurrenceInput,
  type PendingInput,
} from './upcoming-payments.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);

const TODAY = LocalDate.parse('2026-10-20');
const LIQUID: AccountClass = { nature: 'ASSET', liquidity: 'LIQUID' };
const SAVINGS: AccountClass = { nature: 'ASSET', liquidity: 'ILLIQUID' };
const CLASSES = new Map<string, AccountClass>([
  ['banco', LIQUID],
  ['caja', LIQUID],
  ['ahorro', SAVINGS],
]);

const occ = (name: string, dueDate: string, over: Partial<OccurrenceInput> = {}): OccurrenceInput => ({
  occurrenceId: `occ-${name}`,
  definitionId: `def-${name}`,
  name,
  dueDate,
  status: 'SCHEDULED',
  requiresApproval: false,
  amountType: 'FIXED',
  amount: bob('100.00'),
  min: null,
  max: null,
  accountId: 'banco',
  toAccountId: null,
  ...over,
});

const pend = (
  name: string,
  businessDate: string,
  amount: Money,
  over: Partial<PendingInput> = {},
): PendingInput => ({
  transactionId: `txn-${name}`,
  kind: 'EXPENSE',
  direction: 'OUT',
  businessDate,
  accountId: 'banco',
  toAccountId: null,
  amount,
  description: name,
  externalRef: null,
  ...over,
});

const assemble = (
  occurrences: readonly OccurrenceInput[],
  pending: readonly PendingInput[] = [],
  through = '2026-11-19',
) => UpcomingPaymentsAssembler.assemble({ today: TODAY, through, occurrences, pending, classes: CLASSES });

const names = (items: readonly { name: string }[]) => items.map((i) => i.name);
const total = (items: Parameters<typeof UpcomingPaymentsAssembler.totals>[0]) =>
  UpcomingPaymentsAssembler.totals(items)
    .lines.reduce((acc, m) => acc.plus(m.amount), dec('0'))
    .toFixed(2);

describe('UpcomingPaymentsAssembler: lista (reporting/cash-flow-calendar)', () => {
  it('[TC-REPORTING-UPCOMING-001] une ocurrencias y pendientes de egreso por fecha: Cena, Internet, Luz, Alquiler', () => {
    const items = assemble(
      [
        occ('Alquiler', '2026-11-01', { amount: bob('2500.00') }),
        occ('Luz', '2026-10-28', { amount: bob('180.00') }),
        occ('Internet', '2026-10-22', { amount: bob('199.00') }),
        occ('Seguro anual', '2026-12-15', { amount: bob('900.00') }),
      ],
      [pend('Cena', '2026-10-18', bob('300.00'))],
    );
    expect(names(items)).toEqual(['Cena', 'Internet', 'Luz', 'Alquiler']);
    expect(total(items)).toBe('3179.00');
    expect(items[0]).toMatchObject({ kind: 'PENDING_TRANSACTION', status: 'PENDING', amountType: 'ACTUAL' });
    expect(items[0]?.daysOverdue).toBeUndefined();
  });

  it('[TC-REPORTING-UPCOMING-002] solo lo que Commitments informa como no resuelto se lista: Cena, Luz y Alquiler', () => {
    // "Internet" (aprobada y posteada) y "Agua" (omitida) no llegan: Commitments no las informa.
    const items = assemble(
      [
        occ('Alquiler', '2026-11-01', { amount: bob('2500.00') }),
        occ('Luz', '2026-10-28', { amount: bob('180.00') }),
      ],
      [pend('Cena', '2026-10-18', bob('300.00'))],
    );
    expect(names(items)).toEqual(['Cena', 'Luz', 'Alquiler']);
    expect(total(items)).toBe('2980.00');
  });

  it('[TC-REPORTING-UPCOMING-003] los ingresos pendientes no suman ni se listan', () => {
    const items = assemble(
      [occ('Internet', '2026-10-22', { amount: bob('199.00') })],
      [pend('Sueldo', '2026-10-25', bob('8000.00'), { kind: 'INCOME', direction: 'IN' })],
    );
    expect(names(items)).toEqual(['Internet']);
    expect(total(items)).toBe('199.00');
  });

  it('[TC-REPORTING-UPCOMING-005] el vencido sin resolver va primero con 5 días de atraso y suma', () => {
    const items = assemble([
      occ('Internet', '2026-10-22', { amount: bob('199.00') }),
      occ('Netflix', '2026-10-15', { amount: bob('49.00'), status: 'OVERDUE' }),
    ]);
    expect(names(items)).toEqual(['Netflix', 'Internet']);
    expect(items[0]).toMatchObject({ status: 'OVERDUE', daysOverdue: 5 });
    expect(items[1]?.daysOverdue).toBeUndefined();
    expect(total(items)).toBe('248.00');
  });

  it('[TC-REPORTING-UPCOMING-005] un vencido de cualquier antigüedad se lista aunque Commitments aún lo marque SCHEDULED', () => {
    const items = assemble([occ('Seguro', '2026-08-01', { status: 'SCHEDULED' })]);
    expect(items[0]).toMatchObject({ status: 'OVERDUE', daysOverdue: 80 });
  });

  it('[TC-REPORTING-UPCOMING-005] una pendiente con fecha anterior a hoy es PENDING, no vencida', () => {
    const [cena] = assemble([], [pend('Cena', '2026-10-01', bob('300.00'))]);
    expect(cena).toMatchObject({ status: 'PENDING' });
    expect(cena?.daysOverdue).toBeUndefined();
  });

  it('una ocurrencia que requiere aprobación se marca PENDING_APPROVAL', () => {
    const [a] = assemble([occ('Luz', '2026-10-23', { status: 'DUE', requiresApproval: true })]);
    expect(a).toMatchObject({ status: 'PENDING_APPROVAL', requiresApproval: true });
  });

  it('el orden es por fecha, luego por nombre normalizado (sin tildes ni mayúsculas) y luego por id', () => {
    const items = assemble([
      occ('Zeta', '2026-10-25'),
      occ('árbol', '2026-10-25'),
      occ('Beta', '2026-10-25'),
      occ('Antes', '2026-10-24'),
    ]);
    expect(names(items)).toEqual(['Antes', 'árbol', 'Beta', 'Zeta']);
  });

  it('la ventana deja fuera lo posterior a `through`, también en pendientes', () => {
    const items = assemble(
      [occ('Lejos', '2026-11-20'), occ('Justo', '2026-11-19')],
      [pend('PendLejos', '2026-12-01', bob('1.00'))],
    );
    expect(names(items)).toEqual(['Justo']);
  });
});

describe('UpcomingPaymentsAssembler: transferencias (D127)', () => {
  it('una pendiente de cuenta líquida a no líquida cuenta; entre líquidas no', () => {
    const items = assemble(
      [],
      [
        pend('Ahorro', '2026-10-25', bob('500.00'), { kind: 'TRANSFER', toAccountId: 'ahorro' }),
        pend('Entre cajas', '2026-10-25', bob('900.00'), { kind: 'TRANSFER', toAccountId: 'caja' }),
      ],
    );
    expect(names(items)).toEqual(['Ahorro']);
    expect(total(items)).toBe('500.00');
  });
});

describe('UpcomingPaymentsAssembler: tipo de monto (FR-COMMITMENTS-004)', () => {
  const four = (luz = '180.00') =>
    assemble([
      occ('Internet', '2026-10-22', { amount: bob('199.00') }),
      occ('Luz', '2026-10-23', { amountType: 'ESTIMATED', amount: bob(luz) }),
      occ('Gimnasio', '2026-10-24', {
        amountType: 'MIN_MAX',
        amount: null,
        min: bob('150.00'),
        max: bob('200.00'),
      }),
      occ('Agua', '2026-10-25', { amountType: 'VARIABLE', amount: null }),
    ]);

  it('[TC-REPORTING-UPCOMING-006] FIXED exacto, ESTIMATED marcado, MIN_MAX con rango y VARIABLE sin monto', () => {
    const [internet, luz, gym, agua] = four();
    expect(internet).toMatchObject({ amountType: 'FIXED', estimated: false, withoutAmount: false });
    expect(internet?.amount?.toFixed()).toBe('199.00');
    expect(luz).toMatchObject({ amountType: 'ESTIMATED', estimated: true });
    expect(gym?.range?.min.toFixed()).toBe('150.00');
    expect(gym?.range?.max.toFixed()).toBe('200.00');
    expect(gym?.amount).toBeNull();
    expect(agua).toMatchObject({ amountType: 'VARIABLE', withoutAmount: true, amount: null });
  });

  it('[TC-REPORTING-UPCOMING-006] el total es 579.00 con el máximo del rango y 1 pago sin monto', () => {
    const items = four();
    expect(total(items)).toBe('579.00');
    expect(UpcomingPaymentsAssembler.totals(items).withoutAmountCount).toBe(1);
  });

  it('[TC-REPORTING-UPCOMING-006] el monto editado de la ocurrencia reemplaza al de la definición: total 594.00', () => {
    const items = four('195.00');
    expect(total(items)).toBe('594.00');
    expect(UpcomingPaymentsAssembler.totals(items).withoutAmountCount).toBe(1);
  });

  it('[TC-REPORTING-UPCOMING-006] PBT: el total nunca incluye ítems sin monto ni baja de la suma de los mínimos', () => {
    const type = fc.constantFrom('FIXED', 'ESTIMATED', 'MIN_MAX', 'VARIABLE');
    const cents = fc.integer({ min: 1, max: 1_000_000 });
    fc.assert(
      fc.property(fc.array(fc.tuple(type, cents, cents), { maxLength: 12 }), (rows) => {
        const m = (c: number) => Money.ofMinorUnits(BigInt(c), BOB);
        const occurrences = rows.map(([t, a, b], i): OccurrenceInput => {
          return occ(`o${i}`, '2026-10-25', {
            occurrenceId: `o${i}`,
            amountType: t as OccurrenceInput['amountType'],
            amount: t === 'FIXED' || t === 'ESTIMATED' ? m(a) : null,
            min: t === 'MIN_MAX' ? m(Math.min(a, b)) : null,
            max: t === 'MIN_MAX' ? m(Math.max(a, b)) : null,
          });
        });
        const items = assemble(occurrences);
        const { lines, withoutAmountCount } = UpcomingPaymentsAssembler.totals(items);
        const sum = lines.reduce((acc, x) => acc.plus(x.amount), dec('0'));
        const minimums = occurrences.reduce(
          (acc, o) => acc.plus((o.amountType === 'MIN_MAX' ? o.min : o.amount)?.amount ?? dec('0')),
          dec('0'),
        );
        expect(lines.length + withoutAmountCount).toBe(items.length);
        expect(withoutAmountCount).toBe(occurrences.filter((o) => o.amountType === 'VARIABLE').length);
        expect(sum.gte(minimums)).toBe(true);
      }),
    );
  });
});

describe('UpcomingPaymentsAssembler: sin doble conteo ocurrencia y pendiente', () => {
  const luzPending = pend('Luz', '2026-10-20', bob('185.40'), {
    externalRef: { namespace: 'commitments.occurrence', id: 'occ-Luz' },
  });
  const rest = [
    occ('Internet', '2026-10-22', { amount: bob('199.00') }),
    occ('Alquiler', '2026-11-01', { amount: bob('2500.00') }),
  ];
  const cena = pend('Cena', '2026-10-18', bob('300.00'));

  it('[TC-REPORTING-UPCOMING-007] Luz materializada como pendiente aparece una vez con 185.40 y su ocurrencia de origen', () => {
    const items = assemble(rest, [cena, luzPending]);
    const luz = items.filter((i) => i.name === 'Luz');
    expect(luz).toHaveLength(1);
    expect(luz[0]).toMatchObject({
      kind: 'PENDING_TRANSACTION',
      occurrenceId: 'occ-Luz',
      amountType: 'ACTUAL',
    });
    expect(luz[0]?.amount?.toFixed()).toBe('185.40');
    expect(total(items)).toBe('3184.40');
  });

  it('[TC-REPORTING-UPCOMING-007] si Commitments aún informa la ocurrencia junto a su pendiente, gana la pendiente (monto real)', () => {
    const items = assemble(
      [...rest, occ('Luz', '2026-10-20', { amountType: 'ESTIMATED', amount: bob('180.00') })],
      [cena, luzPending],
    );
    expect(items.filter((i) => i.name === 'Luz')).toHaveLength(1);
    expect(total(items)).toBe('3184.40');
  });

  it('[TC-REPORTING-UPCOMING-007] PBT: cada occurrenceId aparece a lo sumo una vez', () => {
    const ids = fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 10 });
    fc.assert(
      fc.property(ids, ids, (occIds, pendIds) => {
        const occurrences = [...new Set(occIds)].map((n) =>
          occ(`o${n}`, '2026-10-25', { occurrenceId: `o${n}` }),
        );
        const pending = pendIds.map((n, i) =>
          pend(`p${i}`, '2026-10-25', bob('1.00'), {
            transactionId: `t${i}`,
            externalRef: { namespace: 'commitments.occurrence', id: `o${n}` },
          }),
        );
        const items = assemble(occurrences, pending);
        const seen = items.map((i) => i.occurrenceId).filter((x): x is string => x !== undefined);
        expect(new Set(seen).size).toBe(seen.length);
      }),
    );
  });

  it('[TC-REPORTING-UPCOMING-008] al postear la pendiente deja de venir y la lista suma 2999.00', () => {
    const items = assemble(rest, [cena]);
    expect(names(items)).toEqual(['Cena', 'Internet', 'Alquiler']);
    expect(total(items)).toBe('2999.00');
  });

  it('una pendiente con otro namespace no se confunde con una ocurrencia', () => {
    const items = assemble(
      [occ('X', '2026-10-25', { occurrenceId: 'abc' })],
      [pend('Otra', '2026-10-25', bob('1.00'), { externalRef: { namespace: 'imports.row', id: 'abc' } })],
    );
    expect(items).toHaveLength(2);
  });
});

describe('UpcomingWindow: "hoy" en la zona del workspace', () => {
  it('[TC-REPORTING-UPCOMING-012] a las 23:30 en La Paz la ventana de 7 días es 2026-10-20..2026-10-27', () => {
    const w = UpcomingWindow.of(Instant.parse('2026-10-21T03:30:00Z'), 'America/La_Paz', 7);
    expect(w.from.toString()).toBe('2026-10-20');
    expect(w.to.toString()).toBe('2026-10-27');
    const items = UpcomingPaymentsAssembler.assemble({
      today: w.from,
      through: w.to.toString(),
      occurrences: [
        occ('Agua', '2026-10-27', { amount: bob('60.00') }),
        occ('Luz', '2026-10-28', { amount: bob('180.00') }),
      ],
      pending: [],
      classes: CLASSES,
    });
    expect(names(items)).toEqual(['Agua']);
  });

  it('[TC-REPORTING-UPCOMING-012] con la fecha UTC la ventana correría un día (control negativo)', () => {
    const utc = LocalDate.ofInstant(Instant.parse('2026-10-21T03:30:00Z'), 'UTC');
    expect(utc.toString()).toBe('2026-10-21');
  });

  it('[TC-REPORTING-UPCOMING-004] 0, 91 y no enteros se rechazan con INVALID_FILTER; 1 y 90 pasan', () => {
    const now = Instant.parse('2026-10-20T14:00:00Z');
    for (const bad of [0, 91, -1, 1.5, Number.NaN]) {
      let caught: unknown;
      try {
        UpcomingWindow.of(now, 'America/La_Paz', bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe('INVALID_FILTER');
    }
    expect(UpcomingWindow.of(now, 'America/La_Paz', 1).to.toString()).toBe('2026-10-21');
    expect(UpcomingWindow.of(now, 'America/La_Paz', 90).to.toString()).toBe('2027-01-18');
    expect(UpcomingWindow.of(now, 'America/La_Paz', undefined).days).toBe(30);
  });
});
