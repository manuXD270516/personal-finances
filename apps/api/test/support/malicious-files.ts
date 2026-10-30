import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

/**
 * Generador de archivos maliciosos de PRUEBA (openspec add-document-attachments, tarea 1.3, suite TC-SECURITY-UPLOAD-022).
 * Cada caso se arma POR CÓDIGO en memoria: ningún binario peligroso se versiona y la cadena EICAR se compone por
 * fragmentos (el antivirus de la máquina del owner pondría en cuarentena un archivo que la contuviera completa).
 * Los datos son sintéticos (D255).
 */
export type Stage = 'request' | 'storage' | 'verification';

export interface MaliciousCase {
  /** Número del caso en la tabla de design.md § Suite de uploads maliciosos. */
  readonly n: number;
  readonly label: string;
  readonly tc: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly purpose: string;
  readonly stage: Stage;
  /** Contenido (ausente en los rechazos de la solicitud que no suben nada). */
  readonly content: Buffer | null;
  /** Tamaño declarado si difiere del real (caso 4, sin armar 15 MiB). */
  readonly declaredSize?: number;
  /** Resultado esperado según la etapa. */
  readonly expect:
    | { readonly status: number; readonly code: string }
    | { readonly rejected: string }
    | { readonly storageRejects: true; readonly completeCode: string };
  /** Solo con escáner antimalware habilitado. */
  readonly needsScanner?: boolean;
}

export const sha256Hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export const sha256Base64 = (b: Buffer): string => createHash('sha256').update(b).digest('base64');

// ── ZIP mínimo (cabeceras locales + directorio central) ──
interface ZipItem {
  name: string;
  data: Buffer;
  declaredSize?: number;
}
function zip(items: readonly ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name, 'utf8');
    const body = deflateRawSync(item.data);
    const crc = crc32(item.data);
    const declared = item.declaredSize ?? item.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(items.length, 8);
  eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

