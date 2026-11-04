import { Ajv2020 } from 'ajv/dist/2020.js';
import type { PdfLayoutRegistry } from '../../application/pdf/ports.js';
import { sha256Hex, type PdfLayout } from '../../domain/index.js';
import bcp from './layouts/bo.bcp.cuenta.v1.json' with { type: 'json' };
import bnb from './layouts/bo.bnb.cuenta.v1.json' with { type: 'json' };
import ganadero from './layouts/bo.ganadero.cuenta.v1.json' with { type: 'json' };
import lock from './pdf-layouts.lock.json' with { type: 'json' };
import { PDF_LAYOUT_SCHEMA } from './pdf-layout-schema.js';

/**
 * Registro de diseños publicados (openspec add-pdf-statement-parser decisión 6). Cada diseño es un JSON validado
 * contra `imports.pdf-layout.v1` AL ARRANCAR (uno inválido impide arrancar) y su suma SHA-256 debe coincidir con la de
 * `pdf-layouts.lock.json`: una versión publicada es inmutable, un formato nuevo del banco es una versión nueva.
 */
type LayoutFile = PdfLayout & { readonly schema: string };

/** Publicados (BNB queda sujeto a la validación del owner con un extracto real: tarea 9.2, pregunta 3 de docs/58). */
const BUNDLED: readonly unknown[] = [bcp, ganadero, bnb];

/** JSON canónico (claves ordenadas) para que la suma no dependa del orden ni del formato del archivo. */
export function canonicalLayoutJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalLayoutJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalLayoutJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const layoutKey = (id: string, version: number): string => `${id}@${version}`;
export const layoutChecksum = (layout: unknown): string => sha256Hex(canonicalLayoutJson(layout));

export interface LayoutProblem {
  readonly layout: string;
  readonly problem: 'INVALID_SCHEMA' | 'CHECKSUM_CHANGED' | 'NOT_IN_LOCK' | 'MISSING';
}

/** Valida los diseños contra el esquema y contra el lock; `[]` si todo cuadra. */
export function verifyPdfLayouts(
  layouts: readonly unknown[],
  lockfile: Readonly<Record<string, string>>,
): LayoutProblem[] {
  const ajv = new Ajv2020({ allErrors: false, strict: true });
  const validate = ajv.compile(PDF_LAYOUT_SCHEMA);
  const problems: LayoutProblem[] = [];
  const seen = new Set<string>();
  for (const layout of layouts) {
    if (!validate(layout)) {
      const l = layout as Partial<LayoutFile>;
      problems.push({
        layout: layoutKey(String(l.id ?? '?'), Number(l.version ?? 0)),
        problem: 'INVALID_SCHEMA',
      });
      continue;
    }
    const l = layout as LayoutFile;
    const key = layoutKey(l.id, l.version);
    seen.add(key);
    const expected = lockfile[key];
    if (expected === undefined) problems.push({ layout: key, problem: 'NOT_IN_LOCK' });
    else if (expected !== layoutChecksum(layout)) problems.push({ layout: key, problem: 'CHECKSUM_CHANGED' });
  }
  for (const key of Object.keys(lockfile)) {
    if (!seen.has(key)) problems.push({ layout: key, problem: 'MISSING' });
  }
  return problems;
}

export class FilePdfLayoutRegistry implements PdfLayoutRegistry {
  private readonly layouts: readonly PdfLayout[];

  constructor(
    layouts: readonly unknown[] = BUNDLED,
    lockfile: Readonly<Record<string, string>> = lock as Record<string, string>,
  ) {
    const problems = verifyPdfLayouts(layouts, lockfile);
    if (problems.length > 0) {
      throw new Error(`invalid pdf layouts: ${problems.map((p) => `${p.layout}: ${p.problem}`).join(', ')}`);
    }
    // Más reciente primero dentro de cada id; el orden entre ids es estable.
    this.layouts = [...(layouts as readonly PdfLayout[])].sort((a, b) =>
      a.id === b.id ? b.version - a.version : a.id < b.id ? -1 : 1,
    );
  }

  get(id: string, version: number): PdfLayout | null {
    return this.layouts.find((l) => l.id === id && l.version === version) ?? null;
  }

  candidates(): readonly PdfLayout[] {
    return this.layouts;
  }
}
