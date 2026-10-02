import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // Imagen de producción mínima (docs/20): `.next/standalone` + `.next/static` + `public`.
  output: 'standalone',
  // Monorepo: el trazado de dependencias parte de la raíz del workspace.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
