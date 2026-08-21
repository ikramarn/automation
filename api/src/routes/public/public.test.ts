import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// Required env variables
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';

// Mock Supabase admin client so tests don't need a real database
vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { createSupabaseAdminClient } from '../../lib/supabase.js';

describe('Public and compliance routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /privacy ──────────────────────────────────────────────────────────

  describe('GET /privacy', () => {
    it('returns HTTP 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.statusCode).toBe(200);
    });

    it('returns Content-Type text/html', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    it('discloses AES-256 / Supabase Vault encrypted API key storage', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.body).toMatch(/AES-256/i);
      expect(res.body).toMatch(/Supabase Vault/i);
    });

    it('discloses use of OpenAI API', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.body).toMatch(/OpenAI/i);
    });

    it('discloses use of HeyGen API', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.body).toMatch(/HeyGen/i);
    });

    it('discloses 90-day execution log retention', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.body).toMatch(/90\s*days?/i);
    });
  });

  // ── GET /terms ────────────────────────────────────────────────────────────

  describe('GET /terms', () => {
    it('returns HTTP 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/terms' });
      expect(res.statusCode).toBe(200);
    });

    it('returns Content-Type text/html', async () => {
      const res = await app.inject({ method: 'GET', url: '/terms' });
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    it('contains Terms of Service content', async () => {
      const res = await app.inject({ method: 'GET', url: '/terms' });
      expect(res.body).toMatch(/Terms of Service/i);
    });
  });

  // ── GET /robots.txt ───────────────────────────────────────────────────────

  describe('GET /robots.txt', () => {
    it('returns HTTP 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.statusCode).toBe(200);
    });

    it('returns Content-Type text/plain', async () => {
      const res = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('contains at least one User-agent directive', async () => {
      const res = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.body).toMatch(/^User-agent:/m);
    });

    it('contains at least one Disallow or Allow crawl directive', async () => {
      const res = await app.inject({ method: 'GET', url: '/robots.txt' });
      const hasDisallow = /^Disallow:/m.test(res.body);
      const hasAllow = /^Allow:/m.test(res.body);
      expect(hasDisallow || hasAllow).toBe(true);
    });

    it('disallows crawling of /api/', async () => {
      const res = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.body).toMatch(/Disallow:\s*\/api\//);
    });
  });

  // ── GET /app-ads.txt ──────────────────────────────────────────────────────

  describe('GET /app-ads.txt', () => {
    it('returns HTTP 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/app-ads.txt' });
      expect(res.statusCode).toBe(200);
    });

    it('returns Content-Type text/plain', async () => {
      const res = await app.inject({ method: 'GET', url: '/app-ads.txt' });
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('contains at least one authorized seller entry', async () => {
      const res = await app.inject({ method: 'GET', url: '/app-ads.txt' });
      // A valid app-ads.txt entry has the form: domain, account-id, DIRECT|RESELLER
      expect(res.body).toMatch(/\w+\.\w+,\s*\S+,\s*(DIRECT|RESELLER)/i);
    });
  });

  // ── POST /data-deletion ───────────────────────────────────────────────────

  describe('POST /data-deletion', () => {
    it('returns 400 when neither email nor user_id provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/data-deletion',
        payload: {},
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when user is not found by email', async () => {
      // Mock Supabase to return an empty result
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
      vi.mocked(createSupabaseAdminClient).mockReturnValue(
        mockSupabase as unknown as ReturnType<typeof createSupabaseAdminClient>,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/data-deletion',
        payload: { email: 'notfound@example.com' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/no account found/i);
    });

    it('returns 200 with confirmation when user is found and deleted', async () => {
      // Mock: find user, then delete profile, then delete auth user
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [{ id: 'user-123', email: 'user@example.com' }],
                    error: null,
                  }),
                }),
              }),
              delete: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          return {};
        }),
        auth: {
          admin: {
            deleteUser: vi.fn().mockResolvedValue({ error: null }),
          },
        },
      };
      vi.mocked(createSupabaseAdminClient).mockReturnValue(
        mockSupabase as unknown as ReturnType<typeof createSupabaseAdminClient>,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/data-deletion',
        payload: { email: 'user@example.com' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/data deletion initiated/i);
      expect(body.message).toMatch(/30 days/i);
    });

    it('returns 200 when user is found by user_id', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [{ id: 'user-456', email: 'other@example.com' }],
                    error: null,
                  }),
                }),
              }),
              delete: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          return {};
        }),
        auth: {
          admin: {
            deleteUser: vi.fn().mockResolvedValue({ error: null }),
          },
        },
      };
      vi.mocked(createSupabaseAdminClient).mockReturnValue(
        mockSupabase as unknown as ReturnType<typeof createSupabaseAdminClient>,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/data-deletion',
        payload: { user_id: 'user-456' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
