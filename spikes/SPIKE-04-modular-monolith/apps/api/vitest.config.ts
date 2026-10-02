import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vite (oxc/esbuild) NO emite `design:paramtypes`; SWC sí (legacyDecorator + decoratorMetadata).
// Con @Inject(token) explícito en todos los constructores el spike no necesita metadata,
// pero SWC se mantiene para que DTOs con class-validator/ValidationPipe funcionen igual que en build.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
    }),
  ],
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: { include: ['test/**/*.test.ts'] },
});
