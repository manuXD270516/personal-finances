import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Test de arquitectura (add-lifecycle-timeline decisión 1; docs/31 D52, tarea 9.1): todo cambio de estado de
// `Category` y `Counterparty` (asignar `archivedAt`) pasa por su máquina declarada (`this.mark(...)`), y el servicio
// registra el recorrido de ambos con `LifecyclePort` (no con `AuditPort.append` directo).
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Cuerpos de los métodos de la clase `name` (desde su firma hasta el cierre con dos espacios de sangría). */
function methods(source: string, name: string): { readonly name: string; readonly body: string }[] {
  const start = source.indexOf(`export class ${name} {`);
  const end = source.indexOf('\n}\n', start);
  const lines = source.slice(start, end).split('\n');
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

describe('Arquitectura del recorrido de CLASSIFICATION (docs/31 D52)', () => {
  it('[TC-AUDIT-LIFECYCLE-014] todo método de Category y Counterparty que cambia archivedAt valida el paso contra su máquina', () => {
    for (const [file, cls] of [
      ['../domain/category.ts', 'Category'],
      ['../domain/counterparty.ts', 'Counterparty'],
    ] as const) {
      const all = methods(read(file), cls);
      const changing = all.filter((m) => m.name !== 'create' && /archivedAt: (at|null)/.test(m.body));
      expect(changing.map((m) => m.name).sort(), cls).toEqual(['archive', 'unarchive']);
      for (const m of changing) expect(m.body, `${cls}.${m.name}`).toMatch(/this\.mark\('(UN)?ARCHIVE'\)/);
      // La creación marca CREATE.
      expect(all.find((m) => m.name === 'create')?.body, `${cls}.create`).toMatch(/\.mark\('CREATE'\)/);
    }
  });

  it('[TC-AUDIT-LIFECYCLE-015] [TC-AUDIT-LIFECYCLE-018] el servicio registra categorías y contrapartes con LifecyclePort', () => {
    const source = read('../application/classification.service.ts');
    for (const helper of ['auditCategory', 'auditCounterparty']) {
      const body = source.slice(source.indexOf(`private ${helper}(`));
      expect(body.slice(0, body.indexOf('\n  }\n')), helper).toMatch(/this\.record\(/);
    }
    expect(source).toMatch(/this\.deps\.lifecycle\.record\(/);
  });
});
