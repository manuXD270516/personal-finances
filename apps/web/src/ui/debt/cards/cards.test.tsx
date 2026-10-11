import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Account } from '../../common/types';
import { OccurrencesTable } from '../../recurring/OccurrencesTable';
import type { RecurringOccurrence } from '../../recurring/types';
import { esContext, textOf } from '../../test-support';
import { ItemName } from '../../upcoming/UpcomingParts';
import type { UpcomingPaymentItem } from '../../upcoming/types';
import { CardOverview } from './CardDetail';
import { ConflictNotice, firstStepWithErrors, StepFields, stepOfField } from './CardForm';
import { CardPaymentHint } from './CardPaymentHint';
import {
  FiguresTable,
  FutureChargesTable,
  InstallmentsTable,
  PlanConflict,
  StatementItem,
} from './CardPanels';
import { CardsGrid, CardSummary } from './CardsList';
import { bob, card, cardAccount, figures, statement, usd, util } from './fixtures';
import { emptyCardForm, EMPTY_CARD_ACCOUNT, paymentSuggestions } from './logic';
import { UtilizationMeter } from './parts';
import type { CardInstallmentPlan } from './types';

const f = esContext('Cards');
const href = (p: string) => `/es${p}`;
const noop = () => undefined;

const shared = (over = {}) =>
  card({
    id: 'card-2',
    name: 'Mastercard Platinum',
    limitMode: 'SHARED',
    sharedLimit: usd('2000.00'),
    accounts: [
      cardAccount(),
      cardAccount({
        id: 'ca-usd',
        accountId: 'acc-usd',
        currency: 'USD',
        creditLimit: null,
        balance: usd('100.00'),
        creditUsed: usd('100.00'),
      }),
    ],
    utilization: [
      util({
        scope: 'SHARED',
        accountId: null,
        limit: usd('2000.00'),
        used: usd('666.00'),
        available: usd('1334.00'),
        utilization: '33.30',
      }),
    ],
    ...over,
  });

describe('listado de tarjetas', () => {
  it('por cuenta: saldo adeudado, crédito usado, utilización (texto + barra), disponible, próximo vencimiento y lo que falta', () => {
    const html = renderToStaticMarkup(
      <CardSummary card={card({ accounts: [cardAccount({ utilization: util() })] })} f={f} href={href} />,
    );
    const text = textOf(html);
    expect(html).toContain('<caption');
    expect(html).toContain('href="/es/debts/tarjetas/card-1"');
    expect(html).toMatch(/data-testid="card-balance"[^>]*>4\.580,00 BOB</);
    expect(html).toMatch(/data-testid="card-used"[^>]*>4\.580,00 BOB</);
    expect(html).toMatch(/data-testid="card-available"[^>]*>10\.420,00 BOB</);
    expect(html).toMatch(/data-testid="card-next-due"[^>]*>15\/11\/2026</);
    expect(html).toMatch(/data-testid="card-missing"[^>]*>1\.200,00 BOB/);
    expect(text).toMatch(/Utilización 30,53 %/);
    expect(text).toMatch(/Cierra el día 25 · vence el día 15/);
    // La utilización también está en una barra con rol y nombre accesibles.
    expect(html).toMatch(/role="progressbar"[^>]*aria-label="Utilización de Visa Oro en BOB"/);
    expect(html).toMatch(/aria-valuenow="31"/);
  });

  it('límite compartido: una utilización para toda la tarjeta y las filas por moneda remiten a ella', () => {
    const html = renderToStaticMarkup(<CardSummary card={shared()} f={f} href={href} />);
    expect(html).toContain('data-testid="card-shared-limit"');
    expect(textOf(html)).toMatch(
      /Límite compartido 2\.000,00 USD · usado 666,00 USD · disponible 1\.334,00 USD/,
    );
    expect(html).toMatch(/aria-label="Utilización del límite compartido de Mastercard Platinum"/);
    expect(html.match(/data-testid="card-account-row"/g)).toHaveLength(2);
    expect(html.match(/role="progressbar"/g)).toHaveLength(1);
  });

  it('una tarjeta archivada lo dice en el título y el pago automático activo se marca con texto', () => {
    const plan = {
      sourceAccountId: 'acc-bank',
      policy: 'NO_INTEREST' as const,
      materialization: { mode: 'PENDING_APPROVAL' as const, autoCreateStatus: null, leadDays: null },
      definitionId: 'def-1',
      enabledAt: '2026-10-01T10:00:00Z',
    };
    const html = renderToStaticMarkup(
      <CardSummary
        card={card({ status: 'ARCHIVED', accounts: [cardAccount({ paymentPlan: plan })] })}
        f={f}
        href={href}
      />,
    );
    expect(textOf(html)).toMatch(/Archivada/);
    expect(textOf(html)).toMatch(/Pago automático activo/);
  });

  it('sin tasa para valorar el límite compartido no inventa un porcentaje', () => {
    const html = renderToStaticMarkup(
      <CardSummary
        card={shared({
          utilization: [
            util({
              scope: 'SHARED',
              accountId: null,
              utilization: null,
              used: null,
              available: null,
              missingRates: ['USD'],
            }),
          ],
        })}
        f={f}
        href={href}
      />,
    );
    expect(textOf(html)).toMatch(/falta la tasa de cambio de USD/);
    expect(html).not.toContain('role="progressbar"');
  });

  it('el listado agrupa las tarjetas', () => {
    const html = renderToStaticMarkup(<CardsGrid cards={[card(), shared()]} f={f} href={href} />);
    expect(html.match(/data-testid="card-item"/g)).toHaveLength(2);
  });
});

