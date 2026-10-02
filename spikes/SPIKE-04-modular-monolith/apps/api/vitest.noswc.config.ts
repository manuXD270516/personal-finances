import { defineConfig } from 'vitest/config';

// Experimento: mismo e2e SIN SWC (transformador por defecto de Vite, sin decorator metadata).
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: { include: ['test/**/*.test.ts'] },
});
