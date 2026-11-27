import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Tablas de la interfaz (refine-data-tables, decisiones 1 y 12): todas pasan por `TableRegion` y ninguna fila o
 * grupo de filas difiere su dibujo con contención (no actúa sobre `display: table-row`).
 */
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../..');
const appDir = resolve(srcDir, '../app');

function walk(dir: string, exts: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p, exts);
    return exts.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const tsxFiles = walk(srcDir, /\.tsx$/);
const rel = (p: string) => relative(srcDir, p).split(sep).join('/');

/** Tablas que no van dentro de `TableRegion` en el mismo archivo, con su motivo. Vacío: ninguna excepción. */
const TABLE_EXCEPTIONS: Readonly<Record<string, string>> = {};

function tagName(node: ts.Node): string | undefined {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return undefined;
}

function tablesOutsideRegion(file: string): number[] {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const visit = (node: ts.Node, inRegion: boolean) => {
    const name = tagName(node);
    if (name === 'table' && !inRegion) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    const next = inRegion || name === 'TableRegion';
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(sf, false);
  return lines;
}

describe('[TC-PLATFORM-TABLES-002] todas las tablas pasan por la región común con nombre', () => {
  it('[TC-PLATFORM-TABLES-002] ningún archivo usa tableWrapStyle ni lo exporta', () => {
    const offenders = tsxFiles
      .concat(walk(srcDir, /\.ts$/))
      .filter((f) => /\btableWrapStyle\b/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  }, 120_000);

  it('[TC-PLATFORM-TABLES-002] cada <table> está dentro de <TableRegion> en su archivo', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      if (TABLE_EXCEPTIONS[rel(file)]) continue;
      const lines = tablesOutsideRegion(file);
      if (lines.length > 0) offenders.push(`${rel(file)}:${lines.join(',')}`);
    }
    expect(offenders).toEqual([]);
  }, 120_000);

  it('[TC-PLATFORM-TABLES-002] ningún envoltorio propio con desplazamiento horizontal rodea una tabla', () => {
    // Los envoltorios `*-table-wrap` y los `overflowX: 'auto'` junto a una tabla se reemplazan por TableRegion.
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const source = readFileSync(file, 'utf8');
      if (
        /<table\b/.test(source) &&
        /overflowX\s*:|table-wrap(?!--)/.test(source.replace(/pf-table-wrap/g, ''))
      ) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const ROW_SELECTOR = /(^|[\s>+~,(])(tr|tbody|thead|tfoot)\b/;

describe('[TC-PLATFORM-TABLES-022] filas de tabla dibujadas completas', () => {
  it('[TC-PLATFORM-TABLES-022] ninguna regla CSS con selector de tr/tbody/thead declara content-visibility ni contain', () => {
    const offenders: string[] = [];
    const cssFiles = walk(srcDir, /\.css$/).concat(walk(appDir, /\.css$/));
    for (const file of cssFiles) {
      const css = stripComments(readFileSync(file, 'utf8'));
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (m[1] ?? '').trim();
        const body = m[2] ?? '';
        if (ROW_SELECTOR.test(selector) && /(^|[;\s])(content-visibility|contain)\s*:/.test(body)) {
          offenders.push(`${rel(file)}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('[TC-PLATFORM-TABLES-022] ningún <tr>/<tbody>/<thead> declara contentVisibility ni contain en su style', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const source = readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        const opening = ts.isJsxElement(node)
          ? node.openingElement
          : ts.isJsxSelfClosingElement(node)
            ? node
            : undefined;
        if (opening && /^(tr|tbody|thead|tfoot)$/.test(opening.tagName.getText())) {
          if (/\b(contentVisibility|contain|containIntrinsicSize)\b\s*:/.test(opening.attributes.getText())) {
            offenders.push(`${rel(file)}:${sf.getLineAndCharacterOfPosition(opening.getStart()).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  }, 120_000);
});
