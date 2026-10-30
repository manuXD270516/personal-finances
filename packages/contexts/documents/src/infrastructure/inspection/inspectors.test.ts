import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { csvWindows1252, heic, jpeg, ofx, pdf, png, qif, webp, xlsx, zip } from '../../testing/fixtures.js';
import { inspectContent } from './inspect-content.js';
import { expectedUserEntryLegacy, hashR5, hashR6, type PdfEncryptionParams } from './pdf-encryption.js';
import { inspectXlsx } from './ooxml-inspector.js';

const reason = (content: Buffer, declared: Parameters<typeof inspectContent>[1]): string =>
  JSON.stringify(inspectContent(content, declared));
const ok = (format: string) => JSON.stringify({ ok: true, format });
const no = (r: string) => JSON.stringify({ ok: false, reason: r });

describe('tipo real por contenido (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-006] acepta cada familia con contenido coherente', () => {
    expect(reason(pdf(), 'PDF')).toBe(ok('PDF'));
    expect(reason(png(), 'PNG')).toBe(ok('PNG'));
    expect(reason(jpeg(), 'JPEG')).toBe(ok('JPEG'));
    expect(reason(webp(), 'WEBP')).toBe(ok('WEBP'));
    expect(reason(heic(), 'HEIC')).toBe(ok('HEIC'));
    expect(reason(csvWindows1252(), 'CSV')).toBe(ok('CSV'));
    expect(reason(ofx(), 'OFX')).toBe(ok('OFX'));
    expect(reason(qif(), 'QIF')).toBe(ok('QIF'));
    expect(reason(Buffer.from('{"a":[1,2,{"b":null}]}'), 'JSON')).toBe(ok('JSON'));
    expect(reason(xlsx(), 'XLSX')).toBe(ok('XLSX'));
  });

  it('[TC-SECURITY-UPLOAD-006] imagen PNG declarada PDF ⇒ TYPE_MISMATCH', () => {
    expect(reason(png(), 'PDF')).toBe(no('TYPE_MISMATCH'));
    expect(reason(pdf(), 'PNG')).toBe(no('TYPE_MISMATCH'));
    expect(reason(png(), 'CSV')).toBe(no('TYPE_MISMATCH'));
  });

  it('[TC-SECURITY-UPLOAD-006] ejecutable PE declarado CSV ⇒ MALFORMED_CONTENT (bytes nulos)', () => {
    const pe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62), Buffer.from('PE\0\0'), randomBytes(200)]);
    expect(reason(pe, 'CSV')).toBe(no('MALFORMED_CONTENT'));
  });

  it('[TC-SECURITY-UPLOAD-006] ejecutable PE declarado PDF ⇒ TYPE_NOT_ALLOWED', () => {
    expect(reason(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'PDF')).toBe(no('TYPE_NOT_ALLOWED'));
  });

  it('[TC-SECURITY-UPLOAD-007] políglota: HTML con script y %PDF- en el byte 200 ⇒ TYPE_MISMATCH', () => {
    const html = Buffer.from(`<html><script>alert(1)</script>${' '.repeat(150)}`);
    const poly = Buffer.concat([html, Buffer.from('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n')]);
    expect(poly.indexOf('%PDF-')).toBeGreaterThan(150);
    expect(reason(poly, 'PDF')).toBe(no('TYPE_MISMATCH'));
  });

  it('[TC-SECURITY-UPLOAD-007] SVG con script declarado PNG ⇒ TYPE_MISMATCH', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(reason(svg, 'PNG')).toBe(no('TYPE_MISMATCH'));
  });

  it('imágenes: lado de más de 50 000 px o cabecera ilegible ⇒ MALFORMED_CONTENT', () => {
    expect(reason(png(50_001, 10), 'PNG')).toBe(no('MALFORMED_CONTENT'));
    expect(reason(jpeg(10, 60_000), 'JPEG')).toBe(no('MALFORMED_CONTENT'));
    expect(reason(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), 'PNG')).toBe(
      no('MALFORMED_CONTENT'),
    );
  });
});

