import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { WorkspaceContext } from '../common/workspace';
import { esContext, textOf } from '../test-support';
import type { Catalogs } from '../transactions/catalogs';
import { OccurrenceStatusBadge, formatExpected } from './Badges';
import { CommittedView } from './CommittedCard';
import { DefinitionFormView } from './DefinitionForm';
import { DefinitionsList } from './DefinitionsList';
import { NavCountView } from './RecurringNavCount';
import { OccurrencesTable } from './OccurrencesTable';
import { RevisionResult } from './RevisionResult';
import { SchedulePreview } from './SchedulePreview';
import {
  OCCURRENCE_PRESENTATION,
  addDays,
  approvalBadge,
  availableOccurrenceActions,
  buildCreateBody,
  buildEditBody,
  buildMaterializeBody,
  buildRevisionBody,
  committedItemPath,
  compareDecimal,
  emptyForm,
  formFromVersion,
  linkCandidates,
  linkMismatchReasons,
  linkSearchQuery,
  materializeDefaults,
  previewOf,
  type DefinitionForm,
  type FormEnv,
} from './logic';
import { OCCURRENCE_STATUSES } from './types';
import type {
  CommittedAmount,
  RecurringDefinition,
  RecurringDefinitionVersion,
  RecurringOccurrence,
} from './types';

const f = esContext('Recurring');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const ENV: FormEnv = { locale: 'es-BO', currency: 'BOB', scale: 2 };
const names: Record<string, string> = { a1: 'Banco BOB', a2: 'Tarjeta', usdt: 'Billetera USDT' };

function occurrence(over: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    id: '0198f0aa-0000-7000-8000-000000000001',
    definitionId: '0198f0aa-0000-7000-8000-0000000000d1',
    definitionName: 'Internet',
    kind: 'EXPENSE',
    managedBy: 'USER',
    occurrenceDate: '2026-10-20',
    dueDate: '2026-10-20',
    definitionVersionNo: 1,
    expected: { type: 'FIXED', amount: bob('199.00') },
    projectedAmount: bob('199.00'),
    status: 'DUE',
    cancelReason: null,
    requiresApproval: true,
    mode: 'PENDING_APPROVAL',
    overridden: false,
    accountId: 'a1',
    toAccountId: null,
    transactionId: null,
    resolution: null,
    matchedBy: null,
    skipReason: null,
    lastAutoCreateError: null,
    version: 1,
    ...over,
  };
}

const version = (over: Partial<RecurringDefinitionVersion> = {}): RecurringDefinitionVersion => ({
  versionNo: 1,
  effectiveFrom: '2026-10-01',
  accountId: 'a1',
  toAccountId: null,
  currency: 'BOB',
  amount: { type: 'FIXED', amount: bob('3500.00') },
  categoryId: null,
  counterpartyId: null,
  tagIds: [],
  paymentMethod: null,
  schedule: {
    cadence: 'MONTHLY',
    interval: 1,
    monthDays: [],
    rrule: null,
    startDate: '2026-10-05',
    endDate: null,
    maxOccurrences: null,
    weekendAdjustment: 'NONE',
  },
  materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null, leadDays: 3 },
  ...over,
});

const definition = (over: Partial<RecurringDefinition> = {}): RecurringDefinition => ({
  id: '0198f0aa-0000-7000-8000-0000000000d1',
  name: 'Alquiler',
  description: null,
  notes: null,
  kind: 'EXPENSE',
  managedBy: 'USER',
  managedRef: null,
  status: 'ACTIVE',
  currentVersionNo: 1,
  generatedThrough: null,
  endDate: null,
  version: 1,
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
  current: version(),
  nextOccurrence: { occurrenceDate: '2026-11-05', dueDate: '2026-11-05' },
  pendingApprovalCount: 2,
  ...over,
});

const form = (over: Partial<DefinitionForm> = {}): DefinitionForm => ({
  ...emptyForm('2026-10-09'),
  name: 'Internet',
  accountId: 'a1',
  amount: '199,00',
  startDate: '2026-10-20',
  ...over,
});

const table = (
  occurrences: readonly RecurringOccurrence[],
  over: Partial<Parameters<typeof OccurrencesTable>[0]> = {},
) =>
  renderToStaticMarkup(
    <OccurrencesTable
      occurrences={occurrences}
      f={f}
      uiLocale="es"
      canEdit
      accountName={(id) => names[id]}
      href={(p) => `/es${p}`}
      caption="Pagos"
      empty="Vacío"
      onAction={() => undefined}
      {...over}
    />,
  );

