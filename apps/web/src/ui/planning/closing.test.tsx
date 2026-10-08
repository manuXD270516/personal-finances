import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { ClosingBody } from './ClosingBody';
import { ClosingChecklistView } from './ClosingChecklistView';
import { ClosingPolicyForm } from './ClosingPolicyPanel';
import { CloseDiffView, CloseReportView } from './CloseReportView';
import {
  CLEAN_DUPLICATES,
  DIFF,
  IDS,
  PENDING_BLOCKING,
  POLICY,
  RECURRING_NA,
  SUMMARY_1,
  SUMMARY_2,
  UNCATEGORIZED_WARNING,
  UNRECONCILED_BLOCKING,
  WITHOUT_STATEMENT_INFO,
  checklist,
  report,
  snapshot,
} from './closing-fixtures';
import {
  closeBlock,
  closeBody,
  canReopen,
  defaultComparison,
  exportPath,
  policyChanged,
  problemItems,
  reopenReasonError,
  sortedItems,
  versionsNewestFirst,
  type CloseBlock,
  type CloseChecklist,
} from './closing-logic';
import { versionLabel } from './CloseReportPage';
import { PERIODS } from './fixtures';
import type { FinancialPeriod } from './logic';
import { PeriodsListView } from './PeriodsListView';

const f = esContext('Closing');
const pf = esContext('Planning');
const href = (path: string) => `/es${path}`;
const TODAY = '2026-11-03';

const OCTOBER: FinancialPeriod = {
  ...PERIODS[0]!,
  id: IDS.period,
  label: '2026-10',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  status: 'ACTIVE',
  pendingClosure: true,
  version: 4,
};
const CLOSED: FinancialPeriod = {
  ...OCTOBER,
  status: 'CLOSED',
  pendingClosure: false,
  closeCount: 1,
  latestCloseNo: 1,
};

interface BodyOver {
  period?: FinancialPeriod;
  checklist?: CloseChecklist | undefined;
  canEdit?: boolean;
  isOwner?: boolean;
  acknowledged?: boolean;
  reopening?: boolean;
  reason?: string;
  reasonError?: 'REQUIRED' | 'TOO_LONG';
  busy?: boolean;
}

/** Renderiza el cuerpo de la pantalla con el bloqueo que calcularía la página (misma función pura). */
function renderBody(over: BodyOver = {}): string {
  const period = over.period ?? OCTOBER;
  const cl = 'checklist' in over ? over.checklist : checklist([]);
  const canEdit = over.canEdit ?? true;
  const acknowledged = over.acknowledged ?? false;
  const block: CloseBlock | null = closeBlock({ canEdit, period, checklist: cl, today: TODAY, acknowledged });
  return renderToStaticMarkup(
    <ClosingBody
      f={f}
      pf={pf}
      href={href}
      period={period}
      today={TODAY}
      checklist={cl}
      block={block}
      busy={over.busy ?? false}
      canEdit={canEdit}
      isOwner={over.isOwner ?? false}
      acknowledged={acknowledged}
      note=""
      onAcknowledged={() => undefined}
      onNote={() => undefined}
      onClose={() => undefined}
      reopening={over.reopening ?? false}
      reason={over.reason ?? ''}
      reasonError={over.reasonError}
      onAskReopen={() => undefined}
      onReason={() => undefined}
      onCancelReopen={() => undefined}
      onReopen={() => undefined}
    />,
  );
}

/** Etiqueta de apertura del botón con ese `data-testid` (para comprobar `disabled`). */
const buttonTag = (html: string, testId: string): string =>
  new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
const isDisabled = (html: string, testId: string): boolean => /\sdisabled=""/.test(buttonTag(html, testId));

