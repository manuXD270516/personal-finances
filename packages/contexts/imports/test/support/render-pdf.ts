import { crc32, deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import type { PdfTextDocument } from '../../src/domain/pdf/text-document.js';

/**
 * Generador de PDF SINTÉTICOS para las pruebas (openspec add-pdf-statement-parser tarea 4.3, decisión 14): dibuja un
 * `PdfTextDocument` (del pintor de diseños) con `pdfkit`, en memoria. Fechas de creación fijas; nada se escribe a
 * disco y NINGÚN PDF se versiona (D255, D281, D282). Fuente monoespaciada de 8 pt (avance 4,8 pt por carácter).
 */
export interface RenderOptions {
  /** Contraseña solo de propietario: el documento se abre sin contraseña (D319). */
  readonly ownerPassword?: string;
  /** Contraseña de apertura (el lector debe rechazarlo: ya lo rechaza DOCUMENTS). */
  readonly userPassword?: string;
  /** Páginas (1-based) que se dibujan como una imagen en lugar de texto (PDF escaneado). */
  readonly imagePages?: readonly number[];
  /** Autor declarado en los metadatos (no debe llegar al sistema). */
  readonly author?: string;
  /** Conserva solo esta fracción de los bytes (tabla de referencias truncada). */
  readonly truncate?: number;
}

const ASCENT = 0.629 * 8;

/** PNG de un solo color generado por código (sin binarios versionados). */
export function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function renderPdf(doc: PdfTextDocument, options: RenderOptions = {}): Promise<Uint8Array> {
  const fixed = new Date(Date.UTC(2026, 3, 2, 14, 0, 0));
  const pdf = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    compress: true,
    info: {
      Title: 'SINTETICO',
      Author: options.author ?? 'SINTETICO',
      Creator: 'SINTETICO',
      Producer: 'SINTETICO',
      CreationDate: fixed,
      ModDate: fixed,
    },
    ...(options.ownerPassword !== undefined ? { ownerPassword: options.ownerPassword } : {}),
    ...(options.userPassword !== undefined ? { userPassword: options.userPassword } : {}),
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve) => pdf.on('end', () => resolve()));
  for (const page of doc.pages) {
    pdf.addPage({ size: [page.width, page.height], margin: 0 });
    if (options.imagePages?.includes(page.number)) {
      pdf.image(solidPng(32, 32, [200, 200, 200]), 0, 0, { width: page.width, height: page.height });
      continue;
    }
    pdf.font('Courier').fontSize(8);
    for (const item of page.items) {
      pdf.text(item.text, item.x, item.y - ASCENT, { lineBreak: false });
    }
  }
  pdf.end();
  await ended;
  const bytes = new Uint8Array(Buffer.concat(chunks));
  return options.truncate === undefined
    ? bytes
    : bytes.subarray(0, Math.floor(bytes.length * options.truncate));
}

/** Documento de `pages` páginas con una línea de texto cada una (límite de páginas). */
export async function renderBlankPages(pages: number): Promise<Uint8Array> {
  const doc: PdfTextDocument = {
    pageCount: pages,
    pages: Array.from({ length: pages }, (_, i) => ({
      number: i + 1,
      width: 300,
      height: 200,
      items: [{ text: `Pagina sintetica ${i + 1}`, x: 20, y: 40, width: 80, height: 8 }],
    })),
  };
  return renderPdf(doc);
}
