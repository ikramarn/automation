import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings hub page.
 * Full implementation in later tasks.
 */
export default function SettingsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-gray-500">
        Settings hub — implemented in later tasks.
      </p>
    </div>
  );
}
