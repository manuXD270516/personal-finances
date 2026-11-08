import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { ZipReader, ZipWriter } from '@pf/identity/interface/identity.module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildMini,
  contract,
  downloadExport,
  exportAndWait,
  importAndWait,
  startHarness,
  w1Api,
  type Harness,
  type Json,
  type Mini,
} from '../support/portability.js';

// Frecuencia del digest del Home (openspec add-cash-flow-forecast; FR-NOTIFY-007): se elige por la API, viaja en el export
// de las preferencias de notificación y un archivo exportado antes del cambio (sin la columna) se importa con el digest
// desactivado. TC-NOTIFICATIONS-DIGEST-001 (API) y TC-NOTIFICATIONS-DIGEST-007.
let h: Harness;
let m: Mini;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Reconstruye el ZIP quitando la frecuencia del digest de las preferencias (como lo exportaba la versión anterior). */
function withoutDigestColumn(source: Buffer): Buffer {
  const reader = ZipReader.open(source);
  const files = new Map<string, Buffer>(reader.names().map((n) => [n, reader.read(n)]));
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as {
    sections: { name: string; file: string; count: number; sha256: string }[];
  };
  const entry = manifest.sections.find((s) => s.name === 'notification-user-settings')!;
  const stripped = files
    .get(entry.file)!
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const { digest_frequency: _removed, ...rest } = JSON.parse(line) as Json;
      return JSON.stringify(rest);
    })
    .join('\n');
  const body = Buffer.from(`${stripped}\n`, 'utf8');
  files.set(entry.file, body);
  entry.sha256 = sha256(body);
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  const writer = new ZipWriter(new Date('2026-10-09T12:00:00Z'));
  for (const [name, content] of files) writer.add(name, content);
  return writer.finish();
}

beforeAll(async () => {
  h = await startHarness({ realClock: true, worker: true });
  m = await buildMini(h, 'digest');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Frecuencia del digest en las preferencias y en la portabilidad', () => {
  let exportedZip: Buffer;

  it('[TC-NOTIFICATIONS-DIGEST-001] las preferencias parten con el digest desactivado, se guarda la frecuencia semanal y una inválida se rechaza con 400', async () => {
    const api = w1Api(h, m);
    const initial = await api.get(m.owner, '/notification-preferences');
    expect(initial.status).toBe(200);
    expect(contract.validateResponse('getNotificationPreferences', 200, initial.body)).toEqual([]);
    expect(initial.body['digestFrequency']).toBe('OFF');
    const body = { types: [], quietHours: null, includeDetailsInEmail: false };
    const saved = await api.put(
      m.owner,
      '/notification-preferences',
      { ...body, digestFrequency: 'WEEKLY' },
      initial.body['version'] as number,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(contract.validateResponse('updateNotificationPreferences', 200, saved.body)).toEqual([]);
    expect(saved.body).toMatchObject({ digestFrequency: 'WEEKLY', version: 2 });
    const invalid = await api.put(
      m.owner,
      '/notification-preferences',
      { ...body, digestFrequency: 'DAILY' },
      2,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body['code']).toBe('VALIDATION_FAILED');
    const after = await api.get(m.owner, '/notification-preferences');
    expect(after.body).toMatchObject({ digestFrequency: 'WEEKLY', version: 2 });
    // Sin el campo, la frecuencia no cambia.
    const without = await api.put(
      m.owner,
      '/notification-preferences',
      { ...body, includeDetailsInEmail: true },
      2,
    );
    expect(without.status, JSON.stringify(without.body)).toBe(200);
    expect(without.body).toMatchObject({ digestFrequency: 'WEEKLY', includeDetailsInEmail: true });
  });

  it('[TC-NOTIFICATIONS-DIGEST-007] la frecuencia semanal viaja en el export y se importa en el workspace nuevo', async () => {
    const exported = await exportAndWait(h, m.owner, m.ws);
    exportedZip = (await downloadExport(h, m.owner, m.ws, exported['id'] as string)).raw;
    const done = await importAndWait(h, m.owner, exportedZip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const restored = w1Api(h, { ws: done['workspaceId'] as string });
    const prefs = await restored.get(m.owner, '/notification-preferences');
    expect(prefs.body['digestFrequency']).toBe('WEEKLY');
  }, 240_000);

  it('[TC-NOTIFICATIONS-DIGEST-007] un archivo exportado antes del cambio, sin la frecuencia, se importa con el digest desactivado', async () => {
    const done = await importAndWait(h, m.owner, withoutDigestColumn(exportedZip));
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED' });
    const restored = w1Api(h, { ws: done['workspaceId'] as string });
    const prefs = await restored.get(m.owner, '/notification-preferences');
    expect(prefs.body['digestFrequency']).toBe('OFF');
    // Lo demás de las preferencias sí viajó.
    expect(prefs.body['includeDetailsInEmail']).toBe(true);
  }, 240_000);
});
