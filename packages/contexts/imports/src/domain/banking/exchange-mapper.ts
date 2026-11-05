import { LocalDate, Instant, dec, type Decimal } from '@pf/shared-kernel';
import type { RowIssue } from '../types.js';
import type { ExternalFee, ExternalRecord, ExternalRecordType } from './provider.js';

/**
 * `ExchangeRecordMapper` (openspec add-banking-providers decisión 8, docs/13 §6.4; D343 y D344): traduce un registro
 * externo de un exchange en filas propuestas para la etapa de normalización del pipeline. Dominio puro, con montos
 * decimales exactos (nunca `number`, INV-001) y sin redondeo: un monto con más decimales que la escala de la moneda de
 * la cuenta deja la fila inválida (INV-003).
 *
 * | Registro   | Propuesta                                                                                         |
 * |------------|---------------------------------------------------------------------------------------------------|
 * | TRADE      | Conversión entre las cuentas mapeadas de sus dos activos (bruto entregado, NETO recibido, comisión) |
 * | DEPOSIT    | Ingreso en la cuenta del activo, señal `POSSIBLE_TRANSFER`                                          |
 * | WITHDRAWAL | Gasto, señal `POSSIBLE_TRANSFER`; comisión de red como gasto `FEES` aparte                          |
 * | FEE        | Gasto `FEES`                                                                                       |
 * | REWARD     | Ingreso «sin categoría de ingreso» (las reglas lo clasifican)                                       |
 * | P2P, OTHER | Fila excluida `CONNECTION_RECORD_UNSUPPORTED`                                                      |
 */

export const PROVIDER_REF_PREFIX = 'imports.provider:' as const;

/** Cuenta mapeada de un activo: su moneda debe ser la del activo (INV-002). */
export interface MappedAccount {
  readonly accountId: string;
  readonly currency: string;
  readonly scale: number;
}
export type AssetResolver = (asset: string) => MappedAccount | null;

export type ExternalRowKind = 'EXPENSE' | 'INCOME' | 'CONVERSION';

/** Datos que la conexión aporta a una fila del staging (columna `external` de `staged_transaction`). */
export interface ExternalRowData {
  readonly providerId: string;
  readonly recordType: ExternalRecordType;
  /** Referencia externa de la transacción (idempotencia entre archivo y API del mismo exchange). */
  readonly ref: { readonly namespace: string; readonly id: string };
  /** Cuenta de la fila (la del activo; en una conversión, la cuenta origen). */
  readonly accountId: string | null;
  readonly kind: ExternalRowKind | null;
  readonly signal: 'POSSIBLE_TRANSFER' | null;
  /** `FEES`: la propuesta de categoría es la de sistema «comisiones». */
  readonly categoryHint: 'FEES' | null;
  /** Instante de ejecución informado por el exchange (ISO UTC). */
  readonly executedAt: string;
  readonly conversion?: {
    readonly counterAccountId: string;
    readonly counterAmount: { readonly amount: string; readonly currency: string };
    readonly fee?: { readonly amount: string; readonly currency: string };
    readonly quotedRate?: { readonly base: string; readonly quote: string; readonly value: string };
  };
}

export interface MappedRow {
  /** Identificador de la fila en el staging (`TRADE:T-1001`). */
  readonly externalId: string;
  readonly bookingDate: string | null;
  readonly bookingTime: string | null;
  /** Con signo (salida negativa), a la escala de la moneda de la cuenta; `null` si no es representable. */
  readonly signedAmount: string | null;
  readonly currency: string | null;
  readonly description: string | null;
  readonly issues: readonly RowIssue[];
  readonly external: ExternalRowData;
}

export interface MapperContext {
  readonly providerId: string;
  /** Exchange que firma las referencias (`BINANCE`). */
  readonly exchange: string;
  readonly timeZone: string;
  readonly resolve: AssetResolver;
}

const error = (code: RowIssue['code']): RowIssue => ({ code, severity: 'ERROR' });

export function refNamespace(exchange: string, type: ExternalRecordType): string {
  return `${PROVIDER_REF_PREFIX}${exchange}:${type}`;
}

/** Fecha y hora locales (`YYYY-MM-DD`, `HH:mm:ss`) del instante en la zona del workspace. */
export function localDateTime(
  executedAt: string,
  timeZone: string,
): { readonly date: string; readonly time: string } | null {
  let instant: Instant;
  try {
    instant = Instant.parse(executedAt);
  } catch {
    return null;
  }
  const date = LocalDate.ofInstant(instant, timeZone).toString();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant.epochMillis));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date, time: `${get('hour')}:${get('minute')}:${get('second')}` };
}

