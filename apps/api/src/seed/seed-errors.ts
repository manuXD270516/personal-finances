/** Seed rechazada por política (entorno, perfil o estado de la BD): `main.seed` sale con código 64. */
export class SeedRejectedError extends Error {
  override readonly name = 'SeedRejectedError';
}
