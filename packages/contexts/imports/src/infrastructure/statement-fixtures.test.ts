import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dec, type Decimal } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';

/**
 * Oráculo de los fixtures sintéticos de extractos bancarios (docs/statement-formats, add-exchange-house-rate-providers
 * 8.3). No es un parser de producto: solo verifica que cada fixture (a) está marcado como sintético, (b) tiene un
 * `expected` coherente en saldos y (c) que el texto imita el formato declarado (mismos números y fechas que el `expected`).
 */

const FORMATS = ['bcp', 'ganadero', 'bisa', 'bnb'] as const;
const DIR = resolve(__dirname, '../../../../../tests/fixtures/imports/statements-bo');

interface Movement {
  readonly section?: string;
  readonly date: string;
  readonly time: string;
  readonly description: string;
  readonly amount: string;
  readonly balance: string | null;
  readonly multiline?: boolean;
  readonly pageBreakCut?: boolean;
}
interface Expected {
  readonly synthetic: boolean;
  readonly formatId: string;
  readonly institution: string;
  readonly currency: string;
  readonly numberFormat: { readonly decimalSeparator: string; readonly thousandsSeparator: string };
  readonly dateFormat: 'YYYYMMDD' | 'DD/MM/YYYY' | 'DD-MM-YYYY';
  readonly layout: string;
  readonly noActivity?: boolean;
  readonly statement: { readonly openingBalance: string; readonly closingBalance: string };
  readonly summary?: Record<string, string>;
  readonly sections?: readonly { readonly name: string; readonly total: string }[];
  readonly movements: readonly Movement[];
}

const load = (id: string): { text: string; expected: Expected } => ({
  text: readFileSync(resolve(DIR, id, 'statement.txt'), 'utf8'),
  expected: JSON.parse(readFileSync(resolve(DIR, id, 'expected.json'), 'utf8')) as Expected,
});

const sum = (values: readonly string[]): Decimal => values.reduce((acc, v) => acc.plus(dec(v)), dec('0'));

/** Formatea un decimal con el separador de la entidad (siempre 2 decimales, HALF_EVEN). */
const formatNumber = (value: string, f: Expected['numberFormat'], signed: boolean): string => {
  const d = dec(value);
  const [int = '0', frac = '00'] = d.abs().toFixed(2, 6 /* ROUND_HALF_EVEN */).split('.');
  const grouped = f.thousandsSeparator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, f.thousandsSeparator) : int;
  return `${signed && d.isNegative() ? '-' : ''}${grouped}${f.decimalSeparator}${frac}`;
};

