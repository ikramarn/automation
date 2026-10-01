import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Downloads",
  description: "Download companion software for AI Video Automation.",
  robots: { index: true, follow: false },
};

/**
 * Downloads page — publicly accessible, no auth required.
 *
 * Lists downloadable software files hosted in a public Supabase Storage
 * bucket. To add or update a file:
 *   1. Upload the .exe to the Supabase Storage bucket "downloads" (public).
 *   2. Copy its public URL (Supabase Dashboard → Storage → downloads →
 *      click the file → "Get URL").
 *   3. Add/update an entry in the DOWNLOADS array below.
 *
 * See the project README or ask the team for the full setup walkthrough —
 * summarized here as a code comment so it stays next to what it documents:
 *
 *   - Create a bucket named "downloads" in Supabase Dashboard → Storage.
 *   - Mark it PUBLIC when creating it (or toggle "Public bucket" after).
 *     A public bucket serves files over a stable CDN URL with no auth
 *     required — appropriate for software downloads, not for private user
 *     data (which should stay in a private bucket / signed URLs instead).
 *   - Upload each .exe directly through the dashboard, or via the
 *     Supabase CLI / JS client from a build/release script.
 *   - Supabase's free tier includes 1 GB of storage and 2 GB of monthly
 *     egress bandwidth — enough for a handful of installer-sized files at
 *     light-to-moderate traffic. Monitor usage in Dashboard → Storage if
 *     files are large or downloads become frequent.
 */

interface DownloadItem {
  name: string;
  description: string;
  version: string;
  sizeLabel: string;
  url: string;
}

// Update this list whenever a new build is published.
const DOWNLOADS: DownloadItem[] = [
  // Example entry — replace with your real file's public Supabase Storage
  // URL once uploaded:
  // {
  //   name: "AutomateSocials Companion App",
  //   description: "Desktop helper for local video preview and upload.",
  //   version: "1.0.0",
  //   sizeLabel: "42 MB",
  //   url: "https://sqfechtihroodkmncxpc.supabase.co/storage/v1/object/public/downloads/companion-app-1.0.0.exe",
  // },
];

export default function DownloadsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-gray-800">
      <nav aria-label="Back to app" className="mb-8">
        <Link
          href="/"
          className="text-sm text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
        >
          ← Back to AI Video Automation
        </Link>
      </nav>

      <h1 className="mb-1 text-3xl font-bold tracking-tight text-gray-900">
        Downloads
      </h1>
      <p className="mb-10 text-sm text-gray-500">
        Software and tools to use alongside AI Video Automation.
      </p>

      {DOWNLOADS.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
          No downloads are available yet. Check back soon.
        </p>
      ) : (
        <ul className="space-y-4">
          {DOWNLOADS.map((item) => (
            <li
              key={item.url}
              className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm"
            >
              <div>
                <p className="font-medium text-gray-900">{item.name}</p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {item.description}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Version {item.version} &middot; {item.sizeLabel}
                </p>
              </div>
              <a
                href={item.url}
                download
                className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-xs text-gray-400">
        Downloaded files are served from our storage provider. Always verify
        the publisher of any software before running it on your machine.
      </p>

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
