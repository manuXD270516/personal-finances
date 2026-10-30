import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from '@pf/shared-kernel';
import { contentDispositionOf, normalizeFileName } from './file-name.js';
import {
  DEFAULT_UPLOAD_LIMITS,
  HARD_MAX_BYTES,
  assertUploadLimits,
  validateDeclaration,
} from './file-type-policy.js';

const SHA = 'a'.repeat(64);
const decl = (over: Record<string, unknown> = {}) => ({
  fileName: 'factura-luz-octubre.pdf',
  contentType: 'application/pdf',
  sizeBytes: 482133,
  sha256: SHA,
  purpose: 'RECEIPT',
  ...over,
});
const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
};

describe('normalización del nombre original (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-014] quita rutas y caracteres de control: `..\\..\\windows\\factura\\n.pdf` ⇒ "factura.pdf"', () => {
    expect(normalizeFileName('..\\..\\windows\\factura\n.pdf')).toBe('factura.pdf');
    expect(normalizeFileName('../../etc/passwd')).toBe('passwd');
  });

  it('[TC-SECURITY-UPLOAD-014] NFC y máximo de 255 caracteres', () => {
    expect(normalizeFileName('Cafe\u0301.pdf')).toBe('Caf\u00e9.pdf');
    expect(normalizeFileName(`${'a'.repeat(400)}.pdf`).length).toBe(255);
  });

  it('[TC-SECURITY-UPLOAD-014] PBT: ningún nombre normalizado contiene `/`, `\\`, CR, LF ni `"`', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (raw) => {
        const n = normalizeFileName(raw);
        expect(n).not.toMatch(/[/\\\r\n"]/u);
        expect([...n].length).toBeLessThanOrEqual(255);
      }),
      { numRuns: 300 },
    );
  });

  it('[TC-SECURITY-UPLOAD-015] Content-Disposition: adjunto, nombre codificado y sin inyección de cabeceras', () => {
    const header = contentDispositionOf('a"b;c\r\nX-Evil: 1.pdf'.replace(/[\r\n]/gu, ''));
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/u);
    const ascii = /filename="([^"]*)"/u.exec(header)![1]!;
    expect(ascii).not.toMatch(/["\\;]/u);
    expect(header).toContain("filename*=UTF-8''");
  });
});

describe('política de tipos y tamaño (security/file-upload-security)', () => {
  const limits = DEFAULT_UPLOAD_LIMITS;

  it('[TC-SECURITY-UPLOAD-001] acepta las extensiones de la lista permitida con su tipo declarado', () => {
    const ok: [string, string][] = [
      ['a.pdf', 'application/pdf'],
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.JPEG', 'image/jpeg'],
      ['a.webp', 'image/webp'],
      ['a.heic', 'image/heic'],
      ['a.csv', 'text/csv'],
      ['a.ofx', 'application/x-ofx'],
      ['a.qfx', 'application/x-ofx'],
      ['a.qif', 'application/qif'],
      ['a.json', 'application/json'],
      ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ];
    for (const [fileName, contentType] of ok) {
      expect(validateDeclaration(decl({ fileName, contentType }), limits).fileName.toLowerCase()).toBe(
        fileName.toLowerCase(),
      );
    }
  });

  it('[TC-SECURITY-UPLOAD-001] SVG, HTML, ejecutables, comprimidos, XLSM y XLS ⇒ UPLOAD_TYPE_NOT_ALLOWED', () => {
    const bad: [string, string][] = [
      ['logo.svg', 'image/svg+xml'],
      ['page.html', 'text/html'],
      ['setup.exe', 'application/x-msdownload'],
      ['datos.zip', 'application/zip'],
      ['macro.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
      ['viejo.xls', 'application/vnd.ms-excel'],
      ['sin-extension', 'application/pdf'],
    ];
    for (const [fileName, contentType] of bad) {
      expect(
        code(() => validateDeclaration(decl({ fileName, contentType }), limits)),
        fileName,
      ).toBe('UPLOAD_TYPE_NOT_ALLOWED');
    }
  });

  it('[TC-SECURITY-UPLOAD-002] extensión cuyo tipo declarado no corresponde ⇒ UPLOAD_TYPE_NOT_ALLOWED', () => {
    expect(
      code(() => validateDeclaration(decl({ fileName: 'extracto.pdf', contentType: 'text/html' }), limits)),
    ).toBe('UPLOAD_TYPE_NOT_ALLOWED');
  });

  it('[TC-SECURITY-UPLOAD-003] 15728640 se acepta, 15728641 ⇒ UPLOAD_TOO_LARGE; vacío ⇒ VALIDATION_FAILED', () => {
    expect(validateDeclaration(decl({ sizeBytes: 15_728_640 }), limits).sizeBytes).toBe(15_728_640);
    expect(code(() => validateDeclaration(decl({ sizeBytes: 15_728_641 }), limits))).toBe('UPLOAD_TOO_LARGE');
    expect(code(() => validateDeclaration(decl({ sizeBytes: 0 }), limits))).toBe('VALIDATION_FAILED');
  });

  it('[TC-SECURITY-UPLOAD-003] un extracto a importar admite 20 MiB (19922944 sí, 20971521 no)', () => {
    const base = { fileName: 'extracto-oct.csv', contentType: 'text/csv', purpose: 'IMPORT_SOURCE' };
    expect(validateDeclaration(decl({ ...base, sizeBytes: 19_922_944 }), limits).sizeBytes).toBe(19_922_944);
    expect(code(() => validateDeclaration(decl({ ...base, sizeBytes: 20_971_521 }), limits))).toBe(
      'UPLOAD_TOO_LARGE',
    );
  });

  it('[TC-SECURITY-UPLOAD-003] la configuración no puede superar el tope duro de 25 MiB', () => {
    expect(HARD_MAX_BYTES).toBe(26_214_400);
    expect(() => assertUploadLimits({ maxBytes: 26_214_401, importSourceMaxBytes: 1 })).toThrow(RangeError);
    expect(() => assertUploadLimits({ maxBytes: 1, importSourceMaxBytes: 0 })).toThrow(RangeError);
    expect(assertUploadLimits({ maxBytes: 26_214_400, importSourceMaxBytes: 26_214_400 }).maxBytes).toBe(
      26_214_400,
    );
  });

  it('[TC-DOCUMENTS-ATTACH-001] valida forma: suma hex de 64, propósito conocido, nombre no vacío', () => {
    expect(code(() => validateDeclaration(decl({ sha256: 'XYZ' }), limits))).toBe('VALIDATION_FAILED');
    expect(code(() => validateDeclaration(decl({ purpose: 'EXPORT' }), limits))).toBe('VALIDATION_FAILED');
    expect(code(() => validateDeclaration(decl({ fileName: '..\\' }), limits))).toBe('VALIDATION_FAILED');
    const ok = validateDeclaration(decl(), limits);
    expect(ok.format).toBe('PDF');
    expect(ok.canonicalType).toBe('application/pdf');
  });
});
