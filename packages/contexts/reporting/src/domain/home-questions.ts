/** Las 9 preguntas del Home (docs/00 §6). */
export const HOME_QUESTIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const;
export type HomeQuestion = (typeof HOME_QUESTIONS)[number];

export interface HomeQuestionStatus {
  readonly question: HomeQuestion;
  readonly status: 'AVAILABLE' | 'NO_DATA' | 'NOT_AVAILABLE_IN_PHASE';
  /** Código de la acción sugerida (la UI lo traduce); `null` si la pregunta está disponible. */
  readonly actionHint: string | null;
}

/**
 * Preguntas que el Home aún no puede responder y la fase/acción que las habilita (docs/00 §6). Q4 y Q8 se habilitaron
 * en Phase 3 (`add-upcoming-payments`).
 */
const NOT_IN_PHASE: Readonly<Partial<Record<HomeQuestion, string>>> = {
  Q5: 'AVAILABLE_IN_PHASE_2',
  Q9: 'AVAILABLE_IN_PHASE_4',
};

/** Preguntas que responde la capability `reporting/cash-flow-calendar`: comprometido (Q4) y próximos pagos (Q8). */
const COMMITMENT_QUESTIONS: ReadonlySet<HomeQuestion> = new Set<HomeQuestion>(['Q4', 'Q8']);

/**
 * Disponibilidad de cada pregunta (FR-REPORTING-001, design.md decisión 6; add-upcoming-payments decisión 11): las no
 * habilitadas se declaran `NOT_AVAILABLE_IN_PHASE`; sin cuentas, las de dinero/flujo son `NO_DATA` con la acción de
 * crear una cuenta; Q4/Q8 sin definiciones recurrentes activas ni transacciones pendientes de egreso son `NO_DATA` con la
 * acción `CREATE_COMMITMENT`. La UI nunca rellena con 0 ni inventa un número.
 */
export function homeQuestions(input: {
  readonly hasAccounts: boolean;
  /** ≥ 1 definición recurrente activa o ≥ 1 transacción pendiente de egreso. */
  readonly hasCommitments: boolean;
}): HomeQuestionStatus[] {
  return HOME_QUESTIONS.map((question) => {
    const hint = NOT_IN_PHASE[question];
    if (hint) return { question, status: 'NOT_AVAILABLE_IN_PHASE', actionHint: hint };
    if (!input.hasAccounts) return { question, status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' };
    if (COMMITMENT_QUESTIONS.has(question) && !input.hasCommitments) {
      return { question, status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' };
    }
    return { question, status: 'AVAILABLE', actionHint: null };
  });
}
