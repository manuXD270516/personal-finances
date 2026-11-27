import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ninguna explicación vive solo en el atributo `title` (change refine-perceived-performance, M-09, decisión 5;
 * NFR-USAB-101/102): el atributo no se ve en el teléfono ni con el teclado. Recorre los `.tsx` de la UI con el
 * compilador de TypeScript y busca `title=` en ELEMENTOS DEL DOM (etiqueta en minúscula). El `title` de un componente
 * propio (`<ConfirmDialog title=…>`, `<Section title=…>`) es una prop de texto visible y no cuenta. Las excepciones
 * llevan el comentario `title-ok: <motivo>` en la misma línea o en la anterior.
 */
const ROOT = join(import.meta.dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [full] : [];
  });
}

export interface TitleUse {
  readonly file: string;
  readonly line: number;
  readonly marked: boolean;
}

/** Usos de `title=` en elementos del DOM de un fuente TSX, con su marca `title-ok:` si la tienen. */
export function domTitleAttributes(file: string, source: string): TitleUse[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split('\n');
  const uses: TitleUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'title') {
      const opening = node.parent.parent;
      const tag =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        opening.tagName.getText(sf);
      if (tag && /^[a-z]/.test(tag)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
        const near = `${lines[line - 1] ?? ''}\n${lines[line] ?? ''}`;
        uses.push({ file, line: line + 1, marked: /title-ok:\s*\S/.test(near) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

describe('atributo title en elementos del DOM', () => {
  it('[TC-PLATFORM-PERCEIVED-015] el detector marca un title sin excepción y acepta el marcado con motivo', () => {
    const bad = domTitleAttributes('x.tsx', 'export const A = () => <span title="Explica">Etiqueta</span>;');
    expect(bad).toEqual([{ file: 'x.tsx', line: 1, marked: false }]);
    const ok = domTitleAttributes(
      'x.tsx',
      'export const A = () => (\n  // title-ok: nombre completo de un texto truncado que también está en el DOM\n  <span title="Nombre largo">Nom…</span>\n);',
    );
    expect(ok.map((u) => u.marked)).toEqual([true]);
    const component = domTitleAttributes('x.tsx', 'export const A = () => <ConfirmDialog title="Anular" />;');
    expect(component).toEqual([]);
  });

  it('[TC-PLATFORM-PERCEIVED-015] ningún title= en el DOM queda sin la marca title-ok: con su motivo', () => {
    const offenders = tsxFiles(ROOT).flatMap((file) =>
      domTitleAttributes(file, readFileSync(file, 'utf8')).filter((u) => !u.marked),
    );
    expect(offenders.map((u) => `${relative(ROOT, u.file)}:${u.line}`)).toEqual([]);
  });
});
