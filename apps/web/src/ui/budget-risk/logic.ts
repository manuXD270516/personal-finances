import type { FormatContext } from '../dashboard/types';
import { formatMoney } from '../dashboard/format';
import type { BudgetLineRisk, BudgetRiskLevel } from './types';

/** Fecha numérica del locale (`22/11/2026` en es-BO y pt-BR, `11/22/2026` en en-US), sin zona: es una fecha de negocio. */
export const numericDate = (date: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));

/** Ruta (sin prefijo de locale) del plan del periodo con la línea resaltada (mismo enlace que el aviso). */
export const budgetLineHref = (periodLabel: string, budgetLineId: string): string => {
  const query = new URLSearchParams({ periodo: periodLabel, linea: budgetLineId });
  return `/planificacion/presupuestos?${query.toString()}`;
};

/** Presentación del nivel: icono decorativo y tono (el texto siempre acompaña, el color solo refuerza). */
export function levelPresentation(level: BudgetRiskLevel): {
  readonly icon: string;
  readonly tone: 'danger' | 'warn' | 'ok' | 'neutral';
} {
  switch (level) {
    case 'EXCEEDED':
    case 'LIKELY':
      return { icon: '▲', tone: 'danger' };
    case 'POSSIBLE':
      return { icon: '△', tone: 'warn' };
    case 'UNLIKELY':
      return { icon: '✓', tone: 'ok' };
    default:
      return { icon: '–', tone: 'neutral' };
  }
}

/** Hay algo que explicar con la leyenda de «posible» en este listado. */
export const hasPossible = (lines: readonly BudgetLineRisk[]): boolean =>
  lines.some((l) => l.level === 'POSSIBLE');

/**
 * Texto del riesgo de una línea por plantilla (sin modelos de lenguaje, FR-REPORTING-020): habla de ritmo o pronóstico y de
 * fecha estimada, nunca de certeza. `undefined` si la línea no tiene un riesgo que contar (improbable, excedida o sin dato).
 */
export function riskSentence(line: BudgetLineRisk, f: FormatContext): string | undefined {
  if (line.level !== 'LIKELY' && line.level !== 'POSSIBLE') return undefined;
  const date = line.estimatedDate ? numericDate(line.estimatedDate, f.locale) : undefined;
  const prefix = line.level === 'LIKELY' ? 'likely' : 'possible';
  const key = `sentence.${prefix}${line.basis === 'FORECAST' ? 'Forecast' : ''}${date ? '' : 'NoDate'}`;
  return f.t(key, { name: line.targetName, ...(date ? { date } : {}) });
}

/** Proyección, proyección alta, fecha y base de una línea, formateadas para el locale. */
export function riskDetails(line: BudgetLineRisk, f: FormatContext) {
  return {
    projected: line.projected ? formatMoney(line.projected, f.locale) : undefined,
    projectedHigh: line.projectedHigh ? formatMoney(line.projectedHigh, f.locale) : undefined,
    date: line.estimatedDate ? numericDate(line.estimatedDate, f.locale) : undefined,
    basis: line.basis ? f.t(`basis.${line.basis}`) : undefined,
  };
}
