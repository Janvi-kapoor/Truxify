import { describe, it, expect, vi } from 'vitest';
import { tokenCostWei, extractEventArg } from './token.service.js';

describe('Token Service Utilities', () => {
  describe('tokenCostWei', () => {
    it('should calculate exact token cost in wei with default roundUp (true)', () => {
      const cost = tokenCostWei('0.1', '3');
      expect(cost).toBe(300000000000000000n);
    });

    it('should calculate token cost with roundUp set to false', () => {
      const cost = tokenCostWei('0.1', '3', false);
      expect(cost).toBe(300000000000000000n);
    });

    it('should correctly handle integer and decimal string conversions', () => {
      const cost = tokenCostWei(1, '2.5');
      expect(cost).toBe(2500000000000000000n);
    });
  });

  describe('extractEventArg', () => {
    it('should return null if receipt, contract, or interface is missing', () => {
      expect(extractEventArg(null, null, 'Transfer')).toBeNull();
      expect(extractEventArg({}, null, 'Transfer')).toBeNull();
      expect(extractEventArg({}, { interface: null }, 'Transfer')).toBeNull();
    });

    it('should successfully extract argument from matching event log', () => {
      const mockParsedLog = {
        name: 'Transfer',
        args: ['0xRecipientAddress', 100n]
      };

      const mockContract = {
        interface: {
          parseLog: vi.fn().mockReturnValue(mockParsedLog)
        }
      };

      const mockReceipt = {
        logs: [{ topics: ['0x123'] }]
      };

      const arg = extractEventArg(mockReceipt, mockContract, 'Transfer', 1);
      expect(arg).toBe(100n);
      expect(mockContract.interface.parseLog).toHaveBeenCalledWith(mockReceipt.logs[0]);
    });

    it('should handle unparsable logs gracefully and return null', () => {
      const mockContract = {
        interface: {
          parseLog: vi.fn().mockImplementation(() => { throw new Error('Parsing failed'); })
        }
      };

      const mockReceipt = {
        logs: [{ topics: ['0xbad'] }]
      };

      const arg = extractEventArg(mockReceipt, mockContract, 'Transfer', 0);
      expect(arg).toBeNull();
    });
  });
});