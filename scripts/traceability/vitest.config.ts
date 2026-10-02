import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Los fixtures contienen archivos *.test.ts de repositorios simulados: no son tests de este paquete.
  test: { include: ['test/*.test.ts'], exclude: ['test/fixtures/**'], testTimeout: 60_000 },
});
