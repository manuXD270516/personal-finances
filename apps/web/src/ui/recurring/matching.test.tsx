import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { MatchSuggestionCard, MatchSuggestionList, matchButtonId } from './MatchSuggestionCard';
import {
  CONFIDENCE_PRESENTATION,
  buildMatchingPatch,
  forOccurrenceQuery,
  forTransactionQuery,
  isActionable,
  matchReasons,
  matchesBadge,
  proposedQuery,
  toleranceFormOf,
  toleranceSummary,
} from './matching-logic';
import { MATCH_CONFIDENCES, type MatchSuggestion } from './types';

const f = esContext('Recurring');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const names: Record<string, string> = { a1: 'Banco BOB', cp1: 'Tigo' };

function suggestion(over: Partial<MatchSuggestion> = {}): MatchSuggestion {
  return {
    id: '0198f0aa-0000-7000-8000-0000000000e1',
    occurrence: {
      id: '0198f0aa-0000-7000-8000-000000000001',
      definitionId: '0198f0aa-0000-7000-8000-0000000000d1',
      definitionName: 'Internet',
      kind: 'EXPENSE',
      status: 'DUE',
      dueDate: '2026-10-20',
      expected: { type: 'FIXED', amount: bob('199.00') },
      accountId: 'a1',
      toAccountId: null,
    },
    transaction: {
      id: '0198f0aa-0000-7000-8000-0000000000a1',
      kind: 'EXPENSE',
      status: 'POSTED',
      businessDate: '2026-10-19',
      amount: bob('199.00'),
      accountId: 'a1',
      toAccountId: null,
      counterpartyId: null,
      source: 'MANUAL',
    },
    score: '85.00',
    confidence: 'HIGH',
    reasons: { amountDelta: bob('0.00'), dateDeltaDays: 1, counterparty: 'UNKNOWN' },
    ambiguous: false,
    status: 'PROPOSED',
    expireReason: null,
    createdAt: '2026-10-19T16:00:00Z',
    version: 1,
    ...over,
  };
}

const render = (s: MatchSuggestion, over: Partial<Parameters<typeof MatchSuggestionCard>[0]> = {}): string =>
  renderToStaticMarkup(
    <ul>
      <MatchSuggestionCard
        suggestion={s}
        f={f}
        canEdit
        accountName={(id) => names[id]}
        counterpartyName={(id) => names[id]}
        href={(path) => `/es/w1${path}`}
        context="tray"
        onConfirm={() => undefined}
        onDismiss={() => undefined}
        {...over}
      />
    </ul>,
  );

