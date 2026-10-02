// Overhead aproximado del SDK OTel: autocannon contra la API con y sin `--import ./dist/otel.js`.
// Mismo proceso Nest, mismo pino (stdout a archivo). Alterna modos para reducir sesgo térmico.
import { spawn } from 'node:child_process';
import { openSync, writeFileSync, mkdirSync } from 'node:fs';
import autocannon from 'autocannon';

const DURATION = Number(process.env.BENCH_DURATION ?? 15);
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 2);
// BENCH_RATE=N -> carga fija (req/s totales) para medir latencia a carga realista en vez de saturación
const RATE = process.env.BENCH_RATE ? { overallRate: Number(process.env.BENCH_RATE) } : {};
const OUT = process.env.BENCH_OUT ?? 'results/bench.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:61918',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=spike-bench,service.version=sha-spike',
  OTEL_SEMCONV_STABILITY_OPT_IN: 'http',
  OTEL_NODE_RESOURCE_DETECTORS: 'env,os,serviceinstance',
};

function start(file, name, sdk) {
  mkdirSync('logs', { recursive: true });
  const out = openSync(`logs/bench-${name}-${sdk ? 'sdk' : 'nosdk'}.log`, 'w');
  const args = sdk ? ['--import', './dist/otel.js', file] : [file];
  return spawn(process.execPath, args, { env: { ...baseEnv, OTEL_SERVICE_NAME: `bench-${name}` }, stdio: ['ignore', out, out] });
}
async function waitUp(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('no levantó ' + url);
}
const run = (opts) => new Promise((res, rej) => autocannon(opts, (e, r) => (e ? rej(e) : res(r))));
async function rssMiB(pid) {
  const ps = spawn('powershell', ['-NoProfile', '-c', `(Get-Process -Id ${pid}).WorkingSet64`]);
  let s = '';
  ps.stdout.on('data', (d) => (s += d));
  await new Promise((r) => ps.on('close', r));
  return Math.round(Number(s.trim()) / 1048576);
}

const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const sdk of [false, true]) {
    const worker = start('dist/worker/main.js', 'worker', sdk);
    const api = start('dist/api/main.js', 'api', sdk);
    await waitUp('http://127.0.0.1:61980/ping');
    await waitUp('http://127.0.0.1:61981/health/live');
    const rssIdle = await rssMiB(api.pid);
    await run({ url: 'http://127.0.0.1:61980/ping', connections: 20, duration: 3 }); // warmup
    const ping = await run({ url: 'http://127.0.0.1:61980/ping', connections: 50, duration: DURATION, ...RATE });
    const tx = await run({
      url: 'http://127.0.0.1:61980/transactions',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer BENCH' },
      body: JSON.stringify({ kind: 'expense' }),
      connections: 20,
      duration: DURATION,
      ...RATE,
    });
    const rssLoaded = await rssMiB(api.pid);
    const row = {
      round,
      mode: sdk ? 'sdk' : 'nosdk',
      ping_rps: Math.round(ping.requests.average),
      ping_p50_ms: ping.latency.p50,
      ping_p99_ms: ping.latency.p99,
      ping_errors: ping.errors + ping.non2xx,
      tx_rps: Math.round(tx.requests.average),
      tx_p50_ms: tx.latency.p50,
      tx_p99_ms: tx.latency.p99,
      tx_errors: tx.errors + tx.non2xx,
      api_rss_idle_mib: rssIdle,
      api_rss_after_mib: rssLoaded,
    };
    console.log(JSON.stringify(row));
    results.push(row);
    api.kill();
    worker.kill();
    await sleep(1500);
  }
}
const avg = (mode, k) => Math.round(results.filter((r) => r.mode === mode).reduce((a, r) => a + r[k], 0) / ROUNDS);
const summary = {};
for (const k of ['ping_rps', 'tx_rps', 'ping_p99_ms', 'tx_p99_ms', 'api_rss_idle_mib', 'api_rss_after_mib']) {
  summary[k] = { nosdk: avg('nosdk', k), sdk: avg('sdk', k) };
}
summary.ping_rps.overheadPct = Math.round((1 - summary.ping_rps.sdk / summary.ping_rps.nosdk) * 1000) / 10;
summary.tx_rps.overheadPct = Math.round((1 - summary.tx_rps.sdk / summary.tx_rps.nosdk) * 1000) / 10;
mkdirSync('results', { recursive: true });
writeFileSync(OUT, JSON.stringify({ durationS: DURATION, rounds: ROUNDS, rate: RATE, results, summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
