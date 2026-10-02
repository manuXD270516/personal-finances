// SPIKE-08 — measures `docker compose --profile core up -d --wait` in several scenarios.
// Usage: pnpm tsx scripts/measure-startup.ts [--cold-pull] [--runs=3]
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = ['compose', '-p', 'pf-spike-08', '-f', resolve(ROOT, 'compose.yaml')];
const ALL = ['--profile', 'deps', '--profile', 'core', '--profile', 'seed', '--profile', 'observability'];
const runs = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 3);

function run(args: string[], quiet = true): { code: number; ms: number; out: string } {
  const t0 = performance.now();
  const r = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', shell: false });
  const ms = Math.round(performance.now() - t0);
  if (!quiet || r.status !== 0) console.log(r.stdout, r.stderr);
  return { code: r.status ?? 1, ms, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
const compose = (args: string[]) => run([...BASE, ...args]);
const up = () => compose(['--profile', 'core', 'up', '-d', '--wait', '--wait-timeout', '180']);

const results: Record<string, number[]> = {};
const rec = (k: string, ms: number) => ((results[k] ??= []).push(ms), console.log(`${k}: ${ms} ms`));

if (process.argv.includes('--cold-pull')) {
  compose([...ALL, 'down', '-v', '--remove-orphans']);
  run(['rmi', 'valkey/valkey:8-alpine']); // image pulled by this spike only
  const b = compose(['--profile', 'core', 'build', '--no-cache']);
  rec('cold_build_no_cache', b.ms);
  const u = up();
  if (u.code !== 0) throw new Error('cold up failed');
  rec('cold_up_with_valkey_pull', u.ms);
}

for (let i = 0; i < runs; i++) {
  compose([...ALL, 'down', '-v', '--remove-orphans']);
  const u = up();
  if (u.code !== 0) throw new Error('up failed');
  rec('cold_volumes_up (images cached, empty volumes: initdb+migrate)', u.ms);
}
for (let i = 0; i < runs; i++) {
  compose([...ALL, 'down', '--remove-orphans']);
  const u = up();
  if (u.code !== 0) throw new Error('up failed');
  rec('warm_down_up (volumes kept, containers recreated)', u.ms);
}
for (let i = 0; i < runs; i++) {
  compose(['--profile', 'core', 'stop']);
  const u = up();
  if (u.code !== 0) throw new Error('up failed');
  rec('warm_stop_up (containers exist, stopped)', u.ms);
}
{
  const u = up();
  rec('noop_up (already running)', u.ms);
}

mkdirSync(resolve(ROOT, 'results'), { recursive: true });
const summary = Object.fromEntries(
  Object.entries(results).map(([k, v]) => [k, { runs_ms: v, median_ms: [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] }]),
);
writeFileSync(resolve(ROOT, 'results/startup.json'), JSON.stringify({ at: new Date().toISOString(), summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