describe('Pantalla de cierre de mes: checklist (planning/month-closing 6.1)', () => {
  it('[TC-PLANNING-CLOSE-002] (UI) con ítems bloqueantes el botón "Cerrar mes" está deshabilitado y se listan primero con texto e icono', () => {
    const cl = checklist([UNCATEGORIZED_WARNING, PENDING_BLOCKING, UNRECONCILED_BLOCKING, CLEAN_DUPLICATES]);
    expect(cl.canClose).toBe(false);
    const html = renderBody({ checklist: cl });
    const text = textOf(html);
    expect(text).toContain('Transacciones pendientes');
    expect(text).toContain('Bloqueante');
    expect(text).toContain('Hay ítems bloqueantes');
    // Conteos y montos por moneda, sin convertir.
    expect(text).toContain('2 hallazgos');
    expect(text).toContain('150,00 BOB · 20,00 USD');
    expect(html).toMatch(/data-tone="BLOCKING"/);
    expect(html).toMatch(/<span aria-hidden="true">⛔<\/span> Bloqueante/);
    // Bloqueantes antes que advertencias.
    expect(text.indexOf('Cuentas sin conciliar')).toBeLessThan(text.indexOf('Transacciones sin categoría'));
    expect(sortedItems(cl.items).map((i) => i.kind)).toEqual([
      'PENDING_TRANSACTIONS',
      'UNRECONCILED_ACCOUNTS',
      'UNCATEGORIZED',
      'UNRESOLVED_DUPLICATES',
    ]);
    // Cerrar deshabilitado, sin casilla de reconocimiento y con el motivo visible.
    expect(isDisabled(html, 'close-month')).toBe(true);
    expect(html).not.toContain('acknowledge-warnings');
    expect(html).toMatch(/data-block="BLOCKING"/);
    expect(text).toContain('Resuelve los ítems bloqueantes');
  });

  it('[TC-PLANNING-CHECKLIST-001] (UI) el detalle enlaza transacciones y cuentas, e indica cuando está truncado', () => {
    const cl = checklist([PENDING_BLOCKING, UNRECONCILED_BLOCKING, UNCATEGORIZED_WARNING]);
    const html = renderToStaticMarkup(<ClosingChecklistView items={cl.items} f={f} href={href} />);
    expect(html).toContain(`href="/es/transacciones/${IDS.tx1}"`);
    expect(html).toContain(`href="/es/cuentas/${IDS.caja}"`);
    expect(textOf(html)).toContain('Almuerzo pendiente');
    expect(textOf(html)).toContain('90,00 BOB');
    expect(textOf(html)).toContain('28/10/2026');
    expect(textOf(html)).toContain('Se muestran 1 de 3 hallazgos.');
    expect(html).toContain('data-testid="checklist-truncated"');
    // Cada ítem ofrece el listado completo.
    expect(html).toContain('href="/es/cuentas"');
    expect(html).toContain('aria-label="Detalle: Transacciones pendientes"');
  });

  it('[TC-PLANNING-CLOSE-003] (UI) con solo advertencias exige marcar el reconocimiento explícito para habilitar "Cerrar mes"', () => {
    const cl = checklist([UNCATEGORIZED_WARNING, CLEAN_DUPLICATES, WITHOUT_STATEMENT_INFO]);
    expect(cl).toMatchObject({ canClose: true, requiresAcknowledgement: true });
    const pending = renderBody({ checklist: cl });
    expect(pending).toContain('data-testid="acknowledge-warnings"');
    expect(pending).not.toMatch(/data-testid="acknowledge-warnings"[^>]*checked/);
    expect(isDisabled(pending, 'close-month')).toBe(true);
    expect(pending).toMatch(/data-block="ACK_REQUIRED"/);
    expect(textOf(pending)).toContain('Solo hay advertencias');
    expect(textOf(pending)).toContain('Reconozco las advertencias');
    const acknowledged = renderBody({ checklist: cl, acknowledged: true });
    expect(isDisabled(acknowledged, 'close-month')).toBe(false);
    expect(acknowledged).not.toContain('close-block-reason');
    expect(closeBody(true, '  Cierre con nota  ')).toEqual({
      acknowledgeWarnings: true,
      note: 'Cierre con nota',
    });
    expect(closeBody(true, '   ')).toEqual({ acknowledgeWarnings: true });
  });

  it('[TC-PLANNING-CLOSE-006] (UI) la conciliada sin extracto es informativa: no bloquea, no pide reconocimiento y queda pendiente de revisión', () => {
    const cl = checklist([WITHOUT_STATEMENT_INFO, CLEAN_DUPLICATES]);
    expect(cl).toMatchObject({ canClose: true, requiresAcknowledgement: false });
    const html = renderBody({ checklist: cl });
    const text = textOf(html);
    expect(html).toMatch(/data-kind="RECONCILED_WITHOUT_STATEMENT"[^>]*data-tone="INFO"/);
    expect(text).toContain('Conciliada sin extracto — pendiente de revisión');
    expect(text).toContain('Informativo');
    expect(text).toContain('pendientes de revisión');
    expect(text).toContain('80,00 BOB');
    expect(html).toContain('href="/es/transacciones?sinExtracto=1"');
    expect(html).not.toContain('acknowledge-warnings');
    expect(isDisabled(html, 'close-month')).toBe(false);
    expect(text).toContain('Sin ítems pendientes');
  });

  it('un ítem NO DISPONIBLE (recurrentes hasta Phase 3) se muestra como tal y no bloquea ni advierte', () => {
    const cl = checklist([RECURRING_NA, CLEAN_DUPLICATES]);
    expect(cl).toMatchObject({ canClose: true, requiresAcknowledgement: false });
    const html = renderToStaticMarkup(<ClosingChecklistView items={cl.items} f={f} href={href} />);
    expect(html).toMatch(/data-kind="UNRESOLVED_RECURRING"[^>]*data-tone="NOT_AVAILABLE"/);
    expect(textOf(html)).toContain('No disponible');
    expect(html).toContain('data-testid="checklist-not-available"');
    // El ítem sin observaciones lo dice con texto.
    expect(textOf(html)).toContain('Sin observaciones.');
  });

  it('[TC-PLANNING-CLOSE-005] (UI) un periodo que aún no terminó, o no activo, no se puede cerrar y lo explica', () => {
    const early = { ...OCTOBER, periodEnd: '2026-11-30' };
    const html = renderBody({ period: early, checklist: checklist([]) });
    expect(isDisabled(html, 'close-month')).toBe(true);
    expect(html).toMatch(/data-block="NOT_ENDED"/);
    expect(textOf(html)).toContain('El periodo termina el 30/11/2026');
    const draft = renderBody({
      period: { ...OCTOBER, status: 'DRAFT', pendingClosure: false },
      checklist: undefined,
    });
    expect(draft).toContain('close-not-closable');
    expect(draft).not.toContain('close-month');
  });

  it('[TC-PLANNING-CLOSE-002] los ítems del 409 (blockingItems / warningItems) se extraen del problema', () => {
    const items = problemItems({
      code: 'MONTH_CLOSING_BLOCKED',
      blockingItems: [PENDING_BLOCKING],
      warningItems: [UNCATEGORIZED_WARNING],
    });
    expect(items.blocking.map((i) => i.kind)).toEqual(['PENDING_TRANSACTIONS']);
    expect(items.warning.map((i) => i.kind)).toEqual(['UNCATEGORIZED']);
    expect(problemItems({ code: 'PERIOD_NOT_ENDED' })).toEqual({ blocking: [], warning: [] });
    expect(problemItems({ blockingItems: 'x' })).toEqual({ blocking: [], warning: [] });
  });
});

