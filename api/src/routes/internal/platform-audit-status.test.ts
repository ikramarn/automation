/**
 * Tests for GET /internal/platform-audit-status/:platform.
 *
 * Strategy mirrors internal.test.ts: build a minimal Fastify app registering
 * only the internal routes, mock Supabase, and drive requests through
 * app.inject() with/without a valid service token.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../../errors/errorHandler.js';
import { internalRoutes } from './index.js';

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../lib/vault.js', () => ({
  getDecryptedSecret: vi.fn(),
  maskApiKey: vi.fn((k: string) => `••••${k.slice(-4)}`),
  maskValue: vi.fn((k: string) => `••••${k.slice(-4)}`),
}));

vi.mock('../../lib/n8n.js', () => ({
  triggerN8nWorkflow: vi.fn(),
}));

vi.mock('../../lib/email.js', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { createSupabaseAdminClient } from '../../lib/supabase.js';

const VALID_TOKEN = 'test-service-token-abc123';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(internalRoutes, { prefix: '/internal' });
  await app.ready();
  return app;
}

function mockSupabaseSelect(response: { data: unknown; error: unknown }) {
  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(response),
    }),
  } as unknown as ReturnType<typeof createSupabaseAdminClient>);
}

describe('GET /internal/platform-audit-status/:platform', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['N8N_SERVICE_TOKEN'] = VALID_TOKEN;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function get(platform: string, token: string | null = VALID_TOKEN) {
    return app.inject({
      method: 'GET',
      url: `/internal/platform-audit-status/${platform}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it('missing Authorization header → 401', async () => {
    const res = await get('youtube', null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'unauthorized' });
  });

  it('wrong Bearer token → 401', async () => {
    const res = await get('youtube', 'wrong-token');
    expect(res.statusCode).toBe(401);
  });

  it('audit_approved=true in DB → returns audit_approved: true', async () => {
    mockSupabaseSelect({ data: { audit_approved: true }, error: null });

    const res = await get('youtube');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ audit_approved: true, user_preferences: {} });
  });

  it('audit_approved=false in DB → returns audit_approved: false', async () => {
    mockSupabaseSelect({ data: { audit_approved: false }, error: null });

    const res = await get('youtube');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ audit_approved: false, user_preferences: {} });
  });

  it('platform name is case-insensitive (YouTube → youtube)', async () => {
    mockSupabaseSelect({ data: { audit_approved: true }, error: null });

    const res = await get('YouTube');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ audit_approved: true });
  });

  it('unknown platform → 200, fails safe to audit_approved: false (no DB call needed)', async () => {
    const res = await get('unknown-platform');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ audit_approved: false, user_preferences: {} });
    // Should never even reach Supabase for a platform outside the known set.
    expect(vi.mocked(createSupabaseAdminClient)).not.toHaveBeenCalled();
  });

  it('no row found for platform (data: null) → fails safe to audit_approved: false', async () => {
    mockSupabaseSelect({ data: null, error: null });

    const res = await get('tiktok');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ audit_approved: false });
  });

  it('Supabase lookup error → 200, fails safe to audit_approved: false (not a 500)', async () => {
    mockSupabaseSelect({ data: null, error: { message: 'connection refused' } });

    const res = await get('facebook');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ audit_approved: false });
  });

  it('supports all four documented platforms', async () => {
    for (const platform of ['youtube', 'tiktok', 'facebook', 'instagram']) {
      mockSupabaseSelect({ data: { audit_approved: false }, error: null });
      const res = await get(platform);
      expect(res.statusCode).toBe(200);
    }
  });
});
