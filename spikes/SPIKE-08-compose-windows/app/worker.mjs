import http from 'node:http';
import { spawn } from 'node:child_process';
import { checkPg, checkValkey } from './checks.mjs';
import { installShutdown, log } from './shutdown.mjs';

const port = Number(process.env.WORKER_HEALTH_PORT ?? 8082);
const drainMs = Number(process.env.PF_DRAIN_MS ?? 3000);
let jobs = 0;

// Fake job loop. Optionally spawn orphaned grandchildren to test zombie reaping (PF_SPAWN_ORPHANS=1).
const timer = setInterval(() => {
  jobs++;
  if (process.env.PF_SPAWN_ORPHANS === '1') {
    // `sh -c "sleep 0.2 &"` exits immediately; the backgrounded sleep is re-parented to PID 1.
    spawn('sh', ['-c', 'sleep 0.2 &'], { stdio: 'ignore' });
  }
}, 500);

const server = http.createServer(async (req, res) => {
  if (req.url === '/health/ready') {
    const [pgR, vk] = await Promise.all([checkPg(), checkValkey()]);
    const ok = pgR.ok && vk.ok;
    res.writeHead(ok ? 200 : 503).end(JSON.stringify({ ok, jobs, pg: pgR, vk }));
    return;
  }
  res.writeHead(200).end(JSON.stringify({ live: true, jobs }));
});
server.listen(port, () => log(`worker health on ${port}`));

installShutdown('worker', async () => {
  clearInterval(timer);
  log(`stopped taking jobs after ${jobs}; finishing in-flight job ${drainMs}ms`);
  await new Promise((r) => setTimeout(r, drainMs));
  server.close();
});
