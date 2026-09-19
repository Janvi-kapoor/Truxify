import { hashOtp, verifyOtpHash, constantTimeEqualHex } from '../../src/lib/otpHashing.js'
import crypto from 'crypto'
import { describe, it, expect } from 'vitest'

describe('otpHashing', () => {
  describe('hashOtp', () => {
    it('generates different hashes and salts for the same OTP', () => {
      const otp = '123456'
      const result1 = hashOtp(otp)
      const result2 = hashOtp(otp)

      expect(result1.hash).toBeDefined()
      expect(result1.salt).toBeDefined()
      expect(result2.hash).toBeDefined()
      expect(result2.salt).toBeDefined()

      expect(result1.salt).not.toBe(result2.salt)
      expect(result1.hash).not.toBe(result2.hash)
    })

    it('generates the same hash if the same salt is provided', () => {
      const otp = '123456'
      const result1 = hashOtp(otp)
      const result2 = hashOtp(otp, result1.salt)

      expect(result2.salt).toBe(result1.salt)
      expect(result2.hash).toBe(result1.hash)
    })
  })

  describe('verifyOtpHash', () => {
    it('verifies a scrypt hashed OTP successfully', () => {
      const otp = '123456'
      const { hash, salt } = hashOtp(otp)
      
      const otpRecord = {
        otp_hash: hash,
        otp_salt: salt
      }

      expect(verifyOtpHash(otp, otpRecord)).toBe(true)
    })

    it('fails verification for an incorrect scrypt hashed OTP', () => {
      const otp = '123456'
      const wrongOtp = '654321'
      const { hash, salt } = hashOtp(otp)
      
      const otpRecord = {
        otp_hash: hash,
        otp_salt: salt
      }

      expect(verifyOtpHash(wrongOtp, otpRecord)).toBe(false)
    })

    it('returns false if otpRecord is null', () => {
      expect(verifyOtpHash('123456', null)).toBe(false)
    })
  })

  describe('constantTimeEqualHex', () => {
    it('should return true for identical hex strings', () => {
      expect(constantTimeEqualHex('abcdef', 'abcdef')).toBe(true)
    })

    it('should return false for different hex strings of the same length', () => {
      expect(constantTimeEqualHex('abcdef', 'fedcba')).toBe(false)
    })

    it('should return false for hex strings of different lengths without timing leaks', () => {
      expect(constantTimeEqualHex('abc', 'abcdef')).toBe(false)
      expect(constantTimeEqualHex('abcdef', 'abc')).toBe(false)
    })

    it('should return false for invalid non-string inputs', () => {
      expect(constantTimeEqualHex(null, 'abcdef')).toBe(false)
      expect(constantTimeEqualHex('abcdef', undefined)).toBe(false)
    })
  })
})