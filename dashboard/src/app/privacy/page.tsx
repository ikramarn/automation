import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How AI Video Automation collects, uses, stores, and protects your information.",
  robots: { index: true, follow: false },
};

/**
 * Privacy Policy page — publicly accessible, no auth required.
 *
 * Discloses:
 *  - Encrypted API key storage (AES-256 via Supabase Vault)
 *  - Use of OpenAI and HeyGen APIs
 *  - Data retention: execution logs deleted after 90 days
 *
 * Requirements: 16.1, 16.2
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-gray-800">
      {/* Nav back to app */}
      <nav aria-label="Back to app" className="mb-8">
        <Link
          href="/"
          className="text-sm text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
        >
          ← Back to AI Video Automation
        </Link>
      </nav>

      <h1 className="mb-1 text-3xl font-bold tracking-tight text-gray-900">
        Privacy Policy
      </h1>
      <p className="mb-10 text-sm text-gray-500">Last updated: January 2025</p>

      <section className="space-y-8 text-sm leading-7">
        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            1. Introduction
          </h2>
          <p>
            AI Video Automation (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or
            &ldquo;our&rdquo;) provides an automated video generation and
            publishing platform. This Privacy Policy explains how we collect,
            use, store, and protect your information when you use our service.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            2. Information We Collect
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Account information:</strong> Email address, display name,
              and password (hashed).
            </li>
            <li>
              <strong>Third-party API credentials:</strong> API keys you provide
              for HeyGen and OpenAI, and OAuth tokens for Google Drive, YouTube,
              TikTok, Facebook, and Instagram.
            </li>
            <li>
              <strong>Pipeline configuration:</strong> Your niche keywords,
              schedules, avatar preferences, and publishing settings.
            </li>
            <li>
              <strong>Execution logs:</strong> Records of each pipeline run,
              including per-step statuses, generated script text, video links,
              and failure reasons.
            </li>
            <li>
              <strong>Subscription and billing data:</strong> Managed by Stripe;
              we store only your subscription status.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            3. Encrypted API Key Storage
          </h2>
          <p>
            All third-party API keys and OAuth tokens you provide are encrypted
            at rest using <strong>AES-256 encryption via Supabase Vault</strong>{" "}
            before being stored in our database. Raw key values are never
            written to application logs or persisted in memory beyond a single
            pipeline execution request. Only the last 4 characters of each API
            key are displayed in the dashboard for identification purposes.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            4. Third-Party Services
          </h2>
          <p className="mb-3">
            We use the following third-party APIs to operate the service:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>OpenAI API:</strong> Used to generate video scripts from
              fetched article content. If you provide your own OpenAI API key it
              is sent to OpenAI on your behalf; otherwise a platform-level key
              is used. Content sent to OpenAI is subject to{" "}
              <a
                href="https://openai.com/policies/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline hover:text-indigo-500"
              >
                OpenAI&rsquo;s Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>HeyGen API:</strong> Used to generate AI avatar videos
              from your scripts. Your HeyGen API key and script text are
              transmitted to HeyGen to produce video files. Use of HeyGen is
              subject to{" "}
              <a
                href="https://www.heygen.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline hover:text-indigo-500"
              >
                HeyGen&rsquo;s Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>Google Drive:</strong> Videos are uploaded to your
              connected Google Drive folder using OAuth tokens you authorise. We
              request only the <code className="rounded bg-gray-100 px-1 text-xs">drive.file</code> scope.
            </li>
            <li>
              <strong>
                Social platforms (YouTube, TikTok, Facebook, Instagram):
              </strong>{" "}
              Videos and captions are published using OAuth tokens you authorise.
              Each platform&rsquo;s own privacy policy applies.
            </li>
            <li>
              <strong>Stripe:</strong> Handles all payment processing. We do not
              store card details.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            5. Data Retention
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Execution logs:</strong> Automatically deleted after{" "}
              <strong>90 days</strong>.
            </li>
            <li>
              <strong>API credentials:</strong> Retained until you delete them
              or close your account.
            </li>
            <li>
              <strong>Account data:</strong> Retained until account deletion is
              completed (within 30 days of a deletion request).
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            6. Your Rights and Data Deletion
          </h2>
          <p>
            You may request deletion of all your account data at any time by
            emailing us or by submitting a request via our{" "}
            <a
              href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/data-deletion`}
              className="text-indigo-600 underline hover:text-indigo-500"
            >
              data deletion form
            </a>
            . We will remove all your data within 30 days of a confirmed
            request.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            7. Security
          </h2>
          <p>
            We enforce HTTPS on all endpoints, use HTTP-only cookies for session
            management, apply Row Level Security (RLS) on all database tables to
            prevent cross-user data access, and follow OWASP secure coding
            practices.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            8. Contact
          </h2>
          <p>
            For privacy-related enquiries please contact us at{" "}
            <a
              href="mailto:privacy@example.com"
              className="text-indigo-600 underline hover:text-indigo-500"
            >
              privacy@example.com
            </a>
            .
          </p>
        </div>
      </section>

      <footer className="mt-12 border-t border-gray-200 pt-6 text-xs text-gray-400">
        <nav className="flex gap-4" aria-label="Legal pages">
          <Link href="/privacy" className="hover:text-gray-600">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-gray-600">
            Terms of Service
          </Link>
        </nav>
      </footer>
    </main>
  );
}
