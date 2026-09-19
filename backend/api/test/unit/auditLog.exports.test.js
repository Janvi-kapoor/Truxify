import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the audit service ──────────────────────────────────────
vi.mock('../../src/services/auditLogService.js', () => ({
  auditLogService: { log: vi.fn() },
  default: { log: vi.fn() },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('auditLog module exports', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not export the dead computeStateDiff helper', async () => {
    const mod = await import('../../src/middleware/auditLog.js');
    expect(Object.keys(mod)).not.toContain('computeStateDiff');
  });
});