import { normalizeLiteral } from './literals.js';

/**
 * Meses en español por tabla propia (decisión 9): independiente de `Intl`, del locale y de la zona del proceso, sin
 * acentos ni mayúsculas, con las abreviaturas habituales.
 */
const MONTHS: Readonly<Record<string, number>> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};

/** Número de mes (1–12) o `null`. */
export function spanishMonth(name: string): number | null {
  return MONTHS[normalizeLiteral(name).replace(/\.$/u, '')] ?? null;
}
