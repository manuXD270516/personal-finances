/**
 * Lector de texto delimitado (CSV, TSV, texto pegado de una planilla) para la tabla de amortización del banco.
 *
 * Adaptado de `imports/src/domain/csv-sniffer.ts` (add-basic-csv-import): un contexto no puede importar el dominio de
 * otro (dependency-cruiser), así que se copian solo las dos funciones puras que hacen falta (delimitador y registros
 * RFC 4180). Aquí ya llega texto (no hay detección de codificación) y el separador `|` no se admite.
 */

/** En orden de preferencia ante un empate: pegado de planilla (tab), luego `;` y por último `,`. */
export const REFERENCE_DELIMITERS = ['\t', ';', ','] as const;
export type ReferenceDelimiter = (typeof REFERENCE_DELIMITERS)[number];

/** Un registro con su línea física inicial (1-based), para informar errores. */
export interface DelimitedRecord {
  readonly line: number;
  readonly cells: readonly string[];
}

/** Cuenta, fuera de comillas, las apariciones de `delimiter` en cada una de las primeras `maxLines` líneas. */
function delimiterCounts(text: string, delimiter: string, maxLines: number): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let count = 0;
  let hasContent = false;
  for (let i = 0; i < text.length && counts.length < maxLines; i += 1) {
    const ch = text[i] as string;
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasContent = true;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (hasContent) counts.push(count);
      count = 0;
      hasContent = false;
    } else {
      hasContent = true;
      if (!inQuotes && ch === delimiter) count += 1;
    }
  }
  if (hasContent && counts.length < maxLines) counts.push(count);
  return counts;
}

/**
 * Delimitador con el recuento más consistente en las primeras 20 líneas: gana el candidato presente (≥ 1) en más
 * líneas con el mismo recuento; el empate lo desempata el mayor recuento y luego el orden de `REFERENCE_DELIMITERS`.
 */
export function detectDelimiter(text: string): ReferenceDelimiter {
  let best: { delimiter: ReferenceDelimiter; lines: number; perLine: number } | null = null;
  for (const delimiter of REFERENCE_DELIMITERS) {
    const counts = delimiterCounts(text, delimiter, 20);
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    let modeCount = 0;
    let modeLines = 0;
    for (const [perLine, lines] of tally) {
      if (lines > modeLines || (lines === modeLines && perLine > modeCount)) {
        modeCount = perLine;
        modeLines = lines;
      }
    }
    if (modeLines === 0) continue;
    if (!best || modeLines > best.lines || (modeLines === best.lines && modeCount > best.perLine)) {
      best = { delimiter, lines: modeLines, perLine: modeCount };
    }
  }
  return best?.delimiter ?? ';';
}

/**
 * Registros RFC 4180: comillas dobles, `""` como comilla escapada, saltos de línea (`\n`, `\r\n`, `\r`) dentro de
 * campos entrecomillados. Las líneas en blanco (o solo con celdas vacías) se omiten.
 */
export function parseDelimited(text: string, delimiter: ReferenceDelimiter): DelimitedRecord[] {
  const records: DelimitedRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let quotedCell = false;
  let line = 1;
  let recordLine = 1;
  let touched = false;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    quotedCell = false;
  };
  const endRecord = () => {
    endCell();
    if (touched && cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '' && !quotedCell) {
      inQuotes = true;
      quotedCell = true;
      touched = true;
    } else if (ch === delimiter) {
      touched = true;
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      touched = true;
      cell += ch;
    }
  }
  if (touched) endRecord();
  return records;
}