describe('PDF sin contenido activo (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-008] /OpenAction → /JS ⇒ ACTIVE_CONTENT', () => {
    const doc = pdf({ rawObjects: ['<< /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>'] });
    expect(reason(doc, 'PDF')).toBe(no('ACTIVE_CONTENT'));
  });

  it('[TC-SECURITY-UPLOAD-008] cada nombre prohibido se rechaza', () => {
    for (const name of [
      'Launch',
      'EmbeddedFile',
      'EmbeddedFiles',
      'RichMedia',
      'XFA',
      'GoToE',
      'SubmitForm',
      'ImportData',
    ]) {
      expect(reason(pdf({ rawObjects: [`<< /Foo /${name} >>`] }), 'PDF'), name).toBe(no('ACTIVE_CONTENT'));
    }
  });

  it('[TC-SECURITY-UPLOAD-008] nombre ofuscado `/J#61vaScript` dentro de un flujo de objetos comprimido', () => {
    const doc = pdf({ compressedObjects: '7 0 << /S /J#61vaScript /J#53 (x) >>' });
    expect(reason(doc, 'PDF')).toBe(no('ACTIVE_CONTENT'));
    // También ofuscado en claro.
    expect(reason(pdf({ rawObjects: ['<< /S /J#61vaScript >>'] }), 'PDF')).toBe(no('ACTIVE_CONTENT'));
  });

  it('[TC-SECURITY-UPLOAD-008] un /OpenAction que solo va a una página no es contenido activo', () => {
    const doc = pdf({
      rawObjects: ['<< /OpenAction [3 0 R /Fit] /AA << /O << /S /GoTo /D [3 0 R /Fit] >> >> >>'],
    });
    expect(reason(doc, 'PDF')).toBe(ok('PDF'));
  });

  it('[TC-SECURITY-UPLOAD-008] un flujo falso con filtro que esconde objetos reales se escanea crudo', () => {
    // El flujo declara Flate pero su contenido es texto plano con un /JS: la inflación falla y se escanea tal cual.
    const doc = pdf({
      rawObjects: ['<< /Length 40 /Filter /FlateDecode >>\nstream\n<< /S /JavaScript /JS (x) >>\nendstream'],
    });
    expect(reason(doc, 'PDF')).toBe(no('ACTIVE_CONTENT'));
  });

  it('límite de objetos (10 000) y de inflado ⇒ MALFORMED_CONTENT', () => {
    const many = pdf({ rawObjects: Array.from({ length: 10_050 }, () => '<< /Type /Foo >>') });
    expect(reason(many, 'PDF')).toBe(no('MALFORMED_CONTENT'));
  });
});

describe('PDF cifrado (D319)', () => {
  const idHex = '0123456789abcdef0123456789abcdef';
  const hex = (b: Buffer): string => `<${b.toString('hex')}>`;
  const legacyParams = (u: Buffer, o: Buffer): PdfEncryptionParams => ({
    filter: 'Standard',
    v: 2,
    r: 3,
    o,
    u,
    p: -3904,
    lengthBits: 128,
    encryptMetadata: true,
    id0: Buffer.from(idHex, 'hex'),
  });
  const encrypted = (u: Buffer, o: Buffer, extra = '/V 2 /R 3 /Length 128'): Buffer =>
    pdf({
      rawObjects: [`<< /Filter /Standard ${extra} /O ${hex(o)} /U ${hex(u)} /P -3904 >>`],
      trailer: `/Encrypt 5 0 R /ID [<${idHex}> <${idHex}>]`,
    });

  it('[TC-SECURITY-UPLOAD-009] contraseña de usuario no vacía ⇒ ENCRYPTED_CONTENT', () => {
    const o = randomBytes(32);
    expect(reason(encrypted(randomBytes(32), o), 'PDF')).toBe(no('ENCRYPTED_CONTENT'));
  });

  it('[TC-SECURITY-UPLOAD-009] solo contraseña de propietario (la de usuario vacía abre) ⇒ se acepta', () => {
    const o = randomBytes(32);
    const expected = expectedUserEntryLegacy(legacyParams(Buffer.alloc(32), o));
    const u = Buffer.concat([expected.subarray(0, 16), randomBytes(16)]);
    expect(reason(encrypted(u, o), 'PDF')).toBe(ok('PDF'));
  });

  it('[TC-SECURITY-UPLOAD-009] R6 (AES-256): contraseña de usuario vacía válida o no', () => {
    const vsalt = randomBytes(8);
    const ksalt = randomBytes(8);
    const good = Buffer.concat([hashR6(Buffer.alloc(0), vsalt, Buffer.alloc(0)), vsalt, ksalt]);
    const bad = Buffer.concat([randomBytes(32), vsalt, ksalt]);
    const doc = (u: Buffer) =>
      pdf({
        rawObjects: [
          `<< /Filter /Standard /V 5 /R 6 /Length 256 /O ${hex(randomBytes(48))} /U ${hex(u)} /P -1 >>`,
        ],
        trailer: `/Encrypt 5 0 R /ID [<${idHex}> <${idHex}>]`,
      });
    expect(reason(doc(good), 'PDF')).toBe(ok('PDF'));
    expect(reason(doc(bad), 'PDF')).toBe(no('ENCRYPTED_CONTENT'));
    expect(hashR5(Buffer.alloc(0), vsalt)).toHaveLength(32);
  });

  it('[TC-SECURITY-UPLOAD-009] /Encrypt ilegible falla cerrado', () => {
    expect(reason(pdf({ trailer: '/Encrypt 99 0 R' }), 'PDF')).toBe(no('ENCRYPTED_CONTENT'));
  });
});

