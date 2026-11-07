import { Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { HomeDigestComposer } from './home-digest.query.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const bob = (amount: string) => ({ amount, currency: 'BOB' });

let mem: InMemoryReporting;
const compose = () => new HomeDigestComposer(mem.upcomingDeps()).compose({ workspaceId: WS });

beforeEach(() => {
  mem = new InMemoryReporting();
  mem.spendableEnabled = true;
  mem.clock.set(Instant.parse('2026-10-20T14:00:00Z'));
  mem.hasActiveDefinitions = true;
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '4000.00');
  mem.addPeriod('2026-10', '2026-10-01', '2026-10-31', 'ACTIVE');
  mem.categories.push({
    categoryId: 'sal',
    name: 'Salario',
    kind: 'INCOME',
    parentId: null,
    systemCode: null,
    archived: false,
  });
  mem.flow('2026-10-05', 'INCOME', 'sal', '8000.00');
  mem.flow('2026-10-10', 'EXPENSE', 'sal', '4680.00');
  mem.flow('2026-09-05', 'INCOME', 'sal', '8000.00');
  mem.flow('2026-09-10', 'EXPENSE', 'sal', '4000.00');
  mem.minimumReserve = bob('1500.00');
  mem.cashFlowOccurrences.push({
    occurrenceId: 'occ-1',
    definitionId: 'def-1',
    definitionName: 'Internet',
    kind: 'EXPENSE',
    dueDate: '2026-10-22',
    status: 'SCHEDULED',
    expected: { type: 'FIXED', amount: '199.00', min: null, max: null, currency: 'BOB' },
    accountId: 'banco',
    toAccountId: null,
    managedBy: 'USER',
    categoryId: null,
  });
  mem.occurrences.push({
    occurrenceId: 'occ-1',
    definitionId: 'def-1',
    definitionName: 'Internet',
    kind: 'EXPENSE',
    dueDate: '2026-10-22',
    status: 'SCHEDULED',
    requiresApproval: false,
    expected: { type: 'FIXED', amount: '199.00', min: null, max: null, currency: 'BOB' },
    projected: bob('199.00'),
    accountId: 'banco',
    toAccountId: null,
  });
});

describe('HomeDigestQuery: resumen de las nueve preguntas para el digest (FR-NOTIFY-007)', () => {
  it('[TC-NOTIFICATIONS-DIGEST-002] entrega una pregunta por cada una de Q1 a Q9 con cantidades, porcentajes, estados, fechas y montos aparte', async () => {
    const d = await compose();
    expect(d.workspaceId).toBe(WS);
    expect(d.today).toBe('2026-10-20');
    expect(d.timeZone).toBe('America/La_Paz');
    expect(d.questions.map((q) => q.question)).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Q7',
      'Q8',
      'Q9',
    ]);
    const byId = Object.fromEntries(d.questions.map((q) => [q.question, q]));
    expect(byId['Q1']!.amounts['liquid']).toEqual(bob('4000.00'));
    expect(byId['Q5']!.states['spendableSign']).toBe('POSITIVE');
    expect(byId['Q6']!.percents['savingsRate']).toBe('41.5');
    expect(byId['Q7']!.percents).toMatchObject({ incomeChange: '0.00' });
    expect(byId['Q8']!.counts).toEqual({ upcoming7d: 1, overdue: 0 });
    expect(byId['Q8']!.states['risk']).toBe('NONE');
  });

  it('[TC-NOTIFICATIONS-DIGEST-003] una pregunta sin datos se indica como tal: sin metas, Q9 es NO_DATA y sin cuentas líquidas Q5 también', async () => {
    const d = await compose();
    const q9 = d.questions.find((q) => q.question === 'Q9')!;
    expect(q9.status).toBe('NO_DATA');
    expect(q9.counts).toEqual({});
    mem.accounts.length = 0;
    mem.balances.clear();
    const without = await compose();
    expect(without.questions.find((q) => q.question === 'Q5')?.status).toBe('NO_DATA');
    expect(without.questions.find((q) => q.question === 'Q1')?.status).toBe('NO_DATA');
  });

  it('[TC-NOTIFICATIONS-DIGEST-003] un riesgo alto informa el nivel, la moneda y la primera fecha bajo el umbral', async () => {
    mem.balances.set('banco', bob('1400.00'));
    const d = await compose();
    const q8 = d.questions.find((q) => q.question === 'Q8')!;
    expect(q8.states).toMatchObject({ risk: 'HIGH', riskCurrency: 'BOB' });
    expect(q8.dates['firstShortfall']).toBe('2026-10-20');
  });
});
