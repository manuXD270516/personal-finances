/**
 * PRNG sembrado y determinista para el dataset Demo (docs/29 §3): mulberry32 sobre enteros de 32 bits. Prohibidos
 * `Math.random`, `Date.now()` y `new Date()` sin argumentos en `src/demo/dataset/**` (ESLint). Cada módulo usa un
 * sub-generador derivado de `seed ⊕ fnv1a(nombre)` para que añadir un módulo no altere los datos de los demás.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Sub-generador estable por nombre de módulo. */
  static derive(seed: number, name: string): SeededRandom {
    return new SeededRandom((seed ^ fnv1a(name)) >>> 0);
  }

  /** Entero sin signo de 32 bits. */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Entero uniforme en [min, max] (ambos incluidos). */
  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`rango inválido [${min}, ${max}]`);
    }
    return min + (this.nextUint32() % (max - min + 1));
  }

  /** Entero grande uniforme en [min, max] (unidades mínimas de dinero). */
  bigint(min: bigint, max: bigint): bigint {
    if (max < min) throw new RangeError('rango inválido');
    const span = max - min + 1n;
    const raw = (BigInt(this.nextUint32()) << 32n) | BigInt(this.nextUint32());
    return min + (raw % span);
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new RangeError('lista vacía');
    return item;
  }
}

/** FNV-1a de 32 bits (estable entre plataformas). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
