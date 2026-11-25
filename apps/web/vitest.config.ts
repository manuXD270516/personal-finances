import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // next-intl/middleware importa `next/server` sin extensión: Vite lo resuelve solo si el paquete no se externaliza.
    server: { deps: { inline: ['next-intl'] } },
  },
});
