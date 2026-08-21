import type { FastifyInstance } from 'fastify';

/**
 * GET /privacy — Privacy Policy page.
 *
 * Publicly accessible, no authentication required.
 *
 * Discloses:
 *  - Encrypted API key storage (AES-256 via Supabase Vault)
 *  - Use of OpenAI and HeyGen APIs
 *  - Data retention: execution logs deleted after 90 days
 *
 * Requirements: 16.1, 16.2
 */
export async function privacyRoute(app: FastifyInstance): Promise<void> {
  app.get('/privacy', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — AI Video Automation</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
    h1 { font-size: 2rem; margin-bottom: 0.25em; }
    h2 { font-size: 1.25rem; margin-top: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.25em; }
    p, li { margin: 0.5em 0; }
    ul { padding-left: 1.5em; }
    .updated { color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: January 2025</p>

  <h2>1. Introduction</h2>
  <p>
    AI Video Automation ("we", "us", or "our") provides an automated video generation and publishing
    platform. This Privacy Policy explains how we collect, use, store, and protect your information
    when you use our service.
  </p>

  <h2>2. Information We Collect</h2>
  <ul>
    <li><strong>Account information:</strong> Email address, display name, and password (hashed).</li>
    <li><strong>Third-party API credentials:</strong> API keys you provide for HeyGen and OpenAI,
        and OAuth tokens for Google Drive, YouTube, TikTok, Facebook, and Instagram.</li>
    <li><strong>Pipeline configuration:</strong> Your niche keywords, schedules, avatar preferences,
        and publishing settings.</li>
    <li><strong>Execution logs:</strong> Records of each pipeline run, including per-step statuses,
        generated script text, video links, and failure reasons.</li>
    <li><strong>Subscription and billing data:</strong> Managed by Stripe; we store only your
        subscription status.</li>
  </ul>

  <h2>3. Encrypted API Key Storage</h2>
  <p>
    All third-party API keys and OAuth tokens you provide are encrypted at rest using
    <strong>AES-256 encryption via Supabase Vault</strong> before being stored in our database.
    Raw key values are never written to application logs or persisted in memory beyond a single
    pipeline execution request. Only the last 4 characters of each API key are displayed in the
    dashboard for identification purposes.
  </p>

  <h2>4. Third-Party Services</h2>
  <p>We use the following third-party APIs to operate the service:</p>
  <ul>
    <li>
      <strong>OpenAI API:</strong> Used to generate video scripts from fetched article content.
      If you provide your own OpenAI API key it is sent to OpenAI on your behalf; otherwise a
      platform-level key is used. Content sent to OpenAI is subject to
      <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener">OpenAI's Privacy Policy</a>.
    </li>
    <li>
      <strong>HeyGen API:</strong> Used to generate AI avatar videos from your scripts.
      Your HeyGen API key and script text are transmitted to HeyGen to produce video files.
      Use of HeyGen is subject to
      <a href="https://www.heygen.com/privacy" target="_blank" rel="noopener">HeyGen's Privacy Policy</a>.
    </li>
    <li>
      <strong>Google Drive:</strong> Videos are uploaded to your connected Google Drive folder
      using OAuth tokens you authorise. We request only the <code>drive.file</code> scope.
    </li>
    <li>
      <strong>Social platforms (YouTube, TikTok, Facebook, Instagram):</strong> Videos and captions
      are published using OAuth tokens you authorise. Each platform's own privacy policy applies.
    </li>
    <li>
      <strong>Stripe:</strong> Handles all payment processing. We do not store card details.
    </li>
  </ul>

  <h2>5. Data Retention</h2>
  <ul>
    <li><strong>Execution logs:</strong> Automatically deleted after <strong>90 days</strong>.</li>
    <li><strong>API credentials:</strong> Retained until you delete them or close your account.</li>
    <li><strong>Account data:</strong> Retained until account deletion is completed (within 30 days
        of a deletion request).</li>
  </ul>

  <h2>6. Your Rights and Data Deletion</h2>
  <p>
    You may request deletion of all your account data at any time by emailing us or by submitting
    a request via our <a href="/data-deletion">data deletion form</a>. We will remove all your data
    within 30 days of a confirmed request.
  </p>

  <h2>7. Security</h2>
  <p>
    We enforce HTTPS on all endpoints, use HTTP-only cookies for session management, apply
    Row Level Security (RLS) on all database tables to prevent cross-user data access, and
    follow OWASP secure coding practices.
  </p>

  <h2>8. Contact</h2>
  <p>
    For privacy-related enquiries please contact us at
    <a href="mailto:privacy@example.com">privacy@example.com</a>.
  </p>
</body>
</html>`;

    return reply.status(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });
}
