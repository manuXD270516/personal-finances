import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * SOLO DEV: página "atacante" para la prueba CSRF. Se abre desde http://127.0.0.1:61600/evil
 * (sitio distinto de http://localhost:61600) y envía un <form> POST cross-site con body JSON
 * disfrazado de text/plain (truco clásico de CSRF contra APIs JSON).
 */
export default function Evil() {
  if (process.env.BFF_DEV_ENDPOINTS !== '1') notFound();
  return (
    <main>
      <h1>Sitio atacante (dev)</h1>
      <form method="POST" action="http://localhost:61600/api/bff/workspaces/01999a7c-0000-7000-8000-00000000d3e0/transactions" encType="text/plain">
        <input type="hidden" name={'{"description":"csrf-attack","amount":"999999","x":"'} value={'"}'} />
        <button type="submit" data-testid="attack">Ganar un premio</button>
      </form>
    </main>
  );
}
