/**
 * /robots.txt — served as a Next.js Route Handler (Req 16.9).
 */
export function GET() {
  const body = [
    "User-agent: *",
    "Disallow: /dashboard",
    "Disallow: /settings",
    "Disallow: /pipelines",
    "Disallow: /executions",
    "Allow: /privacy",
    "Allow: /terms",
    "Allow: /demo",
    "",
    `Sitemap: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/sitemap.xml`,
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
