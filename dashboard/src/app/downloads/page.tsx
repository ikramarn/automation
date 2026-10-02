import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Downloads | AutomateSocials",
  description: "Download companion software for AutomateSocials and AI Video Automation.",
  robots: { index: true, follow: false },
};

interface DownloadItem {
  name: string;
  description: string;
  version: string;
  sizeLabel: string;
  url: string;
}

const DOWNLOADS: DownloadItem[] = [
  {
    name: "JazzyEngine — Desktop Automation & Engagement",
    description: "Multi-profile desktop automation for natural newsfeed browsing, Reels watching, and reach scaling.",
    version: "1.0.0",
    sizeLabel: "129 MB (.exe)",
    url: "https://automatesocials.tech/files/JazzyEngine-Setup-1.0.0.exe",
  },
];

export default function DownloadsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-gray-800">
      <nav aria-label="Back to app" className="mb-8">
        <Link
          href="/"
          className="text-sm text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
        >
          &larr; Back to AI Video Automation
        </Link>
      </nav>

      <h1 className="mb-1 text-3xl font-bold tracking-tight text-gray-900">
        Downloads
      </h1>
      <p className="mb-10 text-sm text-gray-500">
        Software and tools to use alongside AutomateSocials.
      </p>

      {DOWNLOADS.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
          No downloads are currently available. Check back soon.
        </p>
      ) : (
        <ul className="space-y-4">
          {DOWNLOADS.map((item) => (
            <li
              key={item.url}
              className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm"
            >
              <div>
                <p className="font-semibold text-gray-900">{item.name}</p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {item.description}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Version {item.version} &middot; {item.sizeLabel} &middot; Windows 10/11
                </p>
              </div>
              <a
                href={item.url}
                download
                className="shrink-0 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Download (.exe)
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
        <strong>💡 Note for Windows Users:</strong> If Windows SmartScreen or Smart App Control shows a warning, click <em>More info</em> &rarr; <em>Run anyway</em>, or ensure Smart App Control is set to Evaluation/Off.
      </div>

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