import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import type { RequestUser } from '../types/index.js';

/**
 * Supabase JWT payload shape.
 *
 * Supabase issues JWTs where:
 *   - `sub`            → user UUID
 *   - `email`          → user's email address
 *   - `user_metadata`  → custom claims including subscription_status
 */
interface SupabaseJwtPayload {
  sub: string;
  email: string;
  user_metadata?: {
    subscription_status?: string;
  };
  /** Standard JWT expiry (Unix epoch seconds) */
  exp?: number;
}

/** Name of the HttpOnly session cookie set at login (Req 1.4). */
const SESSION_COOKIE = 'session_token';

/**
 * Fastify preHandler hook — JWT authentication middleware.
 *
 * Extraction order:
 *   1. `Authorization: Bearer <token>` header
 *   2. HttpOnly `session_token` cookie (fallback)
 *
 * On success, attaches `request.user = { id, email, subscription_status }`.
 * On any failure, throws AppError.unauthorized() → HTTP 401 { error_code: "unauthorized" }.
 *
 * The raw token value is NEVER logged.
 *
 * Requirements: 1.4, 18.2
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    throw AppError.unauthorized();
  }

  let payload: SupabaseJwtPayload;
  try {
    // Use the verifyJwt decorator registered by the jwt plugin.
    // Supports both new JWKS (asymmetric RS256/ES256) and legacy HS256 secret.
    const verified = await (request.server as any).verifyJwt(token);
    payload = verified as SupabaseJwtPayload;
  } catch {
    // Do NOT log the token; log only a generic failure message
    request.log.debug('JWT verification failed');
    throw AppError.unauthorized();
  }

  // Map Supabase payload fields onto the canonical RequestUser shape
  const subscriptionStatus = payload.user_metadata?.subscription_status;

  request.user = {
    id: payload.sub,
    email: payload.email,
    subscription_status: isValidSubscriptionStatus(subscriptionStatus)
      ? subscriptionStatus
      : 'inactive',
  } satisfies RequestUser;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the raw JWT string from the request.
 * Returns `null` when no token is found in either location.
 * Does NOT log the token value.
 */
function extractToken(request: FastifyRequest): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer' && parts[1]) {
      return parts[1];
    }
  }

  // 2. HttpOnly session cookie fallback
  const cookieToken = (request.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

type ValidSubscriptionStatus = RequestUser['subscription_status'];
const VALID_STATUSES: ReadonlySet<string> = new Set<ValidSubscriptionStatus>([
  'active',
  'inactive',
  'suspended',
  'cancelled',
]);

function isValidSubscriptionStatus(value: string | undefined): value is ValidSubscriptionStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}
