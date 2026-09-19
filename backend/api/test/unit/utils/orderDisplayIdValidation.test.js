import { describe, it, expect } from 'vitest';
import { isValidDisplayId, getDisplayIdDate } from '../../../src/utils/orderDisplayIdValidation.js';

describe('orderDisplayIdValidation', () => {
  describe('isValidDisplayId', () => {
    it('returns true for valid display ID', () => {
      expect(isValidDisplayId('#FF20240101ABCD12345678')).toBe(true);
    });

    it('returns true for another valid display ID', () => {
      expect(isValidDisplayId('#FF20240813XYZ987654321')).toBe(true);
    });

    it('returns false for non-string input', () => {
      expect(isValidDisplayId(null)).toBe(false);
      expect(isValidDisplayId(undefined)).toBe(false);
      expect(isValidDisplayId(123)).toBe(false);
      expect(isValidDisplayId({})).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidDisplayId('')).toBe(false);
    });

    it('returns false for wrong prefix', () => {
      expect(isValidDisplayId('#XX20240101ABCD12345678')).toBe(false);
    });

    it('returns false for wrong length', () => {
      expect(isValidDisplayId('#FF20240101ABCD1234567')).toBe(false);
      expect(isValidDisplayId('#FF20240101ABCD123456789')).toBe(false);
    });

    it('returns false for lowercase letters', () => {
      expect(isValidDisplayId('#FF20240101abcd12345678')).toBe(false);
    });
  });

  describe('getDisplayIdDate', () => {
    it('returns YYYYMMDD from valid display ID', () => {
      expect(getDisplayIdDate('#FF20240101ABCD12345678')).toBe('20240101');
    });

    it('returns null for invalid display ID', () => {
      expect(getDisplayIdDate('not-a-display-id')).toBe(null);
      expect(getDisplayIdDate('')).toBe(null);
      expect(getDisplayIdDate(null)).toBe(null);
    });

    it('returns the date for valid calendar dates', () => {
      expect(getDisplayIdDate('#FF20240228ABCD12345678')).toBe('20240228');
      expect(getDisplayIdDate('#FF20240229ABCD12345678')).toBe('20240229');
      expect(getDisplayIdDate('#FF20241231ABCD12345678')).toBe('20241231');
      expect(getDisplayIdDate('#FF20240430ABCD12345678')).toBe('20240430');
    });

    it('returns null for invalid calendar dates', () => {
      expect(getDisplayIdDate('#FF20250229ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20240230ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20240431ABCD12345678')).toBe(null);
    });

    it('returns null for out-of-range month and day values', () => {
      expect(getDisplayIdDate('#FF99999999ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20261345ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF00000000ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20240001ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20241301ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20240100ABCD12345678')).toBe(null);
      expect(getDisplayIdDate('#FF20240132ABCD12345678')).toBe(null);
    });

    it('returns null for non-string inputs', () => {
      expect(getDisplayIdDate(null)).toBe(null);
      expect(getDisplayIdDate(undefined)).toBe(null);
      expect(getDisplayIdDate(123)).toBe(null);
      expect(getDisplayIdDate({})).toBe(null);
    });
  });
});
