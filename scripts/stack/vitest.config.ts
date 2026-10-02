import { defineConfig } from 'vitest/config';

// Unitarios (sin Docker). La suite que levanta el stack Compose real es `test:stack` (vitest.stack.config.ts).
export default defineConfig({
  test: { include: ['test/*.test.ts'], exclude: ['test/fixtures/**', 'test/stack/**'], testTimeout: 30_000 },
});
