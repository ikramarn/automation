import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing your use of the AI Video Automation platform.",
  robots: { index: true, follow: false },
};

/**
 * Terms of Service page — publicly accessible, no auth required.
 *
 * Requirements: 16.3
 */
export default function TermsPage() {
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
        Terms of Service
      </h1>
      <p className="mb-10 text-sm text-gray-500">Last updated: January 2025</p>

      <section className="space-y-8 text-sm leading-7">
        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            1. Acceptance of Terms
          </h2>
          <p>
            By accessing or using AI Video Automation (&ldquo;the Service&rdquo;),
            you agree to be bound by these Terms of Service
            (&ldquo;Terms&rdquo;). If you do not agree, do not use the Service.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            2. Description of Service
          </h2>
          <p className="mb-2">
            AI Video Automation provides an automated pipeline that fetches
            niche content, generates video scripts via OpenAI, produces AI
            avatar videos via HeyGen using your own API credentials, uploads
            completed videos to your Google Drive, and publishes them to your
            connected social media accounts on a schedule you define.
          </p>
          <p>
            The Service acts as automation infrastructure between third-party
            services. You are responsible for maintaining your own accounts and
            API credentials for HeyGen, OpenAI, Google, and social platforms,
            and for any costs those providers charge.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            3. Eligibility
          </h2>
          <p>
            You must be at least 18 years of age to use the Service. By using
            the Service you represent that you meet this requirement.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            4. Account Registration
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              You must provide accurate and complete information during
              registration.
            </li>
            <li>
              You are responsible for maintaining the confidentiality of your
              account credentials.
            </li>
            <li>
              You are responsible for all activity that occurs under your
              account.
            </li>
            <li>
              Notify us immediately of any unauthorised use of your account.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            5. Subscriptions and Billing
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Access to pipeline creation and execution requires an active paid
              subscription.
            </li>
            <li>
              Subscriptions are billed monthly via Stripe. All prices are shown
              before purchase.
            </li>
            <li>
              Failed payments will suspend pipeline execution. Your data remains
              accessible for 30 days before account deactivation.
            </li>
            <li>
              You may cancel at any time; access continues until the end of your
              current billing period.
            </li>
            <li>
              We do not provide refunds for partial billing periods unless
              required by applicable law.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            6. Acceptable Use
          </h2>
          <p className="mb-2">You agree not to use the Service to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Generate or publish content that is illegal, defamatory,
              harassing, or fraudulent.
            </li>
            <li>Infringe third-party intellectual property rights.</li>
            <li>
              Publish misinformation, spam, or artificially manipulate
              engagement metrics.
            </li>
            <li>
              Violate the terms of service of any connected third-party platform
              (YouTube, TikTok, Facebook, Instagram, HeyGen, OpenAI, Google).
            </li>
            <li>
              Attempt to gain unauthorised access to the Service or its
              infrastructure.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            7. Third-Party Services and API Credentials
          </h2>
          <p>
            You supply your own API keys and OAuth tokens for HeyGen, OpenAI,
            Google Drive, and social platforms. You are responsible for ensuring
            your use of those services complies with their respective terms. We
            are not liable for any costs, suspensions, or penalties imposed by
            third-party providers.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            8. AI-Generated Content
          </h2>
          <p>
            Videos and scripts produced by the Service are AI-generated. You
            are solely responsible for reviewing and ensuring the accuracy,
            legality, and compliance of all content published through your
            account. We do not review content before publication.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            9. Intellectual Property
          </h2>
          <p>
            Videos generated on your behalf using your credentials are owned by
            you. You grant us a limited licence to process and temporarily store
            content solely to operate the Service. The Service software, design,
            and brand are owned by us and may not be copied or
            reverse-engineered.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            10. Data and Privacy
          </h2>
          <p>
            Our collection and use of personal data is described in our{" "}
            <Link
              href="/privacy"
              className="text-indigo-600 underline hover:text-indigo-500"
            >
              Privacy Policy
            </Link>
            , which forms part of these Terms.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            11. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by law, the Service is provided
            &ldquo;as is&rdquo; without warranty. We are not liable for any
            indirect, incidental, or consequential damages arising from your use
            of the Service, including but not limited to lost revenue, data
            loss, or platform account suspensions.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            12. Termination
          </h2>
          <p>
            We may suspend or terminate your account for material breach of
            these Terms. You may close your account at any time via the
            dashboard. Upon termination your data will be deleted within 30
            days.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            13. Changes to Terms
          </h2>
          <p>
            We may update these Terms from time to time. Continued use of the
            Service after changes are posted constitutes acceptance of the
            revised Terms.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            14. Contact
          </h2>
          <p>
            For questions about these Terms contact us at{" "}
            <a
              href="mailto:legal@example.com"
              className="text-indigo-600 underline hover:text-indigo-500"
            >
              legal@example.com
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
