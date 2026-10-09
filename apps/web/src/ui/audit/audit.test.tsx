import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { AuditLogView, EntryDetail, type AuditLogViewProps } from './AuditLogPage';
import {
  EMPTY_AUDIT_FILTERS,
  appendEntries,
  auditHref,
  canExport,
  canQuery,
  entityHref,
  exportPath,
  filterErrors,
  filtersFromParams,
  listPath,
  type AuditEntry,
} from './logic';

const f = esContext('AuditLog');
const h = esContext('AuditHistory');
const U1 = '0190a000-0000-7000-8000-000000000001';
const B1 = '0190a000-0000-7000-8000-0000000000b1';
const T1 = '0190a000-0000-7000-8000-0000000001f1';

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: '0190a000-0000-7000-8000-000000000a01',
  occurredAt: '2026-03-16T03:30:00.000Z',
  actor: { type: 'USER', userId: U1, process: null },
  action: 'transactions.transaction.updated',
  category: 'DATA',
  aggregateType: 'Transaction',
  aggregateId: T1,
  aggregateVersion: 2,
  changes: [
    { field: 'description', before: 'Compra', after: 'Compra mayor' },
    {
      field: 'amount',
      before: { amount: '45.90', currency: 'BOB' },
      after: { amount: '1234.50', currency: 'BOB' },
    },
  ],
  reason: null,
  correlationId: B1,
  origin: 'ui',
  ...over,
});

const base = (over: Partial<AuditLogViewProps> = {}): AuditLogViewProps => ({
  f,
  h,
  role: 'OWNER',
  currentUserId: U1,
  href: (path) => `/es${path}`,
  draft: EMPTY_AUDIT_FILTERS,
  errors: {},
  onDraft: () => undefined,
  onApply: () => undefined,
  onReset: () => undefined,
  onFilterBy: () => undefined,
  entries: [entry()],
  hasMore: false,
  loadingMore: false,
  onLoadMore: () => undefined,
  exportHref: '/api/bff/v1/workspaces/w1/audit-log/export?format=csv',
  problem: undefined,
  uiLocale: 'es',
  ...over,
});

