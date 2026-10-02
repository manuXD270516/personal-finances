import { defineConfig } from 'vitest/config';

// Suite de contenedores (TC-PLATFORM-STACK-*): proyecto Compose desechable `pfos-test` con puertos propios.
// Secuencial y lenta (build de imágenes + Keycloak): no forma parte de `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/stack/**/*.stack.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