describe('Tarjeta de coincidencia sugerida (FR-COMMITMENTS-010; docs/28 §4.8)', () => {
  it('[TC-COMMITMENTS-MATCH-001] muestra el pago, la transacción, la confianza en texto y los motivos explicados', () => {
    const html = render(suggestion());
    const text = textOf(html);
    expect(text).toContain('Internet');
    expect(text).toContain('Confianza alta (85,00 de 100)');
    expect(text).toContain('Transacción del 19/10/2026: 199,00 BOB en Banco BOB (registrada a mano)');
    expect(text).toContain('Pago esperado: 199,00 BOB el 20/10/2026 en Banco BOB');
    expect(text).toContain('Mismo monto');
    expect(text).toContain('1 día de diferencia con el vencimiento');
    expect(text).toContain('Contraparte sin indicar');
    expect(html).toContain('data-confidence="HIGH"');
    expect(html).toContain('data-ambiguous="false"');
    expect(html).not.toContain('data-testid="match-ambiguous"');
  });

  it('[TC-COMMITMENTS-MATCH-005] una importada de confianza alta sigue siendo una sugerencia: hay que confirmarla', () => {
    const html = render(
      suggestion({
        score: '100.00',
        transaction: { ...suggestion().transaction!, source: 'IMPORT', counterpartyId: 'cp1' },
        reasons: { amountDelta: bob('0.00'), dateDeltaDays: 0, counterparty: 'MATCH' },
      }),
    );
    const text = textOf(html);
    expect(text).toContain('Confianza alta (100,00 de 100)');
    expect(text).toContain('(importada)');
    expect(text).toContain('contraparte Tigo');
    expect(text).toContain('Misma contraparte');
    expect(text).toContain('El mismo día del vencimiento');
    expect(html).toContain('data-action="confirm"');
  });

  it('muestra las de confianza baja y media con su confianza en texto (D132)', () => {
    const low = textOf(render(suggestion({ score: '42.50', confidence: 'LOW' })));
    expect(low).toContain('Confianza baja (42,50 de 100)');
    const medium = textOf(render(suggestion({ score: '62.13', confidence: 'MEDIUM' })));
    expect(medium).toContain('Confianza media (62,13 de 100)');
    for (const c of MATCH_CONFIDENCES) {
      // texto + icono decorativo: el color nunca es la única señal (NFR-USAB-104)
      expect(CONFIDENCE_PRESENTATION[c].icon.length).toBeGreaterThan(0);
      expect(render(suggestion({ confidence: c }))).toContain('aria-hidden="true"');
    }
  });

  it('una ambigua lleva la marca y la nota explicativa', () => {
    const html = render(suggestion({ ambiguous: true }));
    expect(html).toContain('data-testid="match-ambiguous"');
    expect(html).toContain('data-ambiguous="true"');
    expect(textOf(html)).toContain('Ambigua: hay otra coincidencia con el mismo puntaje');
  });

  it('[TC-COMMITMENTS-MATCH-015] Confirmar y Descartar son botones nativos con nombre accesible, solo para un EDITOR/OWNER', () => {
    const s = suggestion();
    const html = render(s);
    expect(html).toContain(`id="${matchButtonId(s.id, 'confirm')}"`);
    expect(html).toContain(`id="${matchButtonId(s.id, 'dismiss')}"`);
    expect(html).toContain('aria-label="Confirmar la coincidencia con Internet del 20/10/2026"');
    expect(html).toContain('aria-label="Descartar la coincidencia con Internet del 20/10/2026"');
    expect(html).toMatch(/<button type="button"[^>]*data-action="confirm"/);
    // VIEWER: ve la sugerencia pero no las acciones
    const viewer = render(s, { canEdit: false });
    expect(viewer).not.toContain('data-action="confirm"');
    expect(viewer).not.toContain('data-action="dismiss"');
    expect(textOf(viewer)).toContain('Confianza alta');
    // una ya decidida tampoco las ofrece
    expect(render(suggestion({ status: 'DISMISSED' }))).not.toContain('data-action="confirm"');
    expect(isActionable(suggestion(), true)).toBe(true);
    expect(isActionable(suggestion(), false)).toBe(false);
    expect(isActionable(suggestion({ status: 'EXPIRED' }), true)).toBe(false);
  });

  it('el botón se deshabilita mientras se procesa y enlaza con la ocurrencia y la transacción', () => {
    const html = render(suggestion(), { busy: true });
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-action="confirm"|<button[^>]*data-action="confirm"[^>]*disabled=""/,
    );
    expect(html).toContain('href="/es/w1/recurring/occurrences/0198f0aa-0000-7000-8000-000000000001"');
    expect(html).toContain('href="/es/w1/transacciones/0198f0aa-0000-7000-8000-0000000000a1"');
  });

  it('en el detalle de la transacción dice "Esto parece el pago de Internet (20/10/2026)"', () => {
    const text = textOf(render(suggestion(), { context: 'transaction' }));
    expect(text).toContain('Esto parece el pago de Internet (20/10/2026)');
    expect(text).toContain('Se esperaba 199,00 BOB en Banco BOB.');
    // en este contexto la transacción es la pantalla: solo se enlaza la ocurrencia
    const html = render(suggestion(), { context: 'transaction' });
    expect(html).toContain('data-testid="match-occurrence-link"');
    expect(html).not.toContain('data-testid="match-transaction-link"');
  });

  it('en el detalle de la ocurrencia dice con qué transacción parece pagada', () => {
    const html = render(suggestion(), { context: 'occurrence' });
    expect(textOf(html)).toContain('Parece pagado con la transacción del 19/10/2026 (199,00 BOB)');
    expect(html).toContain('data-testid="match-transaction-link"');
    expect(html).not.toContain('data-testid="match-occurrence-link"');
  });

  it('una lista vacía muestra el texto vacío y la lista conserva su nombre accesible', () => {
    const empty = renderToStaticMarkup(
      <MatchSuggestionList suggestions={[]} caption="Coincidencias" empty="No hay coincidencias por revisar.">
        {() => null}
      </MatchSuggestionList>,
    );
    expect(textOf(empty)).toBe('No hay coincidencias por revisar.');
    const html = renderToStaticMarkup(
      <MatchSuggestionList
        suggestions={[suggestion(), suggestion({ id: '0198f0aa-0000-7000-8000-0000000000e2' })]}
        caption="Coincidencias sugeridas"
        empty=""
      >
        {(s) => (
          <MatchSuggestionCard
            suggestion={s}
            f={f}
            canEdit={false}
            accountName={(id) => names[id]}
            href={(p) => p}
            context="tray"
          />
        )}
      </MatchSuggestionList>,
    );
    expect(html).toContain('aria-label="Coincidencias sugeridas"');
    // <ul> contiene solo <li>
    expect(
      html.match(/<ul[^>]*aria-label="Coincidencias sugeridas"[^>]*>(<li[\s\S]*?<\/li>)+<\/ul>/),
    ).not.toBeNull();
    expect(html.match(/data-testid="match-suggestion"/g)).toHaveLength(2);
  });
});

