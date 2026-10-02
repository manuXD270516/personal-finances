import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '@pf/platform/in-memory';
import { AppModule } from '../src/app.module.js';

describe('API (Nest + SWC) — composición Accounts → Ledger', () => {
  let app: INestApplication;
  let db: InMemoryDatabase;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(InMemoryDatabase);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /accounts abre la cuenta y postea el asiento de saldo inicial en la misma transacción', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Banco', type: 'asset', currency: 'EUR', openingBalanceMinor: '150000' })
      .expect(201);

    expect(res.body.openingJournalEntryId).toEqual(expect.any(String));
    const entries = await request(app.getHttpServer()).get('/ledger/entries').expect(200);
    expect(entries.body).toHaveLength(1);
    expect(entries.body[0].lines).toEqual([
      { ledgerAccountRef: `account:${res.body.id}`, amountMinor: '150000', currency: 'EUR' },
      { ledgerAccountRef: 'equity:opening-balances', amountMinor: '-150000', currency: 'EUR' },
    ]);
    expect(db.commits).toBe(1); // un único COMMIT para Accounts + Ledger
  });

  it('si Ledger rechaza el asiento, la cuenta tampoco se persiste (ROLLBACK atómico)', async () => {
    const commitsBefore = db.commits;
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Enorme', type: 'asset', currency: 'EUR', openingBalanceMinor: '10000000000000000' })
      .expect(422);

    expect(res.body.title).toBe('LEDGER_AMOUNT_OUT_OF_RANGE');
    expect(db.commits).toBe(commitsBefore);
    expect(db.rollbacks).toBe(1);
    const accounts = [...(db.committed.get('accounts.account')?.values() ?? [])] as Array<{ name: string }>;
    expect(accounts.map((a) => a.name)).toEqual(['Banco']);
  });
});
