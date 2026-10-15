import { describe, expect, it } from 'vitest';
import {
  amortize,
  currentSchedule,
  loanDefinitions,
  loanFigures,
  loanOps,
  prepayReduceTerm,
} from './loans.js';

const ANCHOR = '2026-09-30';
const defs = Object.fromEntries(loanDefinitions(ANCHOR).map((d) => [d.key, d]));
const fixed = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;

describe('préstamos del dataset Demo v2 (TC-IDENTITY-DEMO-018)', () => {
  it('[TC-IDENTITY-DEMO-018] fechas de los préstamos respecto de la ancla 2026-09-30 (design.md decisión 4)', () => {
    expect(defs['vehicular']).toMatchObject({ disbursementDate: '2025-02-01', firstDue: '2025-03-01' });
    expect(defs['consumo']).toMatchObject({ disbursementDate: '2026-03-21', firstDue: '2026-04-21' });
    expect(defs['familiar']).toMatchObject({ disbursementDate: '2025-11-10', firstDue: '2025-12-10' });
    expect(defs['educativo']).toMatchObject({ disbursementDate: '2026-01-10', firstDue: '2026-02-10' });
  });

  it('[TC-IDENTITY-DEMO-018] francés 50000.00 BOB al 9.00 %: cuota 1589.99, cuota 1 con interés 375.00 y principal 1214.99, Σ principal = principal (INV-017)', () => {
    const rows = currentSchedule(defs['vehicular']!);
    expect(rows).toHaveLength(36);
    expect(fixed(rows[0]!.payment)).toBe('1589.99');
    expect(fixed(rows[0]!.interest)).toBe('375.00');
    expect(fixed(rows[0]!.principal)).toBe('1214.99');
    expect(rows.reduce((s, r) => s + r.principal, 0n)).toBe(5_000_000n);
    expect(rows.at(-1)!.balance).toBe(0n);
    expect(rows.at(-1)!.due).toBe('2028-02-01');
    const fig = loanFigures(defs['vehicular']!, ANCHOR);
    expect(fig).toMatchObject({
      status: 'ACTIVE',
      paid: 19,
      overdue: 0,
      outstanding: '25288.74',
      nextInstallmentNo: 20,
      nextDue: '2026-10-01',
      interestInAnchorYear: '2166.91',
    });
    expect(fixed(rows[19]!.interest)).toBe('189.67');
    expect(fixed(rows[19]!.principal)).toBe('1400.32');
    // Interés restante (cuotas 20 a 36): 1740.99.
    expect(fixed(rows.slice(19).reduce((s, r) => s + r.interest, 0n))).toBe('1740.99');
  });

  it('[TC-IDENTITY-DEMO-018] alemán 12000.00 BOB al 12.00 %: cuotas 1120, 1110, 1100 y 1090 pagadas; 1080 y 1070 en mora', () => {
    const rows = currentSchedule(defs['consumo']!);
    expect(rows.slice(0, 6).map((r) => fixed(r.payment))).toEqual([
      '1120.00',
      '1110.00',
      '1100.00',
      '1090.00',
      '1080.00',
      '1070.00',
    ]);
    expect(rows.every((r) => r.principal === 100_000n)).toBe(true);
    const fig = loanFigures(defs['consumo']!, ANCHOR);
    expect(fig).toMatchObject({
      status: 'ACTIVE',
      paid: 4,
      overdue: 2,
      overdueAmounts: ['1080.00', '1070.00'],
      outstanding: '8000.00',
      interestInAnchorYear: '420.00',
    });
    expect(rows[4]!.due).toBe('2026-08-21');
    expect(rows[5]!.due).toBe('2026-09-21');
  });

  it('[TC-IDENTITY-DEMO-018] familiar 1000.00 BOB en 3 cuotas: 340.02, 340.02 y 340.03; saldado con interés 2026 de 10.07', () => {
    const rows = currentSchedule(defs['familiar']!);
    expect(rows.map((r) => fixed(r.payment))).toEqual(['340.02', '340.02', '340.03']);
    expect(loanFigures(defs['familiar']!, ANCHOR)).toMatchObject({
      status: 'PAID_OFF',
      paid: 3,
      overdue: 0,
      outstanding: '0.00',
      interestInAnchorYear: '10.07',
    });
  });

  it('[TC-IDENTITY-DEMO-018] crédito educativo en USD: pago extraordinario de 3000.00 reduciendo plazo, versión 2, principal 1007.15 y última cuota 1017.22 el 2026-10-10', () => {
    const def = defs['educativo']!;
    const original = amortize({
      principal: def.principal,
      rate: def.rate,
      term: def.term,
      method: def.method,
      firstDue: def.firstDue,
      scale: 2,
    });
    expect(fixed(original[0]!.payment)).toBe('1066.19');
    expect(fixed(original[2]!.balance)).toBe('9132.95');
    const rows = currentSchedule(def);
    expect(rows).toHaveLength(9);
    expect(rows.at(-1)).toMatchObject({ n: 9, due: '2026-10-10' });
    expect(fixed(rows.at(-1)!.payment)).toBe('1017.22');
    expect(fixed(rows.at(-1)!.interest)).toBe('10.07');
    expect(fixed(rows.at(-1)!.principal)).toBe('1007.15');
    const fig = loanFigures(def, ANCHOR);
    expect(fig).toMatchObject({
      status: 'ACTIVE',
      paid: 8,
      overdue: 0,
      outstanding: '1007.15',
      scheduleVersion: 2,
      nextInstallmentNo: 9,
      interestInAnchorYear: '536.67',
    });
    // Ahorro de interés frente al cronograma original: 247.49 USD.
    const originalInterest = original.reduce((s, r) => s + r.interest, 0n);
    const newInterest = rows.reduce((s, r) => s + r.interest, 0n);
    expect(fixed(originalInterest - newInterest)).toBe('247.49');
    expect(rows.reduce((s, r) => s + r.principal, 0n) + 300_000n).toBe(def.principal);
  });

  it('[TC-IDENTITY-DEMO-018] interés pagado en 2026: 2596.98 BOB (2166.91 + 420.00 + 10.07; el 2597.98 de la spec era un error de suma) y 536.67 USD', () => {
    const bob = ['vehicular', 'consumo', 'familiar'].reduce(
      (s, k) => s + BigInt(loanFigures(defs[k]!, ANCHOR).interestInAnchorYear.replace('.', '')),
      0n,
    );
    expect(fixed(bob)).toBe('2596.98');
  });

  it('[TC-IDENTITY-DEMO-018] las operaciones del plan: desembolso, pagos al vencimiento y extraordinario el día de la cuota 3', () => {
    const ops = loanOps(defs['educativo']!);
    expect(ops[0]).toMatchObject({ op: 'loan', date: '2026-01-10' });
    const payments = ops.filter((o) => o.op === 'loanPayment');
    expect(payments).toHaveLength(8);
    const prepay = ops.find((o) => o.op === 'loanPrepayment');
    expect(prepay).toMatchObject({ date: '2026-04-10' });
    // Las cuotas 4 a 8 se pagan con el cronograma nuevo (versión 2).
    expect(payments.map((p) => (p.op === 'loanPayment' ? fixed(p.interest.minor) : ''))).toEqual([
      '120.00',
      '110.54',
      '100.98',
      '61.33',
      '51.28',
      '41.13',
      '30.88',
      '20.53',
    ]);
  });

  it('[TC-IDENTITY-DEMO-020] con otra ancla (2026-10-05) la mora, el saldado y el estado del vehicular se conservan', () => {
    const other = Object.fromEntries(loanDefinitions('2026-10-05').map((d) => [d.key, d]));
    expect(loanFigures(other['consumo']!, '2026-10-05').overdue).toBeGreaterThanOrEqual(1);
    expect(loanFigures(other['familiar']!, '2026-10-05').status).toBe('PAID_OFF');
    expect(loanFigures(other['vehicular']!, '2026-10-05')).toMatchObject({ paid: 19, status: 'ACTIVE' });
    expect(loanFigures(other['educativo']!, '2026-10-05').scheduleVersion).toBe(2);
  });

  it('[TC-IDENTITY-DEMO-018] simulación sobre el vehicular: un pago extra de 5000.00 BOB reduciendo plazo deja 14 cuotas y 1118.96 BOB de interés (ahorro 622.03)', () => {
    const def = defs['vehicular']!;
    const rows = currentSchedule(def);
    const sim = prepayReduceTerm(rows, 19, 500_000n, { rate: def.rate, scale: 2, firstDue: def.firstDue });
    const tail = sim.filter((r) => r.n > 19);
    expect(tail).toHaveLength(14);
    const interest = tail.reduce((s, r) => s + r.interest, 0n);
    expect(fixed(interest)).toBe('1118.96');
    expect(fixed(rows.slice(19).reduce((s, r) => s + r.interest, 0n) - interest)).toBe('622.03');
  });

  it('prepayReduceTerm exige que la cuota exista', () => {
    expect(() => prepayReduceTerm([], 3, 100n, { rate: '0.12', scale: 2, firstDue: '2026-02-10' })).toThrow(
      RangeError,
    );
  });
});
