import { writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { go } from './finance.js';

/**
 * Extracto CSV SINTÉTICO (fechas, descripciones y montos ficticios en BOB, escala 2) y su importación por la UI hasta
 * la vista previa (paso 3). Ningún dato real. Formato: `Fecha;Descripción;Monto`, dd/MM/yyyy, coma decimal, negativo
 * es salida. Cada fila es única (descripción con número de línea) para que ninguna sea un duplicado exacto.
 */
export interface SyntheticRow {
  date: string;
  description: string;
  amount: string;
}

export function syntheticStatement(rows: number): { csv: string; rowAt: (n: number) => SyntheticRow } {
  const rowAt = (n: number): SyntheticRow => {
    const day = String((n % 28) + 1).padStart(2, '0');
    const cents = String((n * 37) % 100).padStart(2, '0');
    return {
      date: `${day}/10/2026`,
      description: `COMPRA SINTETICA ${String(n).padStart(4, '0')}`,
      amount: `-${10 + (n % 90)},${cents}`,
    };
  };
  const lines = ['Fecha;Descripción;Monto'];
  for (let n = 1; n <= rows; n += 1) {
    const r = rowAt(n);
    lines.push(`${r.date};${r.description};${r.amount}`);
  }
  return { csv: lines.join('\n') + '\n', rowAt };
}

/** Escribe el CSV en `path` y recorre el asistente (archivo, columnas) hasta la vista previa. */
export async function importSyntheticCsv(
  page: Page,
  bankId: string,
  path: string,
  rows: number,
): Promise<void> {
  writeFileSync(path, syntheticStatement(rows).csv, 'utf8');
  await go(page, `/cuentas/${bankId}`);
  await page.getByTestId('import-csv').click();
  await page.getByTestId('import-legacy-toggle').click();
  await page.getByTestId('import-legacy-file').setInputFiles(path);
  await page.getByTestId('import-legacy-upload-submit').click();
  await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '2');
  await page.getByTestId('mapping-date').selectOption('0');
  await page.getByTestId('mapping-description').selectOption('1');
  await page.getByTestId('mapping-amount').selectOption('2');
  await page.getByTestId('mapping-sign').selectOption('NEGATIVE_IS_OUTFLOW');
  await page.getByTestId('mapping-date-format').selectOption('dd/MM/yyyy');
  await page.getByTestId('mapping-decimal').selectOption(',');
  await page.getByTestId('mapping-apply').click();
  await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3', { timeout: 120_000 });
}

/** Carga todas las filas de la vista previa (con «Cargar más» si existe); sirve igual con o sin páginas. */
export async function loadAllPreviewRows(page: Page): Promise<void> {
  await page.getByTestId('import-row').first().waitFor();
  const more = page.getByTestId('import-load-more');
  while (await more.isVisible().catch(() => false)) {
    const before = await page.getByTestId('import-row').count();
    await more.click();
    await expect
      .poll(() => page.getByTestId('import-row').count(), { timeout: 30_000 })
      .toBeGreaterThan(before);
  }
}
