import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import kafkaConfig, { formatKafkaMessageKey } from '../config/kafka.config.js';

describe('Kafka consumer message-key logging', () => {
  it('returns null for a valid keyless Kafka message', () => {
    expect(formatKafkaMessageKey(null)).toBeNull();
    expect(formatKafkaMessageKey(undefined)).toBeNull();
  });

  it('preserves the string representation of keyed messages', () => {
    expect(formatKafkaMessageKey(Buffer.from('order-42'))).toBe('order-42');
    expect(formatKafkaMessageKey('plain-key')).toBe('plain-key');
  });

  it('processes a keyless Kafka message through consumeMessages', async () => {
    const groupId = 'keyless-message-test';
    const payload = { eventId: 'evt-keyless-1', status: 'ready' };
    const messageHandler = vi.fn().mockResolvedValue();
    const errorHandler = vi.fn().mockResolvedValue();

    const consumer = {
      run: vi.fn(async ({ eachMessage }) => {
        await eachMessage({
          topic: 'order.updated',
          partition: 0,
          message: {
            key: null,
            value: Buffer.from(JSON.stringify(payload)),
            headers: {},
          },
        });
      }),
    };

    kafkaConfig.consumers.set(groupId, consumer);
    try {
      await kafkaConfig.consumeMessages(groupId, messageHandler, errorHandler);
    } finally {
      kafkaConfig.consumers.delete(groupId);
    }

    expect(messageHandler).toHaveBeenCalledTimes(1);
    expect(messageHandler).toHaveBeenCalledWith(
      'order.updated',
      payload,
      expect.objectContaining({ key: null }),
    );
    expect(errorHandler).not.toHaveBeenCalled();
  });
});
