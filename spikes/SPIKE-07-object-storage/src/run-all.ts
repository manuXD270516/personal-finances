// SPIKE-07 — orquestador: arranque medido, memoria, suite S3, persistencia. (descartable)
// Uso: npx tsx src/run-all.ts [seaweedfs garage rustfs]
// Levanta UN backend a la vez (medición de memoria limpia) dentro del proyecto pf-spike-07.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BACKENDS, type BackendName } from './backends.js';

const PROJECT = 'pf-spike-07';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };

function sh(cmd: string, args: string[], opts: { quiet?: boolean } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (!opts.quiet && r.status !== 0) console.error(`[cmd falló] ${cmd} ${args.join(' ')}\n${r.stderr}`);
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const compose = (profile: string, ...args: string[]) => sh('docker', ['compose', '-p', PROJECT, '--profile', profile, ...args]);
const cname = (svc: string) => `${PROJECT}-${svc}-1`;

async function waitHealthy(svc: string, t0: number, timeoutMs = 120_000) {
  let s3Ready: number | undefined;
  const ep = BACKENDS[svc as BackendName].endpoint;
  while (performance.now() - t0 < timeoutMs) {
    if (s3Ready === undefined) {
      try { await fetch(ep + '/', { signal: AbortSignal.timeout(500) }); s3Ready = performance.now() - t0; } catch {}
    }
    const st = sh('docker', ['inspect', '--format', '{{.State.Health.Status}}', cname(svc)], { quiet: true }).out;
    if (st === 'healthy') return { healthyMs: Math.round(performance.now() - t0), s3ReadyMs: Math.round(s3Ready ?? performance.now() - t0) };
    await sleep(150);
  }
  throw new Error(`${svc} no llegó a healthy`);
}

function parseMiB(s: string) {
  const m = /([\d.]+)\s*([KMG]i?B)/.exec(s);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  return m[2].startsWith('G') ? v * 1024 : m[2].startsWith('K') ? v / 1024 : v;
}
async function memSamples(svc: string, n = 3, gapMs = 3000) {
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const out = sh('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', cname(svc)]).out;
    vals.push(parseMiB(out.split('|')[0]));
    if (i < n - 1) await sleep(gapMs);
  }
  vals.sort((a, b) => a - b);
  return Math.round(vals[Math.floor(vals.length / 2)] * 10) / 10;
}

function runSuite(b: string, phase = 'all') {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/s3-suite.ts', b, `--phase=${phase}`], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  process.stdout.write(out);
  return { code: r.status, out: out.replace(/\x1b\[[0-9;]*m/g, '') };
}

const targets = (process.argv.slice(2).length ? process.argv.slice(2) : ['seaweedfs', 'garage', 'rustfs']) as BackendName[];
mkdirSync('results', { recursive: true });
const summary: Record<string, unknown> = {};

// Asegura un estado limpio SOLO de este proyecto.
for (const b of targets) compose(b, 'down', '-v', '--remove-orphans');

for (const b of targets) {
  const be = BACKENDS[b];
  console.log(`\n================ ${b} (${be.image}) ================`);
  const img = sh('docker', ['image', 'inspect', '--format', '{{.Size}}', be.image]).out;

  // 1) Arranque en frío (imagen ya descargada; volumen vacío)
  let t0 = performance.now();
  compose(b, 'up', '-d', be.service);
  const cold = await waitHealthy(be.service, t0);
  const initT0 = performance.now();
  compose(b, 'up', '-d', `${be.service}-init`);
  const initWait = compose(b, 'wait', `${be.service}-init`);
  const initMs = Math.round(performance.now() - initT0);
  const initLog = compose(b, 'logs', '--no-color', `${be.service}-init`).out;
  writeFileSync(`results/${b}-init.log`, initLog);
  console.log(`arranque frío: s3Ready=${cold.s3ReadyMs}ms healthy=${cold.healthyMs}ms; init=${initMs}ms (exit ${initWait.out})`);

  // 2) Memoria en reposo (30 s tras healthy)
  await sleep(30_000);
  const idleMiB = await memSamples(be.service);
  console.log(`memoria idle: ${idleMiB} MiB`);

  // 3) Suite S3
  const suite = runSuite(b);
  writeFileSync(`results/${b}-suite.log`, suite.out);
  const memAfterMiB = await memSamples(be.service, 1);

  // 4) Persistencia: restart y recreación del contenedor con el mismo volumen nombrado
  runSuite(b, 'persist-write');
  t0 = performance.now();
  compose(b, 'restart', be.service);
  const restart = await waitHealthy(be.service, t0);
  const p1 = runSuite(b, 'persist-check');
  compose(b, 'down'); // sin -v: borra contenedores, conserva volumen
  t0 = performance.now();
  compose(b, 'up', '-d', be.service);
  const recreate = await waitHealthy(be.service, t0);
  compose(b, 'up', '-d', `${be.service}-init`);
  compose(b, 'wait', `${be.service}-init`);
  const initLog2 = compose(b, 'logs', '--no-color', `${be.service}-init`).out;
  writeFileSync(`results/${b}-init-rerun.log`, initLog2);
  const p2 = runSuite(b, 'persist-check');

  const count = (re: RegExp) => (suite.out.match(re) ?? []).length;
  summary[b] = {
    image: be.image,
    imageSizeBytesLocal: Number(img),
    license: be.license,
    coldStart: cold,
    initMs,
    idleMemMiB: idleMiB,
    memAfterSuiteMiB: memAfterMiB,
    restartToHealthy: restart,
    recreateToHealthy: recreate,
    suite: { pass: count(/^PASS/gm), warn: count(/^WARN/gm), fail: count(/^FAIL/gm) },
    persistenceAfterRestart: /PASS .*persistence/.test(p1.out),
    persistenceAfterRecreate: /PASS .*persistence/.test(p2.out),
    initIdempotentOnRerun: /ya existe/.test(initLog2),
  };
  console.log(JSON.stringify(summary[b], null, 2));

  // Detener este backend antes del siguiente (volumen se conserva hasta el teardown final)
  compose(b, 'stop');
}

writeFileSync('results/summary.json', JSON.stringify({ date: new Date().toISOString(), docker: sh('docker', ['version', '--format', '{{.Server.Version}}']).out, node: process.version, results: summary }, null, 2));
console.log('\nresults/summary.json escrito');
