import type { FastifyInstance } from 'fastify';

/**
 * GET /robots.txt — Robots crawl directives.
 *
 * Publicly accessible, no authentication required.
 *
 * Instructs web crawlers to:
 *  - Allow indexing of public-facing pages (/privacy, /terms, the root)
 *  - Disallow crawling of API routes and the authenticated dashboard
 *
 * Requirements: 17.2
 */
export async function robotsRoute(app: FastifyInstance): Promise<void> {
  app.get('/robots.txt', async (_request, reply) => {
    const content = [
      'User-agent: *',
      'Disallow: /api/',
      'Disallow: /dashboard/',
      'Disallow: /auth/',
      'Allow: /privacy',
      'Allow: /terms',
      'Allow: /',
      '',
    ].join('\n');

    return reply
      .status(200)
      .header('Content-Type', 'text/plain; charset=utf-8')
      .send(content);
  });
}