const formatDate = (iso: string, f: Expected['dateFormat']): string => {
  const [y = '', m = '', d = ''] = iso.split('-');
  if (f === 'YYYYMMDD') return `${y}${m}${d}`;
  return f === 'DD/MM/YYYY' ? `${d}/${m}/${y}` : `${d}-${m}-${y}`;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
/** Token numérico/fecha aislado: no pegado a otros dígitos ni a partes de otro número. */
const hasToken = (text: string, token: string): boolean =>
  new RegExp(`(?<![\\d.,-])${escapeRe(token)}(?![\\d]|[.,]\\d)`).test(text);

describe('Fixtures sintéticos de extractos (oráculo, sin parser de producto)', () => {
  it('[TC-IMPORTS-STMT-001] cada fixture está marcado como sintético y usa una institución ficticia', () => {
    for (const id of FORMATS) {
      const { text, expected } = load(id);
      expect(text.split('\n')[0], id).toMatch(/^\*\*\* SINTETICO:/);
      expect(expected.synthetic, id).toBe(true);
      expect(expected.institution, id).toMatch(/ Demo$/);
      expect(text, id).toContain(expected.institution);
    }
  });

  it('[TC-IMPORTS-STMT-002] saldo inicial + créditos - débitos = saldo final y el saldo corrido cuadra fila a fila', () => {
    for (const id of FORMATS) {
      const { expected } = load(id);
      const { openingBalance, closingBalance } = expected.statement;
      expect(
        dec(openingBalance)
          .plus(sum(expected.movements.map((m) => m.amount)))
          .toFixed(2),
        id,
      ).toBe(dec(closingBalance).toFixed(2));
      let running = dec(openingBalance);
      for (const m of expected.movements) {
        running = running.plus(dec(m.amount));
        // Los importes tienen exactamente 2 decimales: HALF_EVEN no altera nada.
        expect(dec(m.amount).toDecimalPlaces(2, 6).eq(dec(m.amount)), `${id} ${m.amount}`).toBe(true);
        if (m.balance !== null)
          expect(running.toFixed(2), `${id} saldo ${m.balance}`).toBe(dec(m.balance).toFixed(2));
      }
    }
  });

  it('[TC-IMPORTS-STMT-003] los totales declarados coinciden con los movimientos (secciones de BNB, ITF y resumen de BISA)', () => {
    const bnb = load('bnb').expected;
    const credits = bnb.movements.filter((m) => m.section === 'DEPOSITS').map((m) => m.amount);
    const debits = bnb.movements
      .filter((m) => m.section === 'WITHDRAWALS')
      .map((m) => dec(m.amount).abs().toString());
    expect(sum(credits).toFixed(2)).toBe(bnb.sections?.find((s) => s.name === 'DEPOSITS')?.total);
    expect(sum(debits).toFixed(2)).toBe(bnb.sections?.find((s) => s.name === 'WITHDRAWALS')?.total);
    expect(bnb.summary?.totalCredits).toBe(sum(credits).toFixed(2));
    expect(bnb.summary?.totalDebits).toBe(sum(debits).toFixed(2));
    expect(bnb.movements.every((m) => m.balance === null)).toBe(true);

    const gan = load('ganadero');
    const netTotal = gan.expected.movements.reduce((acc, m) => acc.plus(dec(m.amount)), dec('0'));
    expect(dec(gan.expected.statement.openingBalance).plus(netTotal).toFixed(2)).toBe(
      dec(gan.expected.statement.closingBalance).toFixed(2),
    );

    const bisa = load('bisa').expected;
    const s = bisa.summary ?? {};
    const flows = sum(Object.values(s));
    expect(flows.isZero()).toBe(true);
    expect(bisa.statement.openingBalance).toBe(bisa.statement.closingBalance);
  });

  it('[TC-IMPORTS-STMT-004] el texto del fixture contiene los mismos importes, saldos y fechas que el expected, con el formato de la entidad', () => {
    for (const id of FORMATS) {
      const { text, expected } = load(id);
      const signed = expected.layout.startsWith('SIGNED');
      const fmt = (v: string, withSign = false): string => formatNumber(v, expected.numberFormat, withSign);
      expect(hasToken(text, fmt(expected.statement.openingBalance)), `${id} saldo inicial`).toBe(true);
      expect(hasToken(text, fmt(expected.statement.closingBalance)), `${id} saldo final`).toBe(true);
      for (const m of expected.movements) {
        expect(hasToken(text, fmt(m.amount, signed)), `${id} importe ${m.amount}`).toBe(true);
        if (m.balance !== null) expect(hasToken(text, fmt(m.balance)), `${id} saldo ${m.balance}`).toBe(true);
        expect(hasToken(text, formatDate(m.date, expected.dateFormat)), `${id} fecha ${m.date}`).toBe(true);
        expect(text, `${id} hora ${m.time}`).toContain(m.time);
      }
    }
  });

  it('[TC-IMPORTS-STMT-005] los fixtures cubren los casos difíciles: multilínea, corte de página, orden no cronológico, dos secciones y cuenta USD sin actividad', () => {
    const all = Object.fromEntries(FORMATS.map((id) => [id, load(id).expected]));
    expect(all.bcp?.movements.some((m) => m.multiline)).toBe(true);
    expect(all.bcp?.numberFormat.thousandsSeparator).toBe('');
    expect(all.bcp?.movements.some((m) => dec(m.amount).abs().gte(1000))).toBe(true);

    const gan = all.ganadero;
    expect(gan?.movements.some((m) => m.pageBreakCut)).toBe(true);
    const ganText = load('ganadero').text;
    expect(ganText.match(/Página Actual: \d+/g)).toHaveLength(2);
    // La continuación del movimiento cortado aparece tras el encabezado de la página siguiente.
    expect(ganText).toMatch(/Página Actual: 1[\s\S]*?DÉBITO\s+CRÉDITO\s+SALDO\s+FICTICIA BETA Completado/);
    const stamps = (gan?.movements ?? []).map((m) => `${m.date}T${m.time}`);
    expect(stamps.some((s, i) => i > 0 && s < (stamps[i - 1] ?? ''))).toBe(true);
    expect(gan?.movements.some((m) => dec(m.amount).abs().gte(1000))).toBe(true);

    expect(new Set(all.bnb?.movements.map((m) => m.section))).toEqual(new Set(['DEPOSITS', 'WITHDRAWALS']));
    expect(load('bnb').text).toContain('Esta página se dejó en blanco intencionalmente');

    expect(all.bisa?.currency).toBe('USD');
    expect(all.bisa?.numberFormat.decimalSeparator).toBe(',');
    expect(all.bisa?.noActivity).toBe(true);
    expect(all.bisa?.movements).toHaveLength(0);
    expect(load('bisa').text).toContain('Sin Actividad en el Periodo');
  });
});
