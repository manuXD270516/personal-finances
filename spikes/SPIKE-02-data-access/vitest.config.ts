import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // cada archivo usa sus propios workspaces; se ejecutan en serie para medir sin interferencia
    fileParallelism: false,
  },
});
