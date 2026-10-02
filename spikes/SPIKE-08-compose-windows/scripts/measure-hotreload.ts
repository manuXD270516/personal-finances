// SPIKE-08 — file-change -> detection/reload latency inside a container.
//   L1  bind mount from D:\ (9p/drvfs), file written by Windows (editor on Windows)
//   L2  ext4 inside the WSL2 VM (named volume; proxy for "repo cloned in WSL2"), file written from Linux
// Modes: chokidar native (inotify), chokidar polling 100 ms / 1000 ms, `node --watch` (process restart).
// Usage: pnpm tsx scripts/measure-hotreload.ts [--iterations=8] [--filler=2000]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const ITER = arg('iterations', 8);
const FILLER = arg('filler', 2000);
const PORT = 61890;
const WPORT = 61891;
const IMAGE = 'pf-spike-08/hotreload:local';
const VOL = 'pf-spike-08_hr-src';
const WORK_D = resolve(ROOT, 'hotreload/work-d/src');
const APP_SRC = readFileSync(resolve(ROOT, 'hotreload/src/app.mjs'), 'utf8');

const docker = (args: string[]) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', shell: false });
  return { code: r.status ?? 1, out: ((r.stdout ?? '') + (r.stderr ?? '')).trim() };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(1000) })).json() as Promise<any>;

async function waitHttp(url: string, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { return await getJson(url); } catch { await sleep(100); }
  }
  throw new Error(`timeout waiting ${url}`);
}

// container_clock - windows_clock, from the sample with minimum RTT
async function clockOffset(): Promise<{ offset: number; rtt: number }> {
  let best = { offset: 0, rtt: Infinity };
  for (let i = 0; i < 15; i++) {
    const t1 = Date.now();
    const { now } = await getJson(`http://127.0.0.1:${PORT}/time`);
    const t2 = Date.now();
    if (t2 - t1 < best.rtt) best = { offset: now - (t1 + t2) / 2, rtt: t2 - t1 };
  }
  return best;
}

function prepareD() {
  rmSync(resolve(ROOT, 'hotreload/work-d'), { recursive: true, force: true });
  mkdirSync(resolve(WORK_D, 'filler'), { recursive: true });
  for (let i = 0; i < FILLER; i++) writeFileSync(resolve(WORK_D, `filler/f${i}.mjs`), `export const v${i} = ${i};\n`);
  copyFileSync(resolve(ROOT, 'hotreload/src/app.mjs'), resolve(WORK_D, 'app.mjs'));
  writeFileSync(resolve(WORK_D, 'token.mjs'), 'export const token = 0;\n');
}

function startWatcher(mount: string, mode: string): string {
  const name = `pf-spike-08-hr-watch`;
  docker(['rm', '-f', name]);
  const env = mode.startsWith('polling')
    ? ['-e', 'WATCH_MODE=polling', '-e', `POLL_INTERVAL=${mode.split('-')[1]}`]
    : ['-e', 'WATCH_MODE=native'];
  const cmd = mode === 'node-watch' ? ['node', '--watch', '/app/src/app.mjs'] : [];
  const r = docker(['run', '-d', '--name', name, '--label', 'com.docker.compose.project=pf-spike-08',
    '-p', `127.0.0.1:${PORT}:8080`, '-v', `${mount}:/app/src`, ...env, IMAGE, ...cmd]);
  if (r.code !== 0) throw new Error(r.out);
  return name;
}

type Sample = { lat: number | null };
async function runScenario(location: 'D' | 'ext4', mode: string) {
  const mount = location === 'D' ? WORK_D : VOL;
  const name = startWatcher(mount, mode);
  await waitHttp(`http://127.0.0.1:${PORT}/time`);
  await sleep(mode === 'node-watch' ? 1500 : 4000); // chokidar initial scan
  const { offset, rtt } = await clockOffset();
  const samples: Sample[] = [];
  for (let i = 0; i < ITER; i++) {
    let token: number;
    let off = 0;
    if (location === 'D') {
      token = Date.now();
      writeFileSync(resolve(WORK_D, 'token.mjs'), `export const token = ${token};\n`);
      off = offset; // writer clock = Windows
    } else {
      token = (await getJson(`http://127.0.0.1:${WPORT}/write`)).token; // writer clock = container clock
    }
    let lat: number | null = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const s = await getJson(`http://127.0.0.1:${PORT}/token`);
        if (s.token === token) { lat = Math.round(s.at - token - off); break; }
      } catch { /* node --watch restarting */ }
      await sleep(5);
    }
    samples.push({ lat });
    await sleep(700 + Math.random() * 600);
  }
  const cpu: string[] = [];
  for (let i = 0; i < 3; i++) cpu.push(docker(['stats', '--no-stream', '--format', '{{.CPUPerc}}', name]).out);
  const logs = docker(['logs', '--tail', '3', name]).out;
  docker(['rm', '-f', name]);
  const ok = samples.map((s) => s.lat).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const res = {
    location, mode, detected: `${ok.length}/${ITER}`,
    p50: ok.length ? ok[Math.floor(ok.length / 2)] : null,
    max: ok.length ? ok[ok.length - 1] : null,
    all: samples.map((s) => s.lat), idleCpu: cpu.join(' / '), clock: { offset: Math.round(offset), rtt }, logs,
  };
  console.log(JSON.stringify(res));
  return res;
}

const keepAlive = setInterval(() => {}, 1000); // fetch+AbortSignal.timeout are unref'd
const modes = ['native', 'polling-100', 'polling-1000', 'node-watch'];
const results = [];
prepareD();
for (const m of modes) results.push(await runScenario('D', m));

docker(['rm', '-f', 'pf-spike-08-hr-writer']);
docker(['volume', 'rm', VOL]);
docker(['volume', 'create', '--label', 'com.docker.compose.project=pf-spike-08', VOL]);
const w = docker(['run', '-d', '--name', 'pf-spike-08-hr-writer', '--label', 'com.docker.compose.project=pf-spike-08',
  '-p', `127.0.0.1:${WPORT}:8081`, '-e', `FILLER=${FILLER}`, '-e', `APP_SRC=${APP_SRC}`, '-v', `${VOL}:/app/src`, IMAGE, 'node', '/opt/w/writer.mjs']);
if (w.code !== 0) throw new Error(w.out);
await waitHttp(`http://127.0.0.1:${WPORT}/`, 30000);
for (const m of modes) results.push(await runScenario('ext4', m));
docker(['rm', '-f', 'pf-spike-08-hr-writer']);
docker(['volume', 'rm', VOL]);
rmSync(resolve(ROOT, 'hotreload/work-d'), { recursive: true, force: true });

writeFileSync(resolve(ROOT, 'results/06-hotreload.json'), JSON.stringify({ at: new Date().toISOString(), iterations: ITER, filler: FILLER, results }, null, 2));
console.table(results.map(({ location, mode, detected, p50, max, idleCpu }) => ({ location, mode, detected, p50, max, idleCpu })));
clearInterval(keepAlive);
