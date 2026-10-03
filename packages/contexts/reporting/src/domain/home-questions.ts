/** Las 9 preguntas del Home (docs/00 §6). */
export const HOME_QUESTIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const;
export type HomeQuestion = (typeof HOME_QUESTIONS)[number];

export interface HomeQuestionStatus {
  readonly question: HomeQuestion;
  readonly status: 'AVAILABLE' | 'NO_DATA' | 'NOT_AVAILABLE_IN_PHASE';
  /** Código de la acción sugerida (la UI lo traduce); `null` si la pregunta está disponible. */
  readonly actionHint: string | null;
}

/** Preguntas que Phase 1 aún no puede responder y la fase/acción que las habilita (docs/00 §6). */
const NOT_IN_PHASE: Readonly<Partial<Record<HomeQuestion, string>>> = {
  Q4: 'AVAILABLE_IN_PHASE_3',
  Q5: 'AVAILABLE_IN_PHASE_2',
  Q8: 'AVAILABLE_IN_PHASE_3',
  Q9: 'AVAILABLE_IN_PHASE_4',
};

/**
 * Disponibilidad de cada pregunta (FR-REPORTING-001, design.md decisión 6): las no habilitadas en Phase 1 se declaran
 * `NOT_AVAILABLE_IN_PHASE`; sin cuentas, las de dinero/flujo son `NO_DATA` con la acción de crear una cuenta. La UI
 * nunca rellena con 0 ni inventa un número.
 */
export function homeQuestions(input: { readonly hasAccounts: boolean }): HomeQuestionStatus[] {
  return HOME_QUESTIONS.map((question) => {
    const hint = NOT_IN_PHASE[question];
    if (hint) return { question, status: 'NOT_AVAILABLE_IN_PHASE', actionHint: hint };
    if (!input.hasAccounts) return { question, status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' };
    return { question, status: 'AVAILABLE', actionHint: null };
  });
}