/** Monto decimal exacto a la escala: `null` si el texto no es un decimal positivo o excede la escala. */
function exact(amount: string, scale: number): Decimal | null {
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;
  const d = dec(amount);
  return d.decimalPlaces() <= scale ? d : null;
}

const fmt = (d: Decimal, scale: number): string => d.toFixed(scale);

/** Mapea un registro; devuelve una o más filas (un retiro con comisión de red devuelve dos). */
export function mapExternalRecord(record: ExternalRecord, ctx: MapperContext): readonly MappedRow[] {
  const when = localDateTime(record.executedAt, ctx.timeZone);
  const base = {
    bookingDate: when?.date ?? null,
    bookingTime: when?.time ?? null,
  };
  const dateIssues: RowIssue[] = when === null ? [error('IMPORT_INVALID_DATE')] : [];
  const stagedId = `${record.type}:${record.externalId}`;
  const external = (
    over: Partial<ExternalRowData> & Pick<ExternalRowData, 'accountId' | 'kind'>,
  ): ExternalRowData => ({
    providerId: ctx.providerId,
    recordType: record.type,
    ref: { namespace: refNamespace(ctx.exchange, record.type), id: record.externalId },
    signal: null,
    categoryHint: null,
    executedAt: record.executedAt,
    ...over,
  });
  const unsupported = (): MappedRow => ({
    externalId: stagedId,
    ...base,
    signedAmount: null,
    currency: null,
    description: record.description,
    issues: [...dateIssues, error('CONNECTION_RECORD_UNSUPPORTED')],
    external: external({ accountId: null, kind: null }),
  });

  switch (record.type) {
    case 'TRADE':
      return mapTrade(record, ctx, base, dateIssues, stagedId, external);
    case 'DEPOSIT':
    case 'REWARD': {
      const leg = record.legs.find((l) => l.direction === 'IN');
      if (!leg) return [unsupported()];
      return [
        singleLeg(record, ctx, base, dateIssues, stagedId, leg.asset, leg.amount, 'IN', external, {
          kind: 'INCOME',
          signal: record.type === 'DEPOSIT' ? 'POSSIBLE_TRANSFER' : null,
          categoryHint: null,
        }),
      ];
    }
    case 'WITHDRAWAL': {
      const leg = record.legs.find((l) => l.direction === 'OUT');
      if (!leg) return [unsupported()];
      const rows: MappedRow[] = [
        singleLeg(record, ctx, base, dateIssues, stagedId, leg.asset, leg.amount, 'OUT', external, {
          kind: 'EXPENSE',
          signal: 'POSSIBLE_TRANSFER',
          categoryHint: null,
        }),
      ];
      record.fees
        .filter((f) => f.kind === 'NETWORK')
        .forEach((fee, i) =>
          rows.push(feeRow(record, ctx, base, dateIssues, fee, `network${i === 0 ? '' : i}`, external)),
        );
      return rows;
    }
    case 'FEE': {
      const out = record.legs.find((l) => l.direction === 'OUT');
      const fee: ExternalFee | undefined = out
        ? { asset: out.asset, amount: out.amount, kind: 'PROVIDER' }
        : record.fees[0];
      if (!fee) return [unsupported()];
      return [
        singleLeg(record, ctx, base, dateIssues, stagedId, fee.asset, fee.amount, 'OUT', external, {
          kind: 'EXPENSE',
          signal: null,
          categoryHint: 'FEES',
        }),
      ];
    }
    default:
      return [unsupported()];
  }
}

type Base = { readonly bookingDate: string | null; readonly bookingTime: string | null };
type ExternalFactory = (
  over: Partial<ExternalRowData> & Pick<ExternalRowData, 'accountId' | 'kind'>,
) => ExternalRowData;

function singleLeg(
  record: ExternalRecord,
  ctx: MapperContext,
  base: Base,
  dateIssues: readonly RowIssue[],
  stagedId: string,
  asset: string,
  amount: string,
  direction: 'IN' | 'OUT',
  external: ExternalFactory,
  over: Pick<ExternalRowData, 'kind' | 'signal' | 'categoryHint'>,
): MappedRow {
  const account = ctx.resolve(asset);
  const issues: RowIssue[] = [...dateIssues];
  let signed: string | null = null;
  if (account === null) {
    issues.push(error('CONNECTION_ASSET_UNMAPPED'));
  } else {
    const value = exact(amount, account.scale);
    if (value === null || value.isZero()) issues.push(error('IMPORT_INVALID_AMOUNT'));
    else signed = (direction === 'OUT' ? '-' : '') + fmt(value, account.scale);
  }
  return {
    externalId: stagedId,
    ...base,
    signedAmount: signed,
    currency: account?.currency ?? null,
    description: record.description,
    issues,
    external: external({ accountId: account?.accountId ?? null, ...over }),
  };
}

