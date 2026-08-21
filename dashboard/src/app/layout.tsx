import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Video Automation",
    template: "%s | AI Video Automation",
  },
  description:
    "Automate your AI video pipeline: content discovery, script generation, HeyGen video production, and social publishing — all on autopilot.",
  robots: {
    index: false, // Dashboard is behind auth — do not index
    follow: false,
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
}

/**
 * Root layout — wraps every page in the application.
 * No auth check here; individual route groups handle auth redirects.
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
