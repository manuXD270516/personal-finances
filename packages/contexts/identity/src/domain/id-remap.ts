/**
 * `IdRemap` (openspec add-workspace-export, design decisión 8; D101): la importación NUNCA preserva identificadores.
 * Cada id del archivo recibe un UUIDv7 nuevo que CONSERVA el instante del original (el orden temporal de los
 * registros no cambia); el mapa `viejo → nuevo` se usa para reescribir también los UUID que viajan dentro de
 * estructuras JSON (diffs de auditoría, recorridos, instantáneas de cierre). Los UUID que no están en el mapa
 * (usuarios, eventos, tasas globales) se conservan tal cual.
 */
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_ONLY.test(value);

/** Milisegundos del instante codificado en un UUIDv7, o `null` si no es versión 7. */
export function uuidV7Millis(id: string): number | null {
  if (!isUuid(id) || id[14] !== '7') return null;
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

/** UUIDv7 con el instante dado y 74 bits aleatorios (`random`: ≥ 10 bytes). */
export function uuidV7At(epochMillis: number, random: Uint8Array): string {
  if (random.length < 10) throw new RangeError('uuidV7At necesita 10 bytes aleatorios');
  const ts = Math.floor(epochMillis).toString(16).padStart(12, '0').slice(-12);
  const b = Array.from(random.subarray(0, 10), (x) => x);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const rand = b.map(hex);
  const variant = hex(((b[2] as number) & 0x3f) | 0x80);
  const version = hex(((b[0] as number) & 0x0f) | 0x70);
  return (
    `${ts.slice(0, 8)}-${ts.slice(8, 12)}-${version}${rand[1]}-${variant}${rand[3]}-` +
    rand.slice(4, 10).join('')
  );
}

export type RandomBytes = (length: number) => Uint8Array;

export class IdRemap {
  private readonly forward = new Map<string, string>();
  private readonly used = new Set<string>();

  constructor(
    private readonly random: RandomBytes,
    private readonly fallbackMillis: () => number,
  ) {}

  /** Nuevo id del original (idempotente: el mismo id siempre da el mismo resultado). */
  assign(oldId: string): string {
    const key = oldId.toLowerCase();
    const existing = this.forward.get(key);
    if (existing !== undefined) return existing;
    const millis = uuidV7Millis(key) ?? this.fallbackMillis();
    let fresh = uuidV7At(millis, this.random(10));
    while (this.used.has(fresh) || this.forward.has(fresh)) fresh = uuidV7At(millis, this.random(10));
    this.used.add(fresh);
    this.forward.set(key, fresh);
    return fresh;
  }

  /** Fija una correspondencia explícita (p. ej. el workspace de origen → el workspace nuevo). */
  set(oldId: string, newId: string): void {
    this.forward.set(oldId.toLowerCase(), newId.toLowerCase());
    this.used.add(newId.toLowerCase());
  }

  get(oldId: string): string | undefined {
    return this.forward.get(oldId.toLowerCase());
  }

  has(oldId: string): boolean {
    return this.forward.has(oldId.toLowerCase());
  }

  get size(): number {
    return this.forward.size;
  }

  /** Pares `viejo → nuevo` (para el informe de trazabilidad de la importación). */
  entries(): IterableIterator<[string, string]> {
    return this.forward.entries();
  }

  /** Reescribe todo UUID mapeado dentro de un texto (los desconocidos quedan igual). */
  replaceText(text: string): string {
    if (text.length === 36 && UUID_ONLY.test(text)) return this.forward.get(text.toLowerCase()) ?? text;
    if (text.length < 36) return text;
    return text.replace(UUID_ANY, (m) => this.forward.get(m.toLowerCase()) ?? m);
  }

  /** Reescribe los UUID mapeados en cualquier valor JSON (cadenas, claves de objeto, arreglos y objetos anidados). */
  replaceDeep<T>(value: T): T {
    return this.walk(value) as T;
  }

  private walk(value: unknown): unknown {
    if (typeof value === 'string') return this.replaceText(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>))
        out[this.replaceText(k)] = this.walk(v);
      return out;
    }
    return value;
  }
}
