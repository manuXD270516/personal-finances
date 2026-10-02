import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './env';

export const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json(
    { type: 'about:blank', status, title: code, code, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } },
  );

export const sidOf = (req: NextRequest): string | undefined => req.cookies.get(SESSION_COOKIE)?.value;

export function setSessionCookie(res: NextResponse, sid: string) {
  res.cookies.set(SESSION_COOKIE, sid, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** returnTo solo puede ser una ruta relativa propia (evita open redirect). */
export const safeReturnTo = (v: string | null): string => (v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/app');
