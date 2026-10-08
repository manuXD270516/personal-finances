import { cardStyle, mutedStyle, warningStyle } from '../common/ui';
import { formatMoney, formatInstant } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { trimRate } from '../common/money';
import type { Budget } from './budget-logic';

// Columna única que puede encogerse (`minmax(0, 1fr)`): una tabla ancha hace scroll en su contenedor, no en la página.
const stackStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 } as const;

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
  gap: 'var(--pf-space-3)',
  margin: 0,
} as const;

function Figure({
  label,
  value,
  testId,
  hint,
}: {
  label: string;
  value: string;
  testId: string;
  hint?: string;
}) {
  return (
    <div style={{ ...cardStyle, padding: 'var(--pf-space-3)' }}>
      <dt style={mutedStyle}>{label}</dt>
      <dd
        style={{ margin: 0, fontSize: 'var(--pf-text-xl)', fontVariantNumeric: 'tabular-nums' }}
        data-testid={testId}
      >
        {value}
      </dd>
      {hint ? <dd style={{ ...mutedStyle, margin: 0 }}>{hint}</dd> : null}
    </div>
  );
}

/**
 * Totales del plan (openspec add-budgets 6.1): planificado, gastado, restante, DISPONIBLE PARA GASTAR (sin doble
 * conteo; los tags no entran), ingresos esperados/reales y, en modo base cero, el monto por asignar. Informa cuando el
 * gastado es incompleto (montos sin tasa, nunca 1:1) y las tasas usadas, con su fuente y vigencia.
 */
export function BudgetTotalsView({ budget, f }: { budget: Budget; f: FormatContext }) {
  const t = budget.totals;
  const money = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, f.locale);
  const over = t.toAssign !== null && t.toAssign.amount.startsWith('-');
  return (
    <section aria-labelledby="budget-totals-title" style={{ ...stackStyle, gap: 'var(--pf-space-3)' }}>
      <h2 id="budget-totals-title">{f.t('totals.title')}</h2>
      <dl style={gridStyle}>
        <Figure label={f.t('totals.planned')} value={money(t.planned)} testId="total-planned" />
        <Figure label={f.t('totals.actual')} value={money(t.actual)} testId="total-actual" />
        <Figure label={f.t('totals.remaining')} value={money(t.remaining)} testId="total-remaining" />
        <Figure
          label={f.t('totals.available')}
          value={money(t.availableToSpend)}
          testId="total-available"
          hint={f.t('totals.availableHint')}
        />
        <Figure
          label={f.t('totals.expectedIncome')}
          value={money(t.expectedIncome)}
          testId="total-expected-income"
        />
        <Figure
          label={f.t('totals.actualIncome')}
          value={money(t.actualIncome)}
          testId="total-actual-income"
        />
        {t.toAssign ? (
          <Figure
            label={f.t(over ? 'totals.toAssignOver' : 'totals.toAssign')}
            value={money(t.toAssign)}
            testId="total-to-assign"
          />
        ) : null}
      </dl>
      {!t.complete ? (
        <div role="status" style={warningStyle} data-testid="budget-incomplete">
          <strong>{f.t('totals.incomplete')}</strong>
          {t.unconverted.length > 0 ? (
            <> {f.t('totals.unconverted', { amounts: t.unconverted.map((m) => money(m)).join(', ') })}</>
          ) : null}
        </div>
      ) : null}
      {budget.meta.ratesUsed.length > 0 ? (
        <div data-testid="budget-rates">
          <h3 style={{ fontSize: 'var(--pf-text-base)', margin: 0 }}>{f.t('totals.rates')}</h3>
          <ul style={{ ...mutedStyle, margin: 'var(--pf-space-1) 0 0', paddingLeft: 'var(--pf-space-4)' }}>
            {budget.meta.ratesUsed.map((r, i) => (
              <li key={`${r.rate.base}-${r.asOf}-${i}`}>
                {f.t('totals.rate', {
                  base: r.rate.base,
                  quote: r.rate.quote,
                  value: trimRate(r.rate.value),
                  type: r.rateType,
                  asOf: formatInstant(r.asOf, f.locale, f.timeZone),
                })}
              </li>
            ))}
          </ul>
          <p style={{ ...mutedStyle, margin: 'var(--pf-space-1) 0 0' }}>
            {f.t('totals.window', { days: budget.meta.rateWindowDays })}
            {budget.meta.attributions.map((a) => (
              <span key={a.provider}>
                {' '}
                <a href={a.url} rel="noreferrer noopener" target="_blank">
                  {a.text}
                </a>
              </span>
            ))}
          </p>
        </div>
      ) : null}
    </section>
  );
}
