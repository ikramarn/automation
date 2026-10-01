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
 * Lists downloadable software files served directly from the VPS by Caddy
 * (see the `/files/*` handle block in the Caddyfile) — NOT a third-party
 * storage bucket. The one.com VPS plan this runs on includes unlimited
 * data traffic, so there's no egress billing or per-file size cap to
 * worry about the way there would be with a hosted storage service.
 *
 * To add or update a file:
 *   1. Copy the .exe into the `static-downloads/` directory at the repo
 *      root on the VPS (e.g. `scp yourfile.exe administrator@<vps>:
 *      /opt/autoflow/static-downloads/`). No rebuild or redeploy needed —
 *      Caddy serves whatever is in that directory immediately.
 *   2. Add/update an entry in the DOWNLOADS array below with
 *      url: "https://automatesocials.tech/files/yourfile.exe"
 *      (filename must match exactly, case-sensitive).
 *   3. Commit + redeploy the dashboard so the new entry shows on the page.
 *
 * Download counts (not shown publicly, informational only): Caddy logs
 * every request to /files/* to its own dedicated access log. Run
 * `scripts/count-downloads.sh` on the VPS any time to see a per-file tally
 * — see that script's header comment for exact usage. No database, admin
 * UI, or analytics service involved.
 */

interface DownloadItem {
  name: string;
  description: string;
  version: string;
  sizeLabel: string;
  url: string;
}

// Update this list whenever a new build is published. The filename in each
// url must exactly match a file placed in static-downloads/ on the VPS.
const DOWNLOADS: DownloadItem[] = [
  // Example entry — replace once a real file is uploaded:
  // {
  //   name: "AutomateSocials Companion App",
  //   description: "Desktop helper for local video preview and upload.",
  //   version: "1.0.0",
  //   sizeLabel: "42 MB",
  //   url: "https://automatesocials.tech/files/companion-app-1.0.0.exe",
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
        Always verify the publisher of any software before running it on your
        machine.
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
