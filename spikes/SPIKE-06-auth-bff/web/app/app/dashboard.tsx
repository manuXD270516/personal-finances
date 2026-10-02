'use client';
import { useEffect, useState } from 'react';

const WS = '01999a7c-0000-7000-8000-00000000d3e0';

async function bff(method: string, path: string, csrf: string, body?: unknown) {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export default function Dashboard() {
  const [csrf, setCsrf] = useState('');
  const [out, setOut] = useState('');
  useEffect(() => {
    fetch('/api/bff/session').then((r) => r.json()).then((j) => setCsrf(j.csrfToken ?? ''));
  }, []);
  const run = async (method: string, path: string, body?: unknown) => setOut(JSON.stringify(await bff(method, path, csrf, body), null, 2));

  return (
    <section>
      <p data-testid="ready">{csrf ? 'listo' : 'cargando…'}</p>
      <button onClick={() => run('GET', `/api/bff/workspaces/${WS}/accounts`)}>Ver cuentas (VIEWER)</button>{' '}
      <button onClick={() => run('POST', `/api/bff/workspaces/${WS}/transactions`, { description: 'Café', amount: '3500' })}>Crear transacción (EDITOR)</button>{' '}
      <button onClick={() => run('POST', `/api/bff/workspaces/${WS}/periods/2026-09/reopen`, {})}>Reabrir periodo (OWNER)</button>{' '}
      <button
        data-testid="logout"
        onClick={async () => {
          const r = await bff('POST', '/api/bff/auth/logout', csrf, {});
          window.location.assign(r.body.redirectTo);
        }}
      >
        Salir
      </button>
      <pre data-testid="result">{out}</pre>
    </section>
  );
}
