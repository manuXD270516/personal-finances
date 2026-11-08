import { LocalDate } from '@pf/shared-kernel';
import type {
  HomeDigestDto,
  HomeDigestQuery,
  HomeDigestQuestionDto,
  MoneyDto,
  ReportSummaryDto,
  UpcomingPaymentsDto,
} from '../contracts/index.js';
import type { UpcomingPaymentsDeps } from './ports/index.js';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { UpcomingPaymentsQueries } from './upcoming-payments.queries.js';

type Question = HomeDigestQuestionDto['question'];

const empty = (question: Question, status: 'AVAILABLE' | 'NO_DATA'): HomeDigestQuestionDto => ({
  question,
  status,
  counts: {},
  percents: {},
  dates: {},
  states: {},
  amounts: {},
});

const sign = (m: MoneyDto): 'POSITIVE' | 'ZERO' | 'NEGATIVE' =>
  m.amount.startsWith('-') ? 'NEGATIVE' : /^0+(\.0+)?$/.test(m.amount) ? 'ZERO' : 'POSITIVE';

/**
 * `HomeDigestQuery` (openspec add-cash-flow-forecast, design.md decisión 15; D385, D386): compone UNA vez por workspace el
 * resumen de las nueve preguntas del Home para el digest por email. Reutiliza las mismas consultas del Home (resumen,
 * próximos pagos de 7 días) en una sola unidad de trabajo de lectura, y devuelve un DTO por pregunta con cantidades,
 * porcentajes, estados y fechas, y aparte los montos (NOTIFY los descarta si el destinatario no activó los detalles).
 * Una pregunta sin datos es `NO_DATA`: nunca un cero sustituto.
 */
export class HomeDigestComposer implements HomeDigestQuery {
  constructor(private readonly deps: UpcomingPaymentsDeps) {}

  compose(input: { readonly workspaceId: string }): Promise<HomeDigestDto> {
    const { workspaceId } = input;
    return this.deps.uow.run({ userId: null, workspaceId }, async () => {
      const summary = (
        await new ReportSummaryQueries(this.deps).computeInCurrentUnit({ userId: null, workspaceId })
      ).summary;
      const upcoming = (
        await new UpcomingPaymentsQueries(this.deps).getUpcomingPaymentsInCurrentUnit({
          userId: null,
          workspaceId,
          days: 7,
        })
      ).upcoming;
      const now = this.deps.clock.now();
      return {
        workspaceId,
        generatedAt: now.toString(),
        timeZone: summary.meta.timeZone,
        today: LocalDate.ofInstant(now, summary.meta.timeZone).toString(),
        reportingCurrency: summary.meta.reportingCurrency,
        questions: questionsOf(summary, upcoming),
      };
    });
  }
}

/** Las nueve preguntas a partir del resumen del Home y los próximos pagos de 7 días (puro, sin E/S). */
export function questionsOf(
  summary: ReportSummaryDto,
  upcoming: UpcomingPaymentsDto,
): HomeDigestQuestionDto[] {
  const status = (q: Question) =>
    summary.questions.find((x) => x.question === q)?.status === 'AVAILABLE' ? 'AVAILABLE' : 'NO_DATA';
  const c = summary.consolidated;
  const comparison = summary.comparison;
  const overdue = upcoming.items.filter((i) => i.status === 'OVERDUE' || (i.daysOverdue ?? 0) > 0).length;
  const upcoming7d = upcoming.items.length - overdue;
  const out: HomeDigestQuestionDto[] = [];

  out.push({ ...empty('Q1', status('Q1')), amounts: { liquid: c.liquidBalance } });
  out.push({ ...empty('Q2', status('Q2')), amounts: { income: c.income } });
  out.push({ ...empty('Q3', status('Q3')), amounts: { expense: c.expense } });

  const q4 = empty('Q4', status('Q4'));
  out.push({
    ...q4,
    counts: { overdue: upcoming.committed?.overdueFromPreviousPeriods.count ?? 0 },
    ...(upcoming.committed ? { amounts: { committed: upcoming.committed.total.consolidated.amount } } : {}),
  });

  const spendable = summary.spendable;
  const q5Status = status('Q5');
  out.push(
    spendable && q5Status === 'AVAILABLE'
      ? {
          ...empty('Q5', 'AVAILABLE'),
          states: { spendableSign: sign(spendable.consolidated.total) },
          amounts: { spendable: spendable.consolidated.total },
        }
      : empty('Q5', 'NO_DATA'),
  );

  const q6Status = status('Q6');
  out.push({
    ...empty('Q6', q6Status),
    ...(c.savingsRate !== null ? { percents: { savingsRate: c.savingsRate } } : {}),
    amounts: { savings: c.net },
  });

  const q7Percents: Record<string, string> = {};
  // Porcentajes sin signo "más" ni símbolo (`"8.75"`): el idioma y el formato los pone NOTIFY.
  const incomePct = comparison?.income.deltaPct;
  const expensePct = comparison?.expense.deltaPct;
  if (typeof incomePct === 'string') q7Percents['incomeChange'] = incomePct;
  if (typeof expensePct === 'string') q7Percents['expenseChange'] = expensePct;
  out.push({
    ...empty('Q7', comparison && Object.keys(q7Percents).length > 0 ? status('Q7') : 'NO_DATA'),
    percents: q7Percents,
  });

  const flow = summary.cashFlow;
  const q8 = empty('Q8', status('Q8'));
  out.push({
    ...q8,
    counts: { upcoming7d, overdue },
    ...(flow
      ? {
          states: {
            risk: flow.worst?.risk ?? 'NONE',
            ...(flow.worst ? { riskCurrency: flow.worst.currency } : {}),
          },
          dates: flow.worst?.firstShortfallDate ? { firstShortfall: flow.worst.firstShortfallDate } : {},
          amounts: flow.worst
            ? { lowestBalance: flow.worst.lowest }
            : flow.consolidatedLowest
              ? { lowestBalance: flow.consolidatedLowest.amount }
              : {},
        }
      : {}),
  });

  const goals = summary.goals;
  if (goals.status === 'AVAILABLE') {
    const byStatus = (s: 'BEHIND' | 'ON_TRACK' | 'AHEAD') =>
      goals.items.filter((g) => g.tracking.status === s).length;
    out.push({
      ...empty('Q9', 'AVAILABLE'),
      counts: {
        goals: goals.items.length + goals.moreCount,
        goalsBehind: byStatus('BEHIND'),
        goalsOnTrack: byStatus('ON_TRACK'),
        goalsAhead: byStatus('AHEAD'),
      },
    });
  } else {
    out.push(empty('Q9', 'NO_DATA'));
  }
  return out;
}
