// Tiny healthcheck client (no curl/wget needed in runtime image).
const url = process.argv[2] ?? 'http://127.0.0.1:8080/health/ready';
fetch(url, { signal: AbortSignal.timeout(2500) })
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
