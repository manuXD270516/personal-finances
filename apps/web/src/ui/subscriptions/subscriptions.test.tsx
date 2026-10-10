import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { WorkspaceContext } from '../common/workspace';
import type { ResolvedRate } from '../dashboard/types';
import { resourcePath } from '../notifications/logic';
import { activeNav } from '../shell/nav';
import { esContext, textOf } from '../test-support';
import type { Catalogs } from '../transactions/catalogs';
import { ChargeOutcomeBadge, SubscriptionStatusBadge } from './Badges';
import { ChargesTable } from './ChargesSection';
import { CostSummaryView } from './CostSummary';
import { PriceHistoryTable, ProposalCard, ProposalGone } from './PriceSections';
import { SubscriptionFormView } from './SubscriptionForm';
import { SubscriptionsList } from './SubscriptionsList';
import {
  OUTCOME_PRESENTATION,
  STATUS_PRESENTATION,
  availableActions,
  buildCancelBody,
  buildChargeBody,
  buildCreateBody,
  buildPriceBody,
  buildSupersedeBody,
  buildUpdateBody,
  currencyMismatch,
  emptyForm,
  formFromSubscription,
  formatImpliedRate,
  formatPercent,
  historyRows,
  listQuery,
  normalizeTolerance,
  priceInForce,
  subscriptionPath,
  type SubscriptionForm,
} from './logic';
import { SUBSCRIPTION_STATUSES } from './types';
import type {
  Subscription,
  SubscriptionCharge,
  SubscriptionCostSummary,
  SubscriptionPrice,
  SubscriptionPriceProposal,
} from './types';

const f = esContext('Subscriptions');
const df = esContext('Dashboard');
const usd = (amount: string) => ({ amount, currency: 'USD' });
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const ENV = { locale: 'es-BO', scale: 2 };
const SUB_ID = '0198f0aa-0000-7000-8000-0000000000a1';

const price = (over: Partial<SubscriptionPrice> = {}): SubscriptionPrice => ({
  id: '0198f0aa-0000-7000-8000-0000000000b1',
  effectiveFrom: '2026-11-15',
  price: usd('10.99'),
  origin: 'INITIAL',
  supersedesId: null,
  supersededBy: null,
  proposalId: null,
  ...over,
});

const proposal = (over: Partial<SubscriptionPriceProposal> = {}): SubscriptionPriceProposal => ({
  id: '0198f0aa-0000-7000-8000-0000000000c1',
  chargeId: '0198f0aa-0000-7000-8000-0000000000d1',
  effectiveFrom: '2027-03-15',
  previousPrice: usd('10.99'),
  proposedPrice: usd('12.99'),
  changePercent: '+18.20',
  status: 'PENDING',
  decidedAt: null,
  decidedBy: null,
  ...over,
});

const subscription = (over: Partial<Subscription> = {}): Subscription => ({
  id: SUB_ID,
  definitionId: '0198f0aa-0000-7000-8000-0000000000e1',
  counterpartyId: 'p1',
  providerName: 'Streamly Inc.',
  name: 'Streamly',
  planName: 'Premium',
  status: 'ACTIVE',
  currentPrice: usd('10.99'),
  billingCycle: { cadence: 'MONTHLY', interval: 1, monthDays: [], rrule: null },
  paymentAccountId: 'a2',
  paymentAccountName: 'Visa BOB',
  accountCurrency: 'BOB',
  nextRenewalOn: '2026-12-15',
  trialEndsOn: null,
  scheduledCancellationOn: null,
  cancelledOn: null,
  cancellationReason: null,
  cancellationUrl: null,
  reminder: { enabled: true, daysBefore: 3 },
  priceTolerancePercent: '1.00',
  version: 4,
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
  priceHistory: [price()],
  pendingProposal: null,
  definition: {
    id: '0198f0aa-0000-7000-8000-0000000000e1',
    status: 'ACTIVE',
    materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null, leadDays: 3 },
    accountId: 'a2',
    accountCurrency: 'BOB',
    categoryId: null,
    indexed: true,
  },
  ...over,
});

const charge = (over: Partial<SubscriptionCharge> = {}): SubscriptionCharge => ({
  id: '0198f0aa-0000-7000-8000-0000000000f1',
  occurrenceId: '0198f0aa-0000-7000-8000-0000000000f2',
  occurrenceDate: '2026-11-15',
  transactionId: '0198f0aa-0000-7000-8000-0000000000f3',
  charged: bob('108.50'),
  priceCurrencyAmount: null,
  expectedPrice: usd('10.99'),
  impliedRate: '9.8726',
  deviationPercent: null,
  outcome: 'NOT_COMPARABLE',
  ...over,
});