/** Comisión de red de un retiro: gasto aparte con la categoría de sistema `FEES`. */
function feeRow(
  record: ExternalRecord,
  ctx: MapperContext,
  base: Base,
  dateIssues: readonly RowIssue[],
  fee: ExternalFee,
  suffix: string,
  external: ExternalFactory,
): MappedRow {
  const id = `${record.externalId}:${suffix}`;
  const row = singleLeg(record, ctx, base, dateIssues, `FEE:${id}`, fee.asset, fee.amount, 'OUT', external, {
    kind: 'EXPENSE',
    signal: null,
    categoryHint: 'FEES',
  });
  return {
    ...row,
    external: {
      ...row.external,
      recordType: 'FEE',
      ref: { namespace: refNamespace(ctx.exchange, 'FEE'), id },
    },
  };
}

function mapTrade(
  record: ExternalRecord,
  ctx: MapperContext,
  base: Base,
  dateIssues: readonly RowIssue[],
  stagedId: string,
  external: ExternalFactory,
): readonly MappedRow[] {
  const out = record.legs.find((l) => l.direction === 'OUT');
  const into = record.legs.find((l) => l.direction === 'IN');
  const description = record.description ?? (out && into ? `${into.asset}/${out.asset}` : null);
  const invalid = (extra: RowIssue): MappedRow => ({
    externalId: stagedId,
    ...base,
    signedAmount: null,
    currency: null,
    description,
    issues: [...dateIssues, extra],
    external: external({ accountId: null, kind: 'CONVERSION' }),
  });
  if (!out || !into) return [invalid(error('CONNECTION_RECORD_UNSUPPORTED'))];
  const source = ctx.resolve(out.asset);
  const target = ctx.resolve(into.asset);
  if (!source || !target) return [invalid(error('CONNECTION_ASSET_UNMAPPED'))];
  if (source.accountId === target.accountId || source.currency === target.currency) {
    return [invalid(error('CONNECTION_RECORD_UNSUPPORTED'))];
  }
  const gross = exact(out.amount, source.scale);
  const received = exact(into.amount, target.scale);
  if (gross === null || received === null || gross.isZero() || received.isZero()) {
    return [invalid(error('IMPORT_INVALID_AMOUNT'))];
  }

  // Comisión del exchange tal como la informa: en el activo recibido se descuenta de lo recibido (neto); en el
  // entregado forma parte del bruto entregado. Una comisión en un tercer activo es un gasto aparte.
  let net = received;
  let fee: { amount: string; currency: string } | undefined;
  const extraRows: MappedRow[] = [];
  const issues: RowIssue[] = [...dateIssues];
  let feeSeq = 0;
  for (const f of record.fees) {
    const amountFee =
      f.asset === into.asset
        ? exact(f.amount, target.scale)
        : f.asset === out.asset
          ? exact(f.amount, source.scale)
          : null;
    if (f.asset === into.asset || f.asset === out.asset) {
      if (amountFee === null || fee !== undefined) {
        issues.push(error('IMPORT_INVALID_AMOUNT'));
        continue;
      }
      const scale = f.asset === into.asset ? target.scale : source.scale;
      if (f.asset === into.asset) {
        net = received.minus(amountFee);
        if (net.lte(0)) issues.push(error('IMPORT_INVALID_AMOUNT'));
      }
      fee = { amount: fmt(amountFee, scale), currency: f.asset };
    } else {
      feeSeq += 1;
      extraRows.push(feeRow(record, ctx, base, dateIssues, f, `fee${feeSeq}`, external));
    }
  }

  const quoted = record.quotedPrice;
  const row: MappedRow = {
    externalId: stagedId,
    ...base,
    signedAmount: `-${fmt(gross, source.scale)}`,
    currency: source.currency,
    description,
    issues,
    external: external({
      accountId: source.accountId,
      kind: 'CONVERSION',
      conversion: {
        counterAccountId: target.accountId,
        counterAmount: { amount: fmt(net, target.scale), currency: target.currency },
        ...(fee ? { fee } : {}),
        ...(quoted ? { quotedRate: { base: quoted.base, quote: quoted.quote, value: quoted.price } } : {}),
      },
    }),
  };
  return [row, ...extraRows];
}
