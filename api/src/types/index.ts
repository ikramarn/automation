/**
 * Structured JSON error response body (Req 19.3).
 *
 * All error responses from the API use this shape:
 *   { status, error_code, message, details }
 */
export interface ApiErrorResponse {
  /** Always "error" for error responses */
  status: 'error';
  /** Machine-readable error code (e.g. "unauthorized", "not_found") */
  error_code: string;
  /** Human-readable description of the error */
  message: string;
  /** Optional additional context (validation errors, field names, etc.) */
  details?: unknown;
}

/**
 * Structured JSON success response body.
 * Wraps successful responses for consistency.
 */
export interface ApiSuccessResponse<T = unknown> {
  status: 'ok';
  data: T;
}

/**
 * Fastify request user context, populated by the authenticate middleware.
 *
 * Mapped from the Supabase JWT payload:
 *   sub                          → id
 *   email                        → email
 *   user_metadata.subscription_status → subscription_status
 *
 * Requirements: 1.4, 18.2
 */
export interface RequestUser {
  /** Supabase user UUID (from JWT `sub` claim) */
  id: string;
  /** User's email address */
  email: string;
  /** Current subscription status pulled from JWT user_metadata */
  subscription_status: 'active' | 'inactive' | 'suspended' | 'cancelled';
}

// ── @fastify/jwt augmentation ─────────────────────────────────────────────────
//
// Tells @fastify/jwt what shape `request.user` carries after jwtVerify().
// This makes `request.user` strongly typed throughout the app.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    // Raw Supabase payload (what the token actually contains)
    payload: {
      sub: string;
      email: string;
      user_metadata?: {
        subscription_status?: string;
      };
    };
    // request.user after jwtVerify() — the authenticate middleware overwrites
    // this with the canonical RequestUser shape.
    user: RequestUser;
  }
}