describe('barra de utilización accesible (nunca solo color)', () => {
  it('dice el porcentaje y el nivel con texto e icono decorativo, y la barra lleva nombre y valor', () => {
    const html = renderToStaticMarkup(
      <UtilizationMeter utilization={util({ utilization: '85.00' })} f={f} label="Utilización de Visa" />,
    );
    expect(html).toContain('data-level="danger"');
    expect(textOf(html)).toMatch(/Utilización 85,00 %/);
    expect(textOf(html)).toMatch(/Crítica/);
    expect(html).toMatch(/<span aria-hidden="true">⚠<\/span>/);
    expect(html).toMatch(
      /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="85"/,
    );
    expect(html).toMatch(/aria-valuetext="Utilización 85,00 % · Crítica"/);
  });

  it('sobre el límite se dice "Sobre el límite"', () => {
    const html = renderToStaticMarkup(
      <UtilizationMeter utilization={util({ utilization: '110.00', overdrawn: true })} f={f} label="x" />,
    );
    expect(textOf(html)).toMatch(/Sobre el límite/);
  });
});

describe('alta de la tarjeta en pasos', () => {
  const accounts = [
    { id: 'acc-bob', name: 'Visa BOB', currency: 'BOB', type: 'CREDIT_CARD' },
    { id: 'acc-usd', name: 'Visa USD', currency: 'USD', type: 'CREDIT_CARD' },
    { id: 'acc-bob2', name: 'Otra BOB', currency: 'BOB', type: 'CREDIT_CARD' },
    { id: 'acc-used', name: 'Ya usada', currency: 'EUR', type: 'CREDIT_CARD' },
  ] as unknown as Account[];
  const choices = accounts.map((account) => ({ account, inUse: account.id === 'acc-used' }));
  const base = {
    f,
    set: noop,
    setAccount: noop,
    errors: {},
    choices,
    assets: [{ id: 'acc-bank', name: 'Banco BOB', currency: 'BOB' }] as unknown as Account[],
    canCreateAccount: true,
    onCreateAccount: noop,
  };

  it('paso 1: cuentas de tarjeta; una por moneda y las ya vinculadas deshabilitadas con la razón; permite crear cuenta', () => {
    const html = renderToStaticMarkup(
      <StepFields {...base} step="accounts" form={{ ...emptyCardForm(), selected: ['acc-bob'] }} />,
    );
    expect(html).toContain('data-testid="card-name"');
    expect(html).toMatch(/data-testid="card-account-acc-bob"[^>]*checked/);
    // La otra cuenta en BOB y la ya usada quedan deshabilitadas, con la razón asociada.
    expect(html).toMatch(/<input[^>]*disabled[^>]*data-testid="card-account-acc-bob2"/);
    expect(html).toMatch(/<input[^>]*disabled[^>]*data-testid="card-account-acc-used"/);
    expect(textOf(html)).toMatch(/ya elegiste una cuenta en esa moneda/);
    expect(textOf(html)).toMatch(/ya pertenece a otra tarjeta/);
    expect(html).toContain('data-testid="card-create-account"');
  });

  it('paso 1 sin cuentas de tarjeta: lo dice y ofrece crear una; un VIEWER no la ve', () => {
    const empty = renderToStaticMarkup(
      <StepFields {...base} choices={[]} step="accounts" form={emptyCardForm()} />,
    );
    expect(empty).toContain('data-testid="card-no-accounts"');
    expect(empty).toContain('data-testid="card-create-account"');
    const viewer = renderToStaticMarkup(
      <StepFields {...base} canCreateAccount={false} step="accounts" form={emptyCardForm()} />,
    );
    expect(viewer).not.toContain('data-testid="card-create-account"');
  });

  it('paso 1 con errores: cada uno asociado a su campo', () => {
    const html = renderToStaticMarkup(
      <StepFields
        {...base}
        step="accounts"
        errors={{ name: 'REQUIRED', accounts: 'DUPLICATE_CURRENCY' }}
        form={emptyCardForm()}
      />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(textOf(html)).toMatch(/Completa este campo\./);
    expect(textOf(html)).toMatch(/Solo puede haber una cuenta por moneda/);
  });

  it('paso 2 con límite separado: un límite y una regla de mínimo por cuenta, porcentaje con piso', () => {
    const html = renderToStaticMarkup(
      <StepFields {...base} step="limits" form={{ ...emptyCardForm(), selected: ['acc-bob', 'acc-usd'] }} />,
    );
    expect(html).toContain('data-testid="card-limit-BOB"');
    expect(html).toContain('data-testid="card-limit-USD"');
    expect(html).toContain('data-testid="card-percent-BOB"');
    expect(html).toContain('data-testid="card-floor-BOB"');
    expect(textOf(html)).toMatch(/Porcentaje del saldo/);
    expect(textOf(html)).toMatch(/Monto fijo/);
    expect(html).not.toContain('data-testid="card-shared-limit"');
  });

  it('paso 2 con límite compartido: un solo límite con su moneda y sin límite por cuenta; mínimo fijo por cuenta', () => {
    const html = renderToStaticMarkup(
      <StepFields
        {...base}
        step="limits"
        form={{
          ...emptyCardForm(),
          selected: ['acc-bob', 'acc-usd'],
          limitMode: 'SHARED',
          accounts: { 'acc-usd': { ...EMPTY_CARD_ACCOUNT, minimumType: 'FIXED' } },
        }}
      />,
    );
    expect(html).toContain('data-testid="card-shared-limit"');
    expect(html).toContain('data-testid="card-shared-currency"');
    expect(html).not.toContain('data-testid="card-limit-BOB"');
    expect(html).toContain('data-testid="card-fixed-USD"');
  });

  it('paso 3: días de cierre y vencimiento, ajuste de fin de semana, tasa, umbrales y recordatorio', () => {
    const html = renderToStaticMarkup(<StepFields {...base} step="calendar" form={emptyCardForm()} />);
    for (const id of [
      'card-statement-day',
      'card-due-day',
      'card-weekend',
      'card-annual-rate',
      'card-thresholds',
      'card-reminder-days',
    ])
      expect(html).toContain(`data-testid="${id}"`);
    expect(textOf(html)).toMatch(/Pasar al día hábil siguiente/);
    expect(html).toMatch(/data-testid="card-reminder-days"/);
  });

  it('paso 4: plan de pago opcional por cuenta; al activarlo pide la cuenta de origen de la misma moneda', () => {
    const off = renderToStaticMarkup(
      <StepFields {...base} step="plan" form={{ ...emptyCardForm(), selected: ['acc-bob'] }} />,
    );
    expect(off).toContain('data-testid="card-plan-enable-BOB"');
    expect(off).not.toContain('data-testid="card-plan-source-BOB"');
    const on = renderToStaticMarkup(
      <StepFields
        {...base}
        step="plan"
        form={{
          ...emptyCardForm(),
          selected: ['acc-bob'],
          accounts: { 'acc-bob': { ...EMPTY_CARD_ACCOUNT, planEnabled: true } },
        }}
      />,
    );
    expect(on).toContain('data-testid="card-plan-source-BOB"');
    expect(textOf(on)).toMatch(/Banco BOB \(BOB\)/);
    expect(textOf(on)).toMatch(/Total para no generar intereses/);
    expect(textOf(on)).toMatch(/Por aprobar/);
  });

  it('el error de un campo salta al paso que lo contiene', () => {
    expect(stepOfField('name')).toBe('accounts');
    expect(stepOfField('sharedLimit')).toBe('limits');
    expect(stepOfField('account.x.percent')).toBe('limits');
    expect(stepOfField('account.x.plan')).toBe('plan');
    expect(stepOfField('dueDay')).toBe('calendar');
    expect(firstStepWithErrors({ dueDay: 'RANGE', name: 'REQUIRED' })).toBe('accounts');
    expect(firstStepWithErrors({})).toBeUndefined();
  });

  it('[TC-DEBT-CARD-018] tras el alta con conflicto avisa qué transferencia recurrente terminar', () => {
    const html = renderToStaticMarkup(
      <ConflictNotice
        card={card({
          paymentPlanConflicts: [
            {
              accountId: 'acc-bob',
              conflictingDefinitions: [{ definitionId: 'def-9', name: 'Pago Visa' }],
            },
          ],
        })}
        f={f}
        nameOf={() => 'Visa BOB'}
        href={href}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/es/recurring/def-9"');
    expect(textOf(html)).toMatch(/Pago Visa/);
    expect(textOf(html)).toMatch(/Termina esa transferencia/);
    expect(html).toContain('href="/es/debts/tarjetas/card-1"');
  });

  it('sin conflictos no muestra el aviso', () => {
    const html = renderToStaticMarkup(<ConflictNotice card={card()} f={f} nameOf={() => 'x'} href={href} />);
    expect(html).not.toContain('data-testid="plan-conflicts"');
  });
});

describe('detalle: resumen y ciclo abierto', () => {
  it('muestra la utilización por límite y, por cuenta, el ciclo abierto con sus cifras', () => {
    const html = renderToStaticMarkup(<CardOverview card={shared()} f={f} />);
    expect(html).toContain('data-testid="card-overview"');
    expect(html.match(/data-testid="open-cycle"/g)).toHaveLength(2);
    expect(textOf(html)).toMatch(/Ciclo abierto en BOB/);
    expect(textOf(html)).toMatch(/Ciclo abierto en USD/);
    expect(html).toMatch(/data-testid="detail-next-due"[^>]*>15\/11\/2026</);
    expect(html).toContain('data-testid="overview-utilization"');
    expect(html).toContain('<caption');
  });
});

describe('estados de cuenta', () => {
  it('[TC-DEBT-CARD-012] el emitido se muestra frente al recalculado, con la diferencia con signo y el aviso', () => {
    const s = statement({
      current: figures({
        purchases: bob('1500.00'),
        closingBalance: bob('1500.00'),
        billedBalance: bob('1500.00'),
        noInterestPayment: bob('1500.00'),
      }),
      difference: figures({
        purchases: bob('300.00'),
        closingBalance: bob('300.00'),
        billedBalance: bob('300.00'),
        noInterestPayment: bob('300.00'),
        minimumDue: bob('0.00'),
      }),
    });
    const html = renderToStaticMarkup(<StatementItem statement={s} f={f} open highlight={false} />);
    expect(html).toMatch(/data-testid="difference-purchases"[^>]*>(?:<span[^>]*>⚠ <\/span>)?\+300,00 BOB</);
    expect(html).toMatch(/data-figure="purchases" data-changed="true"/);
    expect(html).toMatch(/data-figure="refunds" data-changed="false"/);
    expect(html).toContain('data-testid="statement-recalculated"');
    expect(textOf(html)).toMatch(/Cambiaron 4 cifras desde que se emitió/);
    expect(textOf(html)).toMatch(/Emitido/);
    expect(textOf(html)).toMatch(/Recalculado hoy/);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it('sin cambios no hay aviso; el estado se dice con texto e icono', () => {
    const html = renderToStaticMarkup(<StatementItem statement={statement()} f={f} open highlight={false} />);
    expect(html).not.toContain('data-testid="statement-recalculated"');
    expect(html).toMatch(/data-testid="statement-no-interest"[^>]*>1\.200,00 BOB</);
    expect(html).toMatch(/data-testid="statement-remaining-minimum"[^>]*>60,00 BOB</);
    expect(textOf(html)).toMatch(/Emitido/);
  });

  it('el ciclo que nunca se emitió muestra una sola columna "Calculado"', () => {
    const open = statement({
      id: null,
      status: 'OPEN',
      issuedAt: null,
      issued: null,
      difference: null,
      version: null,
    });
    const html = renderToStaticMarkup(<FiguresTable statement={open} f={f} />);
    expect(textOf(html)).toMatch(/Calculado/);
    expect(textOf(html)).not.toMatch(/Recalculado hoy/);
    expect(html).not.toContain('data-testid="difference-');
  });

  it('lo informado por el banco se muestra con su diferencia respecto del sistema', () => {
    const s = statement({
      reported: { billedBalance: bob('1250.50'), minimumDue: bob('62.53') },
      reportedDifference: bob('50.50'),
    });
    const html = renderToStaticMarkup(<StatementItem statement={s} f={f} open highlight={false} />);
    expect(html).toContain('data-testid="statement-reported"');
    expect(html).toMatch(/data-testid="statement-reported-difference"[^>]*>\+50,50 BOB</);
    expect(textOf(html)).toMatch(/Saldo facturado \(banco\)/);
  });

  it('el estado de cuenta destacado (?statementId=) se marca y el inconsistente lo avisa', () => {
    const html = renderToStaticMarkup(
      <StatementItem statement={statement({ consistent: false })} f={f} open highlight />,
    );
    expect(html).toContain('data-highlight="true"');
    expect(html).toContain('data-testid="statement-inconsistent"');
  });

  it('el formulario de montos del banco solo llega si se pasa (EDITOR); un VIEWER no lo recibe', () => {
    const withForm = renderToStaticMarkup(
      <StatementItem
        statement={statement()}
        f={f}
        open
        highlight={false}
        form={<form data-testid="reported-form" />}
      />,
    );
    expect(withForm).toContain('data-testid="reported-form"');
    const viewer = renderToStaticMarkup(
      <StatementItem statement={statement()} f={f} open highlight={false} />,
    );
    expect(viewer).not.toContain('data-testid="reported-form"');
  });
});

describe('plan de pago: conflicto', () => {
  it('[TC-DEBT-CARD-018] indica la transferencia recurrente "Pago Visa" a terminar, con enlace', () => {
    const html = renderToStaticMarkup(
      <PlanConflict
        f={f}
        href={href}
        problem={{
          code: 'CARD_PAYMENT_PLAN_CONFLICT',
          details: { conflictingDefinitions: [{ definitionId: 'def-9', name: 'Pago Visa' }] },
        }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-error-code="CARD_PAYMENT_PLAN_CONFLICT"');
    expect(html).toContain('href="/es/recurring/def-9"');
    expect(textOf(html)).toMatch(/Pago Visa/);
    expect(textOf(html)).toMatch(/Termina esa transferencia en Pagos recurrentes/);
  });

  it('sin detalles igual explica qué hacer', () => {
    const html = renderToStaticMarkup(
      <PlanConflict f={f} href={href} problem={{ code: 'CARD_PAYMENT_PLAN_CONFLICT' }} />,
    );
    expect(textOf(html)).toMatch(/Termina esa transferencia/);
    expect(html).not.toContain('<li>');
  });
});

describe('cuotas y cargos futuros', () => {
  const plan: CardInstallmentPlan = {
    id: 'p1',
    cardAccountId: 'ca-bob',
    purchaseTransactionId: 't1',
    purchaseDate: '2026-10-05',
    principal: bob('1000.00'),
    installmentCount: 3,
    annualRate: '0.00',
    startCycle: 'PURCHASE',
    status: 'ACTIVE',
    cancelReason: null,
    installments: [
      {
        n: 1,
        billingClosingDate: '2026-10-25',
        dueDate: '2026-11-15',
        principal: bob('333.33'),
        interest: bob('0.00'),
        total: bob('333.33'),
      },
      {
        n: 2,
        billingClosingDate: '2026-11-25',
        dueDate: '2026-12-15',
        principal: bob('333.33'),
        interest: bob('0.00'),
        total: bob('333.33'),
      },
      {
        n: 3,
        billingClosingDate: '2026-12-25',
        dueDate: '2027-01-15',
        principal: bob('333.34'),
        interest: bob('0.00'),
        total: bob('333.34'),
      },
    ],
    version: 1,
  };

  it('[TC-DEBT-CARD-022] la tabla de cuotas deja el residuo en la última y es accesible', () => {
    const html = renderToStaticMarkup(<InstallmentsTable plan={plan} f={f} />);
    expect(html).toContain('<caption');
    expect(html).toMatch(/data-n="3"[^>]*>[\s\S]*333,34 BOB/);
    expect(html).toMatch(/<th scope="row"[^>]*>3\/3</);
  });

  it('el calendario de cargos futuros lista las cuotas por vencimiento', () => {
    const html = renderToStaticMarkup(
      <FutureChargesTable
        f={f}
        charges={[
          {
            dueDate: '2026-11-15',
            closingDate: '2026-10-25',
            accountId: 'acc-bob',
            currency: 'BOB',
            installments: [
              {
                planId: 'p1',
                purchaseTransactionId: 't1',
                n: 1,
                of: 3,
                principal: bob('333.33'),
                interest: bob('0.00'),
                total: bob('333.33'),
              },
            ],
            total: bob('333.33'),
          },
        ]}
      />,
    );
    expect(html).toContain('<caption');
    expect(textOf(html)).toMatch(/Cuota 1 de 3: 333,33 BOB/);
    expect(html).toMatch(/data-testid="future-total"[^>]*>333,33 BOB</);
  });
});

describe('formulario de transferencia: pago de tarjeta', () => {
  const suggestions = paymentSuggestions(card(), 'acc-bob')!;
  const render = (mismatch: boolean, s = suggestions) =>
    renderToStaticMarkup(
      <CardPaymentHint
        suggestions={s}
        f={f}
        href={href}
        mismatch={mismatch}
        onPick={noop}
        conversionLink="/es/fx/conversiones/nueva?origen=a&destino=b"
      />,
    );

  it('[TC-DEBT-CARD-015] rotula "Pago de tarjeta" y sugiere el total sin intereses y el mínimo como botones', () => {
    const html = render(false);
    expect(textOf(html)).toMatch(/Pago de tarjeta/);
    expect(html).toContain('data-testid="card-payment-label"');
    expect(html).toMatch(
      /<button[^>]*data-testid="card-suggest-noInterest"[^>]*>Total para no generar intereses: 1\.200,00 BOB</,
    );
    expect(html).toMatch(/<button[^>]*data-testid="card-suggest-minimum"[^>]*>Pago mínimo: 60,00 BOB</);
    expect(html).toContain('href="/es/debts/tarjetas/card-1?statementId=st-1"');
  });

  it('[TC-DEBT-CARD-016] con monedas distintas solo sugiere y enlaza a la conversión, sin rellenar el monto', () => {
    const html = render(true);
    expect(html).toMatch(
      /<a[^>]*href="\/es\/fx\/conversiones\/nueva\?origen=a&amp;destino=b"[^>]*data-testid="card-suggest-noInterest"/,
    );
    expect(textOf(html)).toMatch(/\(conviértelo antes\)/);
    expect(html).not.toContain('<button');
  });

  it('si no falta nada lo dice y no ofrece montos', () => {
    const html = render(false, { ...suggestions, noInterest: null, minimum: null, status: 'PAID' });
    expect(html).toContain('data-testid="card-payment-nothing"');
    expect(html).not.toContain('<button');
  });
});

describe('Q8 y Pagos recurrentes: pago de tarjeta', () => {
  const fr = esContext('Recurring');
  const fu = esContext('Upcoming');
  const occurrence = (over: Partial<RecurringOccurrence> = {}): RecurringOccurrence => ({
    id: 'o1',
    definitionId: 'def-1',
    definitionName: 'Pago de tarjeta · Visa Oro',
    kind: 'CARD_PAYMENT',
    managedBy: 'DEBT',
    occurrenceDate: '2026-11-15',
    dueDate: '2026-11-15',
    definitionVersionNo: 1,
    expected: { type: 'ESTIMATED', amount: bob('1200.00') },
    projectedAmount: bob('1200.00'),
    status: 'SCHEDULED',
    cancelReason: null,
    requiresApproval: true,
    mode: 'PENDING_APPROVAL',
    overridden: false,
    accountId: 'acc-bank',
    toAccountId: 'acc-bob',
    transactionId: null,
    resolution: null,
    matchedBy: null,
    skipReason: null,
    lastAutoCreateError: null,
    version: 1,
    ...over,
  });
  const table = (o: RecurringOccurrence, canEdit = true) =>
    renderToStaticMarkup(
      <OccurrencesTable
        occurrences={[o]}
        f={fr}
        uiLocale="es"
        canEdit={canEdit}
        accountName={(id) => id}
        href={href}
        caption="Pagos"
        empty="Vacío"
        onAction={noop}
        cardOf={(id) => (id === 'def-1' ? { id: 'card-1', name: 'Visa Oro' } : undefined)}
      />,
    );

  it('[TC-DEBT-CARD-032] se rotula "Pago de tarjeta · <nombre>", marca el estimado y enlaza a la tarjeta', () => {
    const html = table(occurrence());
    expect(html).toMatch(/data-testid="occurrence-link"[^>]*>Pago de tarjeta · Visa Oro</);
    expect(html).toContain('data-testid="occurrence-card-estimated"');
    expect(textOf(html)).toMatch(/Estimado/);
    expect(html).toContain('href="/es/debts/tarjetas/card-1"');
    expect(html).toMatch(/data-testid="expected-amount" data-amount-type="ESTIMATED"/);
  });

  it('aprobar, vincular, omitir y editar siguen disponibles; no es una cuota de préstamo', () => {
    const html = table(occurrence());
    for (const a of ['approve', 'link', 'skip', 'edit']) expect(html).toContain(`data-action="${a}"`);
    expect(html).not.toContain('data-testid="occurrence-register-payment"');
    expect(html).not.toContain('data-testid="occurrence-loan"');
  });

  it('un VIEWER solo lee: sin acciones; con el monto exacto no se marca estimado', () => {
    const html = table(occurrence({ expected: { type: 'FIXED', amount: bob('1200.00') } }), false);
    expect(html).not.toContain('data-action=');
    expect(html).not.toContain('data-testid="occurrence-card-estimated"');
  });

  const item = (over: Partial<UpcomingPaymentItem> = {}): UpcomingPaymentItem => ({
    kind: 'OCCURRENCE',
    occurrenceId: 'o1',
    definitionId: 'def-1',
    name: 'Pago de tarjeta · Visa Oro',
    accountId: 'acc-bank',
    accountName: 'Banco BOB',
    date: '2026-11-15',
    status: 'SCHEDULED',
    amountType: 'ESTIMATED',
    amount: bob('1200.00'),
    estimated: true,
    withoutAmount: false,
    converted: bob('1200.00'),
    ...over,
  });

  it('en Próximos pagos: etiqueta, estimado y enlace a la tarjeta', () => {
    const html = renderToStaticMarkup(
      <ItemName item={item()} f={fu} href={href} cardOf={() => ({ id: 'card-1', name: 'Visa Oro' })} />,
    );
    expect(html).toMatch(/data-testid="card-payment-item"[^>]*>Pago de tarjeta · Visa Oro</);
    expect(html).toContain('data-testid="card-payment-estimated"');
    expect(html).toContain('href="/es/debts/tarjetas/card-1"');
  });

  it('antes de cargar las tarjetas se reconoce por el prefijo y no hay enlace; un pago común no cambia', () => {
    const html = renderToStaticMarkup(<ItemName item={item({ estimated: false })} f={fu} href={href} />);
    expect(textOf(html)).toMatch(/Pago de tarjeta · Visa Oro/);
    expect(html).not.toContain('data-testid="card-payment-estimated"');
    expect(html).not.toContain('data-testid="card-payment-link"');
    const plain = renderToStaticMarkup(
      <ItemName item={item({ name: 'Internet', definitionId: 'otra' })} f={fu} href={href} />,
    );
    expect(plain).not.toContain('data-testid="card-payment-item"');
    expect(textOf(plain)).toBe('Internet');
  });
});

describe('i18n', () => {
  const load = (lang: string) =>
    JSON.parse(readFileSync(new URL(`../../../../messages/${lang}.json`, import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it('es, en y pt tienen las mismas claves en los textos de tarjetas', () => {
    const scopes: [string, ...string[]][] = [
      ['Cards'],
      ['Debt', 'tabs'],
      ['Recurring', 'cardPayment'],
      ['Upcoming', 'cardPayment'],
    ];
    for (const scope of scopes) {
      const pick = (lang: string) =>
        scope.reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], load(lang));
      const es = keys(pick('es')).sort();
      expect(es.length).toBeGreaterThan(0);
      expect(keys(pick('en')).sort()).toEqual(es);
      expect(keys(pick('pt')).sort()).toEqual(es);
    }
  });

  it('los dos tipos de notificación de tarjeta tienen nombre en los tres idiomas', () => {
    for (const lang of ['es', 'en', 'pt']) {
      const types = (load(lang)['Notifications'] as { prefs: { types: Record<string, string> } }).prefs.types;
      expect(types['CARD_PAYMENT_DUE']).toBeTruthy();
      expect(types['CARD_UTILIZATION']).toBeTruthy();
    }
  });
});
