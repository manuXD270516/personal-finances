import type {
  LifecycleAggregateType,
  LifecycleExportSource,
  LifecycleItemDto,
  LifecycleRevisionAmountDto,
} from '../contracts/index.js';

/**
 * Exportación del recorrido (docs/31 D52; add-lifecycle-timeline § Ampliación D52, decisión 6). Datos puros que
 * comparten el CSV y el PDF: el CSV usa claves y códigos estables (no se traduce) y el PDF, textos por locale
 * (es; en/pt preparados). Los montos se copian tal cual (decimal string del contrato) y los instantes se expresan en
 * la zona horaria del workspace.
 */

/** Encabezado estable del CSV (decisión 6 de la ampliación D52), en este orden. */
export const LIFECYCLE_CSV_COLUMNS = [
  'sequence',
  'kind',
  'transition',
  'fromState',
  'toState',
  'occurredAt',
  'actorType',
  'actorId',
  'origin',
  'reason',
  'revisionFrom',
  'revisionTo',
  'amount',
  'fee',
  'currency',
  'reversedJournalEntryId',
  'reversalJournalEntryId',
  'postedJournalEntryId',
  'events',
  'changedFields',
  'derived',
] as const;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** `+hh:mm` / `-hh:mm`. */
  readonly offset: string;
}

/** Un `Intl.DateTimeFormat` por zona: construirlo por fila costaba ~0,2 ms (50 000 filas del export del log ≈ 9 s). */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Partes locales de un instante en `timeZone` (IANA), con su desfase. */
function localParts(iso: string, timeZone: string): LocalParts {
  const parts = formatterOf(timeZone).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const gmt = get('timeZoneName'); // "GMT-04:00" o "GMT" (UTC)
  const offset = /^GMT[+-]\d{2}:\d{2}$/u.test(gmt) ? gmt.slice(3) : '+00:00';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    offset,
  };
}

