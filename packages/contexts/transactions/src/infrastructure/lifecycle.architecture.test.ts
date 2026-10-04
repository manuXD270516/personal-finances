import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Test de arquitectura (add-lifecycle-timeline decisión 1): todo cambio de `status` del agregado `Transaction` pasa por
// la máquina declarada (`this.mark(...)` ⇒ `TRANSACTION_LIFECYCLE.transition`), y los servicios que mutan
// transacciones registran el recorrido con `LifecyclePort` en lugar de `AuditPort.append` directo.
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Cuerpos de los métodos de clase (desde su firma hasta el cierre con dos espacios de sangría). */
function methods(source: string): { readonly name: string; readonly body: string }[] {
  const lines = source.slice(source.indexOf('export class Transaction {')).split('\n');
  const out: { name: string; body: string }[] = [];
  let current: { name: string; start: number } | null = null;
  lines.forEach((line, i) => {
    const sig = /^ {2}(?:static |private |get )?([A-Za-z]\w*)\(/.exec(line);
    if (sig && !current) current = { name: sig[1] as string, start: i };
    if (current && line === '  }') {
      out.push({ name: current.name, body: lines.slice(current.start, i + 1).join('\n') });
      current = null;
    }
  });
  return out;
}

describe('Arquitectura del recorrido (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-001] todo método del agregado que cambia status valida el paso contra la máquina', () => {
    const changing = methods(read('../domain/transaction.ts')).filter((m) =>
      /status: ['a-zA-Z]|bump\(\{ status|status: s\.status === 'CLEARED'/.test(m.body),
    );
    expect(changing.map((m) => m.name).sort()).toEqual([
      'amend',
      'amendConversion',
      'changeStatus',
      'post',
      'recordConversion',
      'recordTransfer',
      'unreconcile',
      'void',
    ]);
    // Toda creación (record, recordTransfer, recordConversion) pasa por el constructor, que marca RECORD.
    const ctor = methods(read('../domain/transaction.ts')).find((m) => m.name === 'constructor');
    expect(ctor?.body).toMatch(/this\.mark\('RECORD', null, state\.status/);
    for (const m of changing) {
      // Los factories crean el estado inicial: su transición RECORD la marca el constructor.
      if (['record', 'recordConversion', 'recordTransfer'].includes(m.name)) continue;
      expect(m.body, m.name).toMatch(/this\.mark\(/);
    }
  });

  it('[TC-AUDIT-LIFECYCLE-002] los servicios de TRANSACTIONS registran el recorrido con LifecyclePort (no AuditPort.append directo)', () => {
    for (const file of ['transactions.service.ts', 'conversions.service.ts']) {
      const source = read(`../application/${file}`);
      expect(source, file).not.toMatch(/this\.audit\.append\(/);
      expect(source, file).toMatch(/lifecycle\.record\(/);
    }
  });
});
