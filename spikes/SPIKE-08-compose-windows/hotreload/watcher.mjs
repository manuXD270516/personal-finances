// chokidar watcher: WATCH_MODE=native|polling, POLL_INTERVAL ms. Serves /time and /token over HTTP.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { watch } from 'chokidar';

const mode = process.env.WATCH_MODE ?? 'native';
const interval = Number(process.env.POLL_INTERVAL ?? 100);
const dir = '/app/src';
let last = { token: null, at: null, events: 0 };

const parse = (f) => Number(/token = (\d+)/.exec(readFileSync(f, 'utf8'))?.[1] ?? NaN);
const t0 = Date.now();
const w = watch(dir, { usePolling: mode === 'polling', interval, binaryInterval: interval, ignoreInitial: true, awaitWriteFinish: false });
w.on('ready', () => console.log(`READY mode=${mode} interval=${interval} files=${Object.values(w.getWatched()).flat().length} in ${Date.now() - t0}ms`));
w.on('change', (f) => {
  if (!f.endsWith('token.mjs')) return;
  const at = Date.now();
  try {
    const token = parse(f);
    last = { token, at, events: last.events + 1 };
    console.log(`DETECT token=${token} at=${at} lat_raw=${at - token}`);
  } catch (e) { console.log('read error', e.message); }
});
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/time') return res.end(JSON.stringify({ now: Date.now() }));
  res.end(JSON.stringify(last));
}).listen(8080);
