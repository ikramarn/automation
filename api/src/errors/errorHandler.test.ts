import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { AppError } from './AppError.js';
import type { ApiErrorResponse } from '../types/index.js';

process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';

describe('Error handler — structured JSON responses (Req 19.3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'silent' });

    // Register test routes that throw various errors
    app.get('/test/app-error', async () => {
      throw new AppError(422, 'test_error', 'Test error message', { field: 'name' });
    });
    app.get('/test/unauthorized', async () => {
      throw AppError.unauthorized();
    });
    app.get('/test/not-found-resource', async () => {
      throw AppError.notFound('Pipeline');
    });
    app.get('/test/internal', async () => {
      throw AppError.internal();
    });
    app.get('/test/unhandled', async () => {
      throw new Error('unexpected crash');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('AppError thrown from route', () => {
    it('returns the correct HTTP status code', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/app-error' });
      expect(res.statusCode).toBe(422);
    });

    it('response body has status="error"', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/app-error' });
      const body = res.json<ApiErrorResponse>();
      expect(body.status).toBe('error');
    });

    it('response body includes error_code', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/app-error' });
      const body = res.json<ApiErrorResponse>();
      expect(body.error_code).toBe('test_error');
    });

    it('response body includes message', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/app-error' });
      const body = res.json<ApiErrorResponse>();
      expect(body.message).toBe('Test error message');
    });

    it('response body includes details when provided', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/app-error' });
      const body = res.json<ApiErrorResponse>();
      expect(body.details).toEqual({ field: 'name' });
    });
  });

  describe('AppError.unauthorized()', () => {
    it('returns HTTP 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/unauthorized' });
      expect(res.statusCode).toBe(401);
    });

    it('error_code is "unauthorized"', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/unauthorized' });
      expect(res.json<ApiErrorResponse>().error_code).toBe('unauthorized');
    });
  });

  describe('AppError.notFound()', () => {
    it('returns HTTP 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/not-found-resource' });
      expect(res.statusCode).toBe(404);
    });

    it('message includes resource name', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/not-found-resource' });
      expect(res.json<ApiErrorResponse>().message).toContain('Pipeline');
    });
  });

  describe('Route not found (404)', () => {
    it('returns HTTP 404 for unknown route', async () => {
      const res = await app.inject({ method: 'GET', url: '/nonexistent' });
      expect(res.statusCode).toBe(404);
    });

    it('error response has status="error" and error_code="not_found"', async () => {
      const res = await app.inject({ method: 'GET', url: '/nonexistent' });
      const body = res.json<ApiErrorResponse>();
      expect(body.status).toBe('error');
      expect(body.error_code).toBe('not_found');
    });
  });

  describe('Unhandled error', () => {
    it('returns HTTP 500 without leaking internals', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/unhandled' });
      expect(res.statusCode).toBe(500);
    });

    it('error_code is "internal_error"', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/unhandled' });
      expect(res.json<ApiErrorResponse>().error_code).toBe('internal_error');
    });

    it('does not leak the original error message', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/unhandled' });
      const body = res.json<ApiErrorResponse>();
      expect(body.message).not.toContain('unexpected crash');
    });
  });

  describe('AppError class', () => {
    it('instanceof AppError works correctly', () => {
      const err = new AppError(400, 'test', 'msg');
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    });

    it('factory methods set correct status codes', () => {
      expect(AppError.badRequest('x').statusCode).toBe(400);
      expect(AppError.unauthorized().statusCode).toBe(401);
      expect(AppError.forbidden().statusCode).toBe(403);
      expect(AppError.notFound().statusCode).toBe(404);
      expect(AppError.conflict('x').statusCode).toBe(409);
      expect(AppError.tooManyRequests().statusCode).toBe(429);
      expect(AppError.internal().statusCode).toBe(500);
    });

    it('details is undefined when not provided', () => {
      const err = AppError.unauthorized();
      expect(err.details).toBeUndefined();
    });
  });
});
