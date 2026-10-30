import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

/**
 * Generadores de archivos sintéticos para las pruebas de los inspectores (D255: ningún dato real; los casos
 * peligrosos se arman por código y no se versionan como binarios).
 */

export interface ZipItem {
  readonly name: string;
  readonly data: Buffer;
  readonly method?: 'deflate' | 'store';
  /** Miente en el directorio central sobre el tamaño descomprimido. */
  readonly declaredSize?: number;
}

/** ZIP mínimo válido (cabeceras locales + directorio central). */
export function zip(items: readonly ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name, 'utf8');
    const method = item.method === 'store' ? 0 : 8;
    const body = method === 0 ? item.data : deflateRawSync(item.data);
    const crc = crc32(item.data);
    const declared = item.declaredSize ?? item.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
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
    central.writeUInt16LE(method, 10);
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

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';

/** Libro XLSX mínimo. */
export function xlsx(extra: readonly ZipItem[] = [], contentTypes = CONTENT_TYPES): Buffer {
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from('<workbook><sheets><sheet name="Hoja1"/></sheets></workbook>'),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData/></worksheet>') },
    ...extra,
  ]);
}

export interface PdfOptions {
  /** Texto extra de objetos en claro (p. ej. `<< /OpenAction << /S /JavaScript /JS (x) >> >>`). */
  readonly rawObjects?: readonly string[];
  /** Contenido de un flujo de objetos (`/ObjStm`) comprimido con Flate. */
  readonly compressedObjects?: string;
  /** Trailer extra (p. ej. `/Encrypt 9 0 R`). */
  readonly trailer?: string;
}

/** PDF mínimo estructuralmente plausible (sin tabla xref válida: los inspectores no la necesitan). */
export function pdf(options: PdfOptions = {}): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let n = 1;
  const obj = (body: string): void => {
    parts.push(Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1'));
    n += 1;
  };
  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>');
  const content = deflateSync(Buffer.from('BT /F1 12 Tf 20 100 Td (Factura de luz) Tj ET'));
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

const be32 = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return b;
};

/** PNG con cabecera IHDR de las dimensiones dadas (sin datos de imagen válidos: solo se lee la cabecera). */
export function png(width = 10, height = 10): Buffer {
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    be32(13),
    Buffer.from('IHDR'),
    ihdr,
    be32(0),
    be32(0),
    Buffer.from('IEND'),
    be32(0),
  ]);
}

/** JPEG con SOI, un APP0 y un SOF0 de las dimensiones dadas. */
export function jpeg(width = 10, height = 10): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(17, 0);
  sof[2] = 8;
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3;
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    Buffer.from([0xff, 0xc0]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** WebP extendido (VP8X) con las dimensiones dadas. */
export function webp(width = 10, height = 10): Buffer {
  const chunk = Buffer.alloc(18);
  chunk.writeUIntLE(width - 1, 4, 3);
  chunk.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([Buffer.from('WEBPVP8X'), Buffer.from([10, 0, 0, 0]), chunk.subarray(0, 10)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** HEIC mínimo: caja `ftyp` con marca `heic` y una `ispe`. */
export function heic(width = 10, height = 10): Buffer {
  const ftyp = Buffer.concat([be32(24), Buffer.from('ftypheic'), be32(0), Buffer.from('heicmif1')]);
  const ispe = Buffer.concat([be32(20), Buffer.from('ispe'), be32(0), be32(width), be32(height)]);
  return Buffer.concat([ftyp, ispe]);
}

export const csvWindows1252 = (): Buffer =>
  Buffer.from('fecha;descripci\xf3n;monto\n2026-10-01;Pago de energ\xeda;-150,00\n', 'latin1');

export const ofx = (): Buffer =>
  Buffer.from(
    'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n',
  );

export const qif = (): Buffer => Buffer.from('!Type:Bank\nD10/01/2026\nT-150.00\nPEnergia\n^\n');
