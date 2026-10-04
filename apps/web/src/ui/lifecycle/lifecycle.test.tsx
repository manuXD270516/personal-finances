import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { tabTarget } from '../common/Tabs';
import { esContext, textOf } from '../test-support';
import { LifecycleReport } from './LifecycleReport';
import { buildDiagramModel, edgeId, layoutFor, timelineRows } from './logic';
import { ACCOUNT, ACCOUNT_MACHINE, E1, E2, E3, EXPENSE, NO_JE, step, TX_MACHINE, U_ME } from './fixtures';
import type { Lifecycle, TransactionLifecycle } from './types';

const f = esContext('Lifecycle');
const tx = esContext('Transactions');
const acc = esContext('Accounts');
const txState = (code: string) => (tx.has(`status.${code}`) ? tx.t(`status.${code}`) : code);
const accState = (code: string) => (acc.has(`status.${code}`) ? acc.t(`status.${code}`) : code);
const field = (name: string) => (tx.has(`history.fields.${name}`) ? tx.t(`history.fields.${name}`) : name);

const render = (lifecycle: Lifecycle | TransactionLifecycle, stateLabel = txState) =>
  renderToStaticMarkup(
    <LifecycleReport
      lifecycle={lifecycle}
      f={f}
      stateLabel={stateLabel}
      fieldLabel={field}
      currentUserId={U_ME}
      idPrefix="tx-lifecycle"
      accountName={(id) => (id === ACCOUNT ? 'Bank A' : undefined)}
    />,
  );

const attr = (html: string, testId: string, code: string, name: string): string | undefined => {
  const tag = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*data-code="${code}"[^>]*>`))?.[0];
  return tag?.match(new RegExp(`${name}="([^"]*)"`))?.[1];
};

