import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Account } from '../common/types';
import { DashboardView } from '../dashboard/DashboardView';
import { EMPTY_SUMMARY, SUMMARY } from '../dashboard/fixtures';
import { GoalsCard } from '../dashboard/GoalsCard';
import type { ReportSummary } from '../dashboard/types';
import { BudgetGoalContributionsView } from '../planning/BudgetGoalContributions';
import { esContext, textOf } from '../test-support';
import { GoalOverview, LinkedAccountsTable, MovementsTable, PlanCard, SimulationResult } from './DetailParts';
import { GoalFields } from './GoalForm';
import { ProblemExtras } from './GoalPanels';
import { GoalsTable } from './GoalsList';
import { emptyGoalForm, formFromGoal } from './logic';
import { GoalStatusBadge, RatesUsed } from './parts';
import { ReservationsTable } from './Reservations';
import { SuggestionRow, SuggestionsView } from './Suggestions';
import { TransactionGoalView } from './TransactionGoalInfo';
import { bob, goal, homeItem, IDS, movement, plan, reservation, suggestion, tracking, usd } from './fixtures';
import type { BudgetGoalContributions, GoalsHomeBlock, GoalSimulation } from './types';

const f = esContext('Goals');
const dash = esContext('Dashboard');
const budgets = esContext('Budgets');
const href = (p: string) => `/es${p}`;
const noop = () => undefined;
const name = (id: string) => (id === IDS.savings ? 'Ahorro BOB' : id === IDS.bank ? 'Banco BOB' : undefined);

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('listado de metas', () => {
  const goals = [
    goal(),
    goal({
      id: IDS.trip,
      name: 'Viaje a Cusco',
      type: 'TRAVEL',
      priority: 2,
      target: bob('10000.00'),
      progress: {
        byCurrency: [bob('4500.00')],
        total: bob('4500.00'),
        percent: '45.00',
        remaining: bob('5500.00'),
        complete: true,
        unconverted: [],
      },
      tracking: tracking({ status: 'ON_TRACK', deviationPercent: '-1.00' }),
      expectedDate: { date: null, reason: 'NO_PACE' },
    }),
    goal({
      id: IDS.laptop,
      name: 'Laptop',
      priority: 2,
      targetDate: null,
      overAllocated: true,
      required: { monthly: null, periods: null, overdue: false },
      tracking: tracking({ status: null, expected: null, deviationPercent: null }),
      progress: {
        byCurrency: [bob('2000.00')],
        total: bob('2000.00'),
        percent: '22.22',
        remaining: bob('7000.00'),
        complete: false,
        unconverted: [usd('50.00')],
      },
      target: bob('9000.00'),
    }),
  ];
  const html = render(<GoalsTable goals={goals} f={f} href={href} />);

  it('[TC-GOALS-SAVINGS-030] muestra progreso con porcentaje en texto, barra con nombre y valor, y el restante', () => {
    expect(html).toContain('data-testid="goals-table"');
    expect(html.match(/data-testid="goal-row"/g)).toHaveLength(3);
    expect(textOf(html)).toContain('33,33 %');
    expect(textOf(html)).toContain('5.000,00 de 15.000,00 BOB');
    expect(html).toMatch(/role="progressbar"[^>]*aria-label="Progreso de la meta Fondo de emergencia"/);
    expect(html).toMatch(/aria-valuenow="33"/);
    expect(html).toMatch(/aria-valuetext="33,33 % · 5\.000,00 de 15\.000,00 BOB"/);
    // Accesibilidad estructural: leyenda, encabezados de columna y de fila.
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it('[TC-GOALS-SAVINGS-034] el estado se dice con texto + icono decorativo (no solo color)', () => {
    expect(html).toMatch(/data-status="BEHIND"[^>]*><span aria-hidden="true">▼<\/span> Atrasada/);
    expect(html).toMatch(/data-status="ON_TRACK"[^>]*><span aria-hidden="true">●<\/span> En ritmo/);
    // Sin fecha objetivo no hay avance: se informa el estado de ciclo de vida.
    expect(html).toMatch(/data-status="ACTIVE"[^>]*><span aria-hidden="true">●<\/span> Activa/);
  });

  it('[TC-GOALS-SAVINGS-031] el requerido mensual, o guion sin fecha objetivo; y la fecha esperada o "sin ritmo suficiente"', () => {
    const rows = html.match(/<tr data-testid="goal-row"[\s\S]*?<\/tr>/g) ?? [];
    expect(textOf(rows[0] ?? '')).toContain('1.666,67 BOB por mes');
    expect(textOf(rows[0] ?? '')).toContain('31/07/2027');
    expect(textOf(rows[1] ?? '')).toContain('Sin ritmo suficiente');
    expect(textOf(rows[2] ?? '')).toContain('Sin fecha');
    expect(rows[2]).toMatch(/data-testid="goal-required"[^>]*>—</);
  });

  it('[TC-GOALS-SAVINGS-016] marca la meta sobre-asignada y avisa del progreso parcial sin convertir 1:1', () => {
    const rows = html.match(/<tr data-testid="goal-row"[\s\S]*?<\/tr>/g) ?? [];
    expect(rows[2]).toContain('data-testid="goal-over-allocated"');
    expect(textOf(rows[2] ?? '')).toContain('Sobre-asignada');
    expect(rows[2]).toContain('data-over-allocated="true"');
    expect(rows[0]).not.toContain('data-testid="goal-over-allocated"');
    expect(textOf(rows[2] ?? '')).toContain('sin tasa vigente para 50,00 USD');
  });

  it('[TC-GOALS-SAVINGS-032] una meta con fecha vencida muestra el restante íntegro como vencida', () => {
    const late = render(
      <GoalsTable
        goals={[goal({ required: { monthly: bob('10000.00'), periods: 0, overdue: true } })]}
        f={f}
        href={href}
      />,
    );
    expect(late).toContain('data-testid="goal-overdue"');
    expect(textOf(late)).toContain('Vencida: faltan 10.000,00 BOB');
  });

  it('enlaza cada meta a su detalle y sobre 100 % la barra queda llena con el porcentaje real', () => {
    expect(html).toContain(`href="/es/goals/${IDS.emergency}"`);
    const done = render(
      <GoalsTable
        goals={[
          goal({
            status: 'ACHIEVED',
            achievedOn: '2026-12-01',
            progress: {
              byCurrency: [bob('12500.00')],
              total: bob('12500.00'),
              percent: '104.17',
              remaining: bob('0.00'),
              complete: true,
              unconverted: [],
            },
            tracking: tracking({ status: null, lifecycleStatus: 'ACHIEVED' }),
            expectedDate: { date: null, reason: null },
          }),
        ]}
        f={f}
        href={href}
      />,
    );
    expect(textOf(done)).toContain('104,17 %');
    expect(done).toMatch(/aria-valuenow="100"/);
    expect(textOf(done)).toContain('Alcanzada el 01/12/2026');
    expect(textOf(done)).toContain('Alcanzada');
  });
});

describe('formulario de la meta', () => {
  const accounts: Account[] = [
    { id: IDS.savings, name: 'Ahorro BOB', currency: 'BOB', status: 'ACTIVE', classification: 'ASSET' },
    { id: IDS.bank, name: 'Banco BOB', currency: 'BOB', status: 'ACTIVE', classification: 'ASSET' },
    { id: 'card', name: 'Tarjeta X', currency: 'BOB', status: 'ACTIVE', classification: 'LIABILITY' },
    { id: 'old', name: 'Cuenta cerrada', currency: 'BOB', status: 'CLOSED', classification: 'ASSET' },
  ] as unknown as Account[];

  it('[TC-GOALS-SAVINGS-001] pide tipo, objetivo, fechas, cuentas vinculadas, prioridad y tolerancia', () => {
    const html = render(
      <GoalFields
        f={f}
        form={{ ...emptyGoalForm('BOB', '2026-10-01'), linkedAccountIds: [IDS.savings] }}
        set={noop}
        errors={{}}
        accounts={accounts}
        currencies={['BOB', 'USD']}
      />,
    );
    for (const id of [
      'goal-name',
      'goal-type',
      'goal-target',
      'goal-currency',
      'goal-start-date',
      'goal-target-date-input',
      'goal-priority',
      'goal-tolerance',
      'goal-pace-periods',
    ])
      expect(html).toContain(`data-testid="${id}"`);
    // Solo cuentas activas de naturaleza activo (sin pasivos ni cerradas).
    expect(html.match(/data-testid="goal-account"/g)).toHaveLength(2);
    expect(html).not.toContain('Tarjeta X');
    expect(html).not.toContain('Cuenta cerrada');
    expect(html).toMatch(/data-account-id="[^"]*a1"[^>]*checked|checked=""[^>]*data-account-id/);
    expect(html).toContain('<legend>Cuentas vinculadas</legend>');
    expect(html).toContain('Fondo de emergencia');
  });

  it('[TC-GOALS-SAVINGS-002] muestra el error de cada campo asociado con aria-describedby y aria-invalid', () => {
    const html = render(
      <GoalFields
        f={f}
        form={emptyGoalForm('BOB', '2026-10-01')}
        set={noop}
        errors={{ name: 'REQUIRED', target: 'SCALE', targetDate: 'DATE_ORDER' }}
        accounts={accounts}
        currencies={['BOB']}
      />,
    );
    expect(html.match(/data-testid="field-error"/g)).toHaveLength(3);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
    expect(textOf(html)).toContain('Este dato es obligatorio.');
    expect(textOf(html)).toContain('Tiene más decimales de los que admite.');
    expect(textOf(html)).toContain('La fecha objetivo no puede ser anterior a la de inicio.');
  });

  it('[TC-GOALS-SAVINGS-005] en edición la fecha de inicio no se edita y la moneda se bloquea con fondos', () => {
    const g = goal();
    const html = render(
      <GoalFields
        f={f}
        form={formFromGoal(g)}
        set={noop}
        errors={{}}
        accounts={accounts}
        currencies={['BOB', 'USD']}
        editing
        currencyLocked
      />,
    );
    expect(html).toMatch(
      /data-testid="goal-start-date"[^>]*disabled|disabled=""[^>]*data-testid="goal-start-date"/,
    );
    expect(html).toMatch(
      /disabled=""[^>]*data-testid="goal-currency"|data-testid="goal-currency"[^>]*disabled/,
    );
    expect(textOf(html)).toContain('La moneda no cambia cuando la meta ya tiene fondos o un plan.');
    expect(html).toContain('value="15000.00"');
  });
});

describe('detalle de la meta', () => {
  it('[TC-GOALS-SAVINGS-033] resume progreso, restante, requerido, ritmo, fecha esperada y desvío', () => {
    const html = render(<GoalOverview goal={goal()} f={f} />);
    const t = textOf(html);
    expect(t).toContain('33,33 %');
    expect(html).toMatch(/data-testid="goal-remaining"[^>]*>10\.000,00 BOB</);
    expect(html).toMatch(/data-testid="goal-required"[^>]*>1\.666,67 BOB por mes</);
    expect(t).toContain('1.000,00 BOB por mes (últimos 3 periodos; historial)');
    expect(html).toMatch(/data-testid="goal-expected"[^>]*>31\/07\/2027</);
    expect(t).toContain('-6,00 % respecto de lo esperado (5.000,00 BOB)');
    expect(t).toContain('5,00 %');
  });

  it('[TC-GOALS-SAVINGS-036] con fondos en dos monedas lista cada moneda y avisa lo que no se pudo convertir', () => {
    const g = goal({
      progress: {
        byCurrency: [bob('1000.00'), usd('50.00')],
        total: bob('1000.00'),
        percent: '6.67',
        remaining: bob('14000.00'),
        complete: false,
        unconverted: [usd('50.00')],
      },
    });
    const html = render(<GoalOverview goal={g} f={f} />);
    expect(html).toContain('data-testid="goal-by-currency"');
    expect(textOf(html)).toContain('50,00 USD');
    expect(html).toContain('data-testid="goal-incomplete"');
    expect(textOf(html)).toContain('no se convierten 1:1');
  });

  it('[TC-GOALS-SAVINGS-036] las tasas usadas muestran el par, el tipo, la fecha y "Fuente: …"', () => {
    const rate = {
      rate: { base: 'USD', quote: 'BOB', value: '6.96' },
      derivation: 'DIRECT' as const,
      rateType: 'OFFICIAL' as const,
      source: 'MANUAL' as const,
      sourceLabel: 'Casa de cambio centro',
      asOf: '2026-10-01T12:00:00Z',
      ageDays: 1,
      approx: false,
    };
    const html = render(<RatesUsed rates={[rate]} windowDays={7} f={f} dashboard={dash} />);
    expect(html).toContain('data-testid="goal-rates"');
    expect(html).toContain('data-pair="USD/BOB"');
    expect(textOf(html)).toContain('USD/BOB 6,96 · OFFICIAL');
    expect(textOf(html)).toContain('Fuente: Casa de cambio centro');
    expect(textOf(html)).toContain('Ventana de vigencia de las tasas: 7 días.');
    expect(render(<RatesUsed rates={[]} f={f} dashboard={dash} />)).toBe('');
  });

  it('[TC-GOALS-SAVINGS-016] las cuentas vinculadas muestran fondos reales y reservas, y enlazan a las reservas si hay sobre-asignación', () => {
    const g = goal({
      overAllocated: true,
      linkedAccounts: [
        {
          accountId: IDS.savings,
          funds: { real: bob('5000.00'), earmark: bob('1000.00') },
          overAllocated: true,
        },
        { accountId: IDS.bank, funds: { real: bob('0.00'), earmark: bob('0.00') }, overAllocated: false },
      ],
    });
    const html = render(<LinkedAccountsTable goal={g} f={f} accountName={name} href={href} />);
    expect(html.match(/data-testid="goal-linked-account"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('Ahorro BOB');
    expect(textOf(html)).toContain('1.000,00 BOB');
    expect(textOf(html)).toContain('Sobre-asignada');
    expect(html).toContain(`href="/es/goals/reservas?accountId=${IDS.savings}"`);
    expect(textOf(html)).toContain('En orden');
  });

  it('[TC-GOALS-SAVINGS-039] el plan con aporte recurrente se administra desde la meta y avisa del aporte en proceso', () => {
    const html = render(
      <PlanCard
        goal={goal({ plan: plan({ pendingContribution: true }) })}
        f={f}
        href={href}
        accountName={name}
      />,
    );
    expect(textOf(html)).toContain('1.500,00 BOB');
    expect(html).toContain('data-testid="goal-plan-managed"');
    expect(textOf(html)).toContain('se cambia o se quita desde aquí, no en Recurrentes');
    expect(html).toContain('href="/es/recurring/0198f0aa-0000-7000-8000-0000000000d1"');
    expect(html).toContain('data-testid="goal-plan-pending"');
    expect(textOf(html)).toContain('Aporte en proceso');
    expect(textOf(html)).toContain('Ahorro BOB');
    expect(html).toContain('Pedir aprobación cada mes');
  });

  it('[TC-GOALS-SAVINGS-038] un plan manual no programa aportes y sin plan se invita a definirlo', () => {
    const manual = render(
      <PlanCard
        goal={goal({
          plan: plan({ automation: 'NONE', materialization: null, definitionId: null, dayOfMonth: null }),
        })}
        f={f}
        href={href}
        accountName={name}
      />,
    );
    expect(manual).not.toContain('data-testid="goal-plan-managed"');
    expect(textOf(manual)).toContain('no programa aportes');
    const none = render(<PlanCard goal={goal()} f={f} href={href} accountName={name} />);
    expect(none).toContain('data-testid="goal-plan-none"');
  });

  it('[TC-GOALS-SAVINGS-035] la simulación muestra requerido, periodos y fecha esperada y dice que no se guardó nada', () => {
    const sim: GoalSimulation = {
      requiredMonthly: bob('1111.11'),
      periods: 9,
      overdue: false,
      expectedDate: { date: '2027-06-30', reason: null },
      tracking: tracking(),
      progress: goal().progress,
      pace: goal().pace,
    };
    const html = render(<SimulationResult sim={sim} f={f} />);
    expect(html).toMatch(/data-testid="sim-required"[^>]*>1\.111,11 BOB por mes</);
    expect(html).toMatch(/data-testid="sim-periods"[^>]*>9</);
    expect(html).toMatch(/data-testid="sim-expected"[^>]*>30\/06\/2027</);
    expect(textOf(html)).toContain('no se guardó ningún cambio');
  });

  it('[TC-GOALS-SAVINGS-029] los movimientos muestran signo, origen y transacción; el inverso y lo revertido se distinguen con texto', () => {
    const original = movement({ id: 'm1' });
    const inverse = movement({
      id: 'm2',
      movement: 'REVERSAL',
      amount: bob('-1000.00'),
      reversesId: 'm1',
      origin: 'SYSTEM',
    });
    const reassign = movement({
      id: 'm3',
      movement: 'REASSIGN_OUT',
      fund: 'EARMARK',
      amount: bob('-500.00'),
      transactionId: null,
      reassignmentId: '0198f0aa-1234-7000-8000-000000000999',
      origin: 'USER',
      note: 'Pasa a la laptop',
    });
    const html = render(
      <MovementsTable movements={[reassign, inverse, original]} f={f} accountName={name} href={href} />,
    );
    expect(html.match(/data-testid="goal-movement"/g)).toHaveLength(3);
    expect(html).toMatch(/data-movement="CONTRIBUTION"[^>]*data-fund="REAL"[^>]*data-reversed="true"/);
    expect(textOf(html)).toContain('Revertido');
    expect(textOf(html)).toContain('Cancela un movimiento anterior');
    expect(textOf(html)).toContain('Reasignación enviada');
    expect(textOf(html)).toContain('Reasignación 0198f0aa');
    expect(textOf(html)).toContain('+1.000,00 BOB');
    expect(textOf(html)).toContain('-1.000,00 BOB');
    expect(textOf(html)).toContain('-500,00 BOB');
    expect(html).toContain(`href="/es/transacciones/${IDS.tx}"`);
    expect(textOf(html)).toContain('Pasa a la laptop');
    expect(html).toContain('<caption');
    expect(render(<MovementsTable movements={[]} f={f} accountName={name} href={href} />)).toContain(
      'data-testid="goal-movements-empty"',
    );
  });

  it('[TC-GOALS-SAVINGS-004] la insignia de estado de ciclo de vida lleva icono decorativo y texto', () => {
    const html = render(
      <GoalStatusBadge tracking={tracking({ status: null, lifecycleStatus: 'CANCELLED' })} f={f} />,
    );
    expect(html).toMatch(/data-status="CANCELLED"[^>]*><span aria-hidden="true">✕<\/span> Cancelada/);
  });

  it('[TC-GOALS-SAVINGS-020] explica el rechazo de la transacción con sus motivos y el de la reserva con saldo y disponible', () => {
    const reasons = render(
      <ProblemExtras
        problem={{ code: 'GOAL_TRANSACTION_NOT_ELIGIBLE', details: { reasons: ['KIND', 'ACCOUNT'] } }}
        f={f}
      />,
    );
    expect(reasons).toContain('data-testid="goal-eligibility-reasons"');
    expect(textOf(reasons)).toContain('Solo se pueden vincular transferencias.');
    expect(textOf(reasons)).toContain('La cuenta de destino debe estar vinculada a la meta.');
    const earmark = render(
      <ProblemExtras
        problem={{
          code: 'EARMARK_EXCEEDS_BALANCE',
          details: { balance: '1000.00', reserved: '800.00', available: '200.00' },
        }}
        f={f}
      />,
    );
    expect(textOf(earmark)).toContain('Saldo 1.000,00, ya reservado 800,00, disponible 200,00.');
    expect(render(<ProblemExtras problem={{ code: 'PERIOD_CLOSED' }} f={f} />)).toBe('');
  });
});

describe('reservas por cuenta', () => {
  it('[TC-GOALS-SAVINGS-013] muestra saldo, reservado, disponible y las metas que reservan', () => {
    const ok = reservation({
      accountId: IDS.bank,
      accountName: 'Banco BOB',
      balance: '3000.00',
      reserved: '1000.00',
      available: '2000.00',
      overAllocated: false,
      shortfall: null,
      since: null,
      goals: [
        { goalId: IDS.trip, name: 'Viaje a Cusco', status: 'ACTIVE', earmarked: '1000.00', realHeld: '0.00' },
      ],
    });
    const html = render(<ReservationsTable items={[ok]} f={f} href={href} />);
    expect(html).toMatch(/data-testid="reservation-balance"[^>]*>3\.000,00 BOB</);
    expect(html).toMatch(/data-testid="reservation-reserved"[^>]*>1\.000,00 BOB</);
    expect(html).toMatch(/data-testid="reservation-available"[^>]*>2\.000,00 BOB</);
    expect(textOf(html)).toContain('En orden');
    expect(html).toContain(`href="/es/goals/${IDS.trip}"`);
    expect(html).toContain('<caption');
  });

  it('[TC-GOALS-SAVINGS-016] la cuenta sobre-asignada va primero con el faltante, el disponible negativo y desde cuándo', () => {
    const ok = reservation({
      accountId: 'ok',
      accountName: 'Alcancía',
      overAllocated: false,
      shortfall: null,
      since: null,
      available: '10.00',
    });
    const html = render(<ReservationsTable items={[ok, reservation()]} f={f} href={href} />);
    const rows = html.match(/<tr data-testid="reservation-row"[\s\S]*?<\/tr>/g) ?? [];
    expect(rows[0]).toContain('data-over-allocated="true"');
    expect(textOf(rows[0] ?? '')).toContain('Sobre-asignada');
    expect(rows[0]).toMatch(/data-testid="reservation-shortfall"[^>]*>Faltan 500,00 BOB</);
    expect(rows[0]).toMatch(/data-testid="reservation-available"[^>]*>-500,00 BOB</);
    expect(textOf(rows[0] ?? '')).toContain('Desde el 08/10/2026');
    expect(rows[1]).toContain('data-over-allocated="false"');
  });
});

describe('bandeja de sugerencias', () => {
  const goalsList = [
    { id: IDS.emergency, name: 'Fondo de emergencia' },
    { id: IDS.trip, name: 'Viaje a Cusco' },
  ];
  const row = (over = {}, props = {}) =>
    render(
      <SuggestionRow
        suggestion={suggestion(over)}
        f={f}
        goals={goalsList}
        accountName={name}
        href={href}
        canEdit
        chosenGoalId=""
        onChoose={noop}
        onConfirm={noop}
        onDismiss={noop}
        busy={false}
        {...props}
      />,
    );

  it('[TC-GOALS-SAVINGS-040] con meta sugerida se confirma o se descarta; sin meta exige elegirla antes', () => {
    const withGoal = row();
    expect(textOf(withGoal)).toContain('Transferencia de 800,00 BOB a Ahorro BOB el 09/10/2026.');
    expect(textOf(withGoal)).toContain('Meta sugerida: Fondo de emergencia');
    expect(withGoal).toContain('data-testid="goal-suggestion-confirm"');
    expect(withGoal).not.toMatch(
      /data-testid="goal-suggestion-confirm"[^>]*disabled|disabled=""[^>]*data-testid="goal-suggestion-confirm"/,
    );
    expect(withGoal).toContain('data-testid="goal-suggestion-dismiss"');
    expect(withGoal).not.toContain('data-testid="goal-suggestion-choose"');

    const noGoal = row({ goalId: null });
    expect(noGoal).toContain('data-testid="goal-suggestion-choose"');
    expect(noGoal).toMatch(
      /disabled=""[^>]*data-testid="goal-suggestion-confirm"|data-testid="goal-suggestion-confirm"[^>]*disabled/,
    );
    const chosen = row({ goalId: null }, { chosenGoalId: IDS.trip });
    expect(chosen).not.toMatch(/data-testid="goal-suggestion-confirm"[^>]*disabled/);
  });

  it('un lector (VIEWER) ve la sugerencia pero no puede confirmarla ni descartarla', () => {
    const html = row({}, { canEdit: false });
    expect(html).not.toContain('goal-suggestion-confirm');
    expect(html).not.toContain('goal-suggestion-dismiss');
  });

  it('[TC-GOALS-SAVINGS-040] el contador cuenta las pendientes y sin ellas dice que no hay', () => {
    const items = [suggestion(), suggestion({ id: 's2', status: 'DISMISSED' })];
    const html = render(
      <SuggestionsView items={items} count={1} f={f}>
        {(s) => <li key={s.id}>{s.id}</li>}
      </SuggestionsView>,
    );
    expect(html).toMatch(/data-testid="goal-suggestions-count"[^>]*>\(1\)</);
    expect(html.match(/<li>/g)).toHaveLength(1);
    const empty = render(
      <SuggestionsView items={[]} count={0} f={f}>
        {() => null}
      </SuggestionsView>,
    );
    expect(empty).toContain('data-testid="goal-suggestions-empty"');
    expect(textOf(empty)).toContain('(0)');
  });
});

describe('detalle de transacción: meta vinculada', () => {
  it('[TC-GOALS-SAVINGS-049] muestra la meta, el aporte y, tras anular, el inverso con el vínculo conservado', () => {
    const html = render(
      <TransactionGoalView
        f={f}
        href={href}
        links={[
          {
            goalId: IDS.emergency,
            goalName: 'Fondo de emergencia',
            movementId: 'm2',
            movement: 'REVERSAL',
            fund: 'REAL',
            amount: bob('-1000.00'),
            reversesId: 'm1',
            active: true,
          },
          {
            goalId: IDS.emergency,
            goalName: 'Fondo de emergencia',
            movementId: 'm1',
            movement: 'CONTRIBUTION',
            fund: 'REAL',
            amount: bob('1000.00'),
            reversesId: null,
            active: false,
          },
        ]}
      />,
    );
    expect(html).toContain('data-testid="tx-goal"');
    expect(html).toContain(`href="/es/goals/${IDS.emergency}"`);
    expect(textOf(html)).toContain('Fondo de emergencia');
    expect(textOf(html)).toContain('+1.000,00 BOB');
    expect(html).toContain('data-testid="tx-goal-reverted"');
    expect(textOf(html)).toContain('revertido');
    expect(render(<TransactionGoalView f={f} href={href} links={[]} />)).toBe('');
  });
});

describe('Home: tarjeta Q9 y aportes a metas', () => {
  const block = (over: Partial<GoalsHomeBlock> = {}): GoalsHomeBlock => ({
    status: 'AVAILABLE',
    action: null,
    items: [
      homeItem(),
      homeItem({
        goalId: IDS.trip,
        name: 'Viaje a Cusco',
        priority: 2,
        percent: '45.00',
        progress: bob('4500.00'),
        target: bob('10000.00'),
        tracking: tracking({ status: 'ON_TRACK', deviationPercent: '-1.00' }),
        requiredMonthly: bob('900.00'),
        expectedDate: '2027-06-30',
      }),
      homeItem({
        goalId: IDS.laptop,
        name: 'Laptop',
        priority: 2,
        percent: '22.22',
        progress: bob('2000.00'),
        target: bob('9000.00'),
        tracking: tracking({ status: null, expected: null, deviationPercent: null }),
        requiredMonthly: null,
        expectedDate: null,
        overAllocated: true,
        complete: false,
      }),
    ],
    moreCount: 1,
    complete: true,
    ratesUsed: [],
    ...over,
  });
  const withGoals = (goals: GoalsHomeBlock | null, over: Partial<ReportSummary> = {}): ReportSummary => ({
    ...SUMMARY,
    questions: SUMMARY.questions.map((q) =>
      q.question === 'Q9'
        ? {
            ...q,
            status: goals?.status === 'NO_DATA' ? 'NO_DATA' : 'AVAILABLE',
            actionHint: goals?.action ?? null,
          }
        : q,
    ),
    goals,
    ...over,
  });
  const card = (summary: ReportSummary) =>
    render(
      <GoalsCard
        summary={summary}
        ctx={dash}
        goalsHref="/es/goals"
        createGoalHref="/es/goals/nuevo"
        goalHref={(id) => `/es/goals/${id}`}
      />,
    );

  it('[TC-GOALS-SAVINGS-046] muestra hasta 3 metas con porcentaje en texto, barra, estado, requerido y fecha esperada, y "N más"', () => {
    const html = card(withGoals(block()));
    expect(html).toContain('data-testid="question-Q9"');
    expect(textOf(html)).toContain('¿Voy a cumplir mis metas?');
    expect(html.match(/data-testid="home-goal"/g)).toHaveLength(3);
    const first = html.match(/<li class="pf-home-card" data-testid="home-goal"[\s\S]*?<\/li>/)?.[0] ?? '';
    expect(textOf(first)).toContain('Fondo de emergencia');
    expect(textOf(first)).toContain('33,33 %');
    expect(first).toMatch(/role="progressbar"[^>]*aria-valuenow="33"/);
    expect(first).toMatch(/data-testid="home-goal-status"[^>]*><span aria-hidden="true">▼<\/span> Atrasada/);
    expect(textOf(first)).toContain('Requerido: 1.666,67 BOB por mes');
    expect(textOf(first)).toContain('Fecha esperada: 31/07/2027');
    expect(first).toContain(`href="/es/goals/${IDS.emergency}"`);
    expect(html).toMatch(/data-testid="home-goals-more"[^>]*><a href="\/es\/goals">1 meta más</);
  });

  it('[TC-GOALS-SAVINGS-046] marca la meta sobre-asignada y la de progreso parcial, sin fecha ni requerido inventados', () => {
    const html = card(withGoals(block()));
    const items = html.match(/<li class="pf-home-card" data-testid="home-goal"[\s\S]*?<\/li>/g) ?? [];
    expect(items[2]).toContain('data-over-allocated="true"');
    expect(textOf(items[2] ?? '')).toContain('Sobre-asignada');
    expect(items[2]).toContain('data-testid="home-goal-partial"');
    expect(textOf(items[2] ?? '')).toContain('Sin ritmo suficiente para estimar la fecha');
    expect(textOf(items[2] ?? '')).toContain('Requerido: sin fecha objetivo');
    expect(items[0]).not.toContain('home-goal-over-allocated');
    expect(textOf(items[2] ?? '')).toContain('Activa');
  });

  it('[TC-GOALS-SAVINGS-047] sin metas ofrece "Crear meta" y no muestra 0 %', () => {
    const empty = withGoals({
      status: 'NO_DATA',
      action: 'CREATE_GOAL',
      items: [],
      moreCount: 0,
      complete: true,
      ratesUsed: [],
    });
    const html = card(empty);
    expect(html).toContain('data-testid="question-Q9-no-data"');
    expect(html).toMatch(/data-testid="home-create-goal"[^>]*>Crear meta</);
    expect(html).toContain('href="/es/goals/nuevo"');
    expect(textOf(html)).toContain('Aún no tienes metas de ahorro.');
    expect(textOf(html)).not.toMatch(/0\s?%/);
    // Tolera que el bloque falte con Q9 sin datos: mismo estado vacío.
    const noBlock = withGoals(null, {
      questions: SUMMARY.questions.map((q) =>
        q.question === 'Q9' ? { ...q, status: 'NO_DATA', actionHint: 'CREATE_GOAL' } : q,
      ),
    });
    expect(card(noBlock)).toContain('data-testid="question-Q9-no-data"');
  });

  it('[TC-GOALS-SAVINGS-047] con metas habilitadas solo Q5 sigue "no disponible" y Q9 no aparece como pendiente de fase', () => {
    const html = render(<DashboardView summary={withGoals(block())} {...dash} />);
    expect(html).toContain('data-testid="question-Q5"');
    expect(html).toMatch(/data-testid="question-Q5"[^>]*data-status="NOT_AVAILABLE_IN_PHASE"/);
    expect(html.match(/Aún no disponible/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="question-Q9"[^>]*data-status="AVAILABLE"/);
    // Sin el bloque (respuesta anterior a la fase 4) Q9 sigue como "no disponible".
    const old = render(<DashboardView summary={SUMMARY} {...dash} />);
    expect(old.match(/Aún no disponible/g)).toHaveLength(2);
    expect(old).not.toContain('data-testid="home-goals"');
    // Un workspace sin datos tampoco rompe el Home.
    expect(render(<DashboardView summary={EMPTY_SUMMARY} {...dash} />)).toContain('data-testid="dashboard"');
  });

  it('[TC-GOALS-SAVINGS-046] avisa cuando el progreso de algún bloque es incompleto', () => {
    const html = card(withGoals(block({ complete: false })));
    expect(html).toContain('data-testid="home-goals-incomplete"');
  });

  it('[TC-GOALS-SAVINGS-048] los aportes netos a metas del periodo van junto al ahorro sin cambiarlo', () => {
    const without = render(<DashboardView summary={SUMMARY} {...dash} />);
    expect(without).not.toContain('data-testid="goal-contributions"');
    const html = render(
      <DashboardView
        summary={{
          ...SUMMARY,
          goalContributions: { native: [bob('2500.00')], base: bob('2500.00'), complete: true },
        }}
        {...dash}
      />,
    );
    expect(html).toMatch(/data-testid="goal-contributions-amount"[^>]*>2\.500,00 BOB</);
    // El ahorro y su tasa son los mismos con o sin el bloque.
    const savings = (h: string) => /data-testid="savings-amount"[^>]*>([^<]*)</.exec(h)?.[1];
    const rate = (h: string) => /data-testid="savings-rate"[^>]*>([^<]*)</.exec(h)?.[1];
    expect(savings(html)).toBe(savings(without));
    expect(rate(html)).toBe(rate(without));
    // Sin tasa de conversión: por moneda y marcado incompleto.
    const partial = render(
      <DashboardView
        summary={{
          ...SUMMARY,
          goalContributions: { native: [bob('1000.00'), usd('50.00')], base: null, complete: false },
        }}
        {...dash}
      />,
    );
    expect(textOf(partial)).toContain('1.000,00 BOB, 50,00 USD');
    expect(partial).toContain('data-testid="goal-contributions-incomplete"');
  });
});

describe('Plan mensual: aportes a metas', () => {
  const section: BudgetGoalContributions = {
    items: [
      {
        goalId: IDS.emergency,
        name: 'Fondo de emergencia',
        planned: bob('1500.00'),
        contributed: bob('1000.00'),
        pending: bob('500.00'),
        exceededBy: bob('0.00'),
      },
      {
        goalId: IDS.laptop,
        name: 'Laptop',
        planned: bob('800.00'),
        contributed: bob('0.00'),
        pending: bob('800.00'),
        exceededBy: bob('0.00'),
      },
    ],
    pendingTotal: { native: [bob('1300.00')], base: bob('1300.00'), complete: true },
  };

  it('[TC-GOALS-SAVINGS-050] lista planificado, aportado y pendiente por meta y el total pendiente (solo lectura)', () => {
    const html = render(<BudgetGoalContributionsView section={section} f={budgets} href={href} />);
    expect(html).toContain('data-testid="budget-goal-contributions"');
    expect(html.match(/data-testid="budget-goal-row"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('Fondo de emergencia');
    expect(html).toMatch(/data-testid="budget-goal-pending-total"[\s\S]*1\.300,00 BOB/);
    expect(textOf(html)).toContain('no son líneas del plan ni cambian el disponible para gastar');
    // Solo lectura: sin botones ni campos.
    expect(html).not.toMatch(/<button|<input/);
    expect(html).toContain('<caption');
    expect(html).toContain(`href="/es/goals/${IDS.laptop}"`);
  });

  it('[TC-GOALS-SAVINGS-050] tolera que la sección falte o venga sin metas, y marca el exceso y el total incompleto', () => {
    expect(render(<BudgetGoalContributionsView section={undefined} f={budgets} href={href} />)).toBe('');
    expect(render(<BudgetGoalContributionsView section={null} f={budgets} href={href} />)).toBe('');
    expect(
      render(
        <BudgetGoalContributionsView
          section={{ items: [], pendingTotal: { native: [], base: null, complete: true } }}
          f={budgets}
          href={href}
        />,
      ),
    ).toBe('');
    const html = render(
      <BudgetGoalContributionsView
        section={{
          items: [{ ...section.items[0]!, exceededBy: bob('200.00') }],
          pendingTotal: { native: [bob('500.00'), usd('10.00')], base: null, complete: false },
        }}
        f={budgets}
        href={href}
      />,
    );
    expect(html).toContain('data-testid="budget-goal-exceeded"');
    expect(textOf(html)).toContain('500,00 BOB, 10,00 USD');
    expect(html).toContain('data-testid="budget-goal-incomplete"');
  });
});
