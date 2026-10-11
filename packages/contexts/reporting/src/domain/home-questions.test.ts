import { describe, expect, it } from 'vitest';
import { homeQuestions } from './home-questions.js';

const byQuestion = (input: Parameters<typeof homeQuestions>[0]) =>
  Object.fromEntries(homeQuestions(input).map((q) => [q.question, q]));

describe('homeQuestions: Q4 y Q8 (add-upcoming-payments, decisión 11)', () => {
  it('[TC-REPORTING-UPCOMING-018] con cuentas y compromisos Q4 y Q8 están disponibles', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: true, hasGoals: true });
    expect(q['Q4']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
    expect(q['Q8']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
  });

  it('[TC-REPORTING-UPCOMING-018] con cuentas y sin compromisos ni pendientes: NO_DATA con CREATE_COMMITMENT', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: false, hasGoals: false });
    expect(q['Q4']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' });
    expect(q['Q8']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' });
    // El resto de las preguntas de dinero no cambia.
    expect(q['Q1']).toMatchObject({ status: 'AVAILABLE' });
  });

  it('[TC-REPORTING-UPCOMING-018] sin cuentas, Q4 y Q8 piden crear una cuenta primero', () => {
    const q = byQuestion({ hasAccounts: false, hasCommitments: false, hasGoals: false });
    expect(q['Q4']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' });
    expect(q['Q8']).toMatchObject({ status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' });
  });

  it('[TC-REPORTING-DASHBOARD-005] solo Q5 sigue sin estar disponible en esta fase, sin montos', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: true, hasGoals: true });
    expect(q['Q5']).toMatchObject({ status: 'NOT_AVAILABLE_IN_PHASE', actionHint: 'AVAILABLE_IN_PHASE_2' });
    expect(q['Q9']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
  });
});

describe('homeQuestions: Q9 (add-savings-goals)', () => {
  it('[TC-GOALS-SAVINGS-047] con cuentas y sin metas Q9 es NO_DATA con CREATE_GOAL y Q5 sigue no disponible', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: true, hasGoals: false });
    expect(q['Q9']).toEqual({ question: 'Q9', status: 'NO_DATA', actionHint: 'CREATE_GOAL' });
    expect(q['Q5']).toMatchObject({ status: 'NOT_AVAILABLE_IN_PHASE' });
  });

  it('[TC-GOALS-SAVINGS-047] con una meta activa, pausada o alcanzada Q9 está disponible', () => {
    const q = byQuestion({ hasAccounts: true, hasCommitments: false, hasGoals: true });
    expect(q['Q9']).toEqual({ question: 'Q9', status: 'AVAILABLE', actionHint: null });
  });
});
