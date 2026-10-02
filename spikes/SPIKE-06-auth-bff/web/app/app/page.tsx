import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/env';
import { getSession } from '@/lib/session';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function AppPage() {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await getSession(sid);
  if (!s) redirect('/api/bff/auth/login?returnTo=/app');
  // Al Client Component solo pasan datos de identidad; nunca tokens.
  return (
    <main>
      <h1 data-testid="welcome">Hola, {s.name ?? s.email}</h1>
      <Dashboard />
    </main>
  );
}