describe('formatos de texto sin marcado activo (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-010] CSV que empieza con `<html><script>` ⇒ ACTIVE_CONTENT (también tras BOM y espacios)', () => {
    expect(reason(Buffer.from('<html><script>x</script>'), 'CSV')).toBe(no('ACTIVE_CONTENT'));
    expect(reason(Buffer.from('﻿  \n<!DOCTYPE HTML><p>'), 'CSV')).toBe(no('ACTIVE_CONTENT'));
    expect(reason(Buffer.from('<?xml version="1.0"?><svg onload="x"/>'), 'CSV')).toBe(no('ACTIVE_CONTENT'));
    expect(reason(Buffer.from('JAVASCRIPT:alert(1)'), 'JSON')).toBe(no('ACTIVE_CONTENT'));
  });

  it('[TC-SECURITY-UPLOAD-010] bytes nulos o controles C0 ⇒ MALFORMED_CONTENT', () => {
    expect(reason(Buffer.from('a;b\n1;\0\n'), 'CSV')).toBe(no('MALFORMED_CONTENT'));
    expect(reason(Buffer.from('a;b\n1;\u0007\n'), 'CSV')).toBe(no('MALFORMED_CONTENT'));
    expect(reason(Buffer.from('a;b\r\n1;2\tx\n'), 'CSV')).toBe(ok('CSV'));
  });

  it('[TC-SECURITY-UPLOAD-010] JSON de 65 niveles ⇒ MALFORMED_CONTENT; 64 se acepta', () => {
    const nested = (n: number) => `${'['.repeat(n)}${']'.repeat(n)}`;
    expect(reason(Buffer.from(nested(65)), 'JSON')).toBe(no('MALFORMED_CONTENT'));
    expect(reason(Buffer.from(nested(64)), 'JSON')).toBe(ok('JSON'));
    expect(reason(Buffer.from('{"a":'), 'JSON')).toBe(no('MALFORMED_CONTENT'));
    // Las llaves dentro de cadenas no cuentan.
    expect(reason(Buffer.from(`{"a":"${'['.repeat(200)}"}`), 'JSON')).toBe(ok('JSON'));
  });

  it('[TC-SECURITY-UPLOAD-010] UTF-8 con BOM, UTF-16 con BOM y windows-1252', () => {
    expect(reason(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a;b\n')]), 'CSV')).toBe(
      ok('CSV'),
    );
    expect(reason(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a;b\n', 'utf16le')]), 'CSV')).toBe(
      ok('CSV'),
    );
    expect(reason(csvWindows1252(), 'CSV')).toBe(ok('CSV'));
  });

  it('OFX sin cabecera y QIF sin tipo ⇒ TYPE_MISMATCH', () => {
    expect(reason(Buffer.from('hola mundo'), 'OFX')).toBe(no('TYPE_MISMATCH'));
    expect(reason(Buffer.from('hola mundo'), 'QIF')).toBe(no('TYPE_MISMATCH'));
  });
});

