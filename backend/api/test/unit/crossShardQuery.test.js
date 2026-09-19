import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteCrossShardQuery = vi.fn();

vi.mock('../../src/services/sharding/ShardManager.js', () => ({
  default: {
    executeCrossShardQuery: mockExecuteCrossShardQuery,
  },
}));

const { crossShardQuery } = await import('../../src/middleware/shardMiddleware.js');

describe('crossShardQuery middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {};
    res = {};
    next = vi.fn();
    mockExecuteCrossShardQuery.mockReset();
    mockExecuteCrossShardQuery.mockResolvedValue({ data: [{ id: 'order-1' }] });
  });

  it('crossShardQuery attaches executeCrossShard to req', async () => {
    await crossShardQuery(req, res, next);
    expect(req.executeCrossShard).toBeDefined();
    expect(typeof req.executeCrossShard).toBe('function');
  });

  it('executeCrossShard is an async function', async () => {
    await crossShardQuery(req, res, next);
    const promise = req.executeCrossShard('SELECT * FROM orders', []);
    expect(promise).toBeInstanceOf(Promise);
    const result = await promise;
    expect(result).toEqual({ data: [{ id: 'order-1' }] });
  });

  it('The middleware calls next()', async () => {
    await crossShardQuery(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('The middleware sets up the method correctly (mock shardManager.executeCrossShardQuery)', async () => {
    await crossShardQuery(req, res, next);

    const query = 'SELECT * FROM orders WHERE status = $1';
    const params = ['active'];

    const result = await req.executeCrossShard(query, params);

    expect(mockExecuteCrossShardQuery).toHaveBeenCalledTimes(1);
    expect(mockExecuteCrossShardQuery).toHaveBeenCalledWith({ query, params });
    expect(result).toEqual({ data: [{ id: 'order-1' }] });
  });

  it('executeCrossShard propagates errors when shardManager fails', async () => {
    mockExecuteCrossShardQuery.mockRejectedValue(new Error('Shard connection timeout'));
    await crossShardQuery(req, res, next);

    await expect(req.executeCrossShard('SELECT 1', [])).rejects.toThrow('Shard connection timeout');
  });
});
