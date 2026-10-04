import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  // `test/live/*.test.ts`: validador del smoke en vivo contra respuestas grabadas (sin red).
  test: { include: ['src/**/*.test.ts', 'test/live/**/*.test.ts'], exclude: ['**/*.int.test.ts'] },
});
