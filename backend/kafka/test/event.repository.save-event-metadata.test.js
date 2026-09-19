import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertedRows: null,
  result: { data: { id: 1 }, error: null },
}));

const query = {
  insert: vi.fn((rows) => {
    mocks.insertedRows = rows;
    return query;
  }),
  select: vi.fn(() => query),
  single: vi.fn(async () => mocks.result),
};

vi.mock('../../api/src/config/db.js', () => ({
  supabaseAdmin: { from: vi.fn(() => query) },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import eventRepository from '../repositories/event.repository.js';

describe('EventRepository.saveEvent metadata fallback', () => {
  beforeEach(() => {
    mocks.insertedRows = null;
    mocks.result = { data: { id: 1 }, error: null };
    query.insert.mockClear();
    query.select.mockClear();
    query.single.mockClear();
  });

  it('saves an event without metadata using an empty object and event timestamp', async () => {
    const event = {
      eventId: 'evt-1',
      eventType: 'ORDER_CREATED',
      orderId: 'order-1',
      data: { status: 'created' },
      timestamp: '2026-09-13T07:00:00.000Z',
    };

    await expect(eventRepository.saveEvent(event)).resolves.toEqual({ id: 1 });

    expect(mocks.insertedRows).toEqual([expect.objectContaining({
      event_id: 'evt-1',
      event_type: 'ORDER_CREATED',
      order_id: 'order-1',
      metadata: {},
      timestamp: '2026-09-13T07:00:00.000Z',
    })]);
  });

  it('falls back to metadata timestamp when event timestamp is absent', async () => {
    await eventRepository.saveEvent({
      eventId: 'evt-2',
      eventType: 'ORDER_UPDATED',
      orderId: 'order-2',
      data: {},
      metadata: { timestamp: '2026-09-13T08:00:00.000Z' },
    });

    expect(mocks.insertedRows[0].timestamp).toBe('2026-09-13T08:00:00.000Z');
  });

  it('uses a current ISO timestamp when neither event nor metadata provides one', async () => {
    const before = Date.now();

    await eventRepository.saveEvent({
      eventId: 'evt-3',
      eventType: 'ORDER_UPDATED',
      orderId: 'order-3',
      data: {},
    });

    const timestamp = Date.parse(mocks.insertedRows[0].timestamp);
    expect(Number.isNaN(timestamp)).toBe(false);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  });
});
