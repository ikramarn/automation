import type { FastifyInstance } from 'fastify';

/**
 * GET /terms — Terms of Service page.
 *
 * Publicly accessible, no authentication required.
 *
 * Requirements: 16.3
 */
export async function termsRoute(app: FastifyInstance): Promise<void> {
  app.get('/terms', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Terms of Service — AI Video Automation</title>
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
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: January 2025</p>

  <h2>1. Acceptance of Terms</h2>
  <p>
    By accessing or using AI Video Automation ("the Service"), you agree to be bound by these
    Terms of Service ("Terms"). If you do not agree, do not use the Service.
  </p>

  <h2>2. Description of Service</h2>
  <p>
    AI Video Automation provides an automated pipeline that fetches niche content, generates
    video scripts via OpenAI, produces AI avatar videos via HeyGen using your own API credentials,
    uploads completed videos to your Google Drive, and publishes them to your connected social
    media accounts on a schedule you define.
  </p>
  <p>
    The Service acts as automation infrastructure between third-party services. You are responsible
    for maintaining your own accounts and API credentials for HeyGen, OpenAI, Google, and social
    platforms, and for any costs those providers charge.
  </p>

  <h2>3. Eligibility</h2>
  <p>
    You must be at least 18 years of age to use the Service. By using the Service you represent
    that you meet this requirement.
  </p>

  <h2>4. Account Registration</h2>
  <ul>
    <li>You must provide accurate and complete information during registration.</li>
    <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
    <li>You are responsible for all activity that occurs under your account.</li>
    <li>Notify us immediately of any unauthorised use of your account.</li>
  </ul>

  <h2>5. Subscriptions and Billing</h2>
  <ul>
    <li>Access to pipeline creation and execution requires an active paid subscription.</li>
    <li>Subscriptions are billed monthly via Stripe. All prices are shown before purchase.</li>
    <li>Failed payments will suspend pipeline execution. Your data remains accessible for 30 days
        before account deactivation.</li>
    <li>You may cancel at any time; access continues until the end of your current billing period.</li>
    <li>We do not provide refunds for partial billing periods unless required by applicable law.</li>
  </ul>

  <h2>6. Acceptable Use</h2>
  <p>You agree not to use the Service to:</p>
  <ul>
    <li>Generate or publish content that is illegal, defamatory, harassing, or fraudulent.</li>
    <li>Infringe third-party intellectual property rights.</li>
    <li>Publish misinformation, spam, or artificially manipulate engagement metrics.</li>
    <li>Violate the terms of service of any connected third-party platform (YouTube, TikTok,
        Facebook, Instagram, HeyGen, OpenAI, Google).</li>
    <li>Attempt to gain unauthorised access to the Service or its infrastructure.</li>
  </ul>

  <h2>7. Third-Party Services and API Credentials</h2>
  <p>
    You supply your own API keys and OAuth tokens for HeyGen, OpenAI, Google Drive, and social
    platforms. You are responsible for ensuring your use of those services complies with their
    respective terms. We are not liable for any costs, suspensions, or penalties imposed by
    third-party providers.
  </p>

  <h2>8. AI-Generated Content</h2>
  <p>
    Videos and scripts produced by the Service are AI-generated. You are solely responsible for
    reviewing and ensuring the accuracy, legality, and compliance of all content published through
    your account. We do not review content before publication.
  </p>

  <h2>9. Intellectual Property</h2>
  <p>
    Videos generated on your behalf using your credentials are owned by you. You grant us a
    limited licence to process and temporarily store content solely to operate the Service.
    The Service software, design, and brand are owned by us and may not be copied or reverse-engineered.
  </p>

  <h2>10. Data and Privacy</h2>
  <p>
    Our collection and use of personal data is described in our
    <a href="/privacy">Privacy Policy</a>, which forms part of these Terms.
  </p>

  <h2>11. Limitation of Liability</h2>
  <p>
    To the maximum extent permitted by law, the Service is provided "as is" without warranty.
    We are not liable for any indirect, incidental, or consequential damages arising from your
    use of the Service, including but not limited to lost revenue, data loss, or platform account
    suspensions.
  </p>

  <h2>12. Termination</h2>
  <p>
    We may suspend or terminate your account for material breach of these Terms. You may close
    your account at any time via the dashboard. Upon termination your data will be deleted within
    30 days.
  </p>

  <h2>13. Changes to Terms</h2>
  <p>
    We may update these Terms from time to time. Continued use of the Service after changes are
    posted constitutes acceptance of the revised Terms.
  </p>

  <h2>14. Contact</h2>
  <p>
    For questions about these Terms contact us at
    <a href="mailto:legal@example.com">legal@example.com</a>.
  </p>
</body>
</html>`;

    return reply.status(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });
}
