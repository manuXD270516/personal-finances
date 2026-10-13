import { dec } from '@pf/shared-kernel';

/**
 * Muestra retenida como anómala de un par (`fx.exchange_rate` con `anomaly_flagged`) con la fecha de su revisión
 * (`fx.rate_anomaly_review.decided_at`; `null` mientras está pendiente).
 */
export interface RetainedSample {
  readonly rateId: string;
  /** `created_at` de la fila: instante en que se retuvo (RFC 3339 UTC). */
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly provider: string;
  readonly rateType: string;
  readonly value: string;
  readonly baselineRateId: string;
  /** Variación con signo (`"6.6116"`). */
  readonly variationPct: string;
}

/** Foto del grupo vigente de un par (refine-rate-anomaly-alert-grouping, design decisiones 1 y 3). */
export interface AnomalyGroup {
  /** Primera muestra del grupo: su id es la clave estable del grupo. */
  readonly anchorRateId: string;
  /** `created_at` del ancla. */
  readonly firstRetainedAt: string;
  /** Todas las muestras del grupo, revisadas o no. */
  readonly retainedCount: number;
  /** Muestras del grupo aún sin revisar (≥ 1). */
  readonly pendingCount: number;
  /** Providers distintos de las pendientes, en orden alfabético. */
  readonly providers: readonly string[];
  /** La pendiente más antigua: destino del enlace del aviso. */
  readonly reviewRateId: string;
  /** La pendiente con mayor variación absoluta (empate ⇒ la más reciente). */
  readonly peak: RetainedSample;
}

const ms = (iso: string): number => Date.parse(iso);

/** Orden estable de la historia del par: `(created_at, id)`. */
function byCreation(a: RetainedSample, b: RetainedSample): number {
  return ms(a.createdAt) - ms(b.createdAt) || (a.rateId < b.rateId ? -1 : a.rateId > b.rateId ? 1 : 0);
}

/**
 * DS `AnomalyGroupResolver`, puro. Cada muestra retenida está *pendiente* desde su `createdAt` hasta el `decidedAt` de
 * su revisión (indefinidamente si no se revisó). Un grupo es una "isla" de muestras cuyos intervalos de pendencia se
 * solapan sin interrupción: ordenadas por `(createdAt, id)`, una muestra abre un grupo nuevo si su `createdAt` es mayor
 * o igual que el mayor `decidedAt` de todas las anteriores (todas estaban revisadas cuando llegó). El grupo vigente es
 * la última isla y existe solo si tiene alguna pendiente. No depende del orden de entrada.
 */
export function resolveAnomalyGroup(retained: readonly RetainedSample[]): AnomalyGroup | null {
  const ordered = [...retained].sort(byCreation);
  let start = 0;
  // Mayor fecha de revisión de lo anterior; `Infinity` si alguna anterior sigue pendiente (nada la interrumpe).
  let reviewedUntil = Number.NEGATIVE_INFINITY;
  ordered.forEach((sample, index) => {
    if (index > 0 && ms(sample.createdAt) >= reviewedUntil) start = index;
    reviewedUntil = Math.max(
      reviewedUntil,
      sample.decidedAt === null ? Number.POSITIVE_INFINITY : ms(sample.decidedAt),
    );
  });
  const members = ordered.slice(start);
  const pending = members.filter((s) => s.decidedAt === null);
  const anchor = members[0];
  const oldest = pending[0];
  if (!anchor || !oldest) return null;
  let peak = oldest;
  for (const s of pending) {
    const a = dec(s.variationPct).abs();
    const b = dec(peak.variationPct).abs();
    // `pending` va de la más antigua a la más reciente: `gte` deja la más reciente en el empate.
    if (a.gte(b)) peak = s;
  }
  return {
    anchorRateId: anchor.rateId,
    firstRetainedAt: anchor.createdAt,
    retainedCount: members.length,
    pendingCount: pending.length,
    providers: [...new Set(pending.map((s) => s.provider))].sort(),
    reviewRateId: oldest.rateId,
    peak,
  };
}
