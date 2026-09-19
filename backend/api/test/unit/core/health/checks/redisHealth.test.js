import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { mockRedisState } = vi.hoisted(() => ({
  mockRedisState: {
    redisClient: {
      ping: vi.fn(),
    },
  },
}));

vi.mock('../../../../../src/config/db.js', () => ({
  get redisClient() {
    return mockRedisState.redisClient;
  },
}));

import { HealthStatus } from '../../../../../src/core/health/HealthCheck.js';
import redisHealth from '../../../../../src/core/health/checks/redisHealth.js';

describe('redisHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisState.redisClient = {
      ping: vi.fn(),
    };
  });

  it('reports healthy state when Redis is reachable and responds with PONG', async () => {
    mockRedisState.redisClient.ping.mockResolvedValue('PONG');

    const result = await redisHealth();

    expect(result.name).toBe('redis');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.critical).toBe(false);
    expect(typeof result.responseTime).toBe('number');
    expect(mockRedisState.redisClient.ping).toHaveBeenCalledTimes(1);
  });

  it('reports unhealthy when Redis client is not configured', async () => {
    mockRedisState.redisClient = null;

    const result = await redisHealth();

    expect(result.name).toBe('redis');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('not_configured');
  });

  it('reports unhealthy state when Redis returns an unexpected reply', async () => {
    mockRedisState.redisClient.ping.mockResolvedValue('OK');

    const result = await redisHealth();

    expect(result.name).toBe('redis');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('unexpected reply: OK');
  });

  it('reports unhealthy state and handles errors when connection fails or ping throws', async () => {
    mockRedisState.redisClient.ping.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));

    const result = await redisHealth();

    expect(result.name).toBe('redis');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toContain('ECONNREFUSED');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('supports custom options such as timeoutMs and critical override', async () => {
    mockRedisState.redisClient.ping.mockResolvedValue('PONG');

    const result = await redisHealth({ timeoutMs: 250, critical: true });

    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.critical).toBe(true);
  });
});
