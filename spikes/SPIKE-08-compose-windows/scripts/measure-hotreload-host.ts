// SPIKE-08 — Mode A baseline: `node --watch` running directly on Windows over D:\ (no container, no bind mount).
// Usage: pnpm tsx scripts/measure-hotreload-host.ts [--iterations=8]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ITER = Number(process.argv.find((a) => a.startsWith('--iterations='))?.split('=')[1] ?? 8);
const DIR = resolve(ROOT, 'hotreload/work-host');
const PORT = 61892;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keepAlive = setInterval(() => {}, 1000);

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
writeFileSync(resolve(DIR, 'app.mjs'), readFileSync(resolve(ROOT, 'hotreload/src/app.mjs'), 'utf8').replace('listen(8080)', `listen(${PORT})`));
writeFileSync(resolve(DIR, 'token.mjs'), 'export const token = 0;\n');
const child = spawn(process.execPath, ['--watch', resolve(DIR, 'app.mjs')], { stdio: 'ignore' });
await sleep(1500);

const lats: (number | null)[] = [];
for (let i = 0; i < ITER; i++) {
  const token = Date.now();
  writeFileSync(resolve(DIR, 'token.mjs'), `export const token = ${token};\n`);
  let lat: number | null = null;
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    try {
      const s = (await (await fetch(`http://127.0.0.1:${PORT}/token`, { signal: AbortSignal.timeout(500) })).json()) as any;
      if (s.token === token) { lat = s.at - token; break; }
    } catch { /* restarting */ }
    await sleep(5);
  }
  lats.push(lat);
  await sleep(800);
}
child.kill();
clearInterval(keepAlive);
rmSync(DIR, { recursive: true, force: true });
const ok = lats.filter((x): x is number => x !== null).sort((a, b) => a - b);
const res = { location: 'D: (host Windows, Mode A)', mode: 'node-watch', detected: `${ok.length}/${ITER}`, p50: ok[Math.floor(ok.length / 2)], max: ok.at(-1), all: lats };
writeFileSync(resolve(ROOT, 'results/06b-hotreload-host.json'), JSON.stringify(res, null, 2));
console.log(res);
