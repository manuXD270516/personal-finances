import { afterEach, describe, expect, it } from 'vitest';
import { HOST_TOOLS_AVAILABLE, Sandbox } from './harness.js';

const BACKUP = 'deploy/host/pfos-backup.sh';
let sb: Sandbox;
afterEach(() => sb?.dispose());

describe.skipIf(!HOST_TOOLS_AVAILABLE)(
  'pfos-backup.sh verify (verificación semanal de repo1 y repo2)',
  () => {
    it('[TC-PLATFORM-DRILL-009] un archivo inválido en repo2 avisa /fail nombrando el repositorio y no oculta el estado de repo1', () => {
      sb = new Sandbox();
      sb.set('verify_repo2_exit', 1).set(
        'verify_repo2_out',
        'P00  ERROR: [044]: archivo con checksum que no coincide',
      );

      const r = sb.run(BACKUP, ['verify']);
      expect(r.status).not.toBe(0);

      const runs = sb.callsMatching(/^docker run /);
      expect(runs).toHaveLength(2);
      expect(runs[0]).toContain('--repo=1 verify');
      expect(runs[1]).toContain('--repo=2 verify');
      for (const run of runs) {
        expect(run).toContain('--rm');
        expect(run).toContain('--memory 192m');
        expect(run).toContain(`--env-file ${sb.etc}/pgbackrest-restore.env`);
        expect(run).not.toMatch(/pgbackrest\.env(\s|$)/);
      }
      // En un contenedor efímero, no dentro del contenedor postgres del stack.
      expect(sb.callsMatching(/^docker compose .*exec .*verify/)).toEqual([]);

      const beats = sb.heartbeats();
      expect(beats.map((b) => b.slug)).toEqual(['/pfos-verify/fail']);
      expect(beats[0]?.body).toContain('repo2');
      expect(beats[0]?.body).not.toContain('repo1');
      expect(r.stderr).toContain('repo2');
    });

    it('[TC-PLATFORM-DRILL-009] con los dos repositorios sanos avisa éxito sin /fail', () => {
      sb = new Sandbox();
      const r = sb.run(BACKUP, ['verify']);
      expect(r.status, r.stderr).toBe(0);
      const beats = sb.heartbeats();
      expect(beats.map((b) => b.slug)).toEqual(['/pfos-verify']);
      expect(beats[0]?.body).toBe('verify ok repo1=ok repo2=ok');
    });

    it('[TC-PLATFORM-DRILL-009] un error de repo1 igual verifica repo2; un "completed with N errors" con salida 0 también falla', () => {
      sb = new Sandbox();
      sb.set('verify_repo1_out', 'P00   INFO: verify command end: completed with 2 error(s)').set(
        'verify_repo2_exit',
        1,
      );

      const r = sb.run(BACKUP, ['verify']);
      expect(r.status).not.toBe(0);
      expect(sb.callsMatching(/^docker run /)).toHaveLength(2);
      expect(sb.heartbeats()[0]?.body).toContain('repo1');
      expect(sb.heartbeats()[0]?.body).toContain('repo2');
    });

    it('[TC-PLATFORM-DRILL-009] sin la clave de solo lectura cargada falla antes de verificar', () => {
      sb = new Sandbox();
      sb.file('etc/pgbackrest-restore.env', 'PGBACKREST_REPO1_S3_KEY=__set__\n');
      const r = sb.run(BACKUP, ['verify']);
      expect(r.status).not.toBe(0);
      expect(sb.callsMatching(/^docker run /)).toEqual([]);
      expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-verify/fail']);
    });
  },
);
