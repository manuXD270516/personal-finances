import { defineConfig } from 'vitest/config';

// Unitarios (sin Docker). Vite 8/Oxc emite decorator metadata con emitDecoratorMetadata (SPIKE-04): sin SWC.
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  // `test/perf/*.test.ts`: utilidades del benchmark nightly; `test/support/*.test.ts`: helpers de tests (sin Docker).
  test: {
    include: ['src/**/*.test.ts', 'test/perf/**/*.test.ts', 'test/support/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
  },
});
