import type { NextConfig } from 'next';
import path from 'node:path';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // CSP completa con nonce (docs/12 §12) queda fuera del spike; solo frame-ancestors/form-action.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; form-action 'self' http://localhost:61681; base-uri 'none'; object-src 'none'" },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // node_modules vive en la raíz del spike (un package.json para web + api + e2e)
  turbopack: { root: path.resolve(import.meta.dirname, '..') },
  async headers() {
    return [
      // /evil (página atacante solo-dev) se excluye: un atacante real no tendría nuestra CSP,
      // y form-action 'self' bloquearía su <form> antes de que el BFF pudiera demostrar la defensa.
      { source: '/((?!evil).*)', headers: securityHeaders },
      { source: '/api/bff/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default config;
