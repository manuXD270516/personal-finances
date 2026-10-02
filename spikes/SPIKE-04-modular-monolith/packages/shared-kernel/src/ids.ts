declare const brand: unique symbol;
export type Branded<T, B extends string> = T & { readonly [brand]: B };

/** Generador de IDs inyectable (determinismo en tests; UUIDv7 en producción). */
export interface IdGenerator {
  next(): string;
}