/** ISO 8601 en la zona del workspace con su desfase (`2026-03-10T10:00:00-04:00`). */
export function isoInTimeZone(iso: string, timeZone: string): string {
  const p = localParts(iso, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${p.offset}`;
}

/** `dd/MM/yyyy HH:mm` (24 h) en la zona del workspace, para el PDF. */
export function displayInTimeZone(iso: string, timeZone: string): string {
  const p = localParts(iso, timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${pad(p.year, 4)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Nombre del archivo: solo ASCII seguro (`recorrido-<aggregateType>-<id>.<csv|pdf>`). */
export function lifecycleFileName(
  type: LifecycleAggregateType,
  aggregateId: string,
  extension: 'csv' | 'pdf',
): string {
  const id = aggregateId.toLowerCase().replace(/[^0-9a-f-]/gu, '');
  return `recorrido-${type.replace(/[^A-Za-z]/gu, '')}-${id}.${extension}`;
}

const actorId = (actor: LifecycleItemDto['actor']) => actor.id;
const num = (n: number | null) => (n === null ? '' : String(n));

/** Revisión destino de una transición de transacción (monto enviado y su moneda; comisión). */
function revisionOf(
  item: LifecycleItemDto,
  revisions: ReadonlyMap<number, LifecycleRevisionAmountDto>,
): LifecycleRevisionAmountDto | undefined {
  return item.kind === 'TRANSITION' && item.revisionTo !== null ? revisions.get(item.revisionTo) : undefined;
}

/** Filas del CSV (sin encabezado), en el orden del recorrido (instante y secuencia). */
export function lifecycleCsvRows(source: LifecycleExportSource, timeZone: string): string[][] {
  const revisions = new Map((source.revisions ?? []).map((r) => [r.revision, r]));
  return source.lifecycle.items.map((item) => {
    const revision = revisionOf(item, revisions);
    const transition = item.kind === 'TRANSITION' ? item : null;
    return [
      String(item.sequence),
      item.kind,
      transition?.transition ?? '',
      transition?.fromState ?? '',
      transition?.toState ?? '',
      isoInTimeZone(item.occurredAt, timeZone),
      item.actor.type,
      actorId(item.actor),
      item.origin,
      transition?.reason ?? '',
      num(item.revisionFrom),
      num(item.revisionTo),
      revision?.amount.amount ?? '',
      revision?.fee?.amount ?? '',
      revision?.amount.currency ?? '',
      transition?.journalEntries.reversed ?? '',
      transition?.journalEntries.reversal ?? '',
      transition?.journalEntries.posted ?? '',
      item.events.join('|'),
      item.kind === 'ANNOTATION' ? item.changedFields.join('|') : '',
      item.derived ? 'true' : 'false',
    ];
  });
}

const FORMULA_START = /^[=+\-@\t\r]/u;
const DECIMAL = /^-?\d+(\.\d+)?$/u;
const NEEDS_QUOTES = /[",\r\n]/u;

/**
 * Celda CSV segura (RFC 4180 + docs/12 §11, docs/14 §12): un texto que empieza con `=`, `+`, `-`, `@`, tabulador o
 * retorno se neutraliza con el prefijo `'` (CSV injection) salvo que sea un decimal exacto (`-12.50` no cambia); se
 * entrecomilla si contiene comillas, comas o saltos de línea, duplicando las comillas internas.
 */
export function csvCell(value: string): string {
  const safe = neutralizeFormula(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** Neutraliza un texto que una hoja de cálculo evaluaría como fórmula (prefijo `'`), salvo un decimal exacto. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) && !DECIMAL.test(value) ? `'${value}` : value;
}

/** BOM UTF-8: Excel reconoce la codificación (tildes, ñ). */
export const UTF8_BOM = '\uFEFF';

/** CSV RFC 4180 (coma, CRLF, encabezado estable) con BOM UTF-8. */
export function lifecycleCsv(source: LifecycleExportSource, timeZone: string): string {
  const lines = [[...LIFECYCLE_CSV_COLUMNS], ...lifecycleCsvRows(source, timeZone)].map((row) =>
    row.map(csvCell).join(','),
  );
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

// ───────────────────────────────────────────── PDF (textos por locale)

export type LifecycleReportLocale = 'es' | 'en' | 'pt';

interface ReportTexts {
  readonly title: string;
  readonly aggregates: Readonly<Record<LifecycleAggregateType, string>>;
  readonly states: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly transitions: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly element: string;
  readonly currentState: string;
  readonly path: string;
  readonly machine: string;
  readonly generated: string;
  readonly incomplete: string;
  readonly empty: string;
  readonly annotation: string;
  readonly creation: string;
  readonly yes: string;
  readonly no: string;
  readonly fee: string;
  readonly page: (n: number, total: number) => string;
  readonly actors: Readonly<Record<string, string>>;
  readonly columns: {
    readonly n: string;
    readonly step: string;
    readonly fromTo: string;
    readonly when: string;
    readonly actor: string;
    readonly reason: string;
    readonly revision: string;
    readonly amount: string;
    readonly derived: string;
  };
}

const CLASSIFICATION = {
  es: {
    states: { ACTIVE: 'Activa', ARCHIVED: 'Archivada' },
    transitions: { CREATE: 'Crear', ARCHIVE: 'Archivar', UNARCHIVE: 'Desarchivar' },
  },
  en: {
    states: { ACTIVE: 'Active', ARCHIVED: 'Archived' },
    transitions: { CREATE: 'Create', ARCHIVE: 'Archive', UNARCHIVE: 'Unarchive' },
  },
  pt: {
    states: { ACTIVE: 'Ativa', ARCHIVED: 'Arquivada' },
    transitions: { CREATE: 'Criar', ARCHIVE: 'Arquivar', UNARCHIVE: 'Desarquivar' },
  },
} as const;

/** Mismos textos que el namespace `Lifecycle` y los estados de la web (es; en/pt preparados). */
const TEXTS: Readonly<Record<LifecycleReportLocale, ReportTexts>> = {
  es: {
    title: 'Recorrido',
    aggregates: {
      Transaction: 'Transacción',
      Account: 'Cuenta',
      ExchangeRate: 'Tasa de cambio',
      Category: 'Categoría',
      Counterparty: 'Contraparte',
      FinancialPeriod: 'Periodo financiero',
      Reconciliation: 'Reconciliación',
      RecurringDefinition: 'Definición recurrente',
      RecurringOccurrence: 'Ocurrencia recurrente',
    },
    states: {
      Transaction: {
        PENDING: 'Pendiente',
        POSTED: 'Contabilizada',
        CLEARED: 'Confirmada',
        RECONCILED: 'Reconciliada',
        VOIDED: 'Anulada',
      },
      Account: { ACTIVE: 'Activa', CLOSED: 'Cerrada', ARCHIVED: 'Archivada' },
      ExchangeRate: { RECORDED: 'Registrada', SUPERSEDED: 'Reemplazada' },
      Category: CLASSIFICATION.es.states,
      Counterparty: CLASSIFICATION.es.states,
      FinancialPeriod: { DRAFT: 'Borrador', ACTIVE: 'Activo', CLOSED: 'Cerrado', REOPENED: 'Reabierto' },
      Reconciliation: { IN_PROGRESS: 'En curso', COMPLETED: 'Completada', CANCELLED: 'Cancelada' },
      RecurringDefinition: { ACTIVE: 'Activa', PAUSED: 'Pausada', ENDED: 'Terminada' },
      RecurringOccurrence: {
        SCHEDULED: 'Programada',
        DUE: 'Próxima',
        OVERDUE: 'Atrasada',
        MATERIALIZED: 'Creada',
        MATCHED: 'Vinculada',
        SKIPPED: 'Omitida',
        CANCELLED: 'Cancelada',
      },
    },
    transitions: {
      Transaction: {
        RECORD: 'Registrar',
        POST: 'Contabilizar',
        CLEAR: 'Confirmar',
        UNCLEAR: 'Quitar confirmación',
        RECONCILE: 'Reconciliar',
        RECONCILE_WITHOUT_STATEMENT: 'Conciliar sin extracto',
        UNRECONCILE: 'Des-reconciliar',
        REVISE: 'Revisar',
        VOID: 'Anular',
      },
      Account: { OPEN: 'Abrir', CLOSE: 'Cerrar', ARCHIVE: 'Archivar', REACTIVATE: 'Reactivar' },
      ExchangeRate: { RECORD: 'Registrar', SUPERSEDE: 'Reemplazar' },
      Category: CLASSIFICATION.es.transitions,
      Counterparty: CLASSIFICATION.es.transitions,
      FinancialPeriod: { CREATE: 'Crear', ACTIVATE: 'Activar', CLOSE: 'Cerrar', REOPEN: 'Reabrir' },
      Reconciliation: { START: 'Iniciar', COMPLETE: 'Finalizar', CANCEL: 'Cancelar' },
      RecurringDefinition: {
        CREATE: 'Crear',
        PAUSE: 'Pausar',
        RESUME: 'Reanudar',
        REVISE: 'Revisar',
        END: 'Terminar',
      },
      RecurringOccurrence: {
        GENERATE: 'Generar',
        BECOME_DUE: 'Pasar a próxima',
        MARK_OVERDUE: 'Atrasar',
        MATERIALIZE: 'Crear transacción',
        LINK: 'Vincular',
        SKIP: 'Omitir',
        RELEASE: 'Liberar',
        CANCEL: 'Cancelar',
        REINSTATE: 'Reinstaurar',
      },
    },
    element: 'Elemento',
    currentState: 'Estado actual',
    path: 'Estados visitados',
    machine: 'Máquina de estados',
    generated: 'Generado',
    incomplete:
      'Historia previa incompleta: parte del recorrido se reconstruyó desde la auditoría y no hay evidencia de los pasos anteriores.',
    empty: 'Todavía no hay transiciones registradas.',
    annotation: 'Cambio descriptivo',
    creation: '(inicio)',
    yes: 'derivada',
    no: '',
    fee: 'comisión',
    page: (n, total) => `Página ${n} de ${total}`,
    actors: { USER: 'Usuario', WORKER: 'Proceso', SYSTEM: 'Sistema' },
    columns: {
      n: 'N°',
      step: 'Transición',
      fromTo: 'Origen -> destino / campos',
      when: 'Fecha y hora',
      actor: 'Actor (origen)',
      reason: 'Motivo',
      revision: 'Revisión',
      amount: 'Monto',
      derived: 'Derivada',
    },
  },
  en: {
    title: 'Lifecycle',
    aggregates: {
      Transaction: 'Transaction',
      Account: 'Account',
      ExchangeRate: 'Exchange rate',
      Category: 'Category',
      Counterparty: 'Counterparty',
      FinancialPeriod: 'Financial period',
      Reconciliation: 'Reconciliation',
      RecurringDefinition: 'Recurring definition',
      RecurringOccurrence: 'Recurring occurrence',
    },
    states: {
      Transaction: {
        PENDING: 'Pending',
        POSTED: 'Posted',
        CLEARED: 'Cleared',
        RECONCILED: 'Reconciled',
        VOIDED: 'Voided',
      },
      Account: { ACTIVE: 'Active', CLOSED: 'Closed', ARCHIVED: 'Archived' },
      ExchangeRate: { RECORDED: 'Recorded', SUPERSEDED: 'Superseded' },
      Category: CLASSIFICATION.en.states,
      Counterparty: CLASSIFICATION.en.states,
      FinancialPeriod: { DRAFT: 'Draft', ACTIVE: 'Active', CLOSED: 'Closed', REOPENED: 'Reopened' },
      Reconciliation: { IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' },
      RecurringDefinition: { ACTIVE: 'Active', PAUSED: 'Paused', ENDED: 'Ended' },
      RecurringOccurrence: {
        SCHEDULED: 'Scheduled',
        DUE: 'Upcoming',
        OVERDUE: 'Overdue',
        MATERIALIZED: 'Created',
        MATCHED: 'Linked',
        SKIPPED: 'Skipped',
        CANCELLED: 'Cancelled',
      },
    },
    transitions: {
      Transaction: {
        RECORD: 'Record',
        POST: 'Post',
        CLEAR: 'Clear',
        UNCLEAR: 'Unclear',
        RECONCILE: 'Reconcile',
        RECONCILE_WITHOUT_STATEMENT: 'Reconcile without statement',
        UNRECONCILE: 'Unreconcile',
        REVISE: 'Revise',
        VOID: 'Void',
      },
      Account: { OPEN: 'Open', CLOSE: 'Close', ARCHIVE: 'Archive', REACTIVATE: 'Reactivate' },
      ExchangeRate: { RECORD: 'Record', SUPERSEDE: 'Supersede' },
      Category: CLASSIFICATION.en.transitions,
      Counterparty: CLASSIFICATION.en.transitions,
      FinancialPeriod: { CREATE: 'Create', ACTIVATE: 'Activate', CLOSE: 'Close', REOPEN: 'Reopen' },
      Reconciliation: { START: 'Start', COMPLETE: 'Complete', CANCEL: 'Cancel' },
      RecurringDefinition: {
        CREATE: 'Create',
        PAUSE: 'Pause',
        RESUME: 'Resume',
        REVISE: 'Revise',
        END: 'End',
      },
      RecurringOccurrence: {
        GENERATE: 'Generate',
        BECOME_DUE: 'Become upcoming',
        MARK_OVERDUE: 'Mark overdue',
        MATERIALIZE: 'Create transaction',
        LINK: 'Link',
        SKIP: 'Skip',
        RELEASE: 'Release',
        CANCEL: 'Cancel',
        REINSTATE: 'Reinstate',
      },
    },
    element: 'Item',
    currentState: 'Current state',
    path: 'Visited states',
    machine: 'State machine',
    generated: 'Generated',
    incomplete:
      'Incomplete earlier history: part of the lifecycle was rebuilt from the audit trail and there is no evidence of earlier steps.',
    empty: 'No transitions recorded yet.',
    annotation: 'Descriptive change',
    creation: '(start)',
    yes: 'derived',
    no: '',
    fee: 'fee',
    page: (n, total) => `Page ${n} of ${total}`,
    actors: { USER: 'User', WORKER: 'Process', SYSTEM: 'System' },
    columns: {
      n: 'No.',
      step: 'Transition',
      fromTo: 'From -> to / fields',
      when: 'Date and time',
      actor: 'Actor (origin)',
      reason: 'Reason',
      revision: 'Revision',
      amount: 'Amount',
      derived: 'Derived',
    },
  },
  pt: {
    title: 'Percurso',
    aggregates: {
      Transaction: 'Transação',
      Account: 'Conta',
      ExchangeRate: 'Taxa de câmbio',
      Category: 'Categoria',
      Counterparty: 'Contraparte',
      FinancialPeriod: 'Período financeiro',
      Reconciliation: 'Conciliação',
      RecurringDefinition: 'Definição recorrente',
      RecurringOccurrence: 'Ocorrência recorrente',
    },
    states: {
      Transaction: {
        PENDING: 'Pendente',
        POSTED: 'Contabilizada',
        CLEARED: 'Confirmada',
        RECONCILED: 'Conciliada',
        VOIDED: 'Anulada',
      },
      Account: { ACTIVE: 'Ativa', CLOSED: 'Encerrada', ARCHIVED: 'Arquivada' },
      ExchangeRate: { RECORDED: 'Registrada', SUPERSEDED: 'Substituída' },
      Category: CLASSIFICATION.pt.states,
      Counterparty: CLASSIFICATION.pt.states,
      FinancialPeriod: { DRAFT: 'Rascunho', ACTIVE: 'Ativo', CLOSED: 'Fechado', REOPENED: 'Reaberto' },
      Reconciliation: { IN_PROGRESS: 'Em andamento', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' },
      RecurringDefinition: { ACTIVE: 'Ativa', PAUSED: 'Pausada', ENDED: 'Encerrada' },
      RecurringOccurrence: {
        SCHEDULED: 'Programada',
        DUE: 'Próxima',
        OVERDUE: 'Atrasada',
        MATERIALIZED: 'Criada',
        MATCHED: 'Vinculada',
        SKIPPED: 'Ignorada',
        CANCELLED: 'Cancelada',
      },
    },
    transitions: {
      Transaction: {
        RECORD: 'Registrar',
        POST: 'Contabilizar',
        CLEAR: 'Confirmar',
        UNCLEAR: 'Remover confirmação',
        RECONCILE: 'Conciliar',
        RECONCILE_WITHOUT_STATEMENT: 'Conciliar sem extrato',
        UNRECONCILE: 'Desconciliar',
        REVISE: 'Revisar',
        VOID: 'Anular',
      },
      Account: { OPEN: 'Abrir', CLOSE: 'Encerrar', ARCHIVE: 'Arquivar', REACTIVATE: 'Reativar' },
      ExchangeRate: { RECORD: 'Registrar', SUPERSEDE: 'Substituir' },
      Category: CLASSIFICATION.pt.transitions,
      Counterparty: CLASSIFICATION.pt.transitions,
      FinancialPeriod: { CREATE: 'Criar', ACTIVATE: 'Ativar', CLOSE: 'Fechar', REOPEN: 'Reabrir' },
      Reconciliation: { START: 'Iniciar', COMPLETE: 'Concluir', CANCEL: 'Cancelar' },
      RecurringDefinition: {
        CREATE: 'Criar',
        PAUSE: 'Pausar',
        RESUME: 'Retomar',
        REVISE: 'Revisar',
        END: 'Encerrar',
      },
      RecurringOccurrence: {
        GENERATE: 'Gerar',
        BECOME_DUE: 'Passar a próxima',
        MARK_OVERDUE: 'Atrasar',
        MATERIALIZE: 'Criar transação',
        LINK: 'Vincular',
        SKIP: 'Ignorar',
        RELEASE: 'Liberar',
        CANCEL: 'Cancelar',
        REINSTATE: 'Reinstaurar',
      },
    },
    element: 'Item',
    currentState: 'Estado atual',
    path: 'Estados visitados',
    machine: 'Máquina de estados',
    generated: 'Gerado',
    incomplete:
      'Histórico anterior incompleto: parte do percurso foi reconstruída a partir da auditoria e não há evidência dos passos anteriores.',
    empty: 'Ainda não há transições registradas.',
    annotation: 'Alteração descritiva',
    creation: '(início)',
    yes: 'derivada',
    no: '',
    fee: 'tarifa',
    page: (n, total) => `Página ${n} de ${total}`,
    actors: { USER: 'Usuário', WORKER: 'Processo', SYSTEM: 'Sistema' },
    columns: {
      n: 'N°',
      step: 'Transição',
      fromTo: 'Origem -> destino / campos',
      when: 'Data e hora',
      actor: 'Ator (origem)',
      reason: 'Motivo',
      revision: 'Revisão',
      amount: 'Valor',
      derived: 'Derivada',
    },
  },
};

/** Locale del reporte desde `Accept-Language` (primer idioma soportado; por defecto es). */
export function reportLocale(acceptLanguage: string | undefined | null): LifecycleReportLocale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.trim().split(';')[0]?.trim().toLowerCase().slice(0, 2);
    if (tag === 'es' || tag === 'en' || tag === 'pt') return tag;
  }
  return 'es';
}

/** Reporte listo para el PDF: textos ya resueltos en el locale. */
export interface LifecycleReport {
  readonly locale: LifecycleReportLocale;
  readonly title: string;
  /** "Cuenta Bank C (0190…)". */
  readonly element: string;
  readonly aggregateId: string;
  readonly headerLines: readonly { readonly label: string; readonly value: string }[];
  readonly incomplete: string | null;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly empty: string;
  readonly page: (n: number, total: number) => string;
  readonly documentTitle: string;
}

export function buildLifecycleReport(
  source: LifecycleExportSource,
  options: {
    readonly timeZone: string;
    readonly generatedAt: string;
    readonly locale: LifecycleReportLocale;
  },
): LifecycleReport {
  const t = TEXTS[options.locale];
  const { lifecycle } = source;
  const type = lifecycle.aggregateType as LifecycleAggregateType;
  const aggregateName = t.aggregates[type] ?? type;
  const state = (code: string | null) => (code === null ? t.creation : (t.states[type]?.[code] ?? code));
  const transition = (code: string) => t.transitions[type]?.[code] ?? code;
  const revisions = new Map((source.revisions ?? []).map((r) => [r.revision, r]));
  const rows = lifecycle.items.map((item, i) => {
    const when = displayInTimeZone(item.occurredAt, options.timeZone);
    const actor = `${t.actors[item.actor.type] ?? item.actor.type} ${item.actor.displayName ?? item.actor.id} (${item.origin})`;
    const revision =
      item.revisionTo === null
        ? ''
        : item.revisionFrom === null || item.revisionFrom === item.revisionTo
          ? String(item.revisionTo)
          : `${item.revisionFrom} -> ${item.revisionTo}`;
    const derived = item.derived ? t.yes : t.no;
    if (item.kind === 'ANNOTATION') {
      return [
        String(i + 1),
        t.annotation,
        item.changedFields.join(', '),
        when,
        actor,
        '',
        revision,
        '',
        derived,
      ];
    }
    const r = revisionOf(item, revisions);
    const amount = r
      ? `${r.amount.amount} ${r.amount.currency}${r.fee ? ` (${t.fee} ${r.fee.amount} ${r.fee.currency})` : ''}`
      : '';
    return [
      String(i + 1),
      transition(item.transition),
      `${state(item.fromState)} -> ${state(item.toState)}`,
      when,
      actor,
      item.reason ?? '',
      revision,
      amount,
      derived,
    ];
  });
  const element = `${aggregateName}${source.label ? ` "${source.label}"` : ''} (${lifecycle.aggregateId})`;
  return {
    locale: options.locale,
    title: `${t.title}: ${aggregateName}${source.label ? ` "${source.label}"` : ''}`,
    element,
    aggregateId: lifecycle.aggregateId,
    headerLines: [
      { label: t.element, value: element },
      {
        label: t.currentState,
        value:
          lifecycle.currentState === null
            ? '—'
            : `${state(lifecycle.currentState)} (${lifecycle.currentState})`,
      },
      {
        label: t.path,
        value: lifecycle.path.length > 0 ? lifecycle.path.map((s) => `${state(s)} (${s})`).join(' -> ') : '—',
      },
      { label: t.machine, value: `${type} v${lifecycle.machine.machineVersion}` },
      {
        label: t.generated,
        value: `${displayInTimeZone(options.generatedAt, options.timeZone)} (${options.timeZone})`,
      },
    ],
    incomplete: lifecycle.historyComplete ? null : t.incomplete,
    columns: [
      t.columns.n,
      t.columns.step,
      t.columns.fromTo,
      t.columns.when,
      t.columns.actor,
      t.columns.reason,
      t.columns.revision,
      t.columns.amount,
      t.columns.derived,
    ],
    rows,
    empty: t.empty,
    page: t.page,
    documentTitle: `${t.title} ${type} ${lifecycle.aggregateId}`,
  };
}