describe('Auditoría global — lógica (FR-AUDIT-006)', () => {
  it('[TC-AUDIT-GLOBAL-001] arma la consulta con los filtros combinados y el cursor', () => {
    const q = listPath(
      {
        ...EMPTY_AUDIT_FILTERS,
        actorUserId: U1,
        aggregateType: 'Transaction',
        action: 'transactions.transaction.voided, transactions.transaction.updated',
        category: 'DATA',
        from: '2026-03-01',
        to: '2026-03-31',
      },
      'abc',
    );
    const params = new URLSearchParams(q.split('?')[1]);
    expect(q.startsWith('/audit-log?')).toBe(true);
    expect(params.get('actorUserId')).toBe(U1);
    expect(params.get('aggregateType')).toBe('Transaction');
    expect(params.get('action')).toBe('transactions.transaction.voided,transactions.transaction.updated');
    expect(params.get('category')).toBe('DATA');
    expect(params.get('from')).toBe('2026-03-01');
    expect(params.get('cursor')).toBe('abc');
    expect(params.get('limit')).toBe('50');
    // Sin filtros no se envía ninguno (categoría ALL no es un filtro).
    expect(listPath(EMPTY_AUDIT_FILTERS)).toBe('/audit-log?limit=50');
  });

  it('[TC-AUDIT-GLOBAL-003] la exportación usa los mismos filtros con format=csv', () => {
    const path = exportPath({ ...EMPTY_AUDIT_FILTERS, correlationId: B1, category: 'SECURITY' });
    const params = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/audit-log/export?')).toBe(true);
    expect(params.get('format')).toBe('csv');
    expect(params.get('correlationId')).toBe(B1);
    expect(params.get('category')).toBe('SECURITY');
  });

  it('[TC-AUDIT-GLOBAL-007] enlaces: la operación (correlación) y el elemento', () => {
    expect(auditHref({ correlationId: B1 })).toBe(`/configuracion/auditoria?correlationId=${B1}`);
    expect(auditHref({ aggregateType: 'Transaction', aggregateId: T1 })).toBe(
      `/configuracion/auditoria?aggregateType=Transaction&aggregateId=${T1}`,
    );
    expect(filtersFromParams({ correlationId: B1 }).correlationId).toBe(B1);
    expect(filtersFromParams({ category: 'SECURITY' }).category).toBe('SECURITY');
    expect(filtersFromParams({ category: 'otra' }).category).toBe('ALL');
    expect(entityHref('Transaction', T1)).toBe(`/transacciones/${T1}`);
    expect(entityHref('Workspace', T1)).toBeUndefined();
  });

  it('valida como la API: ids, formato de acción, entidad sin tipo y rangos', () => {
    expect(filterErrors(EMPTY_AUDIT_FILTERS)).toEqual({});
    expect(filterErrors({ ...EMPTY_AUDIT_FILTERS, actorUserId: 'x', correlationId: 'y' })).toEqual({
      actorUserId: 'uuid',
      correlationId: 'uuid',
    });
    expect(filterErrors({ ...EMPTY_AUDIT_FILTERS, aggregateId: T1 })).toEqual({ aggregateId: 'needsType' });
    expect(filterErrors({ ...EMPTY_AUDIT_FILTERS, action: 'NoEsAccion' })).toEqual({ action: 'action' });
    expect(filterErrors({ ...EMPTY_AUDIT_FILTERS, from: '2026-03-02', to: '2026-03-01' })).toEqual({
      to: 'order',
    });
    const long = { ...EMPTY_AUDIT_FILTERS, from: '2025-03-30', to: '2026-03-31' };
    expect(filterErrors(long)).toEqual({ to: 'range' });
    expect(filterErrors({ ...long, from: '2025-03-31' })).toEqual({}); // 366 días: el máximo
    expect(filterErrors({ ...long, correlationId: B1 })).toEqual({});
    expect(filterErrors({ ...long, aggregateType: 'Transaction', aggregateId: T1 })).toEqual({});
  });

  it('el export es solo del OWNER; la consulta, de OWNER y EDITOR (D105)', () => {
    expect([canQuery('OWNER'), canQuery('EDITOR'), canQuery('VIEWER')]).toEqual([true, true, false]);
    expect([canExport('OWNER'), canExport('EDITOR'), canExport('VIEWER')]).toEqual([true, false, false]);
  });

  it('une páginas sin repetir registros', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b' });
    expect(appendEntries([a], [a, b]).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('Auditoría global — pantalla', () => {
  it('[TC-AUDIT-GLOBAL-001] muestra filtros, registros con zona horaria del espacio y el diff al abrir el detalle', () => {
    const html = renderToStaticMarkup(<AuditLogView {...base()} />);
    const text = textOf(html);
    expect(text).toContain('Auditoría');
    for (const label of [
      'Tipo de evento',
      'Usuario (identificador)',
      'Acción',
      'Tipo de elemento',
      'Operación (identificador)',
      'Origen',
      'Desde',
      'Hasta',
      'Aplicar filtros',
    ]) {
      expect(text).toContain(label);
    }
    // 2026-03-16T03:30Z → 15 de marzo, 23:30 (11:30 p. m.) en America/La_Paz.
    expect(html).toContain('dateTime="2026-03-16T03:30:00.000Z"');
    expect(text).toMatch(/15 mar de 2026, 11:30:00/);
    expect(text).toContain('Transacción modificada');
    expect(text).toContain('Tú');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="audit-entries"');
  });

  it('el detalle muestra antes/después con montos por locale, y enlaces a la operación, al historial y al elemento', () => {
    const html = renderToStaticMarkup(<EntryDetail {...base()} entry={entry()} />);
    const text = textOf(html);
    expect(text).toContain('Descripción');
    expect(text).toContain('Compra mayor');
    expect(text).toContain('45,90 BOB');
    expect(text).toContain('1.234,50 BOB');
    expect(html).toContain(`href="/es/configuracion/auditoria?correlationId=${B1}"`);
    expect(html).toContain(
      `href="/es/configuracion/auditoria?aggregateType=Transaction&amp;aggregateId=${T1}"`,
    );
    expect(html).toContain(`href="/es/transacciones/${T1}"`);
  });

  it('[TC-AUDIT-GLOBAL-006] los eventos de seguridad llevan la etiqueta "Seguridad" (no solo color)', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...base({
          entries: [
            entry({
              id: 's1',
              action: 'security.authorization.denied',
              category: 'SECURITY',
              aggregateType: 'Workspace',
              changes: [{ field: 'operationId', before: null, after: 'createTransaction' }],
            }),
            entry({ id: 'd1' }),
          ],
        })}
      />,
    );
    expect(html.match(/data-testid="audit-chip-security"/g)).toHaveLength(1);
    expect(textOf(html)).toContain('Acceso denegado');
    // Los botones de categoría exponen su estado con aria-pressed.
    expect(html).toContain('aria-pressed="true"');
  });

  it('[TC-AUDIT-GLOBAL-003] el botón Exportar CSV es solo del OWNER; el EDITOR ve la nota', () => {
    const owner = renderToStaticMarkup(<AuditLogView {...base({ role: 'OWNER' })} />);
    expect(owner).toContain('data-testid="audit-export"');
    expect(owner).toContain('download');
    expect(owner).toContain('/api/bff/v1/workspaces/w1/audit-log/export?format=csv');
    const editor = renderToStaticMarkup(<AuditLogView {...base({ role: 'EDITOR' })} />);
    expect(editor).not.toContain('data-testid="audit-export"');
    expect(textOf(editor)).toContain('Solo el propietario del espacio puede exportar');
  });

  it('[TC-AUDIT-GLOBAL-002] un VIEWER no ve la auditoría', () => {
    const html = renderToStaticMarkup(<AuditLogView {...base({ role: 'VIEWER' })} />);
    expect(html).toContain('data-testid="audit-log-denied"');
    expect(html).not.toContain('data-testid="audit-filters"');
    expect(textOf(html)).toContain('Solo un propietario o un editor');
  });

  it('estados: cargando, vacío, cargar más y errores de filtro asociados al campo', () => {
    expect(renderToStaticMarkup(<AuditLogView {...base({ entries: undefined })} />)).toContain(
      'data-testid="audit-loading"',
    );
    expect(textOf(renderToStaticMarkup(<AuditLogView {...base({ entries: [] })} />))).toContain(
      'No hay registros que coincidan',
    );
    const more = renderToStaticMarkup(<AuditLogView {...base({ hasMore: true })} />);
    expect(more).toContain('data-testid="audit-more"');
    const bad = renderToStaticMarkup(
      <AuditLogView
        {...base({ draft: { ...EMPTY_AUDIT_FILTERS, actorUserId: 'x' }, errors: { actorUserId: 'uuid' } })}
      />,
    );
    expect(bad).toContain('aria-invalid="true"');
    expect(textOf(bad)).toContain('Escribe un identificador válido');
    // El envío y la exportación se bloquean mientras haya errores.
    expect(bad).toMatch(/data-testid="audit-apply"[^>]*disabled|disabled=""[^>]*data-testid="audit-apply"/);
    expect(bad).toContain('aria-disabled="true"');
  });
});
