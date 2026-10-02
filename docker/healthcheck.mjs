// Healthcheck de contenedor sin curl/wget en la imagen (docs/20 §8):
//   node /usr/local/lib/pfos/healthcheck.mjs <url> [timeoutMs]
// Sale 0 si la URL responde 2xx dentro del plazo; 1 en cualquier otro caso. La URL la fija quien declara el
// healthcheck (Dockerfile HEALTHCHECK, compose `healthcheck`, task definition): siempre el loopback del propio
// contenedor, nunca la dirección de otro servicio.
const [url, timeoutArg] = process.argv.slice(2);
if (!url) {
  process.stderr.write('usage: healthcheck.mjs <url> [timeoutMs]\n');
  process.exit(2);
}
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(Number(timeoutArg ?? 2500)) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
