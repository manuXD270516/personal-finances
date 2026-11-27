/** Error de uso / precondición: mensaje claro y código de salida explícito (sin stack). */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}