describe('recorrido: modelo del diagrama (add-lifecycle-timeline 6.1)', () => {
  it('[TC-AUDIT-LIFECYCLE-013] numera solo las transiciones (registrar es la entrada): postear 1, revisar 2 (bucle), anular 3', () => {
    const model = buildDiagramModel(EXPENSE);
    const order = (id: string) => model.edges.find((e) => e.id === id)?.order;
    expect(order(edgeId('RECORD', null, 'PENDING'))).toEqual([]);
    expect(model.edges.find((e) => e.id === edgeId('RECORD', null, 'PENDING'))?.traversed).toBe(true);
    expect(order(edgeId('POST', 'PENDING', 'POSTED'))).toEqual([1]);
    expect(order(edgeId('REVISE', 'POSTED', 'POSTED'))).toEqual([2]);
    expect(order(edgeId('VOID', 'POSTED', 'VOIDED'))).toEqual([3]);
    expect(model.orderBySequence.get(1)).toBeUndefined();
    expect([...model.orderBySequence.entries()]).toEqual([
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
  });

  it('[TC-AUDIT-LIFECYCLE-013] destaca pending, posted y void, con void como actual; cleared y reconciled atenuados', () => {
    const model = buildDiagramModel(EXPENSE);
    const node = (code: string) => model.nodes.find((n) => n.code === code)!;
    expect(['PENDING', 'POSTED', 'VOIDED'].map((c) => node(c).visited)).toEqual([true, true, true]);
    expect(['CLEARED', 'RECONCILED'].map((c) => node(c).visited)).toEqual([false, false]);
    expect(model.nodes.filter((n) => n.current).map((n) => n.code)).toEqual(['VOIDED']);
    expect(node('VOIDED').terminal).toBe(true);
    const traversed = model.edges.filter((e) => e.traversed).map((e) => e.id);
    expect(traversed).toEqual([
      edgeId('RECORD', null, 'PENDING'),
      edgeId('POST', 'PENDING', 'POSTED'),
      edgeId('REVISE', 'POSTED', 'POSTED'),
      edgeId('VOID', 'POSTED', 'VOIDED'),
    ]);
    // Una arista por par origen → destino declarado en la máquina (RECORD ×3, REVISE ×2, VOID ×3…).
    expect(model.edges).toHaveLength(3 + 1 + 1 + 1 + 1 + 1 + 2 + 3);
  });

  it('[TC-AUDIT-LIFECYCLE-013] una arista recorrida dos veces lleva ambos números (confirmar 1 y 3)', () => {
    const model = buildDiagramModel({
      ...EXPENSE,
      currentState: 'CLEARED',
      path: ['POSTED', 'CLEARED', 'POSTED', 'CLEARED'],
      items: [
        step({ sequence: 1, toState: 'POSTED' }),
        step({ sequence: 2, transition: 'CLEAR', fromState: 'POSTED', toState: 'CLEARED' }),
        step({ sequence: 3, transition: 'UNCLEAR', fromState: 'CLEARED', toState: 'POSTED' }),
        step({ sequence: 4, transition: 'CLEAR', fromState: 'POSTED', toState: 'CLEARED' }),
      ],
    });
    expect(model.edges.find((e) => e.id === edgeId('CLEAR', 'POSTED', 'CLEARED'))?.order).toEqual([1, 3]);
    expect(model.edges.find((e) => e.id === edgeId('UNCLEAR', 'CLEARED', 'POSTED'))?.order).toEqual([2]);
    expect(model.nodes.find((n) => n.code === 'PENDING')?.visited).toBe(false);
  });

  it('[TC-AUDIT-LIFECYCLE-013] layout fijo por máquina: columnas del flujo principal con anulada a la derecha; vertical en móvil', () => {
    const h = layoutFor(TX_MACHINE, 'horizontal');
    const x = (code: string) => h.nodes.find((n) => n.code === code)!.x;
    const y = (code: string) => h.nodes.find((n) => n.code === code)!.y;
    expect(x('PENDING')).toBeLessThan(x('POSTED'));
    expect(x('POSTED')).toBeLessThan(x('CLEARED'));
    expect(x('CLEARED')).toBeLessThan(x('RECONCILED'));
    expect(x('RECONCILED')).toBeLessThan(x('VOIDED'));
    expect(new Set(['PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOIDED'].map(y)).size).toBe(1);
    // Determinista: el mismo layout en cada render.
    expect(layoutFor(TX_MACHINE, 'horizontal')).toEqual(h);

    const v = layoutFor(TX_MACHINE, 'vertical');
    const vy = (code: string) => v.nodes.find((n) => n.code === code)!.y;
    expect(vy('PENDING')).toBeLessThan(vy('POSTED'));
    expect(vy('RECONCILED')).toBeLessThan(vy('VOIDED'));
    expect(new Set(v.nodes.map((n) => n.x)).size).toBe(1);
    const [, , vw] = v.viewBox;
    const [, , hw] = h.viewBox;
    expect(vw).toBeLessThan(hw);

    const loop = h.edges.find((e) => e.id === edgeId('REVISE', 'POSTED', 'POSTED'))!;
    expect(loop.loop).toBe(true);

    const a = layoutFor(ACCOUNT_MACHINE, 'horizontal');
    const ax = (code: string) => a.nodes.find((n) => n.code === code)!.x;
    expect(ax('ACTIVE')).toBeLessThan(ax('CLOSED'));
    expect(ax('CLOSED')).toBeLessThan(ax('ARCHIVED'));
    expect(a.edges).toHaveLength(6);
  });

  it('[TC-AUDIT-LIFECYCLE-013] filas de la línea de tiempo: orden, actor ("Tú" para la sesión) y revisión', () => {
    const rows = timelineRows(EXPENSE, U_ME);
    expect(rows.map((r) => [r.sequence, r.order, r.transition, r.from, r.to])).toEqual([
      [1, null, 'RECORD', null, 'PENDING'],
      [2, 1, 'POST', 'PENDING', 'POSTED'],
      [3, 2, 'REVISE', 'POSTED', 'POSTED'],
      [4, 3, 'VOID', 'POSTED', 'VOIDED'],
    ]);
    expect(rows.map((r) => r.actor.kind)).toEqual(['you', 'you', 'user', 'you']);
    expect(rows[2]?.actor.value).toBe('000000b2');
  });
});

describe('recorrido: reporte visual y línea de tiempo (add-lifecycle-timeline 6.1, 6.2)', () => {
  it('[TC-AUDIT-LIFECYCLE-013] el SVG es role="img" con nombre y aria-describedby a la línea de tiempo', () => {
    const html = render(EXPENSE);
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg).toContain('role="img"');
      expect(svg).toContain('aria-describedby="tx-lifecycle-timeline"');
      expect(svg).toMatch(/aria-label="Diagrama de estados: [^"]+"/);
    }
    expect(svgs[0]).toContain('data-orientation="horizontal"');
    expect(svgs[1]).toContain('data-orientation="vertical"');
    expect(html).toContain('<ol id="tx-lifecycle-timeline"');
    expect(html).toContain(
      'aria-label="Diagrama de estados: estado actual Anulada. Camino: Pendiente → Contabilizada → Contabilizada → Anulada."',
    );
    // Bajo 768 px se muestra la orientación vertical.
    expect(html).toContain('@media (max-width: 767.98px)');
  });

  it('[TC-AUDIT-LIFECYCLE-013] nodos y aristas con atributos de estado: visitados, actual, atenuados y numeración', () => {
    const html = render(EXPENSE);
    expect(attr(html, 'lifecycle-node', 'PENDING', 'data-visited')).toBe('true');
    expect(attr(html, 'lifecycle-node', 'POSTED', 'data-visited')).toBe('true');
    expect(attr(html, 'lifecycle-node', 'VOIDED', 'data-current')).toBe('true');
    expect(attr(html, 'lifecycle-node', 'CLEARED', 'data-visited')).toBe('false');
    expect(attr(html, 'lifecycle-node', 'RECONCILED', 'data-visited')).toBe('false');
    expect(attr(html, 'lifecycle-edge', 'POST', 'data-order')).toBe('1');
    expect(html).toMatch(
      /data-testid="lifecycle-edge" data-code="REVISE" data-from="POSTED" data-to="POSTED" data-traversed="true" data-order="2"/,
    );
    expect(html).toMatch(
      /data-testid="lifecycle-edge" data-code="REVISE" data-from="CLEARED" data-to="POSTED" data-traversed="false" data-order=""/,
    );
    expect(html).toMatch(
      /data-testid="lifecycle-edge" data-code="VOID" data-from="POSTED" data-to="VOIDED" data-traversed="true" data-order="3"/,
    );
    expect(html).toMatch(
      /data-testid="lifecycle-edge" data-code="RECORD" data-from="" data-to="PENDING" data-traversed="true" data-order=""/,
    );
    expect(textOf(html)).toContain('(actual)');
  });

  it('[TC-AUDIT-LIFECYCLE-013] la línea de tiempo lista registrar, contabilizar, revisar y anular con actor, hora de La Paz y enlace a la revisión 2', () => {
    const html = render(EXPENSE);
    const entries = html.match(/<li data-testid="lifecycle-entry"[\s\S]*?<\/li>/g) ?? [];
    expect(entries).toHaveLength(4);
    const [record, post, revise, voided] = entries.map(textOf) as [string, string, string, string];
    expect(record).toContain('Registrar');
    expect(record).toContain('— → Pendiente');
    expect(record).toContain('Revisión 1 · 80,00 BOB');
    expect(record).not.toMatch(/^\d/);
    expect(post).toMatch(/^1\. Contabilizar/);
    expect(post).toContain('Pendiente → Contabilizada');
    expect(post).toContain('Tú');
    expect(post).toMatch(/12 mar de 2026, 10:05/);
    expect(revise).toMatch(/^2\. Revisar/);
    expect(revise).toContain('Contabilizada → Contabilizada');
    expect(revise).toContain('Revisión 1 → 2 · 80,00 BOB → 85,00 BOB');
    expect(revise).toContain('Usuario …000000b2');
    expect(revise).toContain(`Asiento revertido: ${E1}`);
    expect(revise).toContain(`Asiento de reversa: ${E2}`);
    expect(revise).toContain(`Asiento nuevo: ${E3}`);
    expect(entries[2]).toContain('href="#tx-lifecycle-revision-2"');
    expect(revise).toContain('ver revisión 2');
    expect(entries[2]).toMatch(/<details[^>]*data-testid="lifecycle-journal"/);
    expect(voided).toMatch(/^3\. Anular/);
    expect(voided).toContain('Motivo: duplicado');
    // 02:30 UTC del 13 = 22:30 del 12 en America/La_Paz.
    expect(voided).toMatch(/12 mar de 2026, 10:30/);
    expect(entries[3]).toContain('data-from="POSTED" data-to="VOIDED"');
    // Revisiones enlazadas (montos por revisión, con sus movimientos por cuenta).
    expect(html).toContain('id="tx-lifecycle-revision-2"');
    const rev2 = html.match(/<li id="tx-lifecycle-revision-2"[\s\S]*?<\/li>/)?.[0] ?? '';
    expect(textOf(rev2)).toContain('Revisión 2');
    expect(textOf(rev2)).toContain('85,00 BOB');
    expect(textOf(rev2)).toContain('Bank A');
    expect(html).not.toContain('data-testid="lifecycle-incomplete"');
  });

  it('[TC-AUDIT-LIFECYCLE-011] historia previa incompleta: aviso, chip "derivada" y estado inicial sin evidencia', () => {
    const html = render({
      ...EXPENSE,
      historyComplete: false,
      currentState: 'VOIDED',
      path: ['VOIDED'],
      items: [
        step({
          sequence: 1,
          transition: 'VOID',
          fromState: 'POSTED',
          toState: 'VOIDED',
          derived: true,
          reason: 'cargo repetido',
        }),
      ],
      revisions: [],
    });
    expect(html).toContain('data-testid="lifecycle-incomplete"');
    expect(textOf(html)).toContain('Historia previa incompleta');
    const entry = textOf(html.match(/<li data-testid="lifecycle-entry"[\s\S]*?<\/li>/)?.[0] ?? '');
    expect(entry).toContain('derivada');
    expect(entry).toMatch(/^1\. Anular/);
    expect(attr(html, 'lifecycle-node', 'POSTED', 'data-visited')).toBe('true');
  });

  it('[TC-AUDIT-LIFECYCLE-004] las anotaciones se muestran como cambio descriptivo, sin número ni cambio de estado', () => {
    const html = render({
      ...EXPENSE,
      items: [
        EXPENSE.items[0]!,
        {
          sequence: 2,
          kind: 'ANNOTATION',
          occurredAt: '2026-03-12T15:00:00.000Z',
          actor: { type: 'USER', id: U_ME, displayName: null },
          origin: 'ui',
          changedFields: ['description', 'notes'],
          revisionFrom: 1,
          revisionTo: 1,
          aggregateVersion: 2,
          events: [],
          auditLogId: null,
          derived: false,
        },
      ],
      currentState: 'PENDING',
      path: ['PENDING'],
    });
    const entries = html.match(/<li data-testid="lifecycle-entry"[\s\S]*?<\/li>/g) ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[1]).toContain('data-kind="ANNOTATION"');
    expect(textOf(entries[1]!)).toContain('Cambio descriptivo: Descripción, Notas');
  });

  it('[TC-AUDIT-LIFECYCLE-013] recorrido de una cuenta: abrir (entrada), archivar 1 y reactivar 2, con activa como actual', () => {
    const html = render(
      {
        aggregateType: 'Account',
        aggregateId: ACCOUNT,
        currentState: 'ACTIVE',
        path: ['ACTIVE', 'ARCHIVED', 'ACTIVE'],
        historyComplete: true,
        machine: ACCOUNT_MACHINE,
        items: [
          step({
            sequence: 1,
            transition: 'OPEN',
            toState: 'ACTIVE',
            journalEntries: { ...NO_JE, posted: E1 },
          }),
          step({ sequence: 2, transition: 'ARCHIVE', fromState: 'ACTIVE', toState: 'ARCHIVED' }),
          step({ sequence: 3, transition: 'REACTIVATE', fromState: 'ARCHIVED', toState: 'ACTIVE' }),
        ],
      },
      accState,
    );
    expect(attr(html, 'lifecycle-node', 'ACTIVE', 'data-current')).toBe('true');
    expect(attr(html, 'lifecycle-node', 'CLOSED', 'data-visited')).toBe('false');
    expect(html).toMatch(
      /data-code="ARCHIVE" data-from="ACTIVE" data-to="ARCHIVED" data-traversed="true" data-order="1"/,
    );
    expect(html).toMatch(
      /data-code="REACTIVATE" data-from="ARCHIVED" data-to="ACTIVE" data-traversed="true" data-order="2"/,
    );
    const entries = (html.match(/<li data-testid="lifecycle-entry"[\s\S]*?<\/li>/g) ?? []).map(textOf);
    expect(entries[0]).toContain('Abrir');
    expect(entries[0]).toContain('— → Activa');
    expect(entries[0]).toContain(`Asiento nuevo: ${E1}`);
    expect(entries[1]).toMatch(/^1\. Archivar/);
    expect(entries[2]).toMatch(/^2\. Reactivar/);
    expect(html).not.toContain('lifecycle-revisions');
  });
});

describe('pestañas accesibles (patrón WAI-ARIA tabs)', () => {
  it('flechas, Inicio y Fin mueven la pestaña activa (con vuelta al principio)', () => {
    expect(tabTarget('ArrowRight', 0, 3)).toBe(1);
    expect(tabTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(tabTarget('Home', 2, 3)).toBe(0);
    expect(tabTarget('End', 0, 3)).toBe(2);
    expect(tabTarget('Enter', 1, 3)).toBeNull();
  });
});
