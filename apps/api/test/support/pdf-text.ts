import { inflateSync } from 'node:zlib';

/**
 * Texto visible de un PDF generado con fuentes estándar (pdfkit): descomprime los content streams (FlateDecode) y
 * junta los literales de `Tj`/`TJ`. Suficiente para verificar el contenido de los reportes exportados en tests.
 */
export function pdfVisibleText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/gu;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1] as string, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|\((.*?)\)\s*Tj/gu)) {
      if (t[1] !== undefined) {
        out.push(
          [...t[1].matchAll(/<([0-9a-fA-F]+)>|\((.*?)\)/gu)]
            .map((p) => (p[1] ? Buffer.from(p[1], 'hex').toString('latin1') : (p[2] ?? '')))
            .join(''),
        );
      } else if (t[2]) out.push(Buffer.from(t[2], 'hex').toString('latin1'));
      else out.push(t[3] ?? '');
    }
  }
  return out.join(' ');
}

/** Cantidad de páginas (`/Type /Page`). */
export const pdfPageCount = (pdf: Uint8Array): number =>
  (
    Buffer.from(pdf)
      .toString('latin1')
      .match(/\/Type \/Page\b/gu) ?? []
  ).length;
