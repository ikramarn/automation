"use client";

/**
 * Shared layout for all /settings/* pages.
 *
 * Renders a tab bar that links to:
 *   - Credentials  → /settings/credentials
 *   - Account      → /settings/account
 *   - Billing      → /settings/billing
 *   - Notifications → /settings/notifications
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Credentials", href: "/settings/credentials" },
  { label: "Account", href: "/settings/account" },
  { label: "Billing", href: "/settings/billing" },
  { label: "Notifications", href: "/settings/notifications" },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="container mx-auto max-w-2xl px-4 pb-16 pt-8">
      {/* Tab navigation */}
      <nav
        aria-label="Settings navigation"
        className="mb-8 border-b border-gray-200"
      >
        <ul role="list" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map(({ label, href }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "inline-flex items-center whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
                    active
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
                  ].join(" ")}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Page content — no extra container; each page owns its own heading */}
      {children}
    </div>
  );
}