describe('Estados de la ocurrencia (NFR-USAB-104)', () => {
  it('[TC-COMMITMENTS-RECUR-018] cada estado se muestra con texto e icono decorativo', () => {
    const labels: Record<string, string> = {
      SCHEDULED: 'Programada',
      DUE: 'Próxima',
      OVERDUE: 'Atrasada',
      MATERIALIZED: 'Creada',
      MATCHED: 'Vinculada',
      SKIPPED: 'Omitida',
      CANCELLED: 'Cancelada',
    };
    for (const status of OCCURRENCE_STATUSES) {
      const html = renderToStaticMarkup(<OccurrenceStatusBadge status={status} f={f} />);
      expect(textOf(html)).toContain(labels[status]);
      expect(textOf(html)).toContain(OCCURRENCE_PRESENTATION[status].icon);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-status="${status}"`);
    }
    // Los iconos son distintos: el color nunca es el único portador del estado.
    const icons = new Set(OCCURRENCE_STATUSES.map((s) => OCCURRENCE_PRESENTATION[s].icon));
    expect(icons.size).toBe(OCCURRENCE_STATUSES.length);
  });

  it('solo una ocurrencia sin resolver y un EDITOR/OWNER tienen acciones (también en modo solo aviso, D114)', () => {
    for (const status of ['SCHEDULED', 'DUE', 'OVERDUE'] as const)
      expect(availableOccurrenceActions({ status }, true)).toEqual(['approve', 'link', 'skip', 'edit']);
    for (const status of ['MATERIALIZED', 'MATCHED', 'SKIPPED', 'CANCELLED'] as const)
      expect(availableOccurrenceActions({ status }, true)).toEqual([]);
    expect(availableOccurrenceActions({ status: 'DUE' }, false)).toEqual([]);
  });
});

describe('Montos con la escala de la moneda', () => {
  it('[TC-COMMITMENTS-RECUR-010] fijo, estimado, rango MIN_MAX y variable', () => {
    expect(formatExpected({ type: 'FIXED', amount: bob('199.00') }, f)).toBe('199,00 BOB');
    expect(formatExpected({ type: 'ESTIMATED', amount: bob('150.00') }, f)).toBe('≈ 150,00 BOB');
    expect(formatExpected({ type: 'MIN_MAX', min: bob('100.00'), max: bob('1180.50') }, f)).toBe(
      '100,00 – 1.180,50 BOB',
    );
    expect(formatExpected({ type: 'VARIABLE' }, f)).toBe('Sin monto');
    // Escala de la moneda: 6 decimales de USDT, sin redondear.
    expect(formatExpected({ type: 'FIXED', amount: { amount: '10.000001', currency: 'USDT' } }, f)).toBe(
      '10,000001 USDT',
    );
  });

  it('[TC-COMMITMENTS-RECUR-010] la tabla muestra el rango, el estimado y "Sin monto" por fila', () => {
    const html = table([
      occurrence({
        id: 'o1',
        definitionName: 'Gimnasio',
        expected: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      }),
      occurrence({ id: 'o2', definitionName: 'Luz', expected: { type: 'ESTIMATED', amount: bob('150.00') } }),
      occurrence({ id: 'o3', definitionName: 'Taxi', expected: { type: 'VARIABLE' } }),
    ]);
    const text = textOf(html);
    expect(text).toContain('100,00 – 180,00 BOB');
    expect(text).toContain('≈ 150,00 BOB');
    expect(text).toContain('Sin monto');
    expect(html).toContain('data-amount-type="MIN_MAX"');
  });

  it('[TC-COMMITMENTS-RECUR-011] un monto con más decimales que la moneda se rechaza sin redondear; el separador es el del locale', () => {
    const ok = buildCreateBody(form({ amount: '1.234,50' }), ENV);
    expect(ok.ok && (ok.body['template'] as { amount: unknown }).amount).toEqual({
      type: 'FIXED',
      amount: bob('1234.50'),
    });
    const scale = buildCreateBody(form({ amount: '10,555' }), ENV);
    expect(scale).toMatchObject({ ok: false, errors: { amount: 'AMOUNT_SCALE' } });
    const usdt = buildCreateBody(form({ amount: '10,000001' }), { ...ENV, currency: 'USDT', scale: 6 });
    expect(usdt.ok).toBe(true);
    expect(buildCreateBody(form({ amount: '0' }), ENV)).toMatchObject({
      errors: { amount: 'AMOUNT_NOT_POSITIVE' },
    });
    expect(buildCreateBody(form({ amount: '' }), ENV)).toMatchObject({ errors: { amount: 'REQUIRED' } });
  });

  it('[TC-COMMITMENTS-RECUR-010] MIN_MAX exige mínimo y máximo con máx ≥ mín; VARIABLE no lleva monto', () => {
    const range = buildCreateBody(form({ amountType: 'MIN_MAX', min: '100', max: '180' }), ENV);
    expect(range.ok && (range.body['template'] as { amount: unknown }).amount).toEqual({
      type: 'MIN_MAX',
      min: bob('100.00'),
      max: bob('180.00'),
    });
    expect(buildCreateBody(form({ amountType: 'MIN_MAX', min: '200', max: '180' }), ENV)).toMatchObject({
      ok: false,
      errors: { max: 'RANGE' },
    });
    const variable = buildCreateBody(form({ amountType: 'VARIABLE', amount: '' }), ENV);
    expect(variable.ok && (variable.body['template'] as { amount: unknown }).amount).toEqual({
      type: 'VARIABLE',
    });
    expect(compareDecimal('100.00', '99.999')).toBe(1);
    expect(compareDecimal('1.50', '1.5')).toBe(0);
  });
});

describe('Bandeja y contador', () => {
  it('[TC-COMMITMENTS-RECUR-021] la bandeja lista las por aprobar con sus acciones y nombres accesibles', () => {
    const html = table([occurrence()]);
    expect(html).toContain('data-testid="occurrence-row"');
    for (const action of ['approve', 'link', 'skip', 'edit'])
      expect(html).toContain(`data-action="${action}"`);
    expect(html).toContain('aria-label="Aprobar Internet del 20/10/2026"');
    expect(html).toContain('aria-label="Vincular Internet del 20/10/2026 con una transacción"');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('href="/es/recurring/occurrences/0198f0aa-0000-7000-8000-000000000001"');
    expect(textOf(table([], { empty: 'No tienes pagos por aprobar.' }))).toContain(
      'No tienes pagos por aprobar.',
    );
  });

  it('[TC-COMMITMENTS-RECUR-039] un VIEWER ve la lista sin acciones', () => {
    const html = table([occurrence()], { canEdit: false });
    expect(html).not.toContain('<button');
    expect(textOf(html)).not.toContain('Acciones');
    expect(textOf(html)).toContain('Internet');
  });

  it('[TC-COMMITMENTS-RECUR-019] la creación automática rechazada deja la atrasada con el error visible (D129)', () => {
    const html = table([
      occurrence({
        status: 'OVERDUE',
        mode: 'AUTO_CREATE',
        requiresApproval: false,
        lastAutoCreateError: 'PERIOD_CLOSED',
      }),
    ]);
    expect(html).toContain('data-error-code="PERIOD_CLOSED"');
    expect(textOf(html)).toContain('No se pudo crear automáticamente: El mes de esa fecha está cerrado.');
    expect(textOf(html)).toContain('Atrasada');
  });

  it('el contador de la sidebar muestra el número con texto accesible y se oculta en cero', () => {
    const html = renderToStaticMarkup(<NavCountView count={3} hasMore={false} label="3 pagos por aprobar" />);
    expect(html).toContain('aria-hidden="true">3<');
    expect(textOf(html)).toContain('3 pagos por aprobar');
    expect(renderToStaticMarkup(<NavCountView count={0} hasMore={false} label="x" />)).toBe('');
    expect(approvalBadge(5, false)).toBe('5');
    expect(approvalBadge(100, true)).toBe('99+');
    expect(f.t('columns.toApprove')).toBe('Por aprobar');
  });

  it('[TC-COMMITMENTS-RECUR-029] vincular busca por cuenta y tipo en ±15 días del vencimiento y descarta anuladas', () => {
    const q = linkSearchQuery(occurrence({ dueDate: '2026-10-20' }), ' internet ');
    expect(q.getAll('accountId')).toEqual(['a1']);
    expect(q.getAll('kind')).toEqual(['EXPENSE']);
    expect(q.get('dateFrom')).toBe('2026-10-05');
    expect(q.get('dateTo')).toBe('2026-11-04');
    expect(q.get('q')).toBe('internet');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    const tx = (id: string, kind: string, status: string, legs: string[] = ['a1']) =>
      ({ id, kind, status, legs: legs.map((accountId) => ({ accountId })) }) as never;
    const found = linkCandidates(occurrence({ kind: 'EXPENSE' }), [
      tx('t1', 'EXPENSE', 'POSTED'),
      tx('t2', 'EXPENSE', 'VOIDED'),
      tx('t3', 'INCOME', 'POSTED'),
    ]);
    expect(found.map((t) => t.id)).toEqual(['t1']);
    const transfer = linkCandidates(occurrence({ kind: 'TRANSFER', toAccountId: 'a2' }), [
      tx('t4', 'TRANSFER', 'POSTED', ['a1', 'a2']),
      tx('t5', 'TRANSFER', 'POSTED', ['a1', 'a3']),
    ]);
    expect(transfer.map((t) => t.id)).toEqual(['t4']);
  });

  it('[TC-COMMITMENTS-RECUR-030] OCCURRENCE_LINK_MISMATCH muestra el mensaje por code y los motivos de details.reasons', () => {
    const problem = { code: 'OCCURRENCE_LINK_MISMATCH', details: { reasons: ['ACCOUNT', 'CURRENCY'] } };
    expect(linkMismatchReasons(problem)).toEqual(['ACCOUNT', 'CURRENCY']);
    expect(linkMismatchReasons({ code: 'X' })).toEqual([]);
    const html = renderToStaticMarkup(<ProblemMessage problem={problem} locale="es" />);
    expect(html).toContain('data-error-code="OCCURRENCE_LINK_MISMATCH"');
    expect(textOf(html)).toContain('La transacción no coincide con el pago');
    for (const reason of ['ACCOUNT', 'KIND', 'CURRENCY', 'VOIDED'])
      expect(f.has(`link.reasons.${reason}`)).toBe(true);
  });
});

describe('Aprobar, editar y omitir', () => {
  const dueOctober25 = occurrence({
    dueDate: '2026-10-25',
    expected: { type: 'ESTIMATED', amount: bob('150.00') },
  });

  it('[TC-COMMITMENTS-RECUR-046] aprobar antes del vencimiento propone hoy como fecha; después, el vencimiento', () => {
    expect(materializeDefaults(dueOctober25, '2026-10-09')).toEqual({
      amount: '',
      date: '2026-10-09',
      status: 'POSTED',
    });
    expect(materializeDefaults(dueOctober25, '2026-10-30').date).toBe('2026-10-25');
  });

  it('[TC-COMMITMENTS-RECUR-023] aprobar con el monto real envía Money, fecha y estado', () => {
    const built = buildMaterializeBody(
      dueOctober25,
      { amount: '163,40', date: '2026-10-25', status: 'POSTED' },
      ENV,
    );
    expect(built).toEqual({
      ok: true,
      body: { status: 'POSTED', amount: bob('163.40'), businessDate: '2026-10-25' },
    });
    // Sin monto se usa el esperado en el servidor: no se envía `amount`.
    const expected = buildMaterializeBody(
      dueOctober25,
      { amount: '', date: '2026-10-25', status: 'PENDING' },
      ENV,
    );
    expect(expected).toEqual({ ok: true, body: { status: 'PENDING', businessDate: '2026-10-25' } });
  });

  it('[TC-COMMITMENTS-RECUR-024] VARIABLE exige el monto; MIN_MAX lo acota al rango', () => {
    const variable = occurrence({ expected: { type: 'VARIABLE' } });
    expect(
      buildMaterializeBody(variable, { amount: '', date: '2026-10-25', status: 'POSTED' }, ENV),
    ).toMatchObject({
      ok: false,
      errors: { amount: 'REQUIRED' },
    });
    const range = occurrence({ expected: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') } });
    expect(
      buildMaterializeBody(range, { amount: '200', date: '2026-10-25', status: 'POSTED' }, ENV),
    ).toMatchObject({
      ok: false,
      errors: { amount: 'RANGE' },
    });
    expect(buildMaterializeBody(range, { amount: '150', date: '2026-10-25', status: 'POSTED' }, ENV).ok).toBe(
      true,
    );
    expect(buildMaterializeBody(range, { amount: '', date: '2026-10-25', status: 'POSTED' }, ENV).ok).toBe(
      true,
    );
  });

  it('[TC-COMMITMENTS-RECUR-027] editar envía solo lo que cambió (monto o rango y vencimiento)', () => {
    const o = occurrence();
    expect(buildEditBody(o, { amount: '210,00', min: '', max: '', dueDate: '2026-10-20' }, ENV)).toEqual({
      ok: true,
      body: { expectedAmount: bob('210.00') },
    });
    expect(buildEditBody(o, { amount: '199.00', min: '', max: '', dueDate: '2026-10-22' }, ENV)).toEqual({
      ok: true,
      body: { dueDate: '2026-10-22' },
    });
    expect(
      buildEditBody(o, { amount: '199.00', min: '', max: '', dueDate: '2026-10-20' }, ENV),
    ).toMatchObject({
      ok: false,
      errors: { form: 'NO_CHANGES' },
    });
    const range = occurrence({ expected: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') } });
    expect(buildEditBody(range, { amount: '', min: '100', max: '190', dueDate: '2026-10-20' }, ENV)).toEqual({
      ok: true,
      body: { expectedMax: bob('190.00') },
    });
  });
});

describe('Formulario de definición', () => {
  const ctx = {
    api: {},
    base: '/workspaces/w1',
    scales: { BOB: 2, USDT: 6 },
    formatLocale: 'es-BO',
    uiLocale: 'es',
    canEdit: true,
    href: (p: string) => `/es${p}`,
  } as unknown as WorkspaceContext;
  const accounts = [
    { id: 'a1', name: 'Banco BOB', currency: 'BOB', status: 'ACTIVE' },
    { id: 'a2', name: 'Tarjeta', currency: 'BOB', status: 'ACTIVE' },
  ];
  const catalogs = {
    loaded: true,
    accounts,
    activeAccounts: accounts,
    categories: [],
    groups: [],
    counterparties: [],
    tags: [],
    names: {
      account: (id: string) => names[id],
      category: () => undefined,
      counterparty: () => undefined,
      tag: () => undefined,
    },
    reload: () => undefined,
    addCounterparty: () => undefined,
  } as unknown as Catalogs;
  const render = (initial: DefinitionForm, mode: 'create' | 'revise' = 'create') =>
    renderToStaticMarkup(
      <DefinitionFormView
        ctx={ctx}
        f={f}
        catalogs={catalogs}
        today="2026-10-09"
        mode={mode}
        initial={initial}
        {...(mode === 'revise' ? { definition: definition() } : {})}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );

  it('[TC-COMMITMENTS-RECUR-003] ofrece Ingreso, Gasto y Transferencia; los tipos reservados no se ofrecen', () => {
    const html = render(emptyForm('2026-10-09'));
    expect(html).toContain('value="INCOME"');
    expect(html).toContain('value="EXPENSE"');
    expect(html).toContain('value="TRANSFER"');
    expect(html).not.toContain('LOAN_PAYMENT');
    expect(html).not.toContain('CARD_PAYMENT');
    expect(textOf(html)).toContain('usa una transferencia a la cuenta de la tarjeta');
  });

  it('[TC-COMMITMENTS-RECUR-020] la creación automática se deshabilita con un monto variable o de rango', () => {
    const autoCreateInput = (html: string) => /<input[^>]*value="AUTO_CREATE"[^>]*>/.exec(html)?.[0] ?? '';
    expect(autoCreateInput(render(form({ amountType: 'VARIABLE' })))).toContain('disabled');
    expect(autoCreateInput(render(form({ amountType: 'MIN_MAX' })))).toContain('disabled');
    expect(autoCreateInput(render(form({ amountType: 'FIXED' })))).not.toContain('disabled');
    const bad = buildCreateBody(form({ amountType: 'VARIABLE', mode: 'AUTO_CREATE' }), ENV);
    expect(bad).toMatchObject({ ok: false, errors: { mode: 'AUTO_AMOUNT' } });
  });

  it('[TC-COMMITMENTS-RECUR-012] el formulario muestra la vista previa y el aviso de fin de mes con el día 31', () => {
    const html = render(form({ startDate: '2026-01-31' }));
    expect(html).toContain('data-testid="schedule-preview"');
    expect(html).toContain('data-testid="month-end-warning"');
    expect(html.match(/data-nominal=/g)).toHaveLength(6);
  });

  it('una transferencia exige cuenta de destino distinta y de la misma moneda, y no lleva categoría', () => {
    const base = form({ kind: 'TRANSFER' });
    expect(buildCreateBody(base, ENV)).toMatchObject({ ok: false, errors: { toAccountId: 'REQUIRED' } });
    expect(buildCreateBody({ ...base, toAccountId: 'a1' }, ENV)).toMatchObject({
      errors: { toAccountId: 'SAME_ACCOUNT' },
    });
    expect(buildCreateBody({ ...base, toAccountId: 'a2' }, { ...ENV, toCurrency: 'USD' })).toMatchObject({
      errors: { toAccountId: 'CURRENCY' },
    });
    const ok = buildCreateBody({ ...base, toAccountId: 'a2', categoryId: 'ignorada' }, ENV);
    expect(ok.ok).toBe(true);
    const template = ok.ok ? (ok.body['template'] as Record<string, unknown>) : {};
    expect(template['toAccountId']).toBe('a2');
    expect(template['categoryId']).toBeUndefined();
    expect(ok.ok && ok.body['kind']).toBe('TRANSFER');
  });

  it('crear "Internet" mensual en aprobación pendiente arma el cuerpo de la API', () => {
    const built = buildCreateBody(form({ weekendAdjustment: 'PREVIOUS', leadDays: '5' }), ENV);
    expect(built).toEqual({
      ok: true,
      body: {
        name: 'Internet',
        kind: 'EXPENSE',
        template: {
          accountId: 'a1',
          amount: { type: 'FIXED', amount: bob('199.00') },
          tagIds: [],
          schedule: {
            cadence: 'MONTHLY',
            interval: 1,
            startDate: '2026-10-20',
            weekendAdjustment: 'PREVIOUS',
          },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 5 },
        },
      },
    });
  });

  it('[TC-COMMITMENTS-RECUR-034] "Cambiar esta y las siguientes" envía solo los cambios; sin cambios no hay petición', () => {
    const v = version();
    const meta = { name: 'Alquiler', description: null, notes: null, kind: 'EXPENSE' as const };
    const base = formFromVersion(v, meta);
    expect(base.amount).toBe('3500.00');
    const changed = { ...base, amount: '3.800,00' };
    expect(buildRevisionBody(base, changed, '2027-01-05', ENV)).toEqual({
      ok: true,
      body: { effectiveFrom: '2027-01-05', changes: { amount: { type: 'FIXED', amount: bob('3800.00') } } },
    });
    expect(buildRevisionBody(base, base, '2027-01-05', ENV)).toMatchObject({
      ok: false,
      errors: { form: 'NO_CHANGES' },
    });
    const day = buildRevisionBody(base, { ...base, monthDay: '1' }, '2027-01-05', ENV);
    expect(day.ok && (day.body['changes'] as { schedule: unknown }).schedule).toEqual({
      cadence: 'MONTHLY',
      monthDays: [1],
      rrule: null,
      interval: 1,
    });
    expect(buildRevisionBody(base, changed, 'enero', ENV)).toMatchObject({
      errors: { effectiveFrom: 'DATE' },
    });
    expect(render(base, 'revise')).toContain('Cambiar esta y las siguientes');
  });

  it('[TC-COMMITMENTS-RECUR-034] el resultado informa reescritas, canceladas, creadas, reinstauradas y ediciones descartadas (D123)', () => {
    const result = {
      definition: definition({ currentVersionNo: 2 }),
      rewritten: 3,
      cancelled: 1,
      created: 2,
      reinstated: 0,
      resetOverrides: 2,
    };
    const text = textOf(renderToStaticMarkup(<RevisionResult result={result} f={f} />));
    expect(text).toContain('versión 2');
    expect(text).toContain('reescritas: 3; canceladas: 1; creadas: 2; reinstauradas: 0');
    expect(text).toContain('Se descartaron 2 ediciones individuales');
    const none = textOf(
      renderToStaticMarkup(<RevisionResult result={{ ...result, resetOverrides: 0 }} f={f} />),
    );
    expect(none).not.toContain('descart');
  });

  it('[TC-COMMITMENTS-RECUR-002] los errores de la API se muestran por code, no por título', () => {
    for (const [code, fragment] of [
      ['RECURRING_MODE_NOT_ALLOWED', 'La creación automática necesita un monto fijo o estimado'],
      ['CURRENCY_MISMATCH', 'La moneda no coincide'],
      ['INVALID_RRULE', 'La regla de repetición no es compatible'],
      ['RECURRING_KIND_NOT_AVAILABLE', 'aún no está disponible'],
      ['OCCURRENCE_AMOUNT_REQUIRED', 'Indica el monto para aprobar'],
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

describe('Vista previa de fechas (shared-kernel)', () => {
  const dates = (p: ReturnType<typeof previewOf>) => (p.ok ? p.dates.map((d) => d.nominal) : p.code);
  const dues = (p: ReturnType<typeof previewOf>) => (p.ok ? p.dates.map((d) => d.due) : p.code);

  it('[TC-COMMITMENTS-RECUR-012] el día 31 cae en el último día de los meses cortos y avisa el fin de mes', () => {
    const p = previewOf(form({ startDate: '2026-01-31' }), { today: '2026-01-15' });
    expect(dates(p)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    expect(p.ok && p.endOfMonthDay).toBe(31);
    expect(p.ok && p.dates.map((d) => d.monthEnd)).toEqual([false, true, false, true, false, true]);
    const html = renderToStaticMarkup(<SchedulePreview preview={p} f={f} />);
    expect(textOf(html)).toContain('Fin de mes: en los meses que no tienen día 31');
    expect(textOf(html)).toContain('último día del mes');
    expect(html).toContain('role="note"');
  });

  it('el día 15 no avisa; -1 (último día) tampoco', () => {
    const p = previewOf(form({ startDate: '2026-10-15' }), { today: '2026-10-09' });
    expect(p.ok && p.endOfMonthDay).toBeNull();
    expect(renderToStaticMarkup(<SchedulePreview preview={p} f={f} />)).not.toContain('month-end-warning');
    const last = previewOf(form({ startDate: '2026-10-01', monthDay: '-1' }), { today: '2026-10-09' });
    expect(last.ok && last.endOfMonthDay).toBeNull();
    expect(dates(last)).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('[TC-COMMITMENTS-RECUR-013] el ajuste de fin de semana mueve solo el vencimiento y conserva la fecha nominal', () => {
    // 1 ago 2026 es sábado; 1 nov 2026 es domingo.
    const previous = previewOf(form({ startDate: '2026-08-01', weekendAdjustment: 'PREVIOUS' }), {
      today: '2026-07-01',
    });
    expect(dates(previous)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
    expect(dues(previous)).toEqual([
      '2026-07-31',
      '2026-09-01',
      '2026-10-01',
      '2026-10-30',
      '2026-12-01',
      '2027-01-01',
    ]);
    expect(previous.ok && previous.dates.map((d) => d.adjusted)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    const next = previewOf(form({ startDate: '2026-08-01', weekendAdjustment: 'NEXT' }), {
      today: '2026-07-01',
    });
    expect(dues(next).slice(0, 1)).toEqual(['2026-08-03']);
    const none = previewOf(form({ startDate: '2026-08-01' }), { today: '2026-07-01' });
    expect(dues(none)).toEqual(dates(none));
    const html = renderToStaticMarkup(<SchedulePreview preview={previous} f={f} />);
    expect(textOf(html)).toContain('fecha original');
    expect(html).toContain('data-nominal="2026-08-01" data-due="2026-07-31"');
  });

  it('[TC-COMMITMENTS-RECUR-006] la cadencia semimensual produce el 15 y el último día de cada mes', () => {
    const p = previewOf(
      form({ cadence: 'SEMIMONTHLY', monthDay: '15', monthDay2: '-1', startDate: '2026-10-01' }),
      { today: '2026-10-09' },
    );
    expect(dates(p)).toEqual([
      '2026-10-15',
      '2026-10-31',
      '2026-11-15',
      '2026-11-30',
      '2026-12-15',
      '2026-12-31',
    ]);
    expect(
      buildCreateBody(form({ cadence: 'SEMIMONTHLY', monthDay: '15', monthDay2: '15' }), ENV),
    ).toMatchObject({
      errors: { monthDay: 'DAYS' },
    });
  });

  it('[TC-COMMITMENTS-RECUR-005] el intervalo multiplica la cadencia (trimestral cada 2 = cada seis meses)', () => {
    const p = previewOf(form({ cadence: 'QUARTERLY', interval: '2', startDate: '2026-10-05' }), {
      today: '2026-10-01',
    });
    expect(dates(p).slice(0, 3)).toEqual(['2026-10-05', '2027-04-05', '2027-10-05']);
    expect(buildCreateBody(form({ interval: '0' }), ENV)).toMatchObject({ errors: { interval: 'INTERVAL' } });
  });

  it('[TC-COMMITMENTS-RECUR-007] la RRULE del último viernes del mes y [TC-COMMITMENTS-RECUR-008] el rechazo de partes no soportadas', () => {
    const p = previewOf(
      form({ cadence: 'CUSTOM', rrule: 'FREQ=MONTHLY;BYDAY=-1FR', startDate: '2026-10-01' }),
      {
        today: '2026-10-01',
      },
    );
    expect(dates(p)).toEqual([
      '2026-10-30',
      '2026-11-27',
      '2026-12-25',
      '2027-01-29',
      '2027-02-26',
      '2027-03-26',
    ]);
    expect(previewOf(form({ cadence: 'CUSTOM', rrule: 'FREQ=SECONDLY' }), { today: '2026-10-01' })).toEqual({
      ok: false,
      code: 'RRULE',
    });
    expect(
      previewOf(form({ cadence: 'CUSTOM', rrule: 'FREQ=MONTHLY;COUNT=3;UNTIL=20271231' }), {
        today: '2026-10-01',
      }),
    ).toMatchObject({ ok: false, code: 'RRULE' });
    expect(buildCreateBody(form({ cadence: 'CUSTOM', rrule: 'FREQ=SECONDLY' }), ENV)).toMatchObject({
      ok: false,
      errors: { rrule: 'RRULE' },
    });
    const unavailable = renderToStaticMarkup(
      <SchedulePreview preview={{ ok: false, code: 'RRULE' }} f={f} />,
    );
    expect(unavailable).toContain('data-testid="preview-unavailable"');
  });

  it('[TC-COMMITMENTS-RECUR-033] un máximo de ocurrencias acota la vista previa', () => {
    const p = previewOf(form({ startDate: '2026-10-05', endMode: 'COUNT', maxOccurrences: '3' }), {
      today: '2026-10-01',
    });
    expect(dates(p)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
    const until = previewOf(form({ startDate: '2026-10-05', endMode: 'DATE', endDate: '2026-11-30' }), {
      today: '2026-10-01',
    });
    expect(dates(until)).toEqual(['2026-10-05', '2026-11-05']);
    expect(
      buildCreateBody(form({ endMode: 'DATE', endDate: '2026-10-01', startDate: '2026-10-20' }), ENV),
    ).toMatchObject({ errors: { endDate: 'END_BEFORE_START' } });
  });
});

describe('Comprometido del periodo', () => {
  const committed = (over: Partial<CommittedAmount> = {}): CommittedAmount => ({
    periodId: '0198f0aa-0000-7000-8000-0000000000e1',
    periodLabel: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    byCurrency: [
      { currency: 'BOB', occurrences: bob('529.00'), pending: bob('250.00'), total: bob('779.00') },
    ],
    consolidated: { amount: bob('779.00'), complete: true, unconverted: [] },
    expectedIncome: [bob('9000.00')],
    withoutAmountCount: 0,
    items: [
      {
        source: 'OCCURRENCE',
        id: 'o1',
        definitionId: 'd1',
        name: 'Internet',
        kind: 'EXPENSE',
        date: '2026-10-20',
        amount: bob('199.00'),
        status: 'DUE',
      },
      {
        source: 'OCCURRENCE',
        id: 'o2',
        definitionId: 'd2',
        name: 'Gimnasio',
        kind: 'EXPENSE',
        date: '2026-10-28',
        amount: bob('180.00'),
        status: 'SCHEDULED',
      },
      {
        source: 'PENDING',
        id: 't1',
        definitionId: null,
        name: null,
        kind: 'EXPENSE',
        date: '2026-10-12',
        amount: bob('250.00'),
        status: null,
      },
    ],
    ratesUsed: [],
    generatedAt: '2026-10-09T12:00:00Z',
    ...over,
  });
  const view = (c: CommittedAmount) =>
    renderToStaticMarkup(<CommittedView committed={c} f={f} href={(p) => `/es${p}`} />);

  it('[TC-COMMITMENTS-RECUR-036] muestra el total por moneda (ocurrencias + pendientes), el ingreso esperado y el desglose', () => {
    const html = view(committed());
    const text = textOf(html);
    expect(text).toContain('Comprometido del periodo');
    expect(text).toContain('octubre de 2026');
    expect(text).toContain('779,00 BOB');
    expect(text).toContain('529,00');
    expect(text).toContain('250,00');
    expect(text).toContain('Ingreso esperado (informativo, no se resta): 9.000,00 BOB');
    expect(html).toContain('data-complete="true"');
    expect(html).not.toContain('committed-incomplete');
    // Desglose explicable: ocurrencias (con su estado) y gasto pendiente, con enlaces a su detalle.
    expect(text).toContain('Ver el desglose (3)');
    expect(text).toContain('Pago programado (Próxima)');
    expect(text).toContain('Gasto pendiente');
    expect(html).toContain('href="/es/recurring/occurrences/o1"');
    expect(html).toContain('href="/es/transacciones/t1"');
    expect(committedItemPath({ source: 'PENDING', id: 'a b' })).toBe('/transacciones/a%20b');
  });

  it('[TC-COMMITMENTS-RECUR-037] sin tasa el total es incompleto, lista las partes sin convertir y cuenta los pagos sin monto', () => {
    const html = view(
      committed({
        consolidated: {
          amount: bob('779.00'),
          complete: false,
          unconverted: [{ amount: '20.00', currency: 'USD' }],
        },
        withoutAmountCount: 2,
        byCurrency: [
          { currency: 'BOB', occurrences: bob('529.00'), pending: bob('250.00'), total: bob('779.00') },
          {
            currency: 'USD',
            occurrences: { amount: '20.00', currency: 'USD' },
            pending: { amount: '0.00', currency: 'USD' },
            total: { amount: '20.00', currency: 'USD' },
          },
        ],
      }),
    );
    const text = textOf(html);
    expect(html).toContain('data-complete="false"');
    expect(html).toContain('data-testid="committed-incomplete"');
    expect(text).toContain('Total incompleto');
    expect(text).toContain('Falta una tasa de cambio vigente para convertir: 20,00 USD');
    expect(text).toContain('nunca se convierten 1:1');
    expect(text).toContain('2 pagos sin monto');
    expect(html).toContain('data-currency="USD"');
  });

  it('[TC-COMMITMENTS-RECUR-052] el consolidado en la moneda base lista las tasas usadas', () => {
    const html = view(
      committed({
        ratesUsed: [
          {
            rate: { base: 'USD', quote: 'BOB', value: '6.960000000000000000' },
            derivation: 'DIRECT',
            rateType: 'OFFICIAL',
            source: 'MANUAL',
            asOf: '2026-10-09T00:00:00Z',
            ageDays: 0,
            approx: false,
          } as never,
        ],
      }),
    );
    expect(textOf(html)).toContain('Tasas usadas: USD→BOB 6.96');
  });

  it('un solo pago sin monto usa el singular y sin gastos comprometidos lo dice', () => {
    expect(textOf(view(committed({ withoutAmountCount: 1 })))).toContain('1 pago sin monto');
    const empty = textOf(view(committed({ byCurrency: [], items: [], expectedIncome: [] })));
    expect(empty).toContain('No hay gastos comprometidos en este periodo.');
  });
});

describe('Lista de definiciones', () => {
  it('muestra estado con texto e icono, próxima fecha, monto o rango, frecuencia y por aprobar', () => {
    const html = renderToStaticMarkup(
      <DefinitionsList
        f={f}
        accountName={(id) => names[id]}
        href={(p) => `/es${p}`}
        definitions={[
          definition(),
          definition({
            id: 'd2',
            name: 'Gimnasio',
            status: 'PAUSED',
            nextOccurrence: null,
            pendingApprovalCount: 0,
            current: version({
              amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
              schedule: { ...version().schedule, cadence: 'QUARTERLY', interval: 2 },
            }),
          }),
        ]}
      />,
    );
    const text = textOf(html);
    expect(text).toContain('Alquiler');
    expect(text).toContain('Activa');
    expect(text).toContain('Pausada');
    expect(text).toContain('05/11/2026');
    expect(text).toContain('Sin pagos pendientes');
    expect(text).toContain('3.500,00 BOB');
    expect(text).toContain('100,00 – 180,00 BOB');
    expect(text).toContain('Trimestral (cada 2)');
    expect(html).toContain('href="/es/recurring/d2"');
    expect(html).toContain('data-status="PAUSED"');
    expect(
      textOf(
        renderToStaticMarkup(
          <DefinitionsList definitions={[]} f={f} accountName={() => undefined} href={(p) => p} />,
        ),
      ),
    ).toContain('Todavía no hay definiciones');
  });
});
