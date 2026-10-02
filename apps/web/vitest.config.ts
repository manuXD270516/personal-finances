import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: { include: ['src/**/*.test.ts'] },
});
