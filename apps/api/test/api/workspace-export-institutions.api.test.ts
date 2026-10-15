import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAdmin,
  downloadExport,
  exportAndWait,
  importAndWait,
  startHarness,
  type Harness,
  type Json,
  type User,
} from '../support/portability.js';

// Vínculo con el catálogo de referencia y tasas por institución en el export → import (openspec
// add-exchange-house-rate-providers, tarea 4.7; identity/workspace-portability; TC-IDENTITY-EXPORT-014): API y worker
// reales sobre PostgreSQL + almacenamiento de objetos. La importación restaura filas del workspace: nunca consulta el
// catálogo para cambiar nombres editados ni a ningún provider para reconstruir tasas (FX_PROVIDER_* = none).
const DEMO_DIR = fileURLToPath(new URL('../../reference/institutions/demo', import.meta.url));
const PROVIDER = `INSTRATE_RT_${randomUUID().slice(0, 8).toUpperCase()}`;
let h: Harness;
let owner: User;
let restored: string;
let source: { bad: Json; foreign: string };

const api = (ws: string) => `/api/v1/workspaces/${ws}`;

interface InstitutionRow {
  id: string;
  name: string;
  catalogRef?: { code: string; catalogVersion: string; listingStatus: string | null };
}
const institutions = async (ws: string) =>
  (await h.call('GET', `${api(ws)}/institutions?limit=200`, { token: owner.token })).body[
    'data'
  ] as InstitutionRow[];

const rateRows = (ws: string) =>
  asAdmin(
    h,
    async (c) =>
      (
        await c.query<{ institution_code: string; rate: string; as_of: string; provider: string }>(
          `SELECT institution_code, trim_scale(rate)::text AS rate, provider,
                  to_char(as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS as_of
             FROM fx.exchange_rate
            WHERE workspace_id = $1 AND rate_type = 'BANK_SELL' AND institution_code IS NOT NULL
            ORDER BY as_of, institution_code`,
          [ws],
        )
      ).rows,
  );

beforeAll(async () => {
  h = await startHarness({ worker: true, apiEnv: { ACCOUNTS_INSTITUTION_CATALOG_DIR: DEMO_DIR } });
  owner = await h.user(`kc-ex-inst-${randomUUID()}`);
  // W1 adopta BAD (catálogo ficticio), la renombra y tiene una institución vinculada a un código ausente del catálogo.
  const adopted = await h.call('POST', `${api(owner.ws)}/institutions/adopt`, {
    token: owner.token,
    body: { country: 'BO', codes: ['BAD'] },
  });
  expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
  const bad = (adopted.body['adopted'] as (Json & { id: string; version: number })[])[0]!;
  const renamed = await h.call('PATCH', `${api(owner.ws)}/institutions/${bad.id}`, {
    token: owner.token,
    body: { name: 'Mi banco' },
    headers: { 'content-type': 'application/merge-patch+json', 'if-match': `"${bad.version}"` },
  });
  expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  const foreign = randomUUID();
  await asAdmin(h, async (c) => {
    await c.query(
      `INSERT INTO accounts.institution (id, workspace_id, name, kind, country_code, catalog_country, catalog_code, catalog_version)
       VALUES ($1, $2, 'Entidad Ajena Demo', 'BANK', 'BO', 'BO', 'ZZZ', '2026-03-31')`,
      [foreign, owner.ws],
    );
    // 30 tasas USD/BOB BANK_SELL de BAD de un provider por institución (días consecutivos, valores con 4 decimales).
    for (let day = 0; day < 30; day++) {
      const asOf = new Date(Date.UTC(2026, 8, 1 + day, 16, 0, 0)).toISOString();
      const value = `11.${String(8000 + day * 7).padStart(4, '0')}`;
      await c.query(
        `INSERT INTO fx.exchange_rate (id, workspace_id, base_currency, quote_currency, rate, rate_type, as_of, as_of_date,
                                        source, source_label, provider, institution_code, created_at, fetched_at, raw_payload)
         VALUES ($1, $2, 'USD', 'BOB', $3, 'BANK_SELL', $4, $5, 'PROVIDER', 'Fuente simulada (prueba)', $6, 'BAD', now(), now(), '{}')`,
        [randomUUID(), owner.ws, value, asOf, asOf.slice(0, 10), PROVIDER],
      );
    }
  });
  source = { bad: renamed.body, foreign };
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Exportación e importación del vínculo con el catálogo y de las tasas por institución', () => {
  it('[TC-IDENTITY-EXPORT-014] la ida y vuelta conserva "Mi banco" vinculada a BAD con la misma versión de catálogo y las 30 tasas BANK_SELL con su código, valores y vigencias', async () => {
    const exported = await exportAndWait(h, owner, owner.ws);
    expect(exported['status']).toBe('READY');
    const zip = (await downloadExport(h, owner, owner.ws, exported['id'] as string)).raw;
    const done = await importAndWait(h, owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED', errorCode: null });
    restored = done['workspaceId'] as string;

    const restoredBad = (await institutions(restored)).find((i) => i.catalogRef?.code === 'BAD');
    expect(restoredBad?.name).toBe('Mi banco');
    expect(restoredBad?.catalogRef?.catalogVersion).toBe('2026-09-30');
    expect(restoredBad?.id).not.toBe(source.bad['id']);
    // El catálogo de la instalación sigue mostrando su nombre; la institución importada no lo toma.
    const entries = (
      await h.call('GET', `${api(restored)}/institution-catalog?country=BO`, { token: owner.token })
    ).body['entries'] as { code: string; name: string; adoptedInstitutionId: string | null }[];
    expect(entries.find((e) => e.code === 'BAD')).toMatchObject({
      name: 'Banco Andino Demo',
      adoptedInstitutionId: restoredBad?.id,
    });

    const rates = await rateRows(restored);
    expect(rates).toHaveLength(30);
    expect(rates).toEqual(await rateRows(owner.ws));
    expect(rates.every((r) => r.institution_code === 'BAD' && r.provider === PROVIDER)).toBe(true);
    expect(rates[0]).toEqual({
      institution_code: 'BAD',
      rate: '11.8',
      as_of: '2026-09-01T16:00:00Z',
      provider: PROVIDER,
    });
    expect(rates[29]?.rate).toBe('11.8203');
    // El export y la importación no consultaron ninguna fuente: no hay provider por institución configurado.
    const status = await h.call('GET', `${api(restored)}/fx-providers/status`, { token: owner.token });
    expect(
      (status.body['data'] as { provider: string }[]).some((p) => p.provider.startsWith('INSTRATE_')),
    ).toBe(false);
  }, 240_000);

  it('[TC-IDENTITY-EXPORT-014] una institución vinculada a un código ausente del catálogo de la instalación se importa con su vínculo y sus datos y se informa como ausente', async () => {
    const list = await institutions(restored);
    const foreign = list.find((i) => i.catalogRef?.code === 'ZZZ');
    expect(foreign?.name).toBe('Entidad Ajena Demo');
    expect(foreign?.catalogRef).toMatchObject({ catalogVersion: '2026-03-31', listingStatus: null });
    // Las instituciones del original no cambiaron.
    expect(
      (await institutions(owner.ws))
        .filter((i) => i.catalogRef)
        .map((i) => i.catalogRef?.code)
        .sort(),
    ).toEqual(['BAD', 'ZZZ']);
  });
});
