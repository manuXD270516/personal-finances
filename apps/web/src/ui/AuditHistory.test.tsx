import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditHistoryView, formatDecimal, type AuditLogEntry } from './AuditHistory';

const messages = JSON.parse(
  readFileSync(new URL('../../messages/es.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const t = createTranslator({ locale: 'es', messages, namespace: 'AuditHistory' });
const U1 = '0190a000-0000-7000-8000-000000000001';
const W1 = '0190a000-0000-7000-8000-0000000000a1';

const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: '0190a000-0000-7000-8000-0000000000e1',
  occurredAt: '2026-03-16T03:30:00.000Z',
  actor: { type: 'USER', userId: U1, process: null },
  action: 'identity.workspace.settings_changed',
  aggregateType: 'Workspace',
  aggregateId: W1,
  aggregateVersion: 2,
  changes: [],
  reason: null,
  origin: 'ui',
  ...over,
});

const render = (entries: AuditLogEntry[]) =>
  renderToStaticMarkup(
    <AuditHistoryView
      entries={entries}
      locale="es-BO"
      timeZone="America/La_Paz"
      currentUserId={U1}
      t={(key, values) => t(key as never, values as never)}
      has={(key) => t.has(key as never)}
    />,
  );

describe('componente Historial (add-audit-trail, tarea 7.1)', () => {
  it('[TC-AUDIT-HISTORY-001] lista cronológica con actor, acción, instante en la zona del workspace y diff con montos es-BO', () => {
    const html = render([
      entry({
        id: '0190a000-0000-7000-8000-0000000000e1',
        action: 'identity.workspace.created',
        occurredAt: '2026-03-15T14:00:00.000Z',
        changes: [{ field: 'name', before: null, after: 'Bank C' }],
      }),
      entry({
        id: '0190a000-0000-7000-8000-0000000000e2',
        changes: [
          { field: 'name', before: 'Bank C', after: 'Bank C Sueldo' },
          {
            field: 'minimumLiquidityReserve',
            before: { amount: '500.00', currency: 'BOB' },
            after: { amount: '1500.00', currency: 'BOB' },
          },
        ],
      }),
      entry({
        id: '0190a000-0000-7000-8000-0000000000e3',
        actor: { type: 'SYSTEM', userId: null, process: 'ledger.system-accounts' },
        action: 'ledger.ledger_account.created',
        reason: 'Duplicada',
      }),
    ]);
    expect(html.indexOf('Espacio de trabajo creado')).toBeLessThan(html.indexOf('Configuración modificada'));
    expect(html).toContain('por ti');
    expect(html).toContain('por el proceso ledger.system-accounts');
    // Acción sin traducción: se muestra su identificador, nunca se rompe.
    expect(html).toContain('<strong>ledger.ledger_account.created</strong>');
    expect(html).toContain('Motivo: Duplicada');
    // 2026-03-16T03:30Z = 15/03/2026 23:30 (11:30 p. m. en es-BO) en La Paz.
    expect(html).toMatch(/15[^<]*mar[^<]*2026[^<]*11:30[^<]*p/i);
    expect(html).toContain('<th scope="row">Nombre</th><td>Bank C</td><td>Bank C Sueldo</td>');
    expect(html).toContain('1.500,00 BOB');
    expect(html).toContain('<td>—</td><td>Bank C</td>');
  });

  it('estructura accesible: sección rotulada por su título y tablas con encabezados de columna y fila', () => {
    const html = render([entry({ changes: [{ field: 'name', before: 'a', after: 'b' }] })]);
    expect(html).toContain('<section aria-labelledby="audit-history-title"');
    expect(html).toContain('<h2 id="audit-history-title">Historial de cambios</h2>');
    expect(html).toContain('<caption>Cambios de este registro</caption>');
    expect(html.match(/<th scope="col">/g)).toHaveLength(3);
    expect(render([])).toContain('Todavía no hay cambios registrados.');
  });

  it('los montos se formatean desde el string decimal sin pasar por number (escala intacta)', () => {
    expect(formatDecimal('12345678901234567890.123456789012345678', 'es-BO')).toBe(
      '12.345.678.901.234.567.890,123456789012345678',
    );
    expect(formatDecimal('-100.000000', 'en-US')).toBe('-100.000000');
    expect(formatDecimal('1500', 'pt-BR')).toBe('1.500');
  });
});
