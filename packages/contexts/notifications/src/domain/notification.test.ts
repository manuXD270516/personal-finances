import { describe, expect, it } from 'vitest';
import { thresholdPayload, WS } from './fixtures.js';
import { archive, createNotification, markRead, parseStatusFilter } from './notification.js';
import { definitionOf } from './type-catalog.js';

const base = () =>
  createNotification({
    id: '01928c4e-0000-7000-8000-0000000aa001',
    workspaceId: WS,
    userId: '01928c4e-0000-7000-8000-0000000ea001',
    sourceEventId: '01928c4e-7a3b-7c11-8f00-000000000301',
    createdAt: '2026-11-12T15:20:00.000Z',
    plan: definitionOf('BUDGET_THRESHOLD').plan(thresholdPayload()),
  });

describe('Notification: transiciones UNREAD → READ → ARCHIVED', () => {
  it('[TC-NOTIFICATIONS-INAPP-001] nace UNREAD sin fechas de lectura ni archivo', () => {
    expect(base()).toMatchObject({
      status: 'UNREAD',
      readAt: null,
      archivedAt: null,
      type: 'BUDGET_THRESHOLD',
    });
  });

  it('[TC-NOTIFICATIONS-INAPP-003] leer es idempotente y conserva la primera fecha de lectura', () => {
    const read = markRead(base(), '2026-11-12T16:00:00.000Z');
    expect(read).toMatchObject({ status: 'READ', readAt: '2026-11-12T16:00:00.000Z' });
    expect(markRead(read, '2026-11-13T09:00:00.000Z')).toBe(read);
  });

  it('[TC-NOTIFICATIONS-INAPP-003] archivar es idempotente, también desde UNREAD, y leer una archivada no la reabre', () => {
    const archived = archive(base(), '2026-11-12T16:30:00.000Z');
    expect(archived).toMatchObject({
      status: 'ARCHIVED',
      archivedAt: '2026-11-12T16:30:00.000Z',
      readAt: null,
    });
    expect(archive(archived, '2026-11-14T00:00:00.000Z')).toBe(archived);
    expect(markRead(archived, '2026-11-15T00:00:00.000Z')).toBe(archived);
    const readThenArchived = archive(
      markRead(base(), '2026-11-12T16:00:00.000Z'),
      '2026-11-12T17:00:00.000Z',
    );
    expect(readThenArchived).toMatchObject({ readAt: '2026-11-12T16:00:00.000Z', status: 'ARCHIVED' });
  });

  it('[TC-NOTIFICATIONS-INAPP-004] el filtro de estado solo admite UNREAD, READ o ARCHIVED', () => {
    expect(parseStatusFilter(undefined)).toBeUndefined();
    expect(parseStatusFilter('ARCHIVED')).toBe('ARCHIVED');
    expect(() => parseStatusFilter('DISMISSED')).toThrow(/status/);
  });
});
