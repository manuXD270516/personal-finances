// Next.js llama a `register()` una vez al arrancar el servidor.
export async function register(): Promise<void> {
  // NEXT_RUNTIME es una constante que Next inyecta en compilación (no es configuración de runtime): permite
  // que el bundle edge no incluya la validación de configuración, que usa APIs de Node.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateWebConfig } = await import('./instrumentation-node');
    validateWebConfig();
  }
}
