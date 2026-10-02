import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Cada caso lanza dependency-cruiser en un proceso aparte sobre un mini repositorio temporal.
  test: { include: ['test/*.test.ts'], exclude: ['test/fixtures/**'], testTimeout: 120_000 },
});
