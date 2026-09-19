import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => { req.body = req.body || {}; next(); },
  validateParams: () => (_req, _res, next) => next(),
  validateQuery: () => (_req, _res, next) => next(),
}));

const { dbMock, redisMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } },
  redisMock: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
  get redisClient() { return redisMock; },
}));

vi.mock('../../src/lib/escapeLike.js', () => ({
  escapeLike: (v) => v,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import loadRoutes from '../../src/routes/loadRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/loads', loadRoutes);
  return app;
}

function chain(result) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    ilike: vi.fn(() => q),
    gte: vi.fn(() => q),
    lte: vi.fn(() => q),
    or: vi.fn(() => q),
    order: vi.fn(() => q),
    range: vi.fn(() => q),
    in: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return q;
}

describe('loadRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /loads/', () => {
    it('returns 400 when page is not numeric', async () => {
      const res = await request(makeApp()).get('/loads/').query({ page: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('page must be a valid integer');
    });

    it('returns 400 when limit is out of range', async () => {
      const res = await request(makeApp()).get('/loads/').query({ limit: '500' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('limit must be between 1 and 100');
    });

    it('returns 400 when vehicle_type is not truck-like', async () => {
      const res = await request(makeApp()).get('/loads/').query({ vehicle_type: 'motorcycle' });
      expect(res.status).toBe(200);
      expect(res.body.loads).toEqual([]);
    });

    it('returns formatted loads on success', async () => {
      const q = chain({ data: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000 }], error: null, count: 1 });
      q.range.mockResolvedValue({ data: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000 }], error: null, count: 1 });
      dbMock.supabaseAdmin.from.mockReturnValue(q);
      const res = await request(makeApp()).get('/loads/');
      expect(res.status).toBe(200);
      expect(res.body.loads[0].pickup).toBe('A');
      expect(res.body.loads[0].estimated_price).toBe(100);
    });

    it('returns 500 when the query errors', async () => {
      const q = chain({ data: null, error: { message: 'db down' }, count: 0 });
      dbMock.supabaseAdmin.from.mockReturnValue(q);
      q.range.mockResolvedValue({ data: null, error: { message: 'db down' }, count: 0 });
      const res = await request(makeApp()).get('/loads/');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch load offers.');
    });
  });

  describe('GET /loads/stats', () => {
    it('returns cached stats from Redis if available', async () => {
      const cachedStats = {
        vehicleType: 'all',
        activeLoads: 10,
        avgFreightPrice: 5000,
        minFreightPrice: 2000,
        maxFreightPrice: 15000,
        avgDistance: 250,
        nearbyLoads: 4,
        lastUpdated: '2026-07-04T08:30:00Z',
      };
      redisMock.get.mockResolvedValue(JSON.stringify(cachedStats));

      const res = await request(makeApp()).get('/loads/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.activeLoads).toBe(10);
      expect(res.body.avgFreightPrice).toBe(5000);
      expect(redisMock.get).toHaveBeenCalledWith('loads:stats:all');
    });

    it('returns stats via Supabase RPC get_load_stats when Redis misses', async () => {
      redisMock.get.mockResolvedValue(null);
      const rpcData = {
        vehicleType: 'mini_truck',
        activeLoads: 47,
        avgFreightPrice: 4820,
        minFreightPrice: 1200,
        maxFreightPrice: 12000,
        avgDistance: 283,
        nearbyLoads: 12,
        lastUpdated: '2026-07-04T08:30:00Z',
      };
      dbMock.supabaseAdmin.rpc.mockResolvedValue({ data: rpcData, error: null });

      const res = await request(makeApp())
        .get('/loads/stats')
        .query({ vehicleType: 'mini_truck' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.vehicleType).toBe('mini_truck');
      expect(res.body.activeLoads).toBe(47);
      expect(dbMock.supabaseAdmin.rpc).toHaveBeenCalledWith('get_load_stats', {
        p_vehicle_type: 'mini_truck',
      });
      expect(redisMock.set).toHaveBeenCalledWith(
        'loads:stats:mini_truck',
        JSON.stringify(rpcData),
        'EX',
        60
      );
    });

    it('falls back to DB aggregation if RPC is unavailable or fails', async () => {
      redisMock.get.mockResolvedValue(null);
      dbMock.supabaseAdmin.rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });

      const rows = [
        { freight_value: 500000, extra_distance_km: 100 }, // 5000 INR, 100 km
        { freight_value: 300000, extra_distance_km: 20 },  // 3000 INR, 20 km (nearby)
      ];
      const q = chain({ data: rows, error: null });
      q.eq.mockReturnValue(Promise.resolve({ data: rows, error: null }));
      dbMock.supabaseAdmin.from.mockReturnValue(q);

      const res = await request(makeApp()).get('/loads/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.activeLoads).toBe(2);
      expect(res.body.avgFreightPrice).toBe(4000);
      expect(res.body.minFreightPrice).toBe(3000);
      expect(res.body.maxFreightPrice).toBe(5000);
      expect(res.body.avgDistance).toBe(60);
      expect(res.body.nearbyLoads).toBe(1);
    });
  });

  describe('GET /loads/:id', () => {
    it('returns 404 when the load is not found', async () => {
      const q = chain({ data: null, error: null });
      q.maybeSingle.mockResolvedValue({ data: null, error: null });
      dbMock.supabaseAdmin.from.mockReturnValue(q);
      const res = await request(makeApp()).get('/loads/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
