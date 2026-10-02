import type { ReactNode } from 'react';

export const metadata = { title: 'PFOS — SPIKE-06 Auth BFF' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 820, margin: '2rem auto', padding: '0 16px' }}>{children}</body>
    </html>
  );
}
