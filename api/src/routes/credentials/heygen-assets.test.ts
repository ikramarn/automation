/**
 * HeyGen avatar/voice picker proxy route tests.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server, Supabase, or
 * HeyGen connection. The Supabase admin client, vault helpers, and global
 * fetch are mocked so each test controls exact responses.
 *
 * Architecture under test (heygen-assets.ts):
 *   - GET /credentials/heygen/avatars — looks up the user's stored
 *     heygen_api_key, decrypts it, proxies GET /v3/avatars/looks
 *   - GET /credentials/heygen/voices  — same pattern for GET /v3/voices
 *
 * Both routes require authentication (JWT) but not CSRF, since GET requests
 * are not state-changing.
 *
 * Covered scenarios:
 *
 * GET /credentials/heygen/avatars
 *   - 401 when no JWT provided
 *   - 400 when user has no active heygen_api_key credential
 *   - 400 when HeyGen returns 401/403 (invalid key / credits exhausted)
 *   - 500 when HeyGen returns another error status
 *   - 200 with mapped avatar list on success
 *   - Forwards ?group_id= and ?token= to HeyGen
 *
 * GET /credentials/heygen/voices
 *   - 401 when no JWT provided
 *   - 400 when user has no active heygen_api_key credential
 *   - 200 with mapped voice list on success
 *   - Filters by ?language= client-side
 *
 * Validates: Requirements 6.1, 6.6
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['SUPABASE_JWT_SECRET'] = JWT_SECRET;
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Mock: vault helpers ──────────────────────────────────────────────────────
const mockGetDecryptedSecret = vi.fn();

vi.mock('../../lib/vault.js', () => ({
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(),
  getDecryptedSecret: (...args: unknown[]) => mockGetDecryptedSecret(...args),
  maskApiKey: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
  maskValue: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
}));

// ── Mock: Supabase admin client ──────────────────────────────────────────────
const mockDbFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => mockDbFrom(table),
  }),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

describe('HeyGen avatar/voice picker proxy routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDecryptedSecret.mockResolvedValue('heygen-key-value');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function signJwt(userId = 'user-123'): string {
    return app.jwt.sign({
      sub: userId,
      email: 'user@example.com',
      user_metadata: { subscription_status: 'active' },
    });
  }

  function authHeaders(userId = 'user-123') {
    return { headers: { Authorization: `Bearer ${signJwt(userId)}` } };
  }

  /** Mocks the `credentials` table lookup for the heygen_api_key row. */
  function setupHeyGenCredentialDb(found: boolean) {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(
        found
          ? { data: { vault_secret_id: 'vault-heygen-1' }, error: null }
          : { data: null, error: null },
      ),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockDbFrom.mockReturnValue(chain);
    return chain;
  }

  /** Stubs global fetch to return a HeyGen-shaped response. */
  function stubHeyGenFetch(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }),
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GET /credentials/heygen/avatars
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /credentials/heygen/avatars', () => {
    it('returns 401 when no JWT provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/avatars',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when user has no active heygen_api_key credential', async () => {
      setupHeyGenCredentialDb(false);

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/avatars',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('No active HeyGen API key');
    });

    it('returns 400 when HeyGen returns 401 (invalid key)', async () => {
      setupHeyGenCredentialDb(true);
      stubHeyGenFetch(401, { error: 'unauthorized' });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/avatars',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('invalid or credits exhausted');
    });

    it('returns 500 when HeyGen returns a 500-range error', async () => {
      setupHeyGenCredentialDb(true);
      stubHeyGenFetch(502, { error: 'bad gateway' });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/avatars',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 200 with mapped avatar list on success', async () => {
      setupHeyGenCredentialDb(true);
      stubHeyGenFetch(200, {
        data: [
          {
            id: 'lk_abc123',
            name: 'Business Suit',
            avatar_type: 'photo_avatar',
            group_id: 'ag_abc123',
            gender: 'female',
            preview_image_url: 'https://files.heygen.ai/look/business.jpg',
            preview_video_url: 'https://files.heygen.ai/look/business.mp4',
            default_voice_id: 'voice-1',
            supported_api_engines: ['avatar_v', 'avatar_iv'],
          },
        ],
        has_more: false,
        next_token: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/avatars',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.avatars).toHaveLength(1);
      expect(body.avatars[0]).toEqual({
        avatar_id: 'lk_abc123',
        name: 'Business Suit',
        avatar_type: 'photo_avatar',
        group_id: 'ag_abc123',
        gender: 'female',
        preview_image_url: 'https://files.heygen.ai/look/business.jpg',
        preview_video_url: 'https://files.heygen.ai/look/business.mp4',
        default_voice_id: 'voice-1',
        supported_api_engines: ['avatar_v', 'avatar_iv'],
      });
      expect(body.has_more).toBe(false);
    });

    it('forwards ?group_id= and ?token= query params to HeyGen', async () => {
      setupHeyGenCredentialDb(true);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [], has_more: false }),
        text: async () => '',
      });
      vi.stubGlobal('fetch', fetchMock);

      await app.inject({
        method: 'GET',
        url: '/credentials/heygen/avatars?group_id=ag_1&token=next-page-token',
        ...authHeaders(),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(calledUrl.searchParams.get('group_id')).toBe('ag_1');
      expect(calledUrl.searchParams.get('token')).toBe('next-page-token');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /credentials/heygen/voices
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /credentials/heygen/voices', () => {
    it('returns 401 when no JWT provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/voices',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when user has no active heygen_api_key credential', async () => {
      setupHeyGenCredentialDb(false);

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/voices',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 200 with mapped voice list on success', async () => {
      setupHeyGenCredentialDb(true);
      stubHeyGenFetch(200, {
        data: [
          {
            voice_id: 'voice-1',
            name: 'Sara',
            language: 'English',
            gender: 'female',
            type: 'public',
            preview_audio_url: 'https://files.heygen.ai/voice/sara.mp3',
          },
        ],
        has_more: false,
        next_token: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/voices',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.voices).toHaveLength(1);
      expect(body.voices[0]).toEqual({
        voice_id: 'voice-1',
        name: 'Sara',
        language: 'English',
        gender: 'female',
        type: 'public',
        preview_audio_url: 'https://files.heygen.ai/voice/sara.mp3',
      });
    });

    it('filters voices by ?language= client-side', async () => {
      setupHeyGenCredentialDb(true);
      stubHeyGenFetch(200, {
        data: [
          { voice_id: 'v-en', name: 'Sara', language: 'English', gender: 'female', type: 'public', preview_audio_url: null },
          { voice_id: 'v-fr', name: 'Claire', language: 'French', gender: 'female', type: 'public', preview_audio_url: null },
        ],
        has_more: false,
        next_token: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/heygen/voices?language=English',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.voices).toHaveLength(1);
      expect(body.voices[0].voice_id).toBe('v-en');
    });
  });
});
