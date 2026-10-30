import { Instant, LocalDate } from '@pf/shared-kernel';
import {
  canonicalSignedAmount,
  decodeText,
  emptyRecord,
  error,
  failed,
  joinDescription,
  validIsoDate,
  warning,
  withCurrencyMismatch,
} from './reader-support.js';
import type {
  ParseOptions,
  ParsedStatement,
  SniffResult,
  StatementBalance,
  StatementParser,
  StatementRecord,
} from './statement.js';

/**
 * Lector OFX (openspec add-import-pipeline decisión 5). Un único tokenizador propio para 1.x (SGML, cierre de etiquetas
 * opcional) y 2.x (XML): NO usa un parser XML, así que no existe resolución de DTD, entidades externas ni expansión
 * (XXE / "billion laughs"); un `<!DOCTYPE>` o `<!ENTITY>` se rechaza sin resolverlo. Profundidad acotada.
 */
export const OFX_MAX_DEPTH = 32;

type Token =
  | { readonly kind: 'open'; readonly name: string }
  | { readonly kind: 'close'; readonly name: string }
  | { readonly kind: 'text'; readonly value: string };

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Solo las cinco entidades predefinidas y las numéricas; cualquier otra queda literal (nunca se resuelve). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,5});/gu, (whole, name: string) => {
    if (name.startsWith('#x')) return safeCodePoint(Number.parseInt(name.slice(2), 16)) ?? whole;
    if (name.startsWith('#')) return safeCodePoint(Number.parseInt(name.slice(1), 10)) ?? whole;
    return ENTITIES[name] ?? whole;
  });
}

function safeCodePoint(cp: number): string | null {
  return Number.isInteger(cp) && cp >= 0x20 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
    ? String.fromCodePoint(cp)
    : null;
}

/** Agregados OFX: su cierre es obligatorio también en SGML 1.x (solo las hojas pueden omitirlo). */
const OFX_AGGREGATES: ReadonlySet<string> = new Set([
  'OFX',
  'BANKMSGSRSV1',
  'CREDITCARDMSGSRSV1',
  'STMTTRNRS',
  'CCSTMTTRNRS',
  'STMTRS',
  'CCSTMTRS',
  'BANKTRANLIST',
  'STMTTRN',
]);

class OfxSyntaxError extends Error {
  constructor(readonly pointer: string) {
    super('ofx');
  }
}

function* tokenize(text: string): Generator<Token> {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      const tail = text.slice(i).trim();
      if (tail !== '') yield { kind: 'text', value: decodeEntities(tail) };
      return;
    }
    const between = text.slice(i, lt).trim();
    if (between !== '') yield { kind: 'text', value: decodeEntities(between) };
    const gt = text.indexOf('>', lt);
    if (gt < 0) throw new OfxSyntaxError('tag');
    const body = text.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (body.startsWith('!--')) {
      const end = text.indexOf('-->', lt);
      if (end < 0) throw new OfxSyntaxError('comment');
      i = end + 3;
      continue;
    }
    if (body.startsWith('![CDATA[')) {
      const end = text.indexOf(']]>', lt);
      if (end < 0) throw new OfxSyntaxError('cdata');
      yield { kind: 'text', value: text.slice(lt + 9, end).trim() };
      i = end + 3;
      continue;
    }
    if (/^!(doctype|entity|element|attlist)/iu.test(body)) throw new OfxSyntaxError('dtd');
    if (body.startsWith('?') || body.startsWith('!')) continue;
    if (body.startsWith('/')) {
      yield { kind: 'close', name: body.slice(1).trim().toUpperCase() };
      continue;
    }
    const selfClosing = body.endsWith('/');
    const name = (selfClosing ? body.slice(0, -1) : body).split(/\s/u)[0]?.toUpperCase() ?? '';
    if (!/^[A-Z][A-Z0-9_.]*$/u.test(name)) throw new OfxSyntaxError('tag');
    yield { kind: 'open', name };
    if (selfClosing) yield { kind: 'close', name };
  }
}

/** Fecha y hora de negocio de un `DTPOSTED`. Sin desfase: literal; con desfase: instante ⇒ zona del workspace. */
export function parseOfxDateTime(
  raw: string,
  timeZone: string,
): { readonly date: string; readonly time: string | null } | null {
  const m =
    /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?(?:\.\d{1,3})?)?\s*(?:\[\s*([+-]?\d+(?:\.\d+)?)(?::[A-Za-z]+)?\s*\])?$/u.exec(
      raw.trim(),
    );
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const literal = validIsoDate(y, mo, d);
  if (!literal) return null;
  if (m[4] === undefined) return { date: literal, time: null };
  const [hh, mi, ss] = [Number(m[4]), Number(m[5]), Number(m[6] ?? '0')];
  if (hh > 23 || mi > 59 || ss > 59) return null;
  const two = (v: number) => String(v).padStart(2, '0');
  if (m[7] === undefined) return { date: literal, time: `${two(hh)}:${two(mi)}:${two(ss)}` };
  const offsetMinutes = Math.round(Number.parseFloat(m[7]) * 60);
  const utcMs = Date.UTC(y, mo - 1, d, hh, mi, ss) - offsetMinutes * 60_000;
  const instant = Instant.ofEpochMillis(utcMs);
  const date = LocalDate.ofInstant(instant, timeZone).toString();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant.toDate());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date, time: `${get('hour')}:${get('minute')}:${get('second')}` };
}

interface RawTxn {
  [field: string]: string;
}

export class OfxReader implements StatementParser {
  readonly format = 'OFX' as const;

