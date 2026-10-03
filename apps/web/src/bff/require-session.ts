import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './bff';
import { getBff } from './runtime';

/**
 * Para layouts/páginas protegidas (Server Components): valida la sesión contra `iam.bff_session`. Sin cookie ⇒
 * login del BFF; cookie de una sesión cerrada o expirada ⇒ página "sesión expirada" (pide un nuevo login).
 */
export async function requireSession(): Promise<void> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) redirect('/api/bff/auth/login?returnTo=%2F');
  const session = await getBff().currentSession(sid);
  if (!session) redirect('/auth/error?reason=expired');
}