describe('Pantalla de cierre de mes: roles y reapertura (planning/month-closing 6.1–6.2)', () => {
  it('[TC-PLANNING-ROLE-001] (UI) un VIEWER ve el checklist pero "Cerrar mes" y el reconocimiento están deshabilitados, sin "Reabrir"', () => {
    const cl = checklist([UNCATEGORIZED_WARNING]);
    const html = renderBody({ checklist: cl, canEdit: false });
    expect(textOf(html)).toContain('Transacciones sin categoría');
    expect(isDisabled(html, 'close-month')).toBe(true);
    expect(html).toMatch(/data-block="ROLE"/);
    expect(textOf(html)).toContain('Tu rol (solo lectura) no permite cerrar el mes.');
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*data-testid="acknowledge-warnings"/);
    expect(html).toMatch(/<textarea[^>]*disabled=""[^>]*data-testid="close-note"/);
    const closed = renderBody({ period: CLOSED, checklist: undefined, canEdit: false });
    expect(closed).toContain('close-closed');
    expect(closed).not.toContain('data-testid="reopen"');
  });

  it('[TC-PLANNING-REOPEN-002] (UI) "Reabrir" solo lo ve el OWNER en un periodo cerrado; un EDITOR no', () => {
    const owner = renderBody({ period: CLOSED, checklist: undefined, isOwner: true });
    expect(owner).toContain('data-testid="reopen"');
    expect(textOf(owner)).toContain('Reabrir periodo');
    expect(textOf(owner)).toContain('versión 1 del cierre');
    expect(owner).toContain(`href="/es/planificacion/periodos/${IDS.period}/reporte"`);
    const editor = renderBody({ period: CLOSED, checklist: undefined, isOwner: false });
    expect(editor).not.toContain('data-testid="reopen"');
    expect(canReopen(true, CLOSED)).toBe(true);
    expect(canReopen(false, CLOSED)).toBe(false);
    expect(canReopen(true, OCTOBER)).toBe(false);
  });

  it('[TC-PLANNING-REOPEN-002] (UI) la confirmación de reapertura pide el motivo y rechaza uno vacío', () => {
    expect(reopenReasonError('')).toBe('REQUIRED');
    expect(reopenReasonError('   \n ')).toBe('REQUIRED');
    expect(reopenReasonError('Falta la comisión bancaria')).toBeNull();
    expect(reopenReasonError('x'.repeat(500))).toBeNull();
    expect(reopenReasonError('x'.repeat(501))).toBe('TOO_LONG');
    const dialog = renderBody({
      period: CLOSED,
      checklist: undefined,
      isOwner: true,
      reopening: true,
      reasonError: 'REQUIRED',
    });
    expect(dialog).toContain('role="alertdialog"');
    expect(textOf(dialog)).toContain('¿Reabrir el periodo octubre de 2026?');
    expect(dialog).toContain('data-testid="reopen-reason"');
    expect(dialog).toContain('aria-invalid="true"');
    expect(textOf(dialog)).toContain('Indica el motivo de la reapertura.');
    expect(textOf(dialog)).toContain('Obligatorio, hasta 500 caracteres');
  });
});

