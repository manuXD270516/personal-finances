import { describe, expect, it } from 'vitest';
import { homeQuestions } from './home-questions.js';

const byQuestion = (input: Parameters<typeof homeQuestions>[0]) =>
  Object.fromEntries(homeQuestions(input).map((q) => [q.question, q]));

describe('homeQuestions: Q4 y Q8 (add-upcoming-payments, decisión 11)', () => {
  it('[TC-REPORTING-UPCOMING-018] con cuentas y compromisos Q4 y Q8 están disponibles', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: true });
    expect(q['Q4']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
    expect(q['Q8']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
  });

  it('[TC-REPORTING-UPCOMING-018] con cuentas y sin compromisos ni pendientes: NO_DATA con CREATE_COMMITMENT', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: false });
    expect(q['Q4']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' });
    expect(q['Q8']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' });
    // El resto de las preguntas de dinero no cambia.
    expect(q['Q1']).toMatchObject({ status: 'AVAILABLE' });
  });

  it('[TC-REPORTING-UPCOMING-018] sin cuentas, Q4 y Q8 piden crear una cuenta primero', () => {
    const q = byQuestion({ hasAccounts: false, hasCommitments: false });
    expect(q['Q4']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' });
    expect(q['Q8']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' });
  });

  it('[TC-REPORTING-DASHBOARD-005] Q5 y Q9 siguen sin estar disponibles en esta fase, sin montos', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: true });
    expect(q['Q5']).toMatchObject({ status: 'NOT_AVAILABLE_IN_PHASE', actionHint: 'AVAILABLE_IN_PHASE_2' });
    expect(q['Q9']).toMatchObject({ status: 'NOT_AVAILABLE_IN_PHASE', actionHint: 'AVAILABLE_IN_PHASE_4' });
  });
});
