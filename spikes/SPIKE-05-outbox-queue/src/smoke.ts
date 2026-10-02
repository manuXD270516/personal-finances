import { makePool, migrate, resetData } from './db.js';
import { recordTransaction } from './api.js';
import { Relay } from './relay.js';
import { makeOption, type OptionId } from './options.js';
import { sleep } from './config.js';
import { v4 } from 'uuid';
const pool = makePool();
await migrate(pool);
for (const id of (process.argv[2] ?? 'ABC').split('') as OptionId[]) {
  await resetData(pool);
  const opt = makeOption(id, pool);
  await opt.init();
  const relay = new Relay(pool, opt.publisher, { onError: (e) => console.error('relay', e) });
  await relay.start();
  await opt.startConsumer({ concurrency: 4 });
  const acc = v4();
  for (let i = 0; i < 20; i++) await recordTransaction(pool, { accountId: acc, amount: '1.50' });
  await sleep(3000);
  const r = await pool.query('select * from app.balance');
  console.log(id, opt.label, r.rows, await opt.counts());
  await relay.stop(); await opt.stopConsumer(); await opt.close();
}
await pool.end();
