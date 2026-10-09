import type { Money, RateAttribution, ResolvedRate } from '../dashboard/types';

/**
 * Tipos del contrato `getNetWorthHistory` (`GET /workspaces/{workspaceId}/reports/net-worth/history`,
 * finance-api.v1.yaml; openspec add-net-worth-evolution). Los importes son `DecimalString` en la moneda de reporte
 * (INV-001): nunca `number`.
 */
export interface NetWorthPoint {
  /** Etiqueta del periodo financiero (`YYYY-MM` del inicio). */
  readonly period: string;
  readonly periodId: string;
  /** Fecha de corte: fin del periodo, u hoy si el periodo está en curso. */
  readonly asOf: string;
  readonly assets: string;
  readonly liabilities: string;
  readonly netWorth: string;
  /** Variación del neto respecto al punto anterior; `null` en el primero. */
  readonly change: string | null;
  readonly comparable: boolean;
  readonly complete: boolean;
  /** Saldos nativos sin tasa vigente a la fecha (excluidos de los totales). */
  readonly unconverted: readonly Money[];
  readonly source: 'COMPUTED' | 'SNAPSHOT';
  readonly closed: boolean;
  readonly partial: boolean;
  readonly ratesUsed: readonly ResolvedRate[];
}

export interface NetWorthHistory {
  readonly reportingCurrency: string;
  readonly points: readonly NetWorthPoint[];
  readonly meta: {
    readonly generatedAt: string;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly dataFreshness?: string;
    readonly ratesUsed: readonly ResolvedRate[];
    readonly attributions: readonly RateAttribution[];
  };
}
