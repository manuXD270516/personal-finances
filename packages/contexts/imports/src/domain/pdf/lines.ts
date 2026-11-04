import { normalizeLiteral } from './literals.js';
import type { PdfTextItem, PdfTextPage } from './text-document.js';

/**
 * Palabras y líneas de una página (decisión 7, pasos 1 y 2). Los fragmentos se ordenan por posición (el orden del
 * flujo de contenido se ignora: resuelve el desorden de BNB); fragmentos contiguos de una línea base se unen sin
 * espacio si la separación es menor que `0,15 × alto` (texto dibujado carácter por carácter) y con un espacio hasta
 * `1,0 × alto`; una separación mayor corta la palabra (celda distinta).
 */
const JOIN_GAP = 0.15;
const SPACE_GAP = 1.0;
const LINE_TOLERANCE = 0.5;

export interface PdfWord {
  readonly text: string;
  readonly normalized: string;
  readonly left: number;
  readonly right: number;
}

export interface PdfLine {
  /** Posición de la línea en la página, desde 1 (se informa en las líneas no reconocidas). */
  readonly index: number;
  readonly page: number;
  readonly y: number;
  readonly words: readonly PdfWord[];
  /** Texto de la línea normalizado (para comparar con literales). */
  readonly normalized: string;
  readonly text: string;
}

function median(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

export function buildLines(page: PdfTextPage): PdfLine[] {
  const items = page.items.filter((i) => i.text.trim() !== '');
  if (items.length === 0) return [];
  const h = median(
    items.map((i) => i.height).filter((v) => v > 0),
    10,
  );
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: PdfTextItem[][] = [];
  let anchorY = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    if (groups.length === 0 || item.y - anchorY > LINE_TOLERANCE * h) {
      groups.push([item]);
      anchorY = item.y;
    } else {
      (groups[groups.length - 1] as PdfTextItem[]).push(item);
    }
  }
  return groups.map((group, i) => {
    const row = [...group].sort((a, b) => a.x - b.x);
    const words: PdfWord[] = [];
    let text = '';
    let left = 0;
    let right = 0;
    const flush = (): void => {
      if (text !== '') words.push({ text, normalized: normalizeLiteral(text), left, right });
    };
    for (const item of row) {
      if (text === '') {
        text = item.text.trim();
        left = item.x;
        right = item.x + item.width;
        continue;
      }
      const gap = item.x - right;
      if (gap < JOIN_GAP * h) {
        text += item.text.trim();
      } else if (gap <= SPACE_GAP * h) {
        text += ` ${item.text.trim()}`;
      } else {
        flush();
        text = item.text.trim();
        left = item.x;
      }
      right = Math.max(right, item.x + item.width);
    }
    flush();
    const joined = words.map((w) => w.text).join(' ');
    return {
      index: i + 1,
      page: page.number,
      y: group[0]?.y ?? 0,
      words,
      normalized: normalizeLiteral(joined),
      text: joined,
    };
  });
}

/** Alto de línea típico de la página (mediana de los fragmentos con alto). */
export function typicalHeight(page: PdfTextPage): number {
  return median(
    page.items.filter((i) => i.text.trim() !== '' && i.height > 0).map((i) => i.height),
    10,
  );
}
