import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/src/config/db.js', () => ({
  supabase: {},
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import eventRepository from '../repositories/event.repository.js';

const originalGetAllEventsByOrderId = eventRepository.getAllEventsByOrderId.bind(eventRepository);

afterEach(() => {
  eventRepository.getAllEventsByOrderId = originalGetAllEventsByOrderId;
  vi.restoreAllMocks();
});

describe('EventRepository.getSnapshot', () => {
  it('propagates event-read failures instead of returning a false cache miss', async () => {
    const storageError = new Error('event query failed');
    eventRepository.getAllEventsByOrderId = vi.fn().mockRejectedValue(storageError);

    await expect(eventRepository.getSnapshot('order-1')).rejects.toBe(storageError);
  });

  it('still returns an empty snapshot for a confirmed empty event stream', async () => {
    eventRepository.getAllEventsByOrderId = vi.fn().mockResolvedValue([]);

    await expect(eventRepository.getSnapshot('order-2')).resolves.toEqual({
      orderId: 'order-2',
      status: 'created',
      data: {},
      timeline: [],
    });
  });
});