describe('Reporte de cierre (planning/month-closing 6.2)', () => {
  it('[TC-PLANNING-REPORT-002] (UI) muestra los KPIs, la variación absoluta y % frente al periodo anterior y la tasa de ahorro en puntos', () => {
    const html = renderToStaticMarkup(<CloseReportView report={report()} f={f} href={href} />);
    const text = textOf(html);
    expect(html).toMatch(/data-testid="kpi-income-value">6\.500,00 BOB</);
    expect(html).toMatch(/data-testid="kpi-expense-value">1\.620,00 BOB</);
    expect(html).toMatch(/data-testid="kpi-savings-value">4\.880,00 BOB</);
    expect(html).toMatch(/data-testid="kpi-savings-rate-value">75,1 %</);
    expect(html).toMatch(/data-testid="kpi-net-worth-value">5\.300,00 BOB</);
    expect(textOf(/data-testid="kpi-income-delta".*?<\/dd>/.exec(html)?.[0] ?? '')).toContain(
      '+500,00 BOB (+8,3 %)',
    );
    expect(textOf(/data-testid="kpi-expense-delta".*?<\/dd>/.exec(html)?.[0] ?? '')).toContain(
      '-120,00 BOB (-6,9 %)',
    );
    expect(textOf(/data-testid="kpi-savings-rate-delta".*?<\/dd>/.exec(html)?.[0] ?? '')).toContain(
      '+4,2 pp',
    );
    // Valor anterior 0: variación absoluta sin porcentaje.
    expect(textOf(/data-testid="kpi-net-worth-delta".*?<\/dd>/.exec(html)?.[0] ?? '')).toContain(
      'sin % (el valor anterior era 0)',
    );
    expect(text).toContain('Variación frente a 2026-09 (versión 1 del cierre).');
    expect(text).toContain('Versión 2 (vigente)');
    expect(html).not.toContain('report-incomplete');
    // Saldos con su base de conciliación.
    expect(html).toMatch(/data-basis="STATEMENT"/);
    expect(html).toMatch(/data-basis="WITHOUT_STATEMENT"/);
    expect(html).toMatch(/data-basis="NONE"/);
    expect(text).toContain('Conciliada con extracto');
    expect(text).toContain('Conciliada sin extracto');
    expect(text).toContain('Sin conciliar');
    expect(text).toContain('Extracto del 31/10/2026: 4.880,00 BOB');
    expect(html).toContain('href="/es/transacciones?sinExtracto=1"');
    expect(html).toContain(`href="/es/cuentas/${IDS.caja}"`);
    // Sin plan mensual: presupuesto no disponible, sin montos inventados.
    expect(html).toContain('report-budget-unavailable');
    expect(text).toContain('No disponible: el periodo no tenía un plan mensual.');
    expect(text).toContain('Se cerró reconociendo: Transacciones sin categoría.');
  });

  it('[TC-PLANNING-SNAPSHOT-001] (UI) el patrimonio incompleto se marca y lista los montos sin convertir (nunca 1:1)', () => {
    const incomplete = report({
      snapshot: snapshot({
        netWorth: {
          amount: bob('5300.00'),
          assets: bob('5300.00'),
          liabilities: bob('0.00'),
          complete: false,
          unconverted: [{ amount: '100.00', currency: 'USD' }],
          rates: [],
        },
      }),
    });
    const html = renderToStaticMarkup(<CloseReportView report={incomplete} f={f} href={href} />);
    expect(html).toContain('data-testid="report-incomplete"');
    expect(textOf(html)).toContain('Cifras incompletas');
    expect(textOf(html)).toContain('Montos sin convertir: 100,00 USD.');
    // Solo la tarjeta de patrimonio neto se marca "incompleto".
    expect(/data-testid="kpi-net-worth".*?kpi-incomplete/.test(html)).toBe(true);
    expect(/data-testid="kpi-income".*?<\/div>/.exec(html)?.[0]).not.toContain('kpi-incomplete');
  });

  it('[TC-PLANNING-REPORT-002] (UI) sin periodo anterior muestra el motivo en lugar de la variación', () => {
    const first = report({ comparison: null, comparisonUnavailableReason: 'NO_PREVIOUS_PERIOD' });
    const html = renderToStaticMarkup(<CloseReportView report={first} f={f} href={href} />);
    expect(html).toContain('report-comparison-unavailable');
    expect(textOf(html)).toContain('este es el primer periodo');
    expect(html).not.toContain('kpi-income-delta');
    const noSnapshot = report({ comparison: null, comparisonUnavailableReason: 'NO_PREVIOUS_SNAPSHOT' });
    expect(textOf(renderToStaticMarkup(<CloseReportView report={noSnapshot} f={f} href={href} />))).toContain(
      'el periodo anterior no tiene un cierre',
    );
  });

  it('[TC-PLANNING-REPORT-001] (UI) el presupuesto vs real se muestra cuando el periodo tenía plan', () => {
    const withBudget = report({
      snapshot: snapshot({
        budgetVsActual: {
          budgetId: IDS.snap1,
          currency: 'BOB',
          lines: [
            {
              target: { kind: 'CATEGORY', id: IDS.tx1 },
              targetName: 'Restaurantes',
              nature: 'EXPENSE',
              reference: bob('600.00'),
              actual: bob('650.00'),
              status: 'OVER',
            },
          ],
          totals: { planned: bob('600.00'), actual: bob('650.00'), complete: true },
        },
      }),
    });
    const html = renderToStaticMarkup(<CloseReportView report={withBudget} f={f} href={href} />);
    expect(textOf(html)).toContain('Restaurantes');
    expect(textOf(html)).toContain('650,00 BOB');
    expect(textOf(html)).toContain('Excedido');
    expect(html).not.toContain('report-budget-unavailable');
  });

  it('[TC-PLANNING-RECLOSE-002] (UI) la comparación entre versiones muestra la diferencia exacta con signo; por defecto, anterior → vigente', () => {
    const html = renderToStaticMarkup(
      <CloseDiffView diff={DIFF} accountName={(id) => (id === IDS.caja ? 'Caja BOB' : id)} f={f} />,
    );
    const text = textOf(html);
    expect(html).toContain('data-from="1"');
    expect(html).toContain('data-to="2"');
    expect(text).toContain('Diferencia de la versión 2 menos la versión 1.');
    expect(text).toContain('Caja BOB');
    expect(text).toContain('-15,00 BOB');
    expect(html).toMatch(/data-testid="diff-expense">\+15,00 BOB</);
    expect(html).toMatch(/data-testid="diff-net-worth">-15,00 BOB</);
    expect(html).toMatch(/data-testid="diff-income">0,00 BOB</);
    expect(defaultComparison([SUMMARY_1, SUMMARY_2])).toEqual({ from: 1, to: 2 });
    expect(defaultComparison([SUMMARY_2])).toBeNull();
    expect(versionsNewestFirst([SUMMARY_1, SUMMARY_2]).map((v) => v.closeNo)).toEqual([2, 1]);
  });

  it('[TC-PLANNING-REPORT-003] (UI) la exportación usa la versión elegida y el selector marca la vigente', () => {
    expect(exportPath('/workspaces/w1', IDS.period, 'csv', 1)).toBe(
      `/workspaces/w1/periods/${IDS.period}/close-report/export?format=csv&closeNo=1`,
    );
    expect(exportPath('/workspaces/w1', IDS.period, 'pdf')).toBe(
      `/workspaces/w1/periods/${IDS.period}/close-report/export?format=pdf`,
    );
    expect(versionLabel(SUMMARY_2, f)).toContain('Versión 2 (vigente)');
    expect(versionLabel(SUMMARY_1, f)).not.toContain('vigente');
  });
});

