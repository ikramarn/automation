import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen" style={{ color: "inherit" }}>

      {/* ── Left panel — feature showcase ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-800 px-12 py-16 text-white">

        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-purple-400/40 animate-spin" style={{animationDuration:'20s'}} />
            <div className="absolute inset-1 rounded-full border border-blue-400/30 animate-spin" style={{animationDuration:'15s',animationDirection:'reverse'}} />
            <div className="h-3 w-3 rounded-full bg-gradient-to-br from-purple-400 to-blue-400" />
          </div>
          <span className="text-xl font-bold tracking-tight">AutomateSocials</span>
        </div>

        {/* Hero text */}
        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-extrabold leading-tight mb-4">
              Your content.<br />
              <span className="text-purple-300">On autopilot.</span>
            </h1>
            <p className="text-indigo-200 text-lg leading-relaxed">
              Build once. Publish everywhere. AutomateSocials turns your ideas into AI videos and posts them across all your platforms — while you sleep.
            </p>
          </div>

          {/* How it works steps */}
          <div className="space-y-5">
            {[
              {
                step: "01",
                title: "Connect your platforms",
                desc: "Link Google Drive, YouTube, TikTok, Instagram and your AI tools in minutes.",
                icon: "🔗",
              },
              {
                step: "02",
                title: "Configure your pipeline",
                desc: "Set your content topic, choose platforms, and pick your posting schedule.",
                icon: "⚙️",
              },
              {
                step: "03",
                title: "Enable and forget",
                desc: "AI writes the script, generates the video, uploads to Drive, and publishes — fully automated.",
                icon: "🚀",
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg">
                  {item.icon}
                </div>
                <div>
                  <p className="font-semibold text-white">{item.title}</p>
                  <p className="text-sm text-indigo-300">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/10">
            {[
              { value: "10×", label: "Faster than manual" },
              { value: "24/7", label: "Always publishing" },
              { value: "100%", label: "Hands-free" },
            ].map((stat) => (
              <div key={stat.value} className="text-center">
                <div className="text-2xl font-black text-purple-300">{stat.value}</div>
                <div className="text-xs text-indigo-300 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer quote */}
        <p className="text-sm text-indigo-400">
          "Stop creating manually. Start scaling automatically."
        </p>
      </div>

      {/* ── Right panel — auth form ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 px-6 py-12 lg:px-12">
        {/* Mobile brand (shown only on small screens) */}
        <div className="mb-8 text-center lg:hidden">
          <span className="text-2xl font-bold tracking-tight text-gray-900">
            AutomateSocials
          </span>
        </div>

        {/* Card */}
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-gray-900">
          {children}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} AutomateSocials. All rights reserved.
        </p>
      </div>

    </div>
  );
}
