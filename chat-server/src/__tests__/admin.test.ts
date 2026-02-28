import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../admin';

describe('Admin', () => {
  describe('requireAdmin middleware', () => {
    it('should return 503 when ADMIN_TOKEN not set', () => {
      const originalToken = process.env.ADMIN_TOKEN;
      delete process.env.ADMIN_TOKEN;

      const req = {} as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Admin not configured'
      });
      expect(next).not.toHaveBeenCalled();

      // Restore
      if (originalToken) process.env.ADMIN_TOKEN = originalToken;
    });

    it('should return 401 when token is wrong', () => {
      process.env.ADMIN_TOKEN = 'secret123';

      const req = {
        headers: {
          'x-admin-token': 'wrongtoken'
        }
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid admin token'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() when token is correct', () => {
      process.env.ADMIN_TOKEN = 'secret123';

      const req = {
        headers: {
          'x-admin-token': 'secret123'
        }
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 401 when token header is missing', () => {
      process.env.ADMIN_TOKEN = 'secret123';

      const req = {
        headers: {}
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
