import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
});