describe('Motivos, consultas y contador', () => {
  it('matchReasons explica monto, fecha y contraparte', () => {
    expect(matchReasons(suggestion(), f)).toEqual([
      'Mismo monto',
      '1 día de diferencia con el vencimiento',
      'Contraparte sin indicar',
    ]);
    expect(
      matchReasons(
        suggestion({ reasons: { amountDelta: bob('13.40'), dateDeltaDays: 2, counterparty: 'MATCH' } }),
        f,
      ),
    ).toEqual([
      'Monto distinto en 13,40 BOB',
      '2 días de diferencia con el vencimiento',
      'Misma contraparte',
    ]);
    expect(
      matchReasons(
        suggestion({ reasons: { amountDelta: null, dateDeltaDays: 0, counterparty: 'MATCH' } }),
        f,
      ),
    ).toEqual([
      'Monto variable: se compara solo la contraparte',
      'El mismo día del vencimiento',
      'Misma contraparte',
    ]);
  });

  it('consultas y tope visual del contador', () => {
    expect(proposedQuery()).toBe('status=PROPOSED&limit=100');
    expect(forTransactionQuery('t 1')).toBe('status=PROPOSED&transactionId=t%201&limit=20');
    expect(forOccurrenceQuery('o1')).toBe('status=PROPOSED&occurrenceId=o1&limit=20');
    expect(matchesBadge(3)).toBe('3');
    expect(matchesBadge(100)).toBe('99+');
  });
});

describe('Tolerancias de la definición (SetMatchingTolerances)', () => {
  const LOCALE = 'es-BO';

  it('[TC-COMMITMENTS-MATCH-004] vacío ⇒ valor por omisión (null); solo viaja lo que cambió', () => {
    const none = { amountTolerancePercent: null, dateWindowDays: null };
    expect(buildMatchingPatch({ percent: '', days: '' }, none, LOCALE)).toEqual({ ok: true, patch: null });
    expect(buildMatchingPatch({ percent: '5', days: '2' }, none, LOCALE)).toEqual({
      ok: true,
      patch: { amountTolerancePercent: '5', dateWindowDays: 2 },
    });
    expect(buildMatchingPatch({ percent: '5,5', days: '' }, none, LOCALE)).toEqual({
      ok: true,
      patch: { amountTolerancePercent: '5.5' },
    });
    const current = { amountTolerancePercent: '5.00', dateWindowDays: 2 };
    expect(buildMatchingPatch({ percent: '5', days: '2' }, current, LOCALE)).toEqual({
      ok: true,
      patch: null,
    });
    expect(buildMatchingPatch({ percent: '', days: '2' }, current, LOCALE)).toEqual({
      ok: true,
      patch: { amountTolerancePercent: null },
    });
    expect(buildMatchingPatch({ percent: '5', days: '' }, current, LOCALE)).toEqual({
      ok: true,
      patch: { dateWindowDays: null },
    });
  });

  it('rechaza porcentajes fuera de 0..100 o con más de 2 decimales y ventanas fuera de 0..15', () => {
    const none = { amountTolerancePercent: null, dateWindowDays: null };
    for (const bad of ['101', '-1', 'abc', '1,234', '1.000,5']) {
      const r = buildMatchingPatch({ percent: bad, days: '' }, none, LOCALE);
      expect(r, bad).toEqual({ ok: false, errors: { percent: 'TOLERANCE_PERCENT' } });
    }
    for (const bad of ['16', '-1', '1.5', 'x']) {
      const r = buildMatchingPatch({ percent: '', days: bad }, none, LOCALE);
      expect(r, bad).toEqual({ ok: false, errors: { days: 'TOLERANCE_DAYS' } });
    }
    expect(buildMatchingPatch({ percent: '100', days: '15' }, none, LOCALE)).toEqual({
      ok: true,
      patch: { amountTolerancePercent: '100', dateWindowDays: 15 },
    });
    expect(buildMatchingPatch({ percent: '0', days: '0' }, none, LOCALE)).toEqual({
      ok: true,
      patch: { amountTolerancePercent: '0', dateWindowDays: 0 },
    });
  });

  it('el formulario parte de lo guardado y el resumen distingue el valor por omisión del configurado', () => {
    expect(toleranceFormOf({ matching: { amountTolerancePercent: '5.00', dateWindowDays: 0 } })).toEqual({
      percent: '5.00',
      days: '0',
    });
    expect(toleranceFormOf({})).toEqual({ percent: '', days: '' });
    expect(toleranceSummary(undefined, 'FIXED', f)).toBe('±2 % de monto y ±5 días (por omisión)');
    expect(toleranceSummary({ amountTolerancePercent: null, dateWindowDays: null }, 'ESTIMATED', f)).toBe(
      '±25 % de monto y ±5 días (por omisión)',
    );
    expect(toleranceSummary({ amountTolerancePercent: null, dateWindowDays: null }, 'MIN_MAX', f)).toBe(
      '±5 % de monto y ±5 días (por omisión)',
    );
    expect(toleranceSummary({ amountTolerancePercent: '7.50', dateWindowDays: 2 }, 'FIXED', f)).toBe(
      '±7,50 % de monto y ±2 días (configurada)',
    );
    expect(toleranceSummary(undefined, 'VARIABLE', f)).toBe(
      'Monto variable: misma contraparte y ±5 días (por omisión)',
    );
  });
});