const rate: ResolvedRate = {
  rate: { base: 'USD', quote: 'BOB', value: '9.300000000000000000' },
  derivation: 'DIRECT',
  rateType: 'PARALLEL',
  source: 'PROVIDER',
  asOf: '2026-10-10T12:00:00Z',
  ageDays: 0,
  approx: false,
  attribution: { provider: 'PARALELO_BO', text: 'paralelo.bo', url: 'https://paralelo.bo' },
};

const costItem = (over: Partial<SubscriptionCostSummary['items'][number]> = {}) => ({
  subscriptionId: SUB_ID,
  name: 'Streamly',
  status: 'ACTIVE' as const,
  monthly: { native: usd('10.99'), base: bob('102.21') },
  annual: { native: usd('131.88'), base: bob('1226.48') },
  complete: true,
  ...over,
});

const summary = (over: Partial<SubscriptionCostSummary> = {}): SubscriptionCostSummary => ({
  baseCurrency: 'BOB',
  items: [costItem()],
  totals: { monthly: bob('102.21'), annual: bob('1226.48'), complete: true, unconverted: [] },
  afterTrial: { items: [], monthly: bob('0.00'), annual: bob('0.00'), complete: true },
  meta: { ratesUsed: [rate], rateWindowDays: 7, asOf: '2026-10-10T12:00:00Z' },
  ...over,
});

const ctx = {
  api: {},
  base: '/workspaces/w1',
  scales: { BOB: 2, USD: 2, USDT: 6 },
  currencies: [],
  formatLocale: 'es-BO',
  uiLocale: 'es',
  canEdit: true,
  ws: { baseCurrency: 'BOB' },
  href: (p: string) => `/es${p}`,
} as unknown as WorkspaceContext;

const accounts = [
  { id: 'a1', name: 'Visa USD', currency: 'USD', status: 'ACTIVE' },
  { id: 'a2', name: 'Visa BOB', currency: 'BOB', status: 'ACTIVE' },
];
const catalogs = {
  loaded: true,
  accounts,
  activeAccounts: accounts,
  categories: [],
  groups: [],
  counterparties: [{ id: 'p1', name: 'Streamly Inc.', kind: 'MERCHANT', version: 1 }],
  tags: [],
  names: {
    account: (id: string) => accounts.find((a) => a.id === id)?.name,
    category: () => undefined,
    counterparty: () => undefined,
    tag: () => undefined,
  },
  reload: () => undefined,
  addCounterparty: () => undefined,
} as unknown as Catalogs;

const form = (over: Partial<SubscriptionForm> = {}): SubscriptionForm => ({
  ...emptyForm('2026-10-10'),
  counterpartyId: 'p1',
  name: 'Streamly',
  price: '10,99',
  currency: 'USD',
  paymentAccountId: 'a2',
  firstRenewalOn: '2026-11-15',
  ...over,
});

