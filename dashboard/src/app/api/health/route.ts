import { NextResponse } from 'next/server';

/**
 * Health check route.
 *
 * GET /api/health
 *
 * Returns { status: "ok" } when the Next.js server is running. Used by
 * Docker healthchecks (docker-compose.yml) and Caddy's reverse_proxy
 * health_uri (Caddyfile) — must stay unauthenticated so both can reach it
 * without a session cookie.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok' });
}
