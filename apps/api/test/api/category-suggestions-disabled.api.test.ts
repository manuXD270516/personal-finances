/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../support/malicious-files.js';
import {
  contract,
  money,
  startHarness,
  until,
  type Harness,
  type Json,
  type Reply,
} from '../support/portability.js';

// Las sugerencias de categoría se pueden deshabilitar por instalación (openspec add-category-suggestions, decisión 9;
// TC-CLASSIFICATION-AUTO-022): la consulta responde `DISABLED` y la vista previa del import no muestra sugerencias.
let h: Harness;

const ok = (r: Reply, status = 200): Json => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};

beforeAll(async () => {
  const env = { RULES_CATEGORY_SUGGEST_ENABLED: 'false' };
  h = await startHarness({
    worker: true,
    apiEnv: { ...env, RATE_LIMIT_WRITES_PER_MIN: '100000', RATE_LIMIT_READS_PER_MIN: '100000' },
    workerEnv: env,
  });
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Sugerencias de categoría deshabilitadas', () => {
  it('[TC-CLASSIFICATION-AUTO-022] la consulta responde DISABLED y la vista previa del import no muestra sugerencias', async () => {
    const u = await h.user(`kc-cat-off-${randomUUID()}`);
    const W = `/api/v1/workspaces/${u.ws}`;
    const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      h.call('POST', `${W}${path}`, {
        token: u.token,
        ...(body === undefined ? {} : { body }),
        headers: { 'idempotency-key': randomUUID(), ...headers },
      });
    const bank = ok(
      await post('/accounts', {
        name: 'Banco BOB',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('9000.00'), date: '2026-01-01' },
      }),
      201,
    )['id'] as string;
    const cats = ok(await h.call('GET', `${W}/categories?kind=EXPENSE&limit=200`, { token: u.token }))[
      'data'
    ] as { id: string; name: string }[];
    const rest = cats.find((c) => c.name === 'Restaurantes')!.id;
    for (let i = 0; i < 6; i += 1) {
      ok(
        await post('/transactions', {
          kind: 'EXPENSE',
          transactionDate: `2026-09-${String(10 + i).padStart(2, '0')}`,
          accountId: bank,
          amount: money('30.00'),
          description: 'PEDIDOSYA *881',
          splits: [{ amount: money('30.00'), categoryId: rest }],
        }),
        201,
      );
    }

    const query = await post('/category-suggestions/query', { kind: 'EXPENSE', description: 'PEDIDOSYA' });
    ok(query);
    expect(contract.validateResponse('queryCategorySuggestion', 200, query.body)).toEqual([]);
    expect(query.body).toEqual({ status: 'DISABLED', suggestion: null, ruleId: null });

    const content = Buffer.from(
      [
        'OFXHEADER:100',
        'DATA:OFXSGML',
        'VERSION:102',
        'SECURITY:NONE',
        'ENCODING:USASCII',
        'CHARSET:1252',
        'COMPRESSION:NONE',
        'OLDFILEUID:NONE',
        'NEWFILEUID:NONE',
        '',
        '<OFX>',
        '<BANKMSGSRSV1>',
        '<STMTTRNRS>',
        '<TRNUID>1',
        '<STMTRS>',
        '<CURDEF>BOB',
        '<BANKTRANLIST>',
        '<DTSTART>20260301',
        '<DTEND>20260331',
        '<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260301\n<TRNAMT>-31.00\n<FITID>OFF1\n<NAME>PEDIDOSYA 101\n</STMTTRN>',
        '</BANKTRANLIST>',
        '</STMTRS>',
        '</STMTTRNRS>',
        '</BANKMSGSRSV1>',
        '</OFX>',
      ].join('\n'),
      'latin1',
    );
    const requested = ok(
      await post('/documents/uploads', {
        fileName: 'off.ofx',
        contentType: 'application/x-ofx',
        sizeBytes: content.length,
        sha256: sha256Hex(content),
        purpose: 'IMPORT_SOURCE',
      }),
      201,
    ) as any;
    const sent = await fetch(requested['upload'].url as string, {
      method: requested['upload'].method as string,
      headers: requested['upload'].headers as Record<string, string>,
      body: content,
    });
    expect(sent.status).toBe(200);
    ok(await post(`/documents/${requested['document'].id}/complete`));
    const created = ok(
      await post('/imports', { accountId: bank, documentId: requested['document'].id }),
      202,
    );
    const review = (await until(async () => {
      const j = ok(await h.call('GET', `${W}/imports/${String(created['id'])}`, { token: u.token }));
      return j['status'] === 'AWAITING_REVIEW' ? j : undefined;
    }, 90_000)) as any;
    const preview = ok(
      await h.call('GET', `${W}/imports/${review.id}/preview?limit=50`, { token: u.token }),
    ) as any;
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows.every((r: any) => !r.suggestedCategory)).toBe(true);
  }, 300_000);
});