const WORKBOOK: ZipItem[] = [
  {
    name: '[Content_Types].xml',
    data: Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
  },
  {
    name: 'xl/workbook.xml',
    data: Buffer.from('<workbook><sheets><sheet name="Hoja1"/></sheets></workbook>'),
  },
  { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData/></worksheet>') },
];

/** PDF mínimo plausible (los inspectores leen la estructura; no hace falta una tabla xref válida). */
function pdf(options: { rawObjects?: string[]; compressedObjects?: string; trailer?: string } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let n = 1;
  const obj = (body: string): void => {
    parts.push(Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1'));
    n += 1;
  };
  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>');
  const content = deflateSync(Buffer.from('BT /F1 12 Tf 20 100 Td (Documento de prueba) Tj ET'));
  parts.push(
    Buffer.from(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  );
  n = 5;
  for (const raw of options.rawObjects ?? []) obj(raw);
  if (options.compressedObjects !== undefined) {
    const packed = deflateSync(Buffer.from(options.compressedObjects, 'latin1'));
    parts.push(
      Buffer.from(
        `${n} 0 obj\n<< /Type /ObjStm /N 1 /First 8 /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`,
        'latin1',
      ),
      packed,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    );
    n += 1;
  }
  parts.push(
    Buffer.from(`trailer\n<< /Size ${n} /Root 1 0 R ${options.trailer ?? ''} >>\n%%EOF\n`, 'latin1'),
  );
  return Buffer.concat(parts);
}

/** PNG con cabecera IHDR válida (para el caso «imagen renombrada como PDF»). */
export function png(): Buffer {
  const be32 = (v: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v);
    return b;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    be32(13),
    Buffer.from('IHDR'),
    be32(10),
    be32(10),
    Buffer.from([8, 2, 0, 0, 0]),
    be32(0),
    be32(0),
    Buffer.from('IEND'),
    be32(0),
  ]);
}

/** PDF benigno de texto (el documento «bueno» de las pruebas de punta a punta). */
export const benignPdf = (label = 'Factura de luz octubre'): Buffer => {
  const text = deflateSync(Buffer.from(`BT /F1 12 Tf 20 100 Td (${label}) Tj ET`));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
      'latin1',
    ),
    Buffer.from(`4 0 obj\n<< /Length ${text.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    text,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
};

/** La cadena de prueba EICAR, compuesta por fragmentos: nunca aparece completa en el código fuente. */
export function eicar(): string {
  const parts = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR', '-STANDARD-ANTI', 'VIRUS-TEST-FILE!', '$H+H*'];
  return parts.join('');
}

/** PDF con contraseña de usuario (diccionario /Encrypt estándar R3 cuyo /U no abre con la contraseña vacía). */
function passwordProtectedPdf(): Buffer {
  const hex = (b: Buffer): string => `<${b.toString('hex')}>`;
  const id = randomBytes(16).toString('hex');
  return pdf({
    rawObjects: [
      `<< /Filter /Standard /V 2 /R 3 /Length 128 /O ${hex(randomBytes(32))} /U ${hex(randomBytes(32))} /P -3904 >>`,
    ],
    trailer: `/Encrypt 5 0 R /ID [<${id}> <${id}>]`,
  });
}

/** Los 17 casos maliciosos (más el 18, EICAR, que exige el escáner). */
export function maliciousCases(): MaliciousCase[] {
  const csv = (body: string): Buffer => Buffer.from(body, 'utf8');
  const nested = (n: number): Buffer => Buffer.from(`${'['.repeat(n)}${']'.repeat(n)}`);
  const base = { purpose: 'RECEIPT' } as const;
  return [
    {
      ...base,
      n: 1,
      label: 'logo.svg image/svg+xml',
      tc: 'TC-SECURITY-UPLOAD-001',
      fileName: 'logo.svg',
      contentType: 'image/svg+xml',
      stage: 'request',
      content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      expect: { status: 422, code: 'UPLOAD_TYPE_NOT_ALLOWED' },
    },
    {
      ...base,
      n: 2,
      label: 'setup.exe application/x-msdownload',
      tc: 'TC-SECURITY-UPLOAD-001',
      fileName: 'setup.exe',
      contentType: 'application/x-msdownload',
      stage: 'request',
      content: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]),
      expect: { status: 422, code: 'UPLOAD_TYPE_NOT_ALLOWED' },
    },
    {
      ...base,
      n: 3,
      label: 'extracto.pdf declarado text/html',
      tc: 'TC-SECURITY-UPLOAD-002',
      fileName: 'extracto.pdf',
      contentType: 'text/html',
      stage: 'request',
      content: benignPdf(),
      expect: { status: 422, code: 'UPLOAD_TYPE_NOT_ALLOWED' },
    },
    {
      ...base,
      n: 4,
      label: 'comprobante de 15728641 bytes',
      tc: 'TC-SECURITY-UPLOAD-003',
      fileName: 'comprobante.pdf',
      contentType: 'application/pdf',
      stage: 'request',
      content: null,
      declaredSize: 15_728_641,
      expect: { status: 413, code: 'UPLOAD_TOO_LARGE' },
    },
    {
      ...base,
      n: 5,
      label: 'contenido sustituido (mismo largo, otra suma)',
      tc: 'TC-SECURITY-UPLOAD-004',
      fileName: 'factura.pdf',
      contentType: 'application/pdf',
      stage: 'storage',
      content: benignPdf('declarado'),
      expect: { storageRejects: true, completeCode: 'DOCUMENT_UPLOAD_MISSING' },
    },
    {
      ...base,
      n: 6,
      label: 'PUT con la URL vencida',
      tc: 'TC-SECURITY-UPLOAD-005',
      fileName: 'factura-vencida.pdf',
      contentType: 'application/pdf',
      stage: 'storage',
      content: benignPdf('vencida'),
      expect: { storageRejects: true, completeCode: 'DOCUMENT_UPLOAD_MISSING' },
    },
    {
      ...base,
      n: 7,
      label: 'PNG como factura.pdf',
      tc: 'TC-SECURITY-UPLOAD-006',
      fileName: 'factura.pdf',
      contentType: 'application/pdf',
      stage: 'verification',
      content: png(),
      expect: { rejected: 'TYPE_MISMATCH' },
    },
    {
      ...base,
      n: 8,
      label: 'ejecutable PE como extracto.csv',
      tc: 'TC-SECURITY-UPLOAD-006',
      fileName: 'extracto.csv',
      contentType: 'text/csv',
      stage: 'verification',
      content: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62), Buffer.from('PE\0\0'), randomBytes(200)]),
      expect: { rejected: 'MALFORMED_CONTENT' },
    },
    {
      ...base,
      n: 9,
      label: 'políglota HTML con script y %PDF- en el byte 200',
      tc: 'TC-SECURITY-UPLOAD-007',
      fileName: 'estado.pdf',
      contentType: 'application/pdf',
      stage: 'verification',
      content: Buffer.concat([
        Buffer.from(`<html><body><script>alert(1)</script>${' '.repeat(170)}`),
        Buffer.from('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n'),
      ]),
      expect: { rejected: 'TYPE_MISMATCH' },
    },
    {
      ...base,
      n: 10,
      label: 'SVG con <script> declarado recibo.png',
      tc: 'TC-SECURITY-UPLOAD-007',
      fileName: 'recibo.png',
      contentType: 'image/png',
      stage: 'verification',
      content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      expect: { rejected: 'TYPE_MISMATCH' },
    },
    {
      ...base,
      n: 11,
      label: 'PDF con /OpenAction → /JS',
      tc: 'TC-SECURITY-UPLOAD-008',
      fileName: 'abrir.pdf',
      contentType: 'application/pdf',
      stage: 'verification',
      content: pdf({ rawObjects: ['<< /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>'] }),
      expect: { rejected: 'ACTIVE_CONTENT' },
    },
    {
      ...base,
      n: 12,
      label: 'PDF con /J#61vaScript en flujo de objetos comprimido',
      tc: 'TC-SECURITY-UPLOAD-008',
      fileName: 'ofuscado.pdf',
      contentType: 'application/pdf',
      stage: 'verification',
      content: pdf({ compressedObjects: '7 0 << /S /J#61vaScript /J#53 (x) >>' }),
      expect: { rejected: 'ACTIVE_CONTENT' },
    },
    {
      ...base,
      n: 13,
      label: 'PDF con contraseña de usuario',
      tc: 'TC-SECURITY-UPLOAD-009',
      fileName: 'protegido.pdf',
      contentType: 'application/pdf',
      stage: 'verification',
      content: passwordProtectedPdf(),
      expect: { rejected: 'ENCRYPTED_CONTENT' },
    },
    {
      ...base,
      n: 14,
      label: 'movimientos.csv que empieza con <html><script>',
      tc: 'TC-SECURITY-UPLOAD-010',
      fileName: 'movimientos.csv',
      contentType: 'text/csv',
      stage: 'verification',
      content: csv('<html><script>document.location="https://x.test"</script></html>'),
      expect: { rejected: 'ACTIVE_CONTENT' },
    },
    {
      ...base,
      n: 15,
      label: 'JSON con 65 niveles',
      tc: 'TC-SECURITY-UPLOAD-010',
      fileName: 'datos.json',
      contentType: 'application/json',
      stage: 'verification',
      content: nested(65),
      expect: { rejected: 'MALFORMED_CONTENT' },
    },
    {
      ...base,
      n: 16,
      label: 'XLSX con xl/vbaProject.bin',
      tc: 'TC-SECURITY-UPLOAD-011',
      fileName: 'movimientos.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      stage: 'verification',
      content: zip([...WORKBOOK, { name: 'xl/vbaProject.bin', data: randomBytes(256) }]),
      expect: { rejected: 'MACROS_PRESENT' },
    },
    {
      ...base,
      n: 17,
      label: 'XLSX de 40 KiB que se infla a 2 GiB',
      tc: 'TC-SECURITY-UPLOAD-012',
      fileName: 'bomba.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      stage: 'verification',
      // Una hoja de ceros comprimida (≈ 40 KiB) cuyo directorio declara 2 GiB: se rechaza por límites sin inflarla.
      content: zip([
        ...WORKBOOK,
        { name: 'xl/worksheets/sheet2.xml', data: randomBytes(40 * 1024), declaredSize: 2 * 1024 ** 3 },
      ]),
      expect: { rejected: 'ARCHIVE_LIMITS_EXCEEDED' },
    },
    {
      ...base,
      n: 18,
      label: 'EICAR en movimientos.csv (solo con escáner)',
      tc: 'TC-SECURITY-UPLOAD-019',
      fileName: 'movimientos.csv',
      contentType: 'text/csv',
      stage: 'verification',
      content: Buffer.from(eicar(), 'latin1'),
      expect: { rejected: 'MALWARE_DETECTED' },
      needsScanner: true,
    },
  ];
}
