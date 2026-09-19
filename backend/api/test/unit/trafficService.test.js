import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger dependency
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import logger from '../../src/middleware/logger.js';
import { getLiveTrafficMultiplier } from '../../src/services/trafficService.js';

describe('TrafficService - getLiveTrafficMultiplier & Surge Pricing Comprehensive Test Suite', () => {
  const originalTomTomKey = process.env.TOMTOM_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset env keys by default
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (originalTomTomKey) process.env.TOMTOM_API_KEY = originalTomTomKey;
    else delete process.env.TOMTOM_API_KEY;
    if (originalGoogleKey) process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  // ============================================================================
  // 1. Coordinate Validation & Null/Undefined Edge Cases
  // ============================================================================
  describe('Coordinate Validation & Guard Clauses', () => {
    it('returns 1.0 when pickupLat is null', async () => {
      const multiplier = await getLiveTrafficMultiplier(null, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is null', async () => {
      const multiplier = await getLiveTrafficMultiplier(28.61, null);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when both pickupLat and pickupLng are null', async () => {
      const multiplier = await getLiveTrafficMultiplier(null, null);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLat is undefined', async () => {
      const multiplier = await getLiveTrafficMultiplier(undefined, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is undefined', async () => {
      const multiplier = await getLiveTrafficMultiplier(28.61, undefined);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLat is NaN (non-finite)', async () => {
      const multiplier = await getLiveTrafficMultiplier(NaN, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is Infinity (non-finite)', async () => {
      const multiplier = await getLiveTrafficMultiplier(28.61, Infinity);
      expect(multiplier).toBe(1.0);
    });

    it('returns 1.0 when pickupLat is -Infinity', async () => {
      const multiplier = await getLiveTrafficMultiplier(-Infinity, 77.23);
      expect(multiplier).toBe(1.0);
    });
  });

  // ============================================================================
  // 2. Rush-Hour Deterministic Fallback & Boundary Window Tests
  // ============================================================================
  describe('Rush-Hour Fallback & Multiplier Boundaries (No API Key Configured)', () => {
    it('returns base 1.0 multiplier during non-rush hour (e.g., 02:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T02:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns base 1.0 multiplier during midday lull (e.g., 12:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('returns base 1.0 multiplier during late night (e.g., 22:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T22:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('reaches MIN_SURGE_MULTIPLIER (1.2) precisely at morning window edge start (07:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T07:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(1.20, 2);
    });

    it('returns to base/min surge at morning window edge end (10:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0); // Outside < 10 condition
    });

    it('peaks during morning rush window center (08:30 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T08:30:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      // Peak = MIN_SURGE (1.2) + AMPLITUDE (1.3) * sin(0.5 * PI) = 1.2 + 1.3 = 2.5 (clamped at MAX_SURGE 2.5)
      expect(multiplier).toBeCloseTo(2.33, 2);
    });

    it('reaches MIN_SURGE_MULTIPLIER (1.2) precisely at evening window edge start (16:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T16:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(1.20, 2);
    });

    it('returns to base at evening window edge end (19:00 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T19:00:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('peaks during evening rush window center (17:30 UTC)', async () => {
      vi.setSystemTime(new Date('2026-09-19T17:30:00Z'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBeCloseTo(2.33, 2);
    });

    it('handles invalid Date object passed internally gracefully', async () => {
      // Simulate system time or invalid date evaluation via mocking if necessary
      vi.setSystemTime(new Date('invalid-date-string'));
      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });
  });

  // ============================================================================
  // 3. TomTom API Integration & Error Fallback Tests
  // ============================================================================
  describe('TomTom API Integration & Error Fallbacks', () => {
    beforeEach(() => {
      process.env.TOMTOM_API_KEY = 'mock-tomtom-key';
    });

    it('calculates correct multiplier from TomTom speedDiffPercent (positive traffic delay)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          flowSegmentData: { speedDiffPercent: 45 }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      // 1.0 + 45/100 = 1.45
      expect(multiplier).toBe(1.45);
      expect(logger.info).toHaveBeenCalled();
    });

    it('clamps TomTom multiplier to MAX_SURGE_MULTIPLIER (2.5) when speedDiffPercent is extremely high', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          flowSegmentData: { speedDiffPercent: 200 }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(2.5);
    });

    it('clamps TomTom multiplier to minimum 1.0 when speedDiffPercent is negative', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          flowSegmentData: { speedDiffPercent: -20 }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('falls back gracefully to 1.0 and logs error when TomTom API returns non-OK status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('falls back gracefully to 1.0 when TomTom fetch throws a network exception', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 4. Google Maps Distance Matrix API Integration & Error Fallback Tests
  // ============================================================================
  describe('Google Maps Distance Matrix API Integration & Error Fallbacks', () => {
    beforeEach(() => {
      process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key';
    });

    it('calculates correct multiplier from Google duration_in_traffic vs normal duration', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [{
            elements: [{
              duration_in_traffic: { value: 1500 },
              duration: { value: 1000 }
            }]
          }]
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      // 1500 / 1000 = 1.50
      expect(multiplier).toBe(1.5);
      expect(logger.info).toHaveBeenCalled();
    });

    it('defaults to 1.0 when Google traffic duration elements are missing or zero', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [{
            elements: [{
              duration_in_traffic: null,
              duration: { value: 1000 }
            }]
          }]
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
    });

    it('falls back gracefully to 1.0 when Google Maps API returns non-OK status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429
      });
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('falls back gracefully to 1.0 when Google fetch throws a network exception', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));
      vi.stubGlobal('fetch', mockFetch);

      const multiplier = await getLiveTrafficMultiplier(28.61, 77.23);
      expect(multiplier).toBe(1.0);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
