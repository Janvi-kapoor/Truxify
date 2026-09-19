import { describe, it, expect, vi } from 'vitest'
import { requireJsonContent } from '../../src/middleware/contentType.js'

describe('requireJsonContent middleware', () => {
  it('should pass through GET and DELETE requests without checking content-type', () => {
    const req = { method: 'GET', headers: {} }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('should return 415 when POST has no content-type header', () => {
    const req = { method: 'POST', headers: {} }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(res.status).toHaveBeenCalledWith(415)
    expect(next).not.toHaveBeenCalled()
  })

  it('should pass when POST has application/json content-type', () => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: {} }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should pass when POST has application/x-www-form-urlencoded content-type', () => {
    const req = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should pass when POST has multipart/form-data content-type', () => {
    const req = { method: 'POST', headers: { 'content-type': 'multipart/form-data' } }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should return 415 when POST has invalid mime type (text/plain)', () => {
    const req = { method: 'POST', headers: { 'content-type': 'text/plain' } }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(res.status).toHaveBeenCalledWith(415)
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 415 when POST has malformed mime (application/jsonx)', () => {
    const req = { method: 'POST', headers: { 'content-type': 'application/jsonx' } }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(res.status).toHaveBeenCalledWith(415)
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 400 when POST has application/json but body is a non-object array', () => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: [] }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(next).not.toHaveBeenCalled()
  })

  it('should pass when POST has application/json but body is null', () => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: null }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    requireJsonContent(req, res, next)

    expect(next).toHaveBeenCalled()
  })
})
