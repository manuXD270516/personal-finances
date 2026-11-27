import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GIB, HOST_TOOLS_AVAILABLE, PG_IMAGE, Sandbox, epoch } from './harness.js';

const BACKUP = 'deploy/host/pfos-backup.sh';
const LABEL = '20261201-060012F_20261202-060010D';

let sb: Sandbox;
afterEach(() => sb?.dispose());

const infoJson = (size: number): string =>
  JSON.stringify([{ backup: [{ label: LABEL, info: { size }, timestamp: { start: 1, stop: 2 } }] }]);

const runDrill = () => sb.run(BACKUP, ['drill']);

/** Estado limpio: ningún recurso del drill existe al terminar. */
function expectCleanState(): void {
  expect(sb.exists('container', 'pfos-drill-pg')).toBe(false);
  expect(sb.exists('volume', 'pfos-drill-pg')).toBe(false);
  expect(sb.exists('network', 'pfos-drill')).toBe(false);
}

describe.skipIf(!HOST_TOOLS_AVAILABLE)('pfos-backup.sh drill (restore drill mensual del host)', () => {
  it('[TC-PLATFORM-DRILL-001] restaura repo1 con la clave de solo lectura, verifica la copia, registra la duración y avisa éxito al heartbeat', () => {
    sb = new Sandbox();
    sb.set('prod_last', epoch('2026-12-02T08:58:00Z')).set('copy_last', epoch('2026-12-02T08:55:00Z'));

    const r = runDrill();
    expect(r.status, r.stderr).toBe(0);

    const restore = sb.callsMatching(/^docker run .*--name pfos-drill-restore/);
    expect(restore).toHaveLength(1);
    expect(restore[0]).toContain(`--env-file ${sb.etc}/pgbackrest-restore.env`);
    expect(restore[0]).toContain('--repo=1');
    expect(restore[0]).toContain(PG_IMAGE);
    expect(restore[0]).toContain('--network pfos-drill');
    expect(restore[0]).toMatch(/--memory 256m/);

    const start = sb.callsMatching(/^docker run -d --name pfos-drill-pg/);
    expect(start).toHaveLength(1);
    expect(start[0]).toContain('archive_mode=off');
    expect(start[0]).toMatch(/listen_addresses=(''| )/);
    expect(start[0]).toContain('--network pfos-drill');
    expect(start[0]).not.toMatch(/ -p | --publish|pfos_default/);
    expect(start[0]).toContain('--memory 256m');

    // La credencial de lectura y escritura del host nunca llega al drill.
    expect(sb.callsMatching(/pgbackrest\.env(\s|$)/)).toEqual([]);

    const log = sb.drillsLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(
      new RegExp(
        `^2026-12-02T\\d{2}:\\d{2}:\\d{2}Z ok ${LABEL} restore=60 recovery=120 total=180 size=1073741824 gap=180 pgbackrest=2\\.58\\.0$`,
      ),
    );
    expect(sb.heartbeats()).toEqual([{ slug: '/pfos-drill', body: log[0] }]);

    // Orden: red y volumen, restore, arranque, y al final la limpieza.
    const order = [
      /^docker network create pfos-drill/,
      /^docker volume create pfos-drill-pg/,
      /^docker run .*--name pfos-drill-restore/,
      /^docker run -d --name pfos-drill-pg/,
      /^docker rm -f pfos-drill-pg/,
      /^docker volume rm pfos-drill-pg/,
      /^docker network rm pfos-drill/,
    ].map((p) => sb.indexOf(p));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expectCleanState();
  });

  it('[TC-PLATFORM-DRILL-002] un restore que falla avisa /fail al heartbeat con el motivo, deja fail en drills.log y limpia', () => {
    sb = new Sandbox();
    sb.set('restore_exit', 1);

    const r = runDrill();
    expect(r.status).not.toBe(0);

    const log = sb.drillsLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/ fail .* reason=restore$/);
    const beats = sb.heartbeats();
    expect(beats.map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
    expect(beats[0]?.body).toBe(log[0]);
    expect(sb.callsMatching(/^docker run -d /)).toEqual([]);
    expect(sb.callsMatching(/^docker volume rm pfos-drill-pg/)).toHaveLength(1);
    expect(sb.callsMatching(/^docker network rm pfos-drill/)).toHaveLength(1);
    expectCleanState();
  });

  it('[TC-PLATFORM-DRILL-002] falla con el motivo si faltan las precondiciones (placeholders sin completar) y no restaura', () => {
    sb = new Sandbox();
    sb.file('etc/pgbackrest-restore.env', 'PGBACKREST_REPO1_S3_KEY=__set__\n');

    const r = runDrill();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('__set__');
    expect(sb.drillsLog()[0]).toMatch(/ fail .* reason=precondiciones$/);
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
    expect(sb.callsMatching(/--entrypoint pgbackrest .* restore/)).toEqual([]);
  });

  it('[TC-PLATFORM-DRILL-002] si la recuperación no termina en 90 min, falla con tope y limpia', () => {
    sb = new Sandbox();
    // Cada consulta que sigue en recuperación consume 10 min del reloj (el doble de sleep suma otros 10 s).
    sb.set('recovery_polls', 1000).set('recovery_poll_secs', 600);

    const r = runDrill();
    expect(r.status).not.toBe(0);
    expect(sb.drillsLog()[0]).toMatch(/ fail .* reason=recuperacion\(tope_de_90_min\)$/);
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
    expectCleanState();
  });

  it('[TC-PLATFORM-DRILL-003] un asiento descuadrado en la copia hace fallar el drill y las consultas corren sobre la copia, no sobre producción', () => {
    sb = new Sandbox();
    sb.set('unbalanced', 1);

    const r = runDrill();
    expect(r.status).not.toBe(0);

    const queries = sb.callsMatching(/HAVING/);
    expect(queries).toHaveLength(2);
    for (const q of queries) expect(q).toMatch(/^docker exec pfos-drill-pg psql /);
    expect(sb.callsMatching(/^docker compose .*HAVING/)).toEqual([]);
    expect(queries[0]).toContain('sum(amount) <> 0');
    expect(queries[1]).toContain('LEFT JOIN ledger.posting');

    expect(sb.drillsLog()[0]).toMatch(
      / fail .* reason=integridad\(inv004_sin_cuadrar=1,inv005_incompletos=0\)$/,
    );
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
  });

  it('[TC-PLATFORM-DRILL-005] limpia contenedor, volumen y red tras un fallo de integridad y borra antes los restos de un drill interrumpido', () => {
    sb = new Sandbox();
    sb.leftover('volume', 'pfos-drill-pg').set('incomplete', 2);

    const r = runDrill();
    expect(r.status).not.toBe(0);

    const calls = sb.calls();
    const leftoverRm = calls.findIndex((c) => c.startsWith('docker volume rm pfos-drill-pg'));
    const restore = calls.findIndex((c) => c.includes('--name pfos-drill-restore'));
    expect(leftoverRm).toBeGreaterThanOrEqual(0);
    expect(leftoverRm).toBeLessThan(restore);

    // Tras el fallo se vuelve a limpiar todo: contenedor, volumen y red.
    const lastVolumeRm = calls.map((c) => c.startsWith('docker volume rm pfos-drill-pg')).lastIndexOf(true);
    expect(lastVolumeRm).toBeGreaterThan(restore);
    expect(sb.callsMatching(/^docker rm -f pfos-drill-pg/)).toHaveLength(1);
    expect(sb.callsMatching(/^docker network rm pfos-drill/)).toHaveLength(1);
    expect(sb.drillsLog()[0]).toMatch(/reason=integridad\(inv004_sin_cuadrar=0,inv005_incompletos=2\)$/);
    expectCleanState();
  });

  it('[TC-PLATFORM-DRILL-005] si la limpieza falla, el drill avisa fail aunque todo lo demás haya pasado', () => {
    sb = new Sandbox();
    sb.set('cleanup_fail', 1);

    const r = runDrill();
    expect(r.status).not.toBe(0);
    expect(sb.drillsLog()[0]).toMatch(/ fail .* reason=limpieza$/);
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
  });

  it.each([
    {
      name: 'copia al día: 3 min',
      prod: '2026-12-02T08:58:00Z',
      copy: '2026-12-02T08:55:00Z',
      ok: true,
      gap: '180',
    },
    {
      name: 'justo en el RPO: 15 min',
      prod: '2026-12-02T08:58:00Z',
      copy: '2026-12-02T08:43:00Z',
      ok: true,
      gap: '900',
    },
    {
      name: 'copia atrasada: 28 min',
      prod: '2026-12-02T08:58:00Z',
      copy: '2026-12-02T08:30:00Z',
      ok: false,
      gap: '1680',
    },
    {
      name: 'copia con postings posteriores al inicio',
      prod: '2026-12-02T08:58:00Z',
      copy: '2026-12-02T09:01:00Z',
      ok: true,
      gap: '0',
    },
  ])('[TC-PLATFORM-DRILL-006] pérdida de datos frente al RPO de 15 min: $name', ({ prod, copy, ok, gap }) => {
    sb = new Sandbox();
    sb.set('prod_last', epoch(prod)).set('copy_last', epoch(copy));

    const r = runDrill();
    expect(r.status === 0).toBe(ok);
    const line = sb.drillsLog()[0] ?? '';
    expect(line).toContain(` ${ok ? 'ok' : 'fail'} `);
    expect(line).toContain(` gap=${gap} `);
    if (!ok) expect(line).toMatch(/reason=rpo\(gap=1680s,max=900s\)$/);
    expect(sb.heartbeats().map((b) => b.slug)).toEqual([ok ? '/pfos-drill' : '/pfos-drill/fail']);
  });

  it('[TC-PLATFORM-DRILL-006] sin postings en producción no evalúa la pérdida de datos y lo registra', () => {
    sb = new Sandbox();
    sb.set('prod_last', '').set('copy_last', '');

    const r = runDrill();
    expect(r.status, r.stderr).toBe(0);
    expect(sb.drillsLog()[0]).toContain(' gap=n/a ');
    expect(r.stderr).toContain('producción sin postings');
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill']);
  });

  it('[TC-PLATFORM-DRILL-007] falla cuando la duración total pasa los 60 min (72 min) aunque la copia sea íntegra', () => {
    sb = new Sandbox();
    sb.set('restore_secs', 3000).set('recovery_secs', 1320); // 50 min + 22 min = 72 min

    const r = runDrill();
    expect(r.status).not.toBe(0);
    const line = sb.drillsLog()[0] ?? '';
    expect(line).toContain(' total=4320 ');
    expect(line).toMatch(/ fail .* reason=duracion\(total=4320s,max=3600s\)$/);
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
    expectCleanState();
  });

  it('[TC-PLATFORM-DRILL-007] exactamente 60 min no falla', () => {
    sb = new Sandbox();
    sb.set('restore_secs', 2400).set('recovery_secs', 1200);

    const r = runDrill();
    expect(r.status, r.stderr).toBe(0);
    expect(sb.drillsLog()[0]).toContain(' total=3600 ');
  });

  it('[TC-PLATFORM-DRILL-008] no restaura si el disco no tiene espacio para la copia con margen (4 GiB necesitan 7 GiB y hay 6)', () => {
    sb = new Sandbox();
    sb.set('info_json', infoJson(4 * GIB)).set('free_bytes', 6 * GIB);

    const r = runDrill();
    expect(r.status).not.toBe(0);
    expect(sb.callsMatching(/--name pfos-drill-restore|volume create|network create/)).toEqual([]);
    expect(sb.drillsLog()[0]).toMatch(/ fail .* reason=espacio\(necesario=7GiB,libre=6GiB\)$/);
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-drill/fail']);
  });

  it('[TC-PLATFORM-DRILL-008] con exactamente 7 GiB libres sí restaura', () => {
    sb = new Sandbox();
    sb.set('info_json', infoJson(4 * GIB)).set('free_bytes', 7 * GIB);

    const r = runDrill();
    expect(r.status, r.stderr).toBe(0);
  });

  it('[TC-PLATFORM-HOSTOPS-001] el drill toma el lock del deploy y escribe su nombre', () => {
    sb = new Sandbox();
    const r = runDrill();
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(sb.state, 'deploy.lock'), 'utf8')).toBe('drill\n');
  });
});
