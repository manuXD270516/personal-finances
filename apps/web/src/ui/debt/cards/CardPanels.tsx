'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { uuidv7, type ApiProblemBody } from '../../../bff/finance-api-client';
import { ProblemMessage } from '../../../errors/ProblemMessage';
import { isZeroAmount } from '../../common/money';
import type { Account, Page, Transaction } from '../../common/types';
import {
  ConfirmPanel,
  Field,
  cellStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../../common/workspace';
import { formatMoney, formatSignedMoney } from '../../dashboard/format';
import type { FormatContext } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import {
  buildInstallmentInput,
  buildPlanInput,
  buildReportedPatch,
  canReportBank,
  cardPath,
  changedFigures,
  conflictsOf,
  EMPTY_INSTALLMENT_FORM,
  FIGURE_KEYS,
  planFormOf,
  type FigureKey,
  type InstallmentForm,
  type PlanForm,
} from './logic';
import { StatementStatusBadge } from './parts';
import {
  CARD_MATERIALIZATION_MODES,
  PAYMENT_POLICIES,
  type CardAccount,
  type CardFutureCharge,
  type CardInstallmentPlan,
  type CardStatement,
  type CreditCard,
} from './types';

interface PanelProps {
  readonly ctx: WorkspaceContext;
  readonly card: CreditCard;
  /** Recarga la tarjeta (nueva `version`) tras un cambio; el mensaje se muestra en la cabecera. */
  readonly onChanged: (message: string) => void;
}

const sectionGap = { display: 'grid', gap: 'var(--pf-space-3)' } as const;

// ───────────────────────────── Estados de cuenta ─────────────────────────────

/** Filas de cifras que se muestran siempre; el crédito a favor solo si no es cero. */
const ALWAYS: readonly FigureKey[] = [
  'previousBalance',
  'purchases',
  'refunds',
  'payments',
  'otherNet',
  'closingBalance',
  'unbilledInstallments',
  'billedBalance',
  'noInterestPayment',
  'minimumDue',
];

/**
 * Cifras de un ciclo: lo emitido (congelado), lo recalculado hoy y la diferencia con signo cuando hubo cambios
 * retroactivos; un ciclo que nunca se emitió muestra solo lo calculado. La diferencia se dice con texto y signo.
 */
export function FiguresTable({ statement, f }: { statement: CardStatement; f: FormatContext }) {
  const { issued, current, difference } = statement;
  const changed = new Set(changedFigures(statement));
  const rows = FIGURE_KEYS.filter((k) => ALWAYS.includes(k) || !isZeroAmount(current[k].amount));
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('statements.figuresRegion')}>
      <table style={tableStyle} data-testid="statement-figures">
        <caption className="pf-sr-only">
          {f.t('statements.figuresCaption', {
            currency: statement.currency,
            closing: formatBusinessDate(statement.closingDate),
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('statements.figure')}
            </th>
            {issued ? (
              <>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('statements.issued')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('statements.recalculated')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('statements.difference')}
                </th>
              </>
            ) : (
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('statements.calculated')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k} data-figure={k} data-changed={changed.has(k) ? 'true' : 'false'}>
              <th scope="row" style={cellStyle}>
                {f.t(`statements.figures.${k}`)}
              </th>
              {issued ? (
                <>
                  <td style={numCellStyle}>{formatMoney(issued[k], f.locale)}</td>
                  <td style={numCellStyle}>{formatMoney(current[k], f.locale)}</td>
                  <td style={numCellStyle} data-testid={`difference-${k}`}>
                    {difference && changed.has(k) ? (
                      <>
                        <span aria-hidden="true">⚠ </span>
                        {formatSignedMoney(difference[k], f.locale)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </>
              ) : (
                <td style={numCellStyle}>{formatMoney(current[k], f.locale)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Formulario de lo informado por el banco (Could): reemplaza el cálculo para pagar y deja ver la diferencia. */
function ReportedForm({
  ctx,
  f,
  card,
  statement,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  card: CreditCard;
  statement: CardStatement;
  onChanged: () => void;
}) {
  const [billed, setBilled] = useState(statement.reported?.billedBalance?.amount ?? '');
  const [minimum, setMinimum] = useState(statement.reported?.minimumDue?.amount ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());

  async function save() {
    setProblem(undefined);
    const built = buildReportedPatch(
      { billed, minimum },
      statement.currency,
      { locale: ctx.formatLocale, scales: ctx.scales },
      {
        billed: statement.reported?.billedBalance?.amount ?? null,
        minimum: statement.reported?.minimumDue?.amount ?? null,
      },
    );
    if (!built.ok) {
      setErrors(Object.fromEntries(Object.entries(built.errors).map(([k, v]) => [k, f.t(`errors.${v}`)])));
      return;
    }
    setErrors({});
    if (Object.keys(built.patch).length === 0) return;
    setBusy(true);
    try {
      await ctx.api.command(
        'PATCH',
        `${cardPath(ctx.base, card.id)}/statements/${statement.id}`,
        built.patch,
        { ifMatch: statement.version ?? 0, idempotencyKey: key.current },
      );
      key.current = uuidv7();
      onChanged();
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      style={{ ...formStyle, margin: 0 }}
      noValidate
      data-testid="reported-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <strong>{f.t('statements.reported.title')}</strong>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('statements.reported.hint')}</p>
      <div style={rowStyle}>
        <Field
          label={f.t('statements.reported.billed', { currency: statement.currency })}
          error={errors['billed']}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={billed}
              data-testid="reported-billed"
              onChange={(e) => setBilled(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={f.t('statements.reported.minimum', { currency: statement.currency })}
          error={errors['minimum']}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={minimum}
              data-testid="reported-minimum"
              onChange={(e) => setMinimum(e.target.value)}
            />
          )}
        </Field>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div>
        <button type="submit" disabled={busy} data-testid="reported-save">
          {f.t('statements.reported.save')}
        </button>
      </div>
    </form>
  );
}

/**
 * Un estado de cuenta: fechas, estado, lo que falta para no generar intereses y para el mínimo, las cifras emitidas
 * frente a las recalculadas y lo informado por el banco. Los cambios retroactivos se avisan sin tocar lo emitido.
 */
export function StatementItem({
  statement,
  f,
  open,
  highlight,
  form,
}: {
  statement: CardStatement;
  f: FormatContext;
  open: boolean;
  highlight: boolean;
  /** Formulario de montos del banco (solo EDITOR/OWNER y estado emitido). */
  form?: ReactNode;
}) {
  const changed = changedFigures(statement);
  const reported = statement.reported;
  return (
    <details
      open={open}
      style={{
        border: highlight ? '2px solid var(--pf-primary)' : '1px solid var(--pf-border)',
        borderRadius: 'var(--pf-radius-md)',
        padding: 'var(--pf-space-3)',
        background: 'var(--pf-surface-raised)',
      }}
      data-testid="statement"
      data-statement-id={statement.id ?? ''}
      data-status={statement.status}
      data-highlight={highlight ? 'true' : 'false'}
    >
      <summary
        style={{
          cursor: 'pointer',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--pf-space-2)',
          alignItems: 'center',
        }}
      >
        <strong>
          {f.t('statements.cycle', {
            closing: formatBusinessDate(statement.closingDate),
            due: formatBusinessDate(statement.dueDate),
          })}
        </strong>
        <StatementStatusBadge status={statement.status} f={f} />
      </summary>
      <div style={{ ...sectionGap, marginTop: 'var(--pf-space-3)' }}>
        <dl
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-1) var(--pf-space-4)', margin: 0 }}
        >
          <div>
            <dt style={mutedStyle}>{f.t('statements.noInterest')}</dt>
            <dd style={{ margin: 0 }} data-testid="statement-no-interest">
              {formatMoney(statement.noInterestPayment, f.locale)}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('statements.remainingNoInterest')}</dt>
            <dd style={{ margin: 0 }} data-testid="statement-remaining-no-interest">
              {formatMoney(statement.remainingNoInterest, f.locale)}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('statements.minimum')}</dt>
            <dd style={{ margin: 0 }} data-testid="statement-minimum">
              {formatMoney(statement.minimumDue, f.locale)}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('statements.remainingMinimum')}</dt>
            <dd style={{ margin: 0 }} data-testid="statement-remaining-minimum">
              {formatMoney(statement.remainingMinimum, f.locale)}
            </dd>
          </div>
        </dl>
        {statement.issuedAt === null && statement.status !== 'OPEN' ? (
          <p style={mutedStyle}>{f.t('statements.notIssued')}</p>
        ) : null}
        {changed.length > 0 ? (
          <p role="note" style={warningStyle} data-testid="statement-recalculated">
            <span aria-hidden="true">⚠</span> {f.t('statements.changed', { count: changed.length })}
          </p>
        ) : null}
        {!statement.consistent ? (
          <p role="note" style={warningStyle} data-testid="statement-inconsistent">
            <span aria-hidden="true">ℹ</span> {f.t('statements.inconsistent')}
          </p>
        ) : null}
        <FiguresTable statement={statement} f={f} />
        {reported && (reported.billedBalance || reported.minimumDue) ? (
          <dl
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--pf-space-1) var(--pf-space-4)',
              margin: 0,
            }}
            data-testid="statement-reported"
          >
            {reported.billedBalance ? (
              <div>
                <dt style={mutedStyle}>{f.t('statements.reported.billedShort')}</dt>
                <dd style={{ margin: 0 }}>{formatMoney(reported.billedBalance, f.locale)}</dd>
              </div>
            ) : null}
            {reported.minimumDue ? (
              <div>
                <dt style={mutedStyle}>{f.t('statements.reported.minimumShort')}</dt>
                <dd style={{ margin: 0 }}>{formatMoney(reported.minimumDue, f.locale)}</dd>
              </div>
            ) : null}
            {statement.reportedDifference ? (
              <div>
                <dt style={mutedStyle}>{f.t('statements.reported.difference')}</dt>
                <dd style={{ margin: 0 }} data-testid="statement-reported-difference">
                  {isZeroAmount(statement.reportedDifference.amount)
                    ? f.t('statements.reported.noDifference')
                    : formatSignedMoney(statement.reportedDifference, f.locale)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {form}
      </div>
    </details>
  );
}

/** Pestaña Estados de cuenta: por cuenta, el ciclo abierto y los últimos cierres; el `?statementId=` abre ese estado. */
export function StatementsPanel({
  ctx,
  card,
  reloadKey,
  highlightId,
  onChanged,
}: {
  ctx: WorkspaceContext;
  card: CreditCard;
  reloadKey: number;
  highlightId: string | undefined;
  onChanged: (message: string) => void;
}) {
  const f = useFormat('Cards', ctx);
  const [statements, setStatements] = useState<readonly CardStatement[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<{ data: CardStatement[] }>(`${cardPath(ctx.base, card.id)}/statements`)
      .then((r) => {
        if (!cancelled) {
          setProblem(undefined);
          setStatements(r.data?.data ?? []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatements([]);
          setProblem(problemOf(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, card.id, reloadKey, tick]);

  if (statements === undefined) return <p aria-busy="true">{f.t('loading')}</p>;
  return (
    <div style={sectionGap} data-testid="statements-panel">
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {card.accounts.map((account) => {
        const list = statements.filter((s) => s.accountId === account.accountId);
        return (
          <section
            key={account.id}
            aria-labelledby={`statements-${account.id}`}
            style={sectionGap}
            data-currency={account.currency}
          >
            <h2 id={`statements-${account.id}`} style={{ margin: 0 }}>
              {f.t('statements.accountTitle', { currency: account.currency })}
            </h2>
            {list.length === 0 ? (
              <p style={mutedStyle} data-testid="statements-empty">
                {f.t('statements.empty')}
              </p>
            ) : (
              list.map((s, i) => (
                <StatementItem
                  key={`${s.id ?? 'open'}-${s.closingDate}`}
                  statement={s}
                  f={f}
                  open={highlightId ? s.id === highlightId : i === 0}
                  highlight={highlightId !== undefined && s.id === highlightId}
                  form={
                    ctx.canEdit && canReportBank(s) && card.status === 'ACTIVE' ? (
                      <ReportedForm
                        ctx={ctx}
                        f={f}
                        card={card}
                        statement={s}
                        onChanged={() => {
                          setTick((n) => n + 1);
                          onChanged(f.t('statements.reported.saved'));
                        }}
                      />
                    ) : undefined
                  }
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Plan de pago ─────────────────────────────

/** Aviso del 409 `CARD_PAYMENT_PLAN_CONFLICT`: la transferencia recurrente del usuario que hay que terminar primero. */
export function PlanConflict({
  problem,
  f,
  href,
}: {
  problem: ApiProblemBody;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const conflicts = conflictsOf(problem['details']);
  return (
    <div
      role="alert"
      style={warningStyle}
      data-testid="plan-conflict"
      data-error-code="CARD_PAYMENT_PLAN_CONFLICT"
    >
      <p style={{ margin: 0 }}>{f.t('plan.conflictIntro')}</p>
      {conflicts.length > 0 ? (
        <ul style={{ margin: 'var(--pf-space-1) 0' }}>
          {conflicts.map((c) => (
            <li key={c.definitionId}>
              <a href={href(`/recurring/${c.definitionId}`)} data-testid="plan-conflict-link">
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <p style={{ margin: 0 }}>{f.t('plan.conflictAction')}</p>
    </div>
  );
}

function PlanEditor({
  ctx,
  f,
  card,
  account,
  sources,
  onDone,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  card: CreditCard;
  account: CardAccount;
  sources: readonly Account[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PlanForm>(() => planFormOf(account));
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  const set = (patch: Partial<PlanForm>) => setForm((p) => ({ ...p, ...patch }));

  async function save() {
    setProblem(undefined);
    if (form.sourceAccountId === '') {
      setError(f.t('errors.REQUIRED'));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await ctx.api.command(
        'PUT',
        `${cardPath(ctx.base, card.id)}/accounts/${account.accountId}/payment-plan`,
        buildPlanInput(form),
        { ifMatch: card.version, idempotencyKey: key.current },
      );
      onDone(f.t(account.paymentPlan ? 'plan.updated' : 'plan.enabled'));
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
    }
  }

  return (
    <form
      style={{ ...formStyle, margin: 0 }}
      noValidate
      data-testid="plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div style={rowStyle}>
        <Field
          label={f.t('plan.source')}
          error={error}
          hint={f.t('plan.sourceHint', { currency: account.currency })}
        >
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.sourceAccountId}
              data-testid="plan-source"
              onChange={(e) => set({ sourceAccountId: e.target.value })}
            >
              <option value="">{f.t('form.chooseAccount')}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.currency})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('plan.policy')} hint={f.t(`plan.policyHint.${form.policy}`)}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.policy}
              data-testid="plan-policy"
              onChange={(e) => set({ policy: e.target.value as PlanForm['policy'] })}
            >
              {PAYMENT_POLICIES.map((pol) => (
                <option key={pol} value={pol}>
                  {f.t(`plan.policies.${pol}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('plan.mode')} hint={f.t(`plan.modeHint.${form.mode}`)}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.mode}
              data-testid="plan-mode"
              onChange={(e) => set({ mode: e.target.value as PlanForm['mode'] })}
            >
              {CARD_MATERIALIZATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {f.t(`plan.modes.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {problem?.code === 'CARD_PAYMENT_PLAN_CONFLICT' ? (
        <PlanConflict problem={problem} f={f} href={ctx.href} />
      ) : problem ? (
        <ProblemMessage problem={problem} locale={ctx.uiLocale} />
      ) : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="plan-save">
          {account.paymentPlan ? f.t('plan.update') : f.t('plan.enable')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}

function PlanSection({
  ctx,
  f,
  card,
  account,
  sources,
  nameOf,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  card: CreditCard;
  account: CardAccount;
  sources: readonly Account[];
  nameOf: (id: string) => string | undefined;
  onChanged: (message: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'disable'>('view');
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const plan = account.paymentPlan;
  const editable = ctx.canEdit && card.status === 'ACTIVE';

  async function disable() {
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command(
        'DELETE',
        `${cardPath(ctx.base, card.id)}/accounts/${account.accountId}/payment-plan`,
        undefined,
        { ifMatch: card.version },
      );
      setMode('view');
      setBusy(false);
      onChanged(f.t('plan.disabled'));
    } catch (err) {
      setProblem(problemOf(err));
      setBusy(false);
      setMode('view');
    }
  }

  return (
    <section
      aria-labelledby={`plan-${account.id}`}
      style={{ ...formStyle, margin: 0 }}
      data-testid="plan-section"
      data-currency={account.currency}
      data-enabled={plan ? 'true' : 'false'}
    >
      <h2 id={`plan-${account.id}`} style={{ margin: 0 }}>
        {f.t('plan.title', { currency: account.currency })}
      </h2>
      {plan ? (
        <dl
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-1) var(--pf-space-4)', margin: 0 }}
        >
          <div>
            <dt style={mutedStyle}>{f.t('plan.source')}</dt>
            <dd style={{ margin: 0 }} data-testid="plan-source-name">
              {nameOf(plan.sourceAccountId) ?? '—'}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('plan.policy')}</dt>
            <dd style={{ margin: 0 }}>{f.t(`plan.policies.${plan.policy}`)}</dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('plan.mode')}</dt>
            <dd style={{ margin: 0 }}>{f.t(`plan.modes.${plan.materialization.mode}`)}</dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('plan.commitment')}</dt>
            <dd style={{ margin: 0 }}>
              <a href={ctx.href(`/recurring/${plan.definitionId}`)} data-testid="plan-definition-link">
                {f.t('plan.viewCommitment')}
              </a>
            </dd>
          </div>
        </dl>
      ) : (
        <p style={mutedStyle} data-testid="plan-off">
          {f.t('plan.off')}
        </p>
      )}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {mode === 'view' && editable ? (
        <div style={rowStyle}>
          <button type="button" onClick={() => setMode('edit')} data-testid="plan-edit">
            {plan ? f.t('plan.change') : f.t('plan.enable')}
          </button>
          {plan ? (
            <button type="button" onClick={() => setMode('disable')} data-testid="plan-disable">
              {f.t('plan.disable')}
            </button>
          ) : null}
        </div>
      ) : null}
      {mode === 'edit' ? (
        <PlanEditor
          ctx={ctx}
          f={f}
          card={card}
          account={account}
          sources={sources}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      ) : null}
      {mode === 'disable' ? (
        <ConfirmPanel
          testId="plan-disable-panel"
          title={f.t('plan.disableTitle')}
          description={f.t('plan.disableDescription')}
          confirmLabel={f.t('plan.disable')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void disable()}
          onCancel={() => setMode('view')}
        />
      ) : null}
    </section>
  );
}

/** Pestaña Plan de pago: por cuenta, activar, cambiar o desactivar el pago administrado (compromiso `CARD_PAYMENT`). */
export function PlanPanel({ ctx, card, accounts, onChanged }: PanelProps & { accounts: readonly Account[] }) {
  const f = useFormat('Cards', ctx);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name;
  return (
    <div style={sectionGap} data-testid="plan-panel">
      <p style={mutedStyle}>{f.t('plan.intro')}</p>
      {card.accounts.map((account) => (
        <PlanSection
          key={account.id}
          ctx={ctx}
          f={f}
          card={card}
          account={account}
          sources={accounts.filter(
            (a) => a.status === 'ACTIVE' && a.classification === 'ASSET' && a.currency === account.currency,
          )}
          nameOf={nameOf}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

// ───────────────────────────── Planes de cuotas ─────────────────────────────

/** Tabla de cuotas de un plan: número, cierre, vencimiento, capital, interés proyectado y total. */
export function InstallmentsTable({ plan, f }: { plan: CardInstallmentPlan; f: FormatContext }) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('installments.region')}>
      <table style={tableStyle} data-testid="installments-table">
        <caption className="pf-sr-only">
          {f.t('installments.caption', { count: plan.installmentCount })}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('installments.n')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('installments.closing')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('installments.due')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('installments.principal')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('installments.interest')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('installments.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.installments.map((i) => (
            <tr key={i.n} data-n={i.n}>
              <th scope="row" style={cellStyle}>
                {i.n}/{plan.installmentCount}
              </th>
              <td style={cellStyle}>{formatBusinessDate(i.billingClosingDate)}</td>
              <td style={cellStyle}>{formatBusinessDate(i.dueDate)}</td>
              <td style={numCellStyle}>{formatMoney(i.principal, f.locale)}</td>
              <td style={numCellStyle}>{formatMoney(i.interest, f.locale)}</td>
              <td style={numCellStyle}>{formatMoney(i.total, f.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstallmentEditor({
  ctx,
  f,
  card,
  onDone,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  card: CreditCard;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [purchases, setPurchases] = useState<readonly Transaction[] | undefined>();
  const [form, setForm] = useState<InstallmentForm>(EMPTY_INSTALLMENT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ limit: '50' });
    for (const a of card.accounts) q.append('accountId', a.accountId);
    q.append('kind', 'EXPENSE');
    q.append('status', 'POSTED');
    ctx.api
      .get<Page<Transaction>>(`${ctx.base}/transactions?${q.toString()}`)
      .then((r) => {
        if (!cancelled) setPurchases(r.data?.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setPurchases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, card.accounts]);

  async function save() {
    setProblem(undefined);
    const built = buildInstallmentInput(form, ctx.formatLocale);
    if (!built.ok) {
      setErrors(Object.fromEntries(Object.entries(built.errors).map(([k, v]) => [k, f.t(`errors.${v}`)])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await ctx.api.command('POST', `${cardPath(ctx.base, card.id)}/installment-plans`, built.input, {
        idempotencyKey: key.current,
      });
      onDone(f.t('installments.created'));
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
    }
  }

  return (
    <form
      style={{ ...formStyle, margin: 0 }}
      noValidate
      data-testid="installment-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <strong>{f.t('installments.newTitle')}</strong>
      <div style={rowStyle}>
        <Field
          label={f.t('installments.purchase')}
          error={errors['purchase']}
          hint={f.t('installments.purchaseHint')}
        >
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.purchaseTransactionId}
              data-testid="installment-purchase"
              disabled={purchases === undefined}
              onChange={(e) => setForm((s) => ({ ...s, purchaseTransactionId: e.target.value }))}
            >
              <option value="">{f.t('installments.choosePurchase')}</option>
              {(purchases ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {formatBusinessDate(t.transactionDate)} ·{' '}
                  {t.description ?? f.t('installments.noDescription')} · {formatMoney(t.amount, f.locale)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('installments.count')} error={errors['count']} hint={f.t('installments.countHint')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="numeric"
              value={form.count}
              data-testid="installment-count"
              onChange={(e) => setForm((s) => ({ ...s, count: e.target.value }))}
            />
          )}
        </Field>
        <Field
          label={f.t('installments.rate')}
          error={errors['annualRate']}
          hint={f.t('installments.rateHint')}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.annualRate}
              data-testid="installment-rate"
              onChange={(e) => setForm((s) => ({ ...s, annualRate: e.target.value }))}
            />
          )}
        </Field>
        <Field label={f.t('installments.startCycle')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.startCycle}
              data-testid="installment-start"
              onChange={(e) =>
                setForm((s) => ({ ...s, startCycle: e.target.value as InstallmentForm['startCycle'] }))
              }
            >
              <option value="PURCHASE">{f.t('installments.startCycles.PURCHASE')}</option>
              <option value="NEXT">{f.t('installments.startCycles.NEXT')}</option>
            </select>
          )}
        </Field>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="installment-save">
          {f.t('installments.create')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}

/** Pestaña Cuotas: planes de cuotas de la tarjeta, alta desde una compra posteada y cancelación. */
export function InstallmentsPanel({ ctx, card, onChanged }: PanelProps) {
  const f = useFormat('Cards', ctx);
  const [plans, setPlans] = useState<readonly CardInstallmentPlan[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<CardInstallmentPlan | undefined>();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const editable = ctx.canEdit && card.status === 'ACTIVE';

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<{ data: CardInstallmentPlan[] }>(`${cardPath(ctx.base, card.id)}/installment-plans`)
      .then((r) => {
        if (!cancelled) setPlans(r.data?.data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPlans([]);
          setProblem(problemOf(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, card.id, tick]);

  const done = useCallback(
    (message: string) => {
      setCreating(false);
      setCancelling(undefined);
      setBusy(false);
      setTick((n) => n + 1);
      onChanged(message);
    },
    [onChanged],
  );

  async function cancel(plan: CardInstallmentPlan) {
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command(
        'POST',
        `${cardPath(ctx.base, card.id)}/installment-plans/${plan.id}/cancel`,
        undefined,
        { ifMatch: plan.version },
      );
      done(f.t('installments.cancelled'));
    } catch (err) {
      setProblem(problemOf(err));
      setBusy(false);
      setCancelling(undefined);
    }
  }

  if (plans === undefined) return <p aria-busy="true">{f.t('loading')}</p>;
  return (
    <div style={sectionGap} data-testid="installments-panel">
      <p style={mutedStyle}>{f.t('installments.intro')}</p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {editable && !creating ? (
        <p style={{ margin: 0 }}>
          <button type="button" onClick={() => setCreating(true)} data-testid="installment-new">
            {f.t('installments.new')}
          </button>
        </p>
      ) : null}
      {creating ? (
        <InstallmentEditor ctx={ctx} f={f} card={card} onDone={done} onCancel={() => setCreating(false)} />
      ) : null}
      {plans.length === 0 ? (
        <p style={mutedStyle} data-testid="installments-empty">
          {f.t('installments.empty')}
        </p>
      ) : (
        plans.map((plan) => (
          <details
            key={plan.id}
            style={{
              border: '1px solid var(--pf-border)',
              borderRadius: 'var(--pf-radius-md)',
              padding: 'var(--pf-space-3)',
              background: 'var(--pf-surface-raised)',
            }}
            data-testid="installment-plan"
            data-status={plan.status}
          >
            <summary style={{ cursor: 'pointer' }}>
              <strong>
                {f.t('installments.planSummary', {
                  date: formatBusinessDate(plan.purchaseDate),
                  amount: formatMoney(plan.principal, f.locale),
                  count: plan.installmentCount,
                })}
              </strong>{' '}
              <span data-testid="installment-plan-status">
                {f.t(`installments.status.${plan.status}`)}
                {plan.cancelReason ? ` · ${f.t(`installments.cancelReasons.${plan.cancelReason}`)}` : ''}
              </span>
            </summary>
            <div style={{ ...sectionGap, marginTop: 'var(--pf-space-3)' }}>
              <InstallmentsTable plan={plan} f={f} />
              {editable && plan.status === 'ACTIVE' ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setCancelling(plan)}
                    data-testid="installment-cancel"
                    aria-label={f.t('installments.cancelLabel', {
                      date: formatBusinessDate(plan.purchaseDate),
                    })}
                  >
                    {f.t('installments.cancel')}
                  </button>
                </div>
              ) : null}
            </div>
          </details>
        ))
      )}
      {cancelling ? (
        <ConfirmPanel
          testId="installment-cancel-panel"
          title={f.t('installments.cancelTitle')}
          description={f.t('installments.cancelDescription')}
          confirmLabel={f.t('installments.cancel')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void cancel(cancelling)}
          onCancel={() => setCancelling(undefined)}
        />
      ) : null}
    </div>
  );
}

// ───────────────────────────── Cargos futuros ─────────────────────────────

const MONTH_OPTIONS = [3, 6, 12, 24] as const;

/** Calendario de cargos futuros (cuotas por vencimiento y cuenta). */
export function FutureChargesTable({
  charges,
  f,
}: {
  charges: readonly CardFutureCharge[];
  f: FormatContext;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('future.region')}>
      <table style={tableStyle} data-testid="future-table">
        <caption className="pf-sr-only">{f.t('future.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('future.due')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('future.closing')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('future.installments')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('future.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={`${c.dueDate}-${c.accountId}`} data-due={c.dueDate} data-currency={c.currency}>
              <th scope="row" style={cellStyle}>
                {formatBusinessDate(c.dueDate)}
              </th>
              <td style={cellStyle}>{formatBusinessDate(c.closingDate)}</td>
              <td style={cellStyle}>
                {c.installments.map((i) => (
                  <div key={`${i.planId}-${i.n}`}>
                    {f.t('future.installment', {
                      n: i.n,
                      of: i.of,
                      amount: formatMoney(i.total, f.locale),
                    })}
                  </div>
                ))}
              </td>
              <td style={numCellStyle} data-testid="future-total">
                {formatMoney(c.total, f.locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FuturePanel({
  ctx,
  card,
  reloadKey,
}: {
  ctx: WorkspaceContext;
  card: CreditCard;
  reloadKey: number;
}) {
  const f = useFormat('Cards', ctx);
  const [months, setMonths] = useState<number>(6);
  const [charges, setCharges] = useState<readonly CardFutureCharge[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<{ data: CardFutureCharge[] }>(`${cardPath(ctx.base, card.id)}/future-charges?months=${months}`)
      .then((r) => {
        if (!cancelled) {
          setProblem(undefined);
          setCharges(r.data?.data ?? []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCharges([]);
          setProblem(problemOf(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, card.id, months, reloadKey]);

  return (
    <div style={sectionGap} data-testid="future-panel">
      <p style={mutedStyle}>{f.t('future.intro')}</p>
      <Field label={f.t('future.months')} style={{ maxWidth: '14rem' }}>
        {(p) => (
          <select
            {...p}
            style={inputStyle}
            value={months}
            data-testid="future-months"
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {f.t('future.monthsOption', { months: m })}
              </option>
            ))}
          </select>
        )}
      </Field>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {charges === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : charges.length === 0 ? (
        <p style={mutedStyle} data-testid="future-empty">
          {f.t('future.empty')}
        </p>
      ) : (
        <FutureChargesTable charges={charges} f={f} />
      )}
    </div>
  );
}
