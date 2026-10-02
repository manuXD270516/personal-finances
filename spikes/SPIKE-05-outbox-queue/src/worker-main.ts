// Proceso worker standalone (se ejecuta en un contenedor Linux para probar SIGTERM/SIGKILL reales).
import { makePool } from './db.js';
import { makeOption, type OptionId } from './options.js';

const id = (process.env.OPTION ?? 'A') as OptionId;
const workMs = Number(process.env.JOB_MS ?? 4000);
const pool = makePool(10);
const opt = makeOption(id, pool);

await opt.startConsumer({
  concurrency: 2,
  workMs,
  onStart: (env) => console.log(`START ${env.eventId}`),
  onEvent: (r, env) => console.log(`DONE ${r} ${env.eventId}`),
});
console.log(`READY option=${id} (${opt.label}) pid=${process.pid}`);

let stopping = false;
async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  const t0 = Date.now();
  console.log(`SIGNAL ${sig}: dejando de tomar jobs y esperando los activos`);
  await opt.stopConsumer(); // BullMQ: worker.close() | pg-boss: offWork({wait:true})
  await opt.close();
  await pool.end();
  console.log(`CLEAN_EXIT after ${Date.now() - t0}ms`);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// En Windows, Ctrl+Break llega como SIGBREAK; SIGTERM vía kill() termina el proceso sin ejecutar handlers.
if (process.platform === 'win32') process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
