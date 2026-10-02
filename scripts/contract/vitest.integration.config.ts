import { defineConfig } from 'vitest/config';

// Integración: oasdiff en contenedor efímero (imagen fijada por digest). Requiere Docker.
export default defineConfig({
  test: { include: ['test/**/*.int.test.ts'], testTimeout: 180_000, hookTimeout: 180_000 },
});
