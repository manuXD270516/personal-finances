import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_SETTINGS } from '../../application/testing/in-memory.js';
import { REGISTRY } from '../../../test/support/pdf-layouts.js';
import {
  FilePdfLayoutRegistry,
  layoutChecksum,
  layoutKey,
  verifyPdfLayouts,
} from './file-pdf-layout-registry.js';
import { PDF_LAYOUT_SCHEMA } from './pdf-layout-schema.js';

const HERE = __dirname;
const REPO = resolve(HERE, '../../../../../..');
const require_ = createRequire(import.meta.url);

const published = REGISTRY.candidates();
const lockOf = (layouts: readonly unknown[]): Record<string, string> =>
  Object.fromEntries(
    layouts.map((l) => [
      layoutKey((l as { id: string }).id, (l as { version: number }).version),
      layoutChecksum(l),
    ]),
  );

describe('registro de diseños de extracto (inmutabilidad y esquema)', () => {
  it('los diseños publicados cuadran con el lock y con el esquema', () => {
    const lock = JSON.parse(readFileSync(join(HERE, 'pdf-layouts.lock.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(verifyPdfLayouts(published, lock)).toEqual([]);
    expect(Object.keys(lock).sort()).toEqual(['bo.bcp.cuenta@1', 'bo.bnb.cuenta@1', 'bo.ganadero.cuenta@1']);
    // Todo archivo de diseño está registrado: ninguno queda fuera del lock.
    const files = readdirSync(join(HERE, 'layouts')).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(published.length);
  });

  it('[TC-IMPORTS-PDF-015] alterar una versión publicada de un diseño hace fallar la verificación', () => {
    const lock = lockOf(published);
    const [first] = published as [(typeof published)[number], ...unknown[]];
    const tampered = { ...first, detect: { literals: [...first.detect.literals, 'literal agregado'] } };
    const problems = verifyPdfLayouts([tampered, ...published.slice(1)], lock);
    expect(problems).toEqual([{ layout: layoutKey(first.id, first.version), problem: 'CHECKSUM_CHANGED' }]);
    expect(() => new FilePdfLayoutRegistry([tampered, ...published.slice(1)], lock)).toThrow(
      /CHECKSUM_CHANGED/u,
    );

    // Una versión publicada que desaparece también falla; una nueva sin publicar en el lock, también.
    expect(verifyPdfLayouts(published.slice(1), lock).map((p) => p.problem)).toEqual(['MISSING']);
    const v2 = { ...first, version: 2 };
    expect(verifyPdfLayouts([...published, v2], lock)).toEqual([
      { layout: layoutKey(first.id, 2), problem: 'NOT_IN_LOCK' },
    ]);
    // Un formato nuevo del banco es una versión nueva: con su entrada en el lock cuadra y la más reciente va primero.
    const registry = new FilePdfLayoutRegistry([...published, v2], { ...lock, ...lockOf([v2]) });
    expect(registry.candidates().map((l) => layoutKey(l.id, l.version))).toContain(layoutKey(first.id, 2));
    expect(registry.get(first.id, 1)).not.toBeNull();
    expect(registry.get(first.id, 2)?.version).toBe(2);
  });

  it('un diseño que no cumple el esquema impide arrancar', () => {
    const [first] = published as [(typeof published)[number], ...unknown[]];
    for (const bad of [
      { ...first, unknownField: true },
      { ...first, number: { decimal: ';', thousands: null } },
      { ...first, table: { ...first.table, columns: [] } },
    ]) {
      expect(verifyPdfLayouts([bad], lockOf([bad])).map((p) => p.problem)).toContain('INVALID_SCHEMA');
    }
  });

  it('el esquema ejecutable es idéntico al contrato publicado y no admite expresiones regulares', () => {
    const contract = JSON.parse(
      readFileSync(join(REPO, 'contracts/imports/pdf-layout.v1.schema.json'), 'utf8'),
    ) as unknown;
    expect(PDF_LAYOUT_SCHEMA).toEqual(contract);
    expect(JSON.stringify(contract)).not.toMatch(/"(pattern|regex|regexp)Property|"regexp"|"regex"/u);
  });

  it('los literales de detección no llevan el nombre del banco ni datos del titular', () => {
    for (const layout of published) {
      const literals = [
        ...layout.detect.literals,
        ...layout.page.discardLiterals,
        ...layout.page.footerLiterals,
        ...(layout.table.endLabels ?? []),
      ].join(' | ');
      expect(literals).not.toMatch(/banco|bcp|ganadero|bnb|bisa|titular ficticio|s\.a\./iu);
    }
  });
});

describe('seguridad de la dependencia de lectura de PDF (ADR-0032)', () => {
  const pdfjsRoot = dirname(require_.resolve('pdfjs-dist/package.json'));

  it('pdfjs-dist está fijada en una versión exacta posterior a la corrección de CVE-2024-4367', () => {
    const version = (JSON.parse(readFileSync(join(pdfjsRoot, 'package.json'), 'utf8')) as { version: string })
      .version;
    const pkg = JSON.parse(readFileSync(join(HERE, '../../../package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['pdfjs-dist']).toBe('catalog:');
    const catalog = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8');
    expect(catalog).toMatch(new RegExp(`^ {2}pdfjs-dist: ${version.replaceAll('.', '\\.')}$`, 'mu'));
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
    // La 4.2.67 corrige CVE-2024-4367 (la 4.2.67 es la primera con el parche).
    const fixed = major > 4 || (major === 4 && (minor > 2 || (minor === 2 && patch >= 67)));
    expect(fixed).toBe(true);
  });

  it('el motor no compila funciones con eval ni new Function (la clase de CVE-2024-4367)', () => {
    for (const file of ['legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs']) {
      const code = readFileSync(join(pdfjsRoot, file), 'utf8');
      expect(code, file).not.toMatch(/\bnew Function\s*\(/u);
      expect(code, file).not.toMatch(/(?<![.\w])eval\s*\(/u);
    }
  });

  it('no hay binarios nativos: la dependencia opcional canvas no está instalada ni se importa', () => {
    expect(() => require_.resolve('@napi-rs/canvas')).toThrow();
    expect(() => require_.resolve('canvas')).toThrow();
    const lock = readFileSync(join(REPO, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/ignoredOptionalDependencies:\s*\n\s*- '@napi-rs\/canvas'/u);
    const sources = [
      'pdfjs-text-extractor.ts',
      'pdf-text-extractor.worker.ts',
      'file-pdf-layout-registry.ts',
    ];
    for (const f of sources) {
      expect(readFileSync(join(HERE, f), 'utf8'), f).not.toMatch(
        /from ['"](@napi-rs\/)?canvas['"]|require\(['"](@napi-rs\/)?canvas/u,
      );
    }
  });

  it('el hilo no recibe entorno, no usa render ni metadatos y silencia la consola', () => {
    const main = readFileSync(join(HERE, 'pdfjs-text-extractor.ts'), 'utf8');
    // Sin comentarios: la documentación puede nombrar lo que el código NO usa.
    const worker = readFileSync(join(HERE, 'pdf-text-extractor.worker.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/?\*)/u.test(line))
      .join('\n');
    expect(main).toMatch(/env: \{\}/u);
    expect(main).toMatch(/resourceLimits/u);
    expect(main).toMatch(/terminate\(\)/u);
    expect(worker).toMatch(/isEvalSupported: false/u);
    expect(worker).not.toMatch(/\.render\(|getMetadata|getAnnotations|getJSActions/u);
  });
});

describe('ningún PDF entra al repositorio (D255, D281, D282)', () => {
  const versionedPdfs = (files: readonly string[]): string[] => files.filter((f) => /\.pdf$/iu.test(f));

  it('[TC-IMPORTS-PDF-044] la verificación de la entrega falla si el repositorio contiene un archivo PDF', () => {
    // La verificación detecta cualquier .pdf, sin importar mayúsculas ni carpeta.
    expect(versionedPdfs(['docs/a.md', 'tests/fixtures/extracto.pdf', 'x/EXTRACTO.PDF'])).toEqual([
      'tests/fixtures/extracto.pdf',
      'x/EXTRACTO.PDF',
    ]);
    // Y el repositorio real no tiene ninguno versionado.
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(100);
    expect(versionedPdfs(tracked)).toEqual([]);
    // `.gitignore` los ignora para que un `git add` accidental los deje fuera.
    expect(readFileSync(join(REPO, '.gitignore'), 'utf8')).toMatch(/^\*\.pdf$/mu);
  });
});

describe('presupuesto de memoria del worker con el hilo de lectura de PDF (sin consumidores ni conexiones nuevas)', () => {
  it('[TC-IMPORTS-PDF-005] el techo del contenedor del worker cubre el heap principal más el hilo aislado', () => {
    const compose = readFileSync(join(REPO, 'deploy/compose/compose.prod.yaml'), 'utf8');
    const heap = Number(/--max-old-space-size=(\d+)/u.exec(compose)?.[1]);
    const start = compose.search(/^ {2}finance-worker:$/mu);
    const end = compose.search(/^ {2}finance-web:$/mu);
    const workerBlock = compose.slice(start, end);
    const limit = Number(/memory: (\d+)m/u.exec(workerBlock)?.[1]);
    expect(heap).toBeGreaterThan(0);
    // heap principal + hilo aislado (una extracción a la vez) + 64 MiB nativos.
    expect(limit).toBeGreaterThanOrEqual(heap + TEST_SETTINGS.pdfWorkerMaxOldMb + 64);
  });
});
