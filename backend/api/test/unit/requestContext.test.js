/**
 * Unit tests for backend/api/src/lib/requestContext.js
 */
import { describe, it, expect, vi } from 'vitest';
import { requestContext, getRequestCache, safeJsonParseWithFallback } from '../../src/lib/requestContext.js';
import { RequestCache } from '../../src/lib/requestCache.js';

describe('requestContext', () => {
  describe('getRequestCache', () => {
    it('returns null when called outside a request context', () => {
      const cache = getRequestCache();
      expect(cache).toBeNull();
    });

    it('returns the requestCache from the store when inside context.run()', () => {
      const store = { requestCache: new RequestCache() };
      let observedCache = null;

      requestContext.run(store, () => {
        observedCache = getRequestCache();
      });

      expect(observedCache).toBe(store.requestCache);
      expect(observedCache).toBeInstanceOf(RequestCache);
    });

    it('returns null when the store has no requestCache property', () => {
      const store = {};
      let observedCache = null;

      requestContext.run(store, () => {
        observedCache = getRequestCache();
      });

      expect(observedCache).toBeNull();
    });

    it('returns null when the store.requestCache is explicitly null', () => {
      const store = { requestCache: null };
      let observedCache = null;

      requestContext.run(store, () => {
        observedCache = getRequestCache();
      });

      expect(observedCache).toBeNull();
    });
  });

  describe('safeJsonParseWithFallback', () => {
    it('returns parsed object for valid JSON object string', () => {
      const result = safeJsonParseWithFallback('{"key":"value"}', null);
      expect(result).toEqual({ key: 'value' });
    });

    it('parses valid JSON objects with multiple properties', () => {
      expect(safeJsonParseWithFallback('{"a":1,"b":2}', {})).toEqual({ a: 1, b: 2 });
    });

    it('returns fallback for JSON array string (not an object)', () => {
      const fallback = null;
      const result = safeJsonParseWithFallback('[1, 2, 3]', fallback);
      expect(result).toBe(fallback);
    });

    it('returns fallback for null input', () => {
      const fallback = { default: true };
      expect(safeJsonParseWithFallback(null, fallback)).toBe(fallback);
    });

    it('returns fallback for undefined input', () => {
      const fallback = { default: true };
      expect(safeJsonParseWithFallback(undefined, fallback)).toBe(fallback);
    });

    it('returns fallback for invalid JSON string', () => {
      const fallback = { safe: true };
      expect(safeJsonParseWithFallback('not valid json', fallback)).toBe(fallback);
      expect(safeJsonParseWithFallback('{ broken }', {})).toEqual({});
    });

    it('returns fallback for primitive JSON values', () => {
      const fallback = { safe: true };
      expect(safeJsonParseWithFallback('"just a string"', fallback)).toBe(fallback);
      expect(safeJsonParseWithFallback('123', fallback)).toBe(fallback);
      expect(safeJsonParseWithFallback('true', fallback)).toBe(fallback);
    });

    it('returns fallback for empty string', () => {
      const fallback = { safe: true };
      expect(safeJsonParseWithFallback('', fallback)).toBe(fallback);
    });

    it('uses custom fallback', () => {
      const custom = { custom: true };
      expect(safeJsonParseWithFallback('not valid', custom)).toBe(custom);
    });
  });
});