describe('Estados (NFR-USAB-104)', () => {
  it('cada estado se muestra con texto e icono decorativo, nunca solo color', () => {
    const labels: Record<string, string> = {
      TRIAL: 'En prueba',
      ACTIVE: 'Activa',
      PAUSED: 'Pausada',
      CANCELLED: 'Cancelada',
    };
    for (const status of SUBSCRIPTION_STATUSES) {
      const html = renderToStaticMarkup(<SubscriptionStatusBadge status={status} f={f} />);
      expect(textOf(html)).toContain(labels[status]);
      expect(textOf(html)).toContain(STATUS_PRESENTATION[status].icon);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-status="${status}"`);
    }
    expect(new Set(SUBSCRIPTION_STATUSES.map((s) => STATUS_PRESENTATION[s].icon)).size).toBe(4);
  });

  it('el resultado de un cargo también lleva texto e icono', () => {
    const html = renderToStaticMarkup(<ChargeOutcomeBadge outcome="PRICE_CHANGE_DETECTED" f={f} />);
    expect(textOf(html)).toContain('Cambio de precio detectado');
    expect(textOf(html)).toContain(OUTCOME_PRESENTATION.PRICE_CHANGE_DETECTED.icon);
  });
});

describe('Listado', () => {
  const list = (subs: readonly Subscription[]) =>
    renderToStaticMarkup(<SubscriptionsList subscriptions={subs} f={f} href={(p) => `/es${p}`} />);

  it('muestra estado, provider, plan, precio con su moneda, renovación y cuenta', () => {
    const html = list([subscription()]);
    const text = textOf(html);
    expect(text).toContain('Streamly');
    expect(text).toContain('Streamly Inc. · Premium');
    expect(text).toContain('Activa');
    expect(text).toContain('10,99 USD');
    expect(text).toContain('Mensual');
    expect(text).toContain('15/12/2026');
    expect(text).toContain('Visa BOB');
    expect(text).toContain('Cargo estimado en BOB');
    expect(html).toContain('<caption');
    expect(html).toContain(`href="/es/recurring/suscripciones/${SUB_ID}"`);
  });

  it('muestra la cancelación programada, el fin de la prueba y las canceladas con el acceso al historial', () => {
    const scheduled = textOf(list([subscription({ scheduledCancellationOn: '2026-12-15' })]));
    expect(scheduled).toContain('Se cancela el 15/12/2026');
    const trial = textOf(list([subscription({ status: 'TRIAL', trialEndsOn: '2026-11-01' })]));
    expect(trial).toContain('En prueba');
    expect(trial).toContain('Prueba hasta el 01/11/2026');
    const cancelled = list([
      subscription({ status: 'CANCELLED', cancelledOn: '2026-11-02', nextRenewalOn: null }),
    ]);
    expect(textOf(cancelled)).toContain('Cancelada el 02/11/2026');
    expect(textOf(cancelled)).toContain('Sin renovación');
    expect(cancelled).toContain('?historial=1');
  });

  it('sin suscripciones muestra el estado vacío', () => {
    expect(list([])).toContain('data-testid="subscriptions-empty"');
  });

  it('por omisión no pide las canceladas; "Mostrar canceladas" pide todos los estados', () => {
    expect(listQuery(false)).toBe('limit=200');
    expect(listQuery(true)).toContain('status=TRIAL%2CACTIVE%2CPAUSED%2CCANCELLED');
  });
});

describe('Formulario de alta y edición', () => {
  const render = (initial: SubscriptionForm, mode: 'create' | 'edit' = 'create', canEdit = true) =>
    renderToStaticMarkup(
      <SubscriptionFormView
        ctx={{ ...ctx, canEdit } as WorkspaceContext}
        f={f}
        catalogs={catalogs}
        today="2026-10-10"
        mode={mode}
        initial={initial}
        {...(mode === 'edit' ? { subscription: subscription() } : {})}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );

  it('ofrece provider con creación en línea, precio, ciclo, trial, cuenta y recordatorio', () => {
    const html = render(emptyForm('2026-10-10'));
    for (const name of [
      'counterparty',
      'name',
      'planName',
      'price',
      'currency',
      'cadence',
      'interval',
      'firstRenewalOn',
      'trialEndsOn',
      'paymentAccountId',
      'categoryId',
      'reminderEnabled',
      'reminderDays',
      'tolerance',
    ])
      expect(html).toContain(`name="${name}"`);
    expect(html).toContain('value="AUTO_CREATE"');
    expect(html).toContain('value="PENDING_APPROVAL"');
    expect(html).toContain('value="NOTIFY_ONLY"');
    // Valores por omisión: recordatorio 3 días y tolerancia 1,00.
    expect(html).toMatch(/name="reminderDays"[^>]*value="3"/);
    expect(html).toMatch(/name="tolerance"[^>]*value="1.00"/);
    expect(html).toContain('type="date"');
  });

  it('cada control tiene su etiqueta asociada (accesibilidad)', () => {
    const html = render(emptyForm('2026-10-10'));
    const controls = [...html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(controls.length).toBeGreaterThan(8);
    for (const id of controls) expect(html).toContain(`for="${id}"`);
    expect(html).toContain('<legend>');
    expect(html).toContain('role="radiogroup"');
  });

  it('avisa cuando el precio está en otra moneda que la cuenta de pago', () => {
    const mismatch = render(form());
    expect(textOf(mismatch)).toContain('Precio en USD, cargo estimado en BOB con la tasa paralela');
    expect(mismatch).toContain('role="note"');
    const same = render(form({ currency: 'BOB' }));
    expect(same).not.toContain('data-testid="currency-mismatch"');
    const none = render(form({ paymentAccountId: '' }));
    expect(none).not.toContain('data-testid="currency-mismatch"');
    expect(currencyMismatch('USD', 'BOB')).toBe(true);
    expect(currencyMismatch('USD', 'USD')).toBe(false);
    expect(currencyMismatch('USD', undefined)).toBe(false);
  });

  it('la edición no ofrece provider, precio ni primera renovación y no pide fecha de efecto sin cambios', () => {
    const initial = formFromSubscription(subscription());
    const html = render(initial, 'edit');
    expect(html).not.toContain('name="price"');
    expect(html).not.toContain('name="firstRenewalOn"');
    expect(html).not.toContain('name="counterparty"');
    expect(html).not.toContain('name="effectiveFrom"');
  });

  it('arma el cuerpo de la API con montos como string decimal y valores por omisión', () => {
    const built = buildCreateBody(form(), ENV);
    expect(built).toEqual({
      ok: true,
      body: {
        counterpartyId: 'p1',
        name: 'Streamly',
        price: usd('10.99'),
        billingCycle: { cadence: 'MONTHLY', interval: 1 },
        firstRenewalOn: '2026-11-15',
        paymentAccountId: 'a2',
        materialization: { mode: 'PENDING_APPROVAL' },
        reminder: { enabled: true, daysBefore: 3 },
        priceTolerancePercent: '1.00',
      },
    });
    const full = buildCreateBody(
      form({
        planName: ' Premium ',
        trialEndsOn: '2026-11-01',
        mode: 'AUTO_CREATE',
        autoCreateStatus: 'POSTED',
        categoryId: 'c1',
        reminderDays: '7',
        tolerance: '2,5',
        cancellationUrl: 'https://streamly.example/cancel',
      }),
      ENV,
    );
    expect(full).toMatchObject({
      ok: true,
      body: {
        planName: 'Premium',
        trialEndsOn: '2026-11-01',
        categoryId: 'c1',
        materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED' },
        reminder: { enabled: true, daysBefore: 7 },
        priceTolerancePercent: '2.5',
        cancellationUrl: 'https://streamly.example/cancel',
      },
    });
  });

  it('valida obligatorios, precio, escala, intervalo, fechas, recordatorio y tolerancia', () => {
    expect(buildCreateBody(emptyForm('2026-10-10'), ENV)).toMatchObject({
      ok: false,
      errors: {
        counterpartyId: 'REQUIRED',
        name: 'REQUIRED',
        paymentAccountId: 'REQUIRED',
        price: 'REQUIRED',
      },
    });
    expect(buildCreateBody(form({ price: '0' }), ENV)).toMatchObject({
      errors: { price: 'AMOUNT_NOT_POSITIVE' },
    });
    expect(buildCreateBody(form({ price: 'abc' }), ENV)).toMatchObject({
      errors: { price: 'AMOUNT_INVALID' },
    });
    expect(buildCreateBody(form({ price: '10,999' }), ENV)).toMatchObject({
      errors: { price: 'AMOUNT_SCALE' },
    });
    expect(buildCreateBody(form({ interval: '0' }), ENV)).toMatchObject({ errors: { interval: 'INTERVAL' } });
    expect(buildCreateBody(form({ firstRenewalOn: '' }), ENV)).toMatchObject({
      errors: { firstRenewalOn: 'DATE' },
    });
    // La primera renovación no puede ser anterior al fin del trial.
    expect(buildCreateBody(form({ trialEndsOn: '2026-12-01' }), ENV)).toMatchObject({
      errors: { firstRenewalOn: 'TRIAL_AFTER_RENEWAL' },
    });
    expect(buildCreateBody(form({ reminderDays: '31' }), ENV)).toMatchObject({
      errors: { reminderDays: 'REMINDER_DAYS' },
    });
    expect(buildCreateBody(form({ reminderDays: '0' }), ENV)).toMatchObject({
      errors: { reminderDays: 'REMINDER_DAYS' },
    });
    expect(buildCreateBody(form({ tolerance: '50,01' }), ENV)).toMatchObject({
      errors: { tolerance: 'TOLERANCE' },
    });
    expect(buildCreateBody(form({ cancellationUrl: 'javascript:alert(1)' }), ENV)).toMatchObject({
      errors: { cancellationUrl: 'URL' },
    });
  });

  it('la tolerancia admite 0–50 con hasta 2 decimales y tolera el locale', () => {
    expect(normalizeTolerance('1', 'es-BO')).toBe('1');
    expect(normalizeTolerance('0,5', 'es-BO')).toBe('0.5');
    expect(normalizeTolerance('50', 'es-BO')).toBe('50');
    expect(normalizeTolerance('50.00', 'en-US')).toBe('50.00');
    expect(normalizeTolerance('50,01', 'es-BO')).toBeNull();
    expect(normalizeTolerance('1,234', 'es-BO')).toBeNull();
    expect(normalizeTolerance('-1', 'es-BO')).toBeNull();
    expect(normalizeTolerance('', 'es-BO')).toBeNull();
  });

  it('la edición envía solo lo que cambió; cuenta o ciclo exigen fecha de efecto', () => {
    const initial = formFromSubscription(subscription());
    expect(buildUpdateBody(initial, initial, '2026-12-15', ENV)).toEqual({
      ok: false,
      errors: { form: 'NO_CHANGES' },
    });
    expect(buildUpdateBody(initial, { ...initial, name: 'Streamly+', planName: '' }, '', ENV)).toEqual({
      ok: true,
      body: { name: 'Streamly+', planName: null },
    });
    expect(buildUpdateBody(initial, { ...initial, paymentAccountId: 'a1' }, '2026-11-15', ENV)).toEqual({
      ok: true,
      body: { paymentAccountId: 'a1', effectiveFrom: '2026-11-15' },
    });
    expect(buildUpdateBody(initial, { ...initial, paymentAccountId: 'a1' }, '', ENV)).toMatchObject({
      ok: false,
      errors: { effectiveFrom: 'DATE' },
    });
    expect(
      buildUpdateBody(initial, { ...initial, cadence: 'ANNUAL', interval: '1' }, '2026-12-15', ENV),
    ).toEqual({
      ok: true,
      body: { billingCycle: { cadence: 'ANNUAL', interval: 1 }, effectiveFrom: '2026-12-15' },
    });
    expect(
      buildUpdateBody(
        initial,
        { ...initial, reminderEnabled: false, reminderDays: '5', tolerance: '3', mode: 'NOTIFY_ONLY' },
        '',
        ENV,
      ),
    ).toEqual({
      ok: true,
      body: {
        materialization: { mode: 'NOTIFY_ONLY' },
        reminder: { enabled: false, daysBefore: 5 },
        priceTolerancePercent: '3',
      },
    });
  });
});

describe('Acciones según rol y estado', () => {
  it('el VIEWER solo ve: ninguna acción de escritura', () => {
    const actions = availableActions(subscription({ scheduledCancellationOn: '2026-12-15' }), false);
    expect(Object.values(actions).every((v) => v === false)).toBe(true);
  });

  it('solo ACTIVE se pausa y solo PAUSED se reanuda; una cancelada es de solo lectura', () => {
    expect(availableActions(subscription({ status: 'ACTIVE' }), true)).toMatchObject({
      pause: true,
      resume: false,
      cancel: true,
      edit: true,
    });
    expect(availableActions(subscription({ status: 'TRIAL' }), true)).toMatchObject({
      pause: false,
      resume: false,
      cancel: true,
    });
    expect(availableActions(subscription({ status: 'PAUSED' }), true)).toMatchObject({
      pause: false,
      resume: true,
    });
    const cancelled = availableActions(subscription({ status: 'CANCELLED' }), true);
    expect(Object.values(cancelled).every((v) => v === false)).toBe(true);
  });

  it('deshacer la cancelación y cancelar al fin del ciclo dependen de los datos de la suscripción', () => {
    expect(availableActions(subscription(), true).undoCancellation).toBe(false);
    expect(availableActions(subscription({ scheduledCancellationOn: '2026-12-15' }), true)).toMatchObject({
      undoCancellation: true,
    });
    expect(availableActions(subscription({ nextRenewalOn: null }), true).cancelAtCycleEnd).toBe(false);
    expect(availableActions(subscription(), true).cancelAtCycleEnd).toBe(true);
  });

  it('cancelar ahora no envía fecha; al fin del ciclo envía la próxima renovación', () => {
    expect(buildCancelBody('NOW', '2026-12-15', '')).toBeUndefined();
    expect(buildCancelBody('NOW', '2026-12-15', ' Ya no la uso ')).toEqual({ reason: 'Ya no la uso' });
    expect(buildCancelBody('CYCLE_END', '2026-12-15', '')).toEqual({ effectiveOn: '2026-12-15' });
    expect(buildCancelBody('CYCLE_END', null, '')).toBeUndefined();
  });
});

describe('Historial de precios', () => {
  const replaced = price({
    id: 'old',
    effectiveFrom: '2027-03-15',
    price: usd('129.90'),
    supersededBy: 'new',
  });
  const correction = price({
    id: 'new',
    effectiveFrom: '2027-03-15',
    price: usd('12.99'),
    origin: 'CORRECTION',
    supersedesId: 'old',
  });
  const history = [price(), replaced, correction];
  const table = (canSupersede = true) =>
    renderToStaticMarkup(
      <PriceHistoryTable
        history={history}
        f={f}
        locale="es-BO"
        today="2027-04-01"
        canSupersede={canSupersede}
        onSupersede={() => undefined}
      />,
    );

  it('conserva la entrada reemplazada, marcada con texto e icono, y muestra quién la sustituye', () => {
    const html = table();
    const text = textOf(html);
    expect(html).toContain('data-superseded="true"');
    expect(html).toContain('<s>129,90 USD</s>');
    expect(text).toContain('Reemplazado por 12,99 USD');
    expect(text).toContain('Corrección');
    expect(text).toContain('Precio inicial');
    expect(text).toContain('15/03/2027');
    expect(html).toContain('<caption');
  });

  it('el precio vigente hoy ignora las entradas reemplazadas y las futuras se marcan programadas', () => {
    expect(priceInForce(history, '2027-04-01')?.id).toBe('new');
    expect(priceInForce(history, '2027-02-28')?.price.amount).toBe('10.99');
    expect(priceInForce(history, '2026-01-01')).toBeUndefined();
    expect(textOf(table())).toContain('Vigente hoy');
    const future = renderToStaticMarkup(
      <PriceHistoryTable
        history={history}
        f={f}
        locale="es-BO"
        today="2027-01-01"
        canSupersede={false}
        onSupersede={() => undefined}
      />,
    );
    expect(textOf(future)).toContain('Programado');
  });

  it('ordena por vigencia descendente con la corrección antes de la reemplazada', () => {
    expect(historyRows(history).map((p) => p.id)).toEqual(['new', 'old', price().id]);
  });

  it('"Corregir" solo aparece para un EDITOR y en entradas no reemplazadas', () => {
    const editor = table(true);
    expect(editor.match(/data-testid="supersede-price"/g)).toHaveLength(2);
    expect(table(false)).not.toContain('supersede-price');
  });

  it('el precio de corrección es positivo y respeta la escala', () => {
    expect(buildSupersedeBody('12,99', ' tipeo ', 'USD', ENV)).toEqual({
      ok: true,
      body: { price: usd('12.99'), reason: 'tipeo' },
    });
    expect(buildSupersedeBody('12,999', '', 'USD', ENV)).toMatchObject({ errors: { price: 'AMOUNT_SCALE' } });
    expect(buildPriceBody('12,99', '2027-03-15', 'USD', ENV)).toEqual({
      ok: true,
      body: { price: usd('12.99'), effectiveFrom: '2027-03-15' },
    });
    expect(buildPriceBody('0', '2027-03-15', 'USD', ENV)).toMatchObject({
      errors: { price: 'AMOUNT_NOT_POSITIVE' },
    });
    expect(buildPriceBody('12,99', '', 'USD', ENV)).toMatchObject({ errors: { effectiveFrom: 'DATE' } });
  });
});

describe('Propuesta de precio pendiente', () => {
  const card = (over: { canDecide?: boolean; highlighted?: boolean } = {}) =>
    renderToStaticMarkup(
      <ProposalCard
        ctx={ctx}
        f={f}
        subscription={subscription({ pendingProposal: proposal() })}
        canDecide={over.canDecide ?? true}
        highlighted={over.highlighted ?? false}
        onChanged={() => undefined}
      />,
    );

  it('muestra el precio anterior y el propuesto, la variación y Aceptar/Rechazar', () => {
    const html = card();
    const text = textOf(html);
    expect(text).toContain('de 10,99 USD a 12,99 USD desde el 15/03/2027');
    expect(text).toContain('+18,20 %');
    expect(html).toContain('data-testid="accept-proposal"');
    expect(html).toContain('data-testid="reject-proposal"');
    expect(html).toContain('data-highlighted="false"');
  });

  it('el enlace de la notificación la resalta y el VIEWER no puede decidir', () => {
    expect(card({ highlighted: true })).toContain('data-highlighted="true"');
    const viewer = card({ canDecide: false });
    expect(viewer).not.toContain('accept-proposal');
    expect(viewer).not.toContain('reject-proposal');
  });

  it('sin propuesta pendiente no se dibuja nada y un enlace a una ya decidida lo avisa', () => {
    expect(
      renderToStaticMarkup(
        <ProposalCard
          ctx={ctx}
          f={f}
          subscription={subscription()}
          canDecide
          highlighted={false}
          onChanged={() => undefined}
        />,
      ),
    ).toBe('');
    expect(textOf(renderToStaticMarkup(<ProposalGone f={f} />))).toContain('ya no está pendiente');
  });
});

describe('Cargos', () => {
  const table = (charges: readonly SubscriptionCharge[], canRecord = true) =>
    renderToStaticMarkup(
      <ChargesTable
        charges={charges}
        f={f}
        locale="es-BO"
        canRecord={canRecord}
        renderStatement={() => <span data-testid="statement-slot" />}
      />,
    );

  it('un cargo en otra moneda muestra la tasa implícita con 4 decimales', () => {
    const html = table([charge()]);
    const text = textOf(html);
    expect(text).toContain('108,50 BOB');
    expect(text).toContain('10,99 USD');
    expect(text).toContain('9,8726 BOB por USD');
    expect(text).toContain('No comparable');
    expect(html).toContain('data-testid="statement-slot"');
    expect(formatImpliedRate('9.8726', 'es-BO')).toBe('9,8726');
  });

  it('un cargo en la misma moneda muestra el desvío con signo y su resultado', () => {
    const html = table([
      charge({
        charged: usd('12.99'),
        impliedRate: null,
        deviationPercent: '+18.20',
        outcome: 'PRICE_CHANGE_DETECTED',
      }),
    ]);
    expect(textOf(html)).toContain('Desvío +18,20 %');
    expect(textOf(html)).toContain('Cambio de precio detectado');
    expect(html).not.toContain('statement-slot');
    expect(formatPercent('-5.00', 'es-BO')).toBe('-5,00 %');
  });

  it('con el monto del extracto lo muestra y el VIEWER no puede indicarlo', () => {
    const withStatement = table([
      charge({ priceCurrencyAmount: usd('12.99'), outcome: 'PRICE_CHANGE_DETECTED' }),
    ]);
    expect(textOf(withStatement)).toContain('Extracto: 12,99 USD');
    expect(table([charge()], false)).not.toContain('statement-slot');
  });

  it('el monto del extracto es positivo, en la moneda del precio y con su escala', () => {
    expect(buildChargeBody('12,99', 'USD', ENV)).toEqual({
      ok: true,
      body: { priceCurrencyAmount: usd('12.99') },
    });
    expect(buildChargeBody('', 'USD', ENV)).toMatchObject({ errors: { amount: 'REQUIRED' } });
    expect(buildChargeBody('0', 'USD', ENV)).toMatchObject({ errors: { amount: 'AMOUNT_NOT_POSITIVE' } });
  });

  it('sin cargos muestra el estado vacío', () => {
    expect(table([])).toContain('data-testid="charges-empty"');
  });
});

describe('Costo de suscripciones', () => {
  const view = (s: SubscriptionCostSummary) =>
    renderToStaticMarkup(<CostSummaryView summary={s} f={f} df={df} href={(p) => `/es${p}`} />);

  it('muestra costo mensual y anual por suscripción y el total en moneda base', () => {
    const html = view(summary());
    const text = textOf(html);
    expect(text).toContain('102,21 BOB');
    expect(text).toContain('1.226,48 BOB');
    expect(text).toContain('10,99 USD');
    expect(text).toContain('131,88 USD');
    expect(html).toContain('data-complete="true"');
    expect(html).not.toContain('data-testid="cost-incomplete"');
    expect(html).toContain('<caption');
  });

  it('muestra las tasas usadas con su fuente atribuida y enlazada', () => {
    const html = view(summary());
    expect(html).toContain('data-testid="cost-rates"');
    expect(html).toContain('data-testid="rate-badge"');
    expect(html).toContain('href="https://paralelo.bo"');
    expect(textOf(html)).toContain('USD/BOB');
  });

  it('sin tasa deja el monto sin convertir, marca "incompleto" y no lo suma 1 a 1', () => {
    const item = costItem({
      name: 'SinTasa',
      monthly: { native: { amount: '5.000000', currency: 'USDT' }, base: null },
      annual: { native: { amount: '60.000000', currency: 'USDT' }, base: null },
      complete: false,
    });
    const html = view(
      summary({
        items: [costItem(), item],
        totals: {
          monthly: bob('102.21'),
          annual: bob('1226.48'),
          complete: false,
          unconverted: [
            {
              monthly: { amount: '5.000000', currency: 'USDT' },
              annual: { amount: '60.000000', currency: 'USDT' },
            },
          ],
        },
      }),
    );
    const text = textOf(html);
    expect(html).toContain('data-testid="cost-incomplete"');
    expect(text).toContain('Total incompleto: faltan tasas');
    expect(text).toContain('5,000000 USDT al mes');
    expect(html).toContain('data-testid="cost-row-incomplete"');
    expect(html).toContain('data-testid="unconverted-amount"');
    expect(text).toContain('incompleto');
    expect(html).toContain('data-complete="false"');
  });

  it('las suscripciones en trial van aparte como "Costo al terminar el trial"', () => {
    const html = view(
      summary({
        afterTrial: {
          items: [costItem({ name: 'CloudDrive', status: 'TRIAL' })],
          monthly: bob('46.50'),
          annual: bob('558.00'),
          complete: true,
        },
      }),
    );
    expect(html).toContain('data-testid="after-trial"');
    expect(textOf(html)).toContain('Costo al terminar el trial');
    expect(textOf(html)).toContain('46,50 BOB al mes; 558,00 BOB al año');
    expect(html).toContain('data-testid="after-trial-table"');
    const trialSection = html.slice(html.indexOf('data-testid="after-trial"'));
    expect(trialSection).toContain('CloudDrive');
    expect(html.slice(0, html.indexOf('data-testid="after-trial"'))).not.toContain('CloudDrive');
  });

  it('sin suscripciones activas muestra el estado vacío', () => {
    const html = view(
      summary({ items: [], meta: { ratesUsed: [], rateWindowDays: 7, asOf: '2026-10-10T12:00:00Z' } }),
    );
    expect(html).toContain('data-testid="cost-empty"');
    expect(html).not.toContain('cost-rates');
  });
});

describe('Enlace de la notificación y navegación', () => {
  const link = (over: Record<string, unknown>) => ({
    kind: 'SUBSCRIPTION',
    periodId: SUB_ID,
    periodLabel: '2026-11',
    subscriptionId: SUB_ID,
    ...over,
  });

  it('traduce el enlace SUBSCRIPTION al detalle, con ?propuesta= si trae propuesta', () => {
    expect(resourcePath(link({}) as never)).toBe(`/recurring/suscripciones/${SUB_ID}`);
    expect(resourcePath(link({ proposalId: 'p-1' }) as never)).toBe(
      `/recurring/suscripciones/${SUB_ID}?propuesta=p-1`,
    );
    expect(resourcePath(link({ subscriptionId: undefined }) as never)).toBeUndefined();
  });

  it('la ruta del detalle marca el acceso desde el listado de una cancelada', () => {
    expect(subscriptionPath(SUB_ID)).toBe(`/recurring/suscripciones/${SUB_ID}`);
    expect(subscriptionPath(SUB_ID, { cancelled: true })).toBe(
      `/recurring/suscripciones/${SUB_ID}?historial=1`,
    );
  });

  it('las suscripciones cuelgan de la sección Recurrentes de la sidebar', () => {
    expect(activeNav('/recurring/suscripciones')).toBe('recurring');
    expect(activeNav(`/en/recurring/suscripciones/${SUB_ID}`)).toBe('recurring');
  });

  it('los tres tipos de notificación nuevos tienen texto de preferencias', () => {
    const n = esContext('Notifications');
    for (const type of ['SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_TRIAL_ENDING', 'SUBSCRIPTION_PRICE_CHANGE'])
      expect(n.has(`prefs.types.${type}`)).toBe(true);
  });
});

describe('Errores por code (NFR-USAB-009)', () => {
  it('los códigos nuevos se muestran por code, no por título', () => {
    for (const [code, fragment] of [
      ['SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL', 'posterior a la del último precio'],
      ['SUBSCRIPTION_PROPOSAL_NOT_PENDING', 'ya fue decidida'],
      ['RECURRING_MANAGED_EXTERNALLY', 'lo administra una suscripción'],
    ] as const) {
      const html = renderToStaticMarkup(
        <ProblemMessage problem={{ code, title: 'Internal title' } as { code: string }} locale="es" />,
      );
      expect(textOf(html)).toContain(fragment);
      expect(html).toContain(`data-error-code="${code}"`);
      expect(html).not.toContain('Internal title');
    }
  });
});

describe('Estilos y tokens', () => {
  it('no usa colores literales: solo los tokens de globals.css', () => {
    const dir = new URL('./', import.meta.url);
    for (const file of readdirSync(dir).filter((n) => /\.(tsx?|css)$/.test(n) && !n.includes('.test.'))) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/\brgba?\(/);
    }
  });
});
