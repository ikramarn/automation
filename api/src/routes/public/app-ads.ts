import type { FastifyInstance } from 'fastify';

/**
 * GET /app-ads.txt — Authorized digital sellers file.
 *
 * Publicly accessible, no authentication required.
 *
 * The app-ads.txt standard (IAB Tech Lab) allows app developers to declare
 * authorized digital sellers of their in-app advertising inventory. Serving
 * this file prevents unauthorized reselling of ad space.
 *
 * Format per line: <ad-system-domain>, <publisher-account-id>, <account-type>, [cert-authority-id]
 *
 * Requirements: 17.6
 */
export async function appAdsRoute(app: FastifyInstance): Promise<void> {
  app.get('/app-ads.txt', async (_request, reply) => {
    // Authorized seller entries — update with real ad network details as needed.
    // The placeholder entries below document the structure; replace with actual
    // publisher account IDs before enabling live ad serving.
    const content = [
      '# app-ads.txt — Authorized Digital Sellers',
      '# See https://iabtechlab.com/ads-txt/ for specification',
      '#',
      '# Format: <SSP/Exchange Domain>, <Publisher Account ID>, <Account Type>, [Certification Authority ID]',
      '#',
      '# Google AdMob / AdSense (placeholder — replace with real publisher ID)',
      'google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0',
      '#',
      '# No additional authorized sellers at this time.',
      '',
    ].join('\n');

    return reply
      .status(200)
      .header('Content-Type', 'text/plain; charset=utf-8')
      .send(content);
  });
}
