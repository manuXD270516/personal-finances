import { defineConfig } from 'vitest/config';

// Tests de dominio/aplicación: sin Nest, sin SWC, sin reflect-metadata.
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: { include: ['test/**/*.test.ts'] },
});
