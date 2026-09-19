import { describe, it, expect } from 'vitest';
import {
  PROFILE_KEY_PREFIX,
  PROFILE_SUB_KEYS,
  firebaseProfileKey,
  supabaseProfileKey,
  customerStatsKey,
  driverDetailsKey,
  profileCacheKey,
} from '../../src/cache/profileCacheKeys.js';
import { CacheNamespace } from '../../src/cache/CacheNamespace.js';

describe('profileCacheKeys', () => {
  describe('Constants and exports', () => {
    it('exports the correct PROFILE_KEY_PREFIX', () => {
      expect(PROFILE_KEY_PREFIX).toBe('user:profile');
    });

    it('exports PROFILE_SUB_KEYS with expected subkey values', () => {
      expect(PROFILE_SUB_KEYS).toEqual({
        STATS: 'stats',
        DRIVER: 'driver',
      });
      expect(PROFILE_SUB_KEYS.STATS).toBe('stats');
      expect(PROFILE_SUB_KEYS.DRIVER).toBe('driver');
    });

    it('freezes PROFILE_SUB_KEYS object to prevent modification', () => {
      expect(Object.isFrozen(PROFILE_SUB_KEYS)).toBe(true);
      expect(() => {
        PROFILE_SUB_KEYS.NEW_KEY = 'test';
      }).toThrow();
    });
  });

  describe('firebaseProfileKey', () => {
    it('generates correct key for standard Firebase UIDs', () => {
      expect(firebaseProfileKey('abc123xyz')).toBe('user:profile:abc123xyz');
      expect(firebaseProfileKey('28CharStandardFirebaseUid123')).toBe('user:profile:28CharStandardFirebaseUid123');
    });

    it('prefixes keys with PROFILE_KEY_PREFIX', () => {
      const uid = 'fb-user-123';
      expect(firebaseProfileKey(uid)).toBe(`${PROFILE_KEY_PREFIX}:${uid}`);
    });
  });

  describe('supabaseProfileKey', () => {
    it('generates correct key for standard UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(supabaseProfileKey(uuid)).toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000');
    });

    it('prefixes keys with PROFILE_KEY_PREFIX and sb namespace segment', () => {
      const id = 'user-test-id';
      expect(supabaseProfileKey(id)).toBe(`${PROFILE_KEY_PREFIX}:sb:${id}`);
    });
  });

  describe('customerStatsKey', () => {
    it('generates correct key for customer stats with UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(customerStatsKey(uuid)).toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000:stats');
    });

    it('appends the STATS subkey matching PROFILE_SUB_KEYS.STATS', () => {
      const userId = 'user-456';
      expect(customerStatsKey(userId)).toBe(`${supabaseProfileKey(userId)}:${PROFILE_SUB_KEYS.STATS}`);
    });
  });

  describe('driverDetailsKey', () => {
    it('generates correct key for driver details with UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(driverDetailsKey(uuid)).toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000:driver');
    });

    it('appends the DRIVER subkey matching PROFILE_SUB_KEYS.DRIVER', () => {
      const userId = 'user-789';
      expect(driverDetailsKey(userId)).toBe(`${supabaseProfileKey(userId)}:${PROFILE_SUB_KEYS.DRIVER}`);
    });
  });

  describe('profileCacheKey (CacheKeyBuilder integration)', () => {
    it('generates backward-compatible base key matching supabaseProfileKey', () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      expect(profileCacheKey(userId)).toBe(supabaseProfileKey(userId));
    });

    it('generates backward-compatible stats key matching customerStatsKey', () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      expect(profileCacheKey(userId, PROFILE_SUB_KEYS.STATS)).toBe(customerStatsKey(userId));
    });

    it('generates backward-compatible driver key matching driverDetailsKey', () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      expect(profileCacheKey(userId, PROFILE_SUB_KEYS.DRIVER)).toBe(driverDetailsKey(userId));
    });

    it('supports arbitrary sub-keys dynamically', () => {
      const userId = 'user-123';
      expect(profileCacheKey(userId, 'documents')).toBe('user:profile:sb:user-123:documents');
      expect(profileCacheKey(userId, 'activity_log')).toBe('user:profile:sb:user-123:activity_log');
    });
  });

  describe('TTL and Namespace configuration', () => {
    it('verifies profile namespace registered in CacheNamespace aligns with prefix', () => {
      const ns = CacheNamespace.get('profile');
      expect(ns).toBeDefined();
      expect(ns.prefix).toBe(PROFILE_KEY_PREFIX);
    });

    it('verifies default TTL is formatted as a positive integer in seconds', () => {
      const ns = CacheNamespace.get('profile');
      expect(Number.isInteger(ns.defaultTtl)).toBe(true);
      expect(ns.defaultTtl).toBeGreaterThan(0);
    });
  });

  describe('Edge cases for UID formats', () => {
    it('handles numeric string UIDs', () => {
      const numericUid = '1029384756';
      expect(firebaseProfileKey(numericUid)).toBe('user:profile:1029384756');
      expect(supabaseProfileKey(numericUid)).toBe('user:profile:sb:1029384756');
      expect(customerStatsKey(numericUid)).toBe('user:profile:sb:1029384756:stats');
      expect(driverDetailsKey(numericUid)).toBe('user:profile:sb:1029384756:driver');
    });

    it('handles UIDs with special characters (hyphens, underscores, colons, pipes, dots)', () => {
      const complexUid = 'auth0|usr_123.456-abc:xyz';
      expect(firebaseProfileKey(complexUid)).toBe('user:profile:auth0|usr_123.456-abc:xyz');
      expect(supabaseProfileKey(complexUid)).toBe('user:profile:sb:auth0|usr_123.456-abc:xyz');
      expect(customerStatsKey(complexUid)).toBe('user:profile:sb:auth0|usr_123.456-abc:xyz:stats');
      expect(driverDetailsKey(complexUid)).toBe('user:profile:sb:auth0|usr_123.456-abc:xyz:driver');
      expect(profileCacheKey(complexUid, 'custom:sub')).toBe('user:profile:sb:auth0|usr_123.456-abc:xyz:custom:sub');
    });

    it('handles long SHA256/JWT formatted identifiers', () => {
      const longId = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(firebaseProfileKey(longId)).toBe(`user:profile:${longId}`);
      expect(supabaseProfileKey(longId)).toBe(`user:profile:sb:${longId}`);
      expect(customerStatsKey(longId)).toBe(`user:profile:sb:${longId}:stats`);
      expect(driverDetailsKey(longId)).toBe(`user:profile:sb:${longId}:driver`);
    });

    it('handles uppercase and mixed-case UUIDs deterministically', () => {
      const upperUuid = '550E8400-E29B-41D4-A716-446655440000';
      expect(supabaseProfileKey(upperUuid)).toBe(`user:profile:sb:${upperUuid}`);
      expect(profileCacheKey(upperUuid)).toBe(`user:profile:sb:${upperUuid}`);
    });

    it('handles empty strings and whitespace without crashing', () => {
      expect(firebaseProfileKey('')).toBe('user:profile:');
      expect(supabaseProfileKey('')).toBe('user:profile:sb:');
      expect(customerStatsKey('')).toBe('user:profile:sb::stats');
      expect(driverDetailsKey('')).toBe('user:profile:sb::driver');
      expect(profileCacheKey('')).toBe('user:profile:sb:');
    });
  });
});
