import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Landing page — shown to unauthenticated visitors.
 * Authenticated users are redirected straight to /dashboard.
 */
export default async function RootPage() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden animated-gradient">

      {/* ── Background orbs ──────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb-1 absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full bg-purple-700/20 blur-[120px]" />
        <div className="orb-2 absolute -bottom-40 -right-40 h-[700px] w-[700px] rounded-full bg-blue-600/15 blur-[140px]" />
        <div className="orb-3 absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      {/* ── Grid overlay ─────────────────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center">
            <div className="spin-slow absolute inset-0 rounded-full border border-purple-500/40" />
            <div className="spin-reverse absolute inset-1 rounded-full border border-blue-500/30" />
            <div className="h-3 w-3 rounded-full bg-gradient-to-br from-purple-400 to-blue-400" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            AutoFlow <span className="text-purple-400">AI</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:text-white"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="pulse-glow rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:from-purple-500 hover:to-blue-500"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 text-center md:px-12 md:pt-24">

        {/* Badge */}
        <div className="fade-in-up-1 mb-6 inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-1.5 text-sm text-purple-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-400" />
          </span>
          AI-Powered Video Automation Platform
        </div>

        {/* Headline */}
        <h1 className="fade-in-up-2 mx-auto mb-6 max-w-4xl text-5xl font-extrabold leading-tight tracking-tight text-white md:text-7xl">
          Create. Publish.{" "}
          <span className="shimmer-text">Automate.</span>
          <br />
          <span className="text-gray-400">While You Sleep.</span>
        </h1>

        {/* Subheadline — concrete outcome focus */}
        <p className="fade-in-up-3 mx-auto mb-3 max-w-2xl text-lg leading-relaxed text-gray-400 md:text-xl">
          Turn one idea into a finished video, uploaded to Drive, and published
          across YouTube, TikTok &amp; Instagram — <strong className="text-white font-semibold">fully automated in under 10 minutes</strong>.
          No editing. No scheduling. No manual uploads.
        </p>

        {/* Free trial callout */}
        <p className="fade-in-up-3 mb-8 text-sm text-purple-400 font-medium">
          Free to start · No credit card required
        </p>

        {/* CTA buttons */}
        <div className="fade-in-up-4 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-purple-500/25 transition-all hover:shadow-purple-500/40 hover:scale-105"
          >
            <span className="relative z-10">Start Automating for Free →</span>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <Link
            href="/login"
            className="rounded-xl border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/10"
          >
            Sign In to Dashboard
          </Link>
        </div>

        {/* Social proof pill */}
        <div className="fade-in-up-5 mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {/* Avatars */}
          <div className="flex -space-x-2">
            {["bg-purple-500", "bg-blue-500", "bg-emerald-500", "bg-pink-500", "bg-amber-500"].map((color, i) => (
              <div
                key={i}
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-black text-xs font-bold text-white ${color}`}
              >
                {["A", "J", "M", "S", "R"][i]}
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-400">
            <span className="font-semibold text-white">500+ creators</span> publishing on autopilot
          </p>
          {/* Star rating */}
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <svg key={i} className="h-4 w-4 text-amber-400 fill-amber-400" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
            <span className="ml-1 text-sm text-gray-400">4.9 / 5</span>
          </div>
        </div>
      </section>

      {/* ── Platform logos ────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-20 max-w-4xl px-6 md:px-12">
        <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-gray-600">
          Publish directly to
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
          {[
            { label: "YouTube", icon: "▶", color: "text-red-400 border-red-500/20 bg-red-500/5" },
            { label: "TikTok",  icon: "♪", color: "text-pink-400 border-pink-500/20 bg-pink-500/5" },
            { label: "Instagram", icon: "◈", color: "text-orange-400 border-orange-500/20 bg-orange-500/5" },
            { label: "Facebook", icon: "f", color: "text-blue-400 border-blue-500/20 bg-blue-500/5" },
            { label: "Google Drive", icon: "△", color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" },
          ].map((p) => (
            <div
              key={p.label}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium backdrop-blur-sm ${p.color}`}
            >
              <span className="text-base">{p.icon}</span>
              {p.label}
            </div>
          ))}
        </div>
      </section>

      {/* ── Animated Pipeline Visualiser ─────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-24 max-w-5xl px-6 md:px-12">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm md:p-10">
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-widest text-gray-500">
            Your pipeline, automated end-to-end
          </p>
          <div className="relative flex items-center justify-between gap-2">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent">
              <div className="flow-dot absolute left-0 h-2 w-2 -translate-y-1/2 rounded-full bg-purple-400" />
              <div className="flow-dot-2 absolute left-0 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-400" />
              <div className="flow-dot-3 absolute left-0 h-2 w-2 -translate-y-1/2 rounded-full bg-emerald-400" />
            </div>
            {[
              { icon: "🔍", label: "Fetch Content",   color: "from-purple-600/20 to-purple-600/5",  border: "border-purple-500/20" },
              { icon: "✍️", label: "AI Script",        color: "from-blue-600/20 to-blue-600/5",      border: "border-blue-500/20"   },
              { icon: "🎬", label: "Generate Video",   color: "from-indigo-600/20 to-indigo-600/5",  border: "border-indigo-500/20" },
              { icon: "☁️", label: "Upload Drive",     color: "from-cyan-600/20 to-cyan-600/5",      border: "border-cyan-500/20"   },
              { icon: "📱", label: "Publish Social",   color: "from-emerald-600/20 to-emerald-600/5",border: "border-emerald-500/20"},
              { icon: "📊", label: "Track Results",    color: "from-teal-600/20 to-teal-600/5",      border: "border-teal-500/20"   },
            ].map((node, i) => (
              <div key={i} className="relative z-10 flex flex-1 flex-col items-center gap-2">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl border bg-gradient-to-b ${node.color} ${node.border} text-xl shadow-lg md:h-14 md:w-14`}>
                  {node.icon}
                </div>
                <span className="hidden text-center text-xs text-gray-400 md:block">{node.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-gray-500 md:hidden">
            Fetch → Script → Video → Drive → Publish → Track
          </p>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-24 max-w-5xl px-6 md:px-12">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { value: "10×",   label: "Faster than manual",   sub: "vs. editing by hand",   color: "text-purple-400" },
            { value: "24/7",  label: "Always publishing",    sub: "zero manual effort",     color: "text-blue-400"   },
            { value: "5 min", label: "Avg. setup time",      sub: "from signup to running", color: "text-emerald-400"},
            { value: "4+",    label: "Platforms at once",    sub: "one pipeline, many posts",color: "text-cyan-400"  },
          ].map((stat, i) => (
            <div
              key={i}
              className="count-up rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur-sm"
            >
              <div className={`mb-1 text-4xl font-extrabold ${stat.color}`}>{stat.value}</div>
              <div className="text-sm font-medium text-gray-300">{stat.label}</div>
              <div className="mt-1 text-xs text-gray-500">{stat.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-24 max-w-5xl px-6 md:px-12">
        <h2 className="mb-4 text-center text-3xl font-bold text-white md:text-4xl">
          Everything automated.{" "}
          <span className="shimmer-text">Nothing manual.</span>
        </h2>
        <p className="mb-12 text-center text-gray-400">
          One platform to replace your entire content production workflow.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: "🤖",
              title: "AI Script Generation",
              desc: "Feed a topic, get a broadcast-ready script. GPT-4 writes content tailored to your brand voice and platform.",
              color: "border-purple-500/20 hover:border-purple-500/50",
              glow: "group-hover:bg-purple-500/5",
            },
            {
              icon: "🎥",
              title: "Automated Video Production",
              desc: "HeyGen renders your AI avatar videos automatically. No studio, no camera, no editing software required.",
              color: "border-blue-500/20 hover:border-blue-500/50",
              glow: "group-hover:bg-blue-500/5",
            },
            {
              icon: "📡",
              title: "Multi-Platform Publishing",
              desc: "One click schedules posts to YouTube, TikTok, Instagram, and more — simultaneously, on your cron schedule.",
              color: "border-indigo-500/20 hover:border-indigo-500/50",
              glow: "group-hover:bg-indigo-500/5",
            },
            {
              icon: "📁",
              title: "Google Drive Backup",
              desc: "Every video is automatically uploaded to your Google Drive folder — organised, searchable, always accessible.",
              color: "border-cyan-500/20 hover:border-cyan-500/50",
              glow: "group-hover:bg-cyan-500/5",
            },
            {
              icon: "⏰",
              title: "Cron Scheduling",
              desc: "Set your pipeline to run daily, weekly, or at any custom interval. AutoFlow handles the rest while you focus on growth.",
              color: "border-emerald-500/20 hover:border-emerald-500/50",
              glow: "group-hover:bg-emerald-500/5",
            },
            {
              icon: "📈",
              title: "Execution Analytics",
              desc: "Real-time logs, success rates, and failure alerts keep you in control without manual monitoring.",
              color: "border-teal-500/20 hover:border-teal-500/50",
              glow: "group-hover:bg-teal-500/5",
            },
          ].map((f, i) => (
            <div
              key={i}
              className={`feature-card group relative overflow-hidden rounded-2xl border bg-white/5 p-6 backdrop-blur-sm ${f.color}`}
            >
              <div className={`absolute inset-0 transition-colors duration-300 ${f.glow}`} />
              <div className="relative z-10">
                <div className="mb-3 text-3xl">{f.icon}</div>
                <h3 className="mb-2 font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-24 max-w-4xl px-6 md:px-12">
        <h2 className="mb-12 text-center text-3xl font-bold text-white md:text-4xl">
          Up and running in <span className="shimmer-text">3 steps</span>
        </h2>
        <div className="flex flex-col gap-6 md:flex-row">
          {[
            {
              step: "01",
              title: "Connect your platforms",
              desc: "Link your Google Drive, social accounts, and AI credentials in the credentials vault. Takes 5 minutes.",
              color: "text-purple-400 border-purple-500/30",
            },
            {
              step: "02",
              title: "Configure your pipeline",
              desc: "Define your content source, set your publishing schedule, and choose your target platforms.",
              color: "text-blue-400 border-blue-500/30",
            },
            {
              step: "03",
              title: "Enable and forget",
              desc: "Flip the switch. AutoFlow runs on autopilot — creating, uploading, and publishing while you focus on strategy.",
              color: "text-emerald-400 border-emerald-500/30",
            },
          ].map((step, i) => (
            <div key={i} className="relative flex-1 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
              <div className={`mb-4 inline-block rounded-lg border px-3 py-1 text-2xl font-black ${step.color}`}>
                {step.step}
              </div>
              <h3 className="mb-2 font-semibold text-white">{step.title}</h3>
              <p className="text-sm leading-relaxed text-gray-400">{step.desc}</p>
              {i < 2 && (
                <div className="absolute -right-3 top-1/2 z-20 hidden -translate-y-1/2 text-gray-600 md:block">
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-24 max-w-5xl px-6 md:px-12">
        <h2 className="mb-4 text-center text-3xl font-bold text-white md:text-4xl">
          Loved by <span className="shimmer-text">creators</span>
        </h2>
        <p className="mb-12 text-center text-sm text-gray-500">
          Real people, real workflows, real time saved.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              quote: "I used to spend 4 hours editing and uploading every video. Now the entire workflow runs itself — I just check the logs on Monday morning.",
              name: "Alex R.",
              role: "YouTube Creator · 82K subscribers",
              avatar: "A",
              color: "bg-purple-500",
            },
            {
              quote: "Set up a TikTok + Instagram pipeline in one afternoon. It&apos;s been running daily for 3 weeks without me touching anything. Absolutely wild.",
              name: "Jasmine M.",
              role: "Social Media Manager",
              avatar: "J",
              color: "bg-blue-500",
            },
            {
              quote: "The cron scheduling is exactly what I needed. My content goes out at peak times across all platforms and I&apos;m not glued to my phone anymore.",
              name: "Sam K.",
              role: "Brand Strategist",
              avatar: "S",
              color: "bg-emerald-500",
            },
          ].map((t, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
            >
              {/* Stars */}
              <div className="mb-4 flex gap-1">
                {Array.from({ length: 5 }).map((_, si) => (
                  <svg key={si} className="h-4 w-4 fill-amber-400 text-amber-400" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              {/* Quote */}
              <p className="mb-6 text-sm leading-relaxed text-gray-300">&ldquo;{t.quote}&rdquo;</p>
              {/* Author */}
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${t.color}`}>
                  {t.avatar}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{t.name}</div>
                  <div className="text-xs text-gray-500">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mb-24 max-w-4xl px-6 md:px-12">
        <div className="relative overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-br from-purple-900/40 via-blue-900/30 to-black/50 p-10 text-center backdrop-blur-sm md:p-16">
          <div className="pointer-events-none absolute -top-20 left-1/2 h-60 w-60 -translate-x-1/2 rounded-full bg-purple-600/20 blur-[80px]" />
          <h2 className="relative mb-4 text-3xl font-extrabold text-white md:text-5xl">
            Stop creating manually.
            <br />
            <span className="shimmer-text">Start scaling automatically.</span>
          </h2>
          <p className="relative mb-2 text-gray-400">
            Join the automation revolution. Your competitors aren&apos;t sleeping — your content shouldn&apos;t either.
          </p>
          <p className="relative mb-8 text-sm text-purple-400 font-medium">
            Free to start · No credit card · Cancel anytime · 14-day money-back guarantee
          </p>
          <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="pulse-glow rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-10 py-4 text-base font-bold text-white shadow-lg shadow-purple-500/30 transition-all hover:scale-105 hover:shadow-purple-500/50"
            >
              Create Free Account →
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-white/15 px-10 py-4 text-base font-semibold text-gray-300 transition-all hover:border-white/30 hover:text-white"
            >
              Already have an account? Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 py-8 text-center">
        <p className="text-sm text-gray-500">
          © {new Date().getFullYear()} AutoFlow AI · Built for creators who move fast ·{" "}
          <Link href="/privacy" className="transition-colors hover:text-gray-300">Privacy</Link>
          {" · "}
          <Link href="/terms" className="transition-colors hover:text-gray-300">Terms</Link>
        </p>
      </footer>

    </main>
  );
}
