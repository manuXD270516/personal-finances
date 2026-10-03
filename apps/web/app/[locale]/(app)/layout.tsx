import type { ReactNode } from 'react';
import { requireSession } from '../../../src/bff/require-session';
import { AppFrame } from '../../../src/ui/AppFrame';
import { SessionProvider } from '../../../src/ui/session-context';

export const dynamic = 'force-dynamic';

/** Páginas autenticadas: sesión validada en el servidor; el navegador solo recibe datos, nunca tokens. */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <SessionProvider>
      <AppFrame>{children}</AppFrame>
    </SessionProvider>
  );
}
