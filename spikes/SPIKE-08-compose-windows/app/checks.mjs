import net from 'node:net';
import pg from 'pg';

export async function checkPg() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    // readiness also requires the migration to be applied
    const r = await c.query("select count(*)::int as n from spike.migration_marker");
    return { ok: true, migrations: r.rows[0].n };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    c.end().catch(() => {});
  }
}

export function checkValkey() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://redis:6379');
  return new Promise((resolve) => {
    const s = net.createConnection({ host: url.hostname, port: Number(url.port || 6379) });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(1500, () => done({ ok: false, error: 'timeout' }));
    s.on('error', (e) => done({ ok: false, error: e.message }));
    s.on('connect', () => s.write('PING\r\n'));
    s.on('data', (d) => done(d.toString().startsWith('+PONG') ? { ok: true } : { ok: false, error: d.toString() }));
  });
}