describe('hojas de cálculo sin macros ni bombas (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-011] proyecto de macros ⇒ MACROS_PRESENT', () => {
    expect(reason(xlsx([{ name: 'xl/vbaProject.bin', data: randomBytes(64) }]), 'XLSX')).toBe(
      no('MACROS_PRESENT'),
    );
    expect(reason(xlsx([{ name: 'xl/activeX/activeX1.xml', data: Buffer.from('<a/>') }]), 'XLSX')).toBe(
      no('MACROS_PRESENT'),
    );
  });

  it('[TC-SECURITY-UPLOAD-011] tipo de contenido `macroEnabled` sin proyecto ⇒ MACROS_PRESENT', () => {
    const macroTypes =
      '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>';
    expect(reason(xlsx([], macroTypes), 'XLSX')).toBe(no('MACROS_PRESENT'));
  });

  it('[TC-SECURITY-UPLOAD-012] bomba de compresión: 40 KiB que se infla a 2 GiB ⇒ ARCHIVE_LIMITS_EXCEEDED sin inflarla', () => {
    // Una hoja de 2 GiB de ceros se comprime ~1000:1; se declara sin construirla (el directorio basta para rechazar).
    const bomb = xlsx([
      { name: 'xl/worksheets/sheet2.xml', data: Buffer.alloc(64 * 1024), declaredSize: 2 * 1024 ** 3 },
    ]);
    expect(bomb.length).toBeLessThan(40 * 1024);
    expect(reason(bomb, 'XLSX')).toBe(no('ARCHIVE_LIMITS_EXCEEDED'));
  });

  it('[TC-SECURITY-UPLOAD-012] más de 1000 entradas, razón > 100:1 y tamaño total > 100 MiB', () => {
    const many = xlsx(
      Array.from({ length: 1001 }, (_v, i) => ({ name: `xl/media/${i}.xml`, data: Buffer.from('x') })),
    );
    expect(reason(many, 'XLSX')).toBe(no('ARCHIVE_LIMITS_EXCEEDED'));
    const ratio = xlsx([{ name: 'xl/worksheets/sheet2.xml', data: Buffer.alloc(200_000) }]);
    expect(reason(ratio, 'XLSX')).toBe(no('ARCHIVE_LIMITS_EXCEEDED'));
    const total = xlsx([
      { name: 'xl/a.xml', data: Buffer.from('a'), declaredSize: 60 * 1024 * 1024 },
      { name: 'xl/b.xml', data: Buffer.from('b'), declaredSize: 60 * 1024 * 1024 },
    ]);
    expect(reason(total, 'XLSX')).toBe(no('ARCHIVE_LIMITS_EXCEEDED'));
  });

  it('[TC-SECURITY-UPLOAD-012] el tamaño declarado miente (poco declarado, mucho real) ⇒ ARCHIVE_LIMITS_EXCEEDED', () => {
    const liar = xlsx([{ name: 'xl/worksheets/sheet2.xml', data: randomBytes(5000), declaredSize: 10 }]);
    expect(reason(liar, 'XLSX')).toBe(no('ARCHIVE_LIMITS_EXCEEDED'));
  });

  it('rutas peligrosas, libro sin partes obligatorias y ZIP64/ilegible', () => {
    expect(reason(xlsx([{ name: '../evil.xml', data: Buffer.from('x') }]), 'XLSX')).toBe(
      no('MALFORMED_CONTENT'),
    );
    expect(reason(xlsx([{ name: '/abs.xml', data: Buffer.from('x') }]), 'XLSX')).toBe(
      no('MALFORMED_CONTENT'),
    );
    expect(reason(zip([{ name: 'hola.txt', data: Buffer.from('hola') }]), 'XLSX')).toBe(no('TYPE_MISMATCH'));
    expect(inspectXlsx(Buffer.concat([Buffer.from('PK\u0003\u0004'), randomBytes(100)]))).toEqual({
      ok: false,
      reason: 'MALFORMED_CONTENT',
    });
  });

  it('suma SHA-256 de control: el inspector no modifica el contenido', () => {
    const doc = xlsx();
    const before = createHash('sha256').update(doc).digest('hex');
    inspectContent(doc, 'XLSX');
    expect(createHash('sha256').update(doc).digest('hex')).toBe(before);
  });
});