describe('Política de cierre y enlaces desde los periodos (planning/month-closing 6.1–6.2)', () => {
  it('[TC-PLANNING-CHECKLIST-002] (UI) el OWNER edita las severidades; los demás roles la ven en solo lectura', () => {
    const owner = renderToStaticMarkup(<ClosingPolicyForm policy={POLICY} f={f} canEdit />);
    expect(owner.match(/type="radio"/g)).toHaveLength(10);
    expect(owner).toMatch(/data-testid="policy-PENDING_TRANSACTIONS-BLOCKING"[^>]*checked/);
    expect(owner).toMatch(/data-testid="policy-UNCATEGORIZED-WARNING"[^>]*checked/);
    // Sin cambios no hay nada que guardar; el ítem informativo no es configurable.
    expect(isDisabled(owner, 'policy-save')).toBe(true);
    expect(owner).not.toContain('RECONCILED_WITHOUT_STATEMENT"');
    expect(textOf(owner)).toContain('solo informativo');
    const viewer = renderToStaticMarkup(<ClosingPolicyForm policy={POLICY} f={f} canEdit={false} />);
    expect(viewer).not.toContain('type="radio"');
    expect(viewer).not.toContain('policy-save');
    expect(textOf(viewer)).toContain('Solo el propietario puede cambiar la política de cierre.');
    expect(viewer.match(/data-testid="policy-value"/g)).toHaveLength(5);
    expect(policyChanged(POLICY.severities, { ...POLICY.severities, UNCATEGORIZED: 'BLOCKING' })).toBe(true);
    expect(policyChanged(POLICY.severities, POLICY.severities)).toBe(false);
  });

  it('[TC-PLANNING-CLOSE-005] (UI) la lista de periodos ofrece "Cerrar mes" en los terminados sin cerrar y "Ver reporte" en los cerrados', () => {
    const periods: FinancialPeriod[] = [
      ...PERIODS.filter((p) => p.label !== '2026-10'),
      { ...OCTOBER, pendingClosure: true },
      {
        ...OCTOBER,
        id: IDS.previousPeriod,
        label: '2026-09',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        status: 'CLOSED',
        pendingClosure: false,
      },
    ];
    const html = renderToStaticMarkup(
      <PeriodsListView periods={periods} today={TODAY} canEdit={false} f={pf} href={href} />,
    );
    expect(html).toContain(`href="/es/planificacion/periodos/${IDS.period}/cierre"`);
    expect(html).toContain('aria-label="Cerrar el mes octubre de 2026"');
    expect(html).toContain(`href="/es/planificacion/periodos/${IDS.previousPeriod}/reporte"`);
    expect(html).toContain('aria-label="Ver el reporte de cierre de septiembre de 2026"');
    // Son enlaces visibles para todos los roles (la pantalla deshabilita las acciones del VIEWER).
    expect(html).not.toContain('<button');
  });
});

function bob(amount: string) {
  return { amount, currency: 'BOB' };
}