  sniff(head: Uint8Array): SniffResult | null {
    const text = decodeText(head.subarray(0, 4096));
    if (text === null) return null;
    if (/^\s*OFXHEADER\s*:/iu.test(text) || /<OFX[\s>]/iu.test(text)) {
      return { format: 'OFX', confidence: 'HIGH' };
    }
    return null;
  }

  parse(bytes: Uint8Array, options: ParseOptions): ParsedStatement {
    const text = decodeText(bytes);
    if (text === null) return failed('OFX', 'IMPORT_PARSE_FAILED', 'encoding');
    const txns: RawTxn[] = [];
    const ledger: RawTxn = {};
    const period: RawTxn = {};
    let curdef: string | null = null;
    let sawOfx = false;
    try {
      const stack: string[] = [];
      let pending: string | null = null; // etiqueta abierta sin valor todavía
      let current: RawTxn | null = null;
      for (const token of tokenize(text)) {
        if (token.kind === 'open') {
          if (token.name === 'OFX') sawOfx = true;
          stack.push(token.name);
          if (stack.length > OFX_MAX_DEPTH) throw new OfxSyntaxError('depth');
          pending = token.name;
          if (token.name === 'STMTTRN') {
            current = {};
            if (txns.length >= options.maxRows) {
              return failed('OFX', 'IMPORT_TOO_MANY_ROWS', null);
            }
          }
        } else if (token.kind === 'text') {
          if (pending !== null && stack[stack.length - 1] === pending) {
            const owner = stack[stack.length - 2];
            if (current !== null && owner === 'STMTTRN') current[pending] = token.value;
            else if (owner === 'LEDGERBAL') ledger[pending] = token.value;
            else if (owner === 'BANKTRANLIST') period[pending] = token.value;
            else if (pending === 'CURDEF') curdef = token.value.trim().toUpperCase();
            stack.pop(); // hoja SGML: no trae cierre
            pending = null;
          }
        } else {
          pending = null;
          const at = stack.lastIndexOf(token.name);
          if (at < 0) continue; // cierre de una hoja ya cerrada
          // Cerrar un agregado con otro agregado hijo todavía abierto: el bloque interior no cerró.
          const unclosed = stack.slice(at + 1).find((name) => OFX_AGGREGATES.has(name));
          if (unclosed !== undefined) throw new OfxSyntaxError(unclosed);
          stack.length = at;
          if (token.name === 'STMTTRN' && current !== null) {
            txns.push(current);
            current = null;
          }
        }
      }
      // Un agregado sin cerrar (archivo truncado o bloque de movimientos abierto) es un error estructural: la hoja SGML
      // puede omitir su cierre, el agregado no. Se informa la ubicación (la etiqueta), nunca texto del archivo.
      const open = stack.find((name) => OFX_AGGREGATES.has(name));
      if (open !== undefined) throw new OfxSyntaxError(open);
    } catch (err) {
      if (err instanceof OfxSyntaxError) return failed('OFX', 'IMPORT_PARSE_FAILED', err.pointer);
      throw err;
    }
    if (!sawOfx) return failed('OFX', 'IMPORT_PARSE_FAILED', 'OFX');

    const { timeZone, accountCurrency: code, currencyScale: scale } = options;
    const records: StatementRecord[] = txns.map((t, idx) => {
      const issues = [];
      const rec = emptyRecord(idx + 1);
      const posted = t['DTPOSTED'] === undefined ? null : parseOfxDateTime(t['DTPOSTED'], timeZone);
      if (!posted) issues.push(error('IMPORT_INVALID_DATE'));
      const amount = t['TRNAMT'] === undefined ? null : canonicalSignedAmount(t['TRNAMT'], code, scale);
      if (amount === null) issues.push(error('IMPORT_INVALID_AMOUNT'));
      const description = joinDescription(t['NAME'], t['MEMO']);
      if (description.truncated) issues.push(warning('IMPORT_DESCRIPTION_TRUNCATED'));
      const valueRaw = t['DTUSER'];
      const value = valueRaw === undefined ? null : parseOfxDateTime(valueRaw, timeZone);
      return {
        ...rec,
        bookingDate: posted?.date ?? null,
        time: posted?.time ?? null,
        valueDate: value?.date ?? null,
        amount,
        currency: curdef,
        description: description.text,
        externalId: t['FITID']?.trim() || null,
        reference: t['CHECKNUM']?.trim() || t['REFNUM']?.trim() || null,
        issues,
      };
    });

    const closing =
      ledger['BALAMT'] === undefined ? null : canonicalSignedAmount(ledger['BALAMT'], code, scale);
    const asOf = ledger['DTASOF'] === undefined ? null : parseOfxDateTime(ledger['DTASOF'], timeZone);
    const from = period['DTSTART'] === undefined ? null : parseOfxDateTime(period['DTSTART'], timeZone);
    const to = period['DTEND'] === undefined ? null : parseOfxDateTime(period['DTEND'], timeZone);
    const statement: StatementBalance | null =
      closing !== null || from !== null || to !== null
        ? {
            openingBalance: null,
            closingBalance: closing,
            closingDate: asOf?.date ?? null,
            periodFrom: from?.date ?? null,
            periodTo: to?.date ?? null,
          }
        : null;

    const mismatch = curdef !== null && curdef !== code;
    return {
      format: 'OFX',
      records: mismatch ? withCurrencyMismatch(records) : records,
      statement,
      declaredCurrency: curdef,
      failure: null,
      needsMapping: [],
    };
  }
}
