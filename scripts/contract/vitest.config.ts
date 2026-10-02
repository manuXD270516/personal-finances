import { defineConfig } from 'vitest/config';

// Unitarios (sin Docker): reglas Spectral propias.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], exclude: ['test/**/*.int.test.ts'] },
});
