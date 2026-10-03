import { cardStyle, mutedStyle } from './styles';
import type { FormatContext, HomeQuestion, HomeQuestionStatus, ReportSummary } from './types';

/** Estado de disponibilidad de una pregunta del Home (docs/00 §6); sin entrada se asume disponible. */
export const statusOf = (summary: ReportSummary, question: HomeQuestion): HomeQuestionStatus =>
  summary.questions.find((q) => q.question === question) ?? {
    question,
    status: 'AVAILABLE',
    actionHint: null,
  };

/** Acción sugerida para habilitar una pregunta (código `actionHint` de la API traducido). */
export function ActionHint({
  code,
  ctx,
  href,
  testId,
}: {
  code: string | null;
  ctx: FormatContext;
  href?: string | undefined;
  testId?: string;
}) {
  if (!code) return null;
  const text = ctx.has(`actionHints.${code}`) ? ctx.t(`actionHints.${code}`) : ctx.t('actionHints.UNKNOWN');
  return (
    <p data-testid={testId ?? 'action-hint'} data-action={code}>
      {href ? <a href={href}>{text}</a> : text}
    </p>
  );
}

/**
 * Widget de una pregunta que aún no puede responderse en esta fase (Q4, Q5, Q8, Q9 en Phase 1): lo dice
 * explícitamente y sugiere cuándo/cómo se habilita, sin ningún monto (FR-REPORTING-001).
 */
export function NotAvailableWidget({ status, ctx }: { status: HomeQuestionStatus; ctx: FormatContext }) {
  const { t } = ctx;
  return (
    <section
      data-testid={`question-${status.question}`}
      data-question={status.question}
      data-status={status.status}
      aria-labelledby={`question-${status.question}-title`}
      style={{ ...cardStyle, borderStyle: 'dashed' }}
    >
      <h2 id={`question-${status.question}-title`} style={{ fontSize: '1rem', margin: 0 }}>
        {t(`questions.${status.question}`)}
      </h2>
      <p data-testid="question-not-available">{t('notAvailable')}</p>
      <div style={mutedStyle}>
        <ActionHint code={status.actionHint} ctx={ctx} />
      </div>
    </section>
  );
}

/** Pregunta sin datos suficientes (p. ej. workspace sin movimientos): texto y acción, nunca un cero sustituto. */
export function NoDataMessage({ status, ctx }: { status: HomeQuestionStatus; ctx: FormatContext }) {
  return (
    <div data-testid={`question-${status.question}-no-data`} data-status={status.status}>
      <p>{ctx.t('noData')}</p>
      <ActionHint code={status.actionHint} ctx={ctx} />
    </div>
  );
}
