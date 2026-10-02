import http from 'node:http';
import { checkPg, checkValkey } from './checks.mjs';
import { installShutdown, log } from './shutdown.mjs';

const port = Number(process.env.HTTP_PORT ?? 8080);
const drainMs = Number(process.env.PF_DRAIN_MS ?? 2000);

const server = http.createServer(async (req, res) => {
  if (req.url === '/health/live') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"live"}');
    return;
  }
  if (req.url === '/health/ready') {
    const [pgR, vk] = await Promise.all([checkPg(), checkValkey()]);
    const ok = pgR.ok && vk.ok;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: ok ? 'ready' : 'not-ready', postgres: pgR, valkey: vk }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => log(`api listening on ${port}`));

installShutdown('api', async () => {
  log('closing HTTP server (stop accepting new connections)');
  await new Promise((r) => server.close(r));
  log(`simulating in-flight drain ${drainMs}ms`);
  await new Promise((r) => setTimeout(r, drainMs));
});
