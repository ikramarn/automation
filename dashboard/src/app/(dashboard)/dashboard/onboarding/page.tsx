"use client";

/**
 * Onboarding checklist page — /dashboard/onboarding
 *
 * Renders a 5-step sequential onboarding checklist. Steps must be completed
 * in order (Req 20.2). Each step has a primary action button and contextual
 * help links where applicable. The user can skip setup to hide the checklist
 * for the session (Req 20.3).
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import {
  useOnboardingStore,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_LABELS,
  type OnboardingStep,
} from "@/store/onboardingStore";

// ---------------------------------------------------------------------------
// Step metadata — descriptions and action buttons
// ---------------------------------------------------------------------------

interface StepConfig {
  step: OnboardingStep;
  description: string;
  actionLabel: string;
  actionHref: string;
  helpLink?: { label: string; href: string };
}

const STEP_CONFIG: StepConfig[] = [
  {
    step: "subscribe",
    description:
      "Choose a subscription plan to unlock pipeline creation and automated publishing.",
    actionLabel: "Subscribe",
    actionHref: "/settings/billing",
  },
  {
    step: "connectDrive",
    description:
      "Connect your Google Drive so finished videos are automatically saved to your chosen folder.",
    actionLabel: "Connect Drive",
    actionHref: "/settings/integrations#google-drive",
  },
  {
    step: "addHeygenKey",
    description:
      "Add your HeyGen API key to enable AI avatar video generation for your pipelines.",
    actionLabel: "Add HeyGen Key",
    actionHref: "/settings/integrations#heygen",
    helpLink: {
      label: "How to get your HeyGen API key",
      href: "https://docs.heygen.com/reference/api-key",
    },
  },
  {
    step: "connectSocial",
    description:
      "Connect at least one social platform (YouTube, TikTok, Facebook, or Instagram) to publish your videos.",
    actionLabel: "Connect Platform",
    actionHref: "/settings/integrations#social",
    helpLink: {
      label: "Social platform OAuth setup guide",
      href: "https://www.youtube.com/account_advanced",
    },
  },
  {
    step: "createPipeline",
    description:
      "Create your first automated pipeline. Choose a niche, set your schedule, and go live.",
    actionLabel: "Create Pipeline",
    actionHref: "/pipelines/new",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spinner SVG used on loading buttons */
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`animate-spin ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

/** Check-circle icon for completed steps */
function CheckCircle() {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6 text-green-500 shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Empty circle for incomplete steps */
function EmptyCircle({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
        active ? "border-indigo-500" : "border-gray-300"
      }`}
    />
  );
}

// ---------------------------------------------------------------------------
// Step item component
// ---------------------------------------------------------------------------

interface StepItemProps {
  config: StepConfig;
  index: number;
  isComplete: boolean;
  isActive: boolean;
  isLocked: boolean;
}

function StepItem({
  config,
  index,
  isComplete,
  isActive,
  isLocked,
}: StepItemProps) {
  const label = ONBOARDING_STEP_LABELS[config.step];

  return (
    <li
      className={`relative flex gap-4 rounded-xl border p-5 transition-colors ${
        isComplete
          ? "border-green-200 bg-green-50"
          : isActive
          ? "border-indigo-300 bg-indigo-50"
          : "border-gray-200 bg-white"
      } ${isLocked ? "opacity-50" : ""}`}
      aria-current={isActive ? "step" : undefined}
    >
      {/* Step status icon */}
      <div className="pt-0.5">
        {isComplete ? (
          <CheckCircle />
        ) : (
          <EmptyCircle active={isActive} />
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-xs font-medium uppercase tracking-wide ${
              isComplete
                ? "text-green-600"
                : isActive
                ? "text-indigo-600"
                : "text-gray-400"
            }`}
          >
            Step {index + 1}
          </span>
          {isComplete && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Complete
            </span>
          )}
        </div>

        <h2 className="text-base font-semibold text-gray-900">{label}</h2>
        <p className="mt-1 text-sm text-gray-500">{config.description}</p>

        {/* Help link */}
        {config.helpLink && !isLocked && (
          <a
            href={config.helpLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 hover:underline focus:outline-none focus:underline"
            aria-label={`${config.helpLink.label} (opens in new tab)`}
          >
            {config.helpLink.label}
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}

        {/* Action button — only shown for active/incomplete steps */}
        {!isComplete && !isLocked && (
          <div className="mt-3">
            <Link
              href={config.actionHref}
              className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              aria-label={`${config.actionLabel} — ${label}`}
            >
              {config.actionLabel}
            </Link>
          </div>
        )}

        {/* Locked notice */}
        {isLocked && (
          <p className="mt-2 text-xs text-gray-400" aria-label="Step locked">
            Complete the previous step first to unlock this one.
          </p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter();
  const { completedSteps, currentStepIndex, isComplete, dismiss } =
    useOnboardingStore();

  // If user already dismissed checklist, redirect to dashboard
  // (they can re-open via help menu)
  const isDismissed = useOnboardingStore((s) => s.dismissed);

  useEffect(() => {
    if (isDismissed) {
      router.replace("/dashboard");
    }
  }, [isDismissed, router]);

  // If all steps complete, redirect to dashboard after short delay
  useEffect(() => {
    if (isComplete()) {
      const timer = setTimeout(() => router.push("/dashboard"), 1500);
      return () => clearTimeout(timer);
    }
  }, [isComplete, router]);

  const activeIdx = currentStepIndex();
  const allComplete = isComplete();

  function handleSkip() {
    dismiss();
    router.push("/dashboard");
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Get started
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Complete these steps to set up your AI video automation pipeline.
          Steps must be completed in order.
        </p>
      </div>

      {/* All-complete banner */}
      {allComplete && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700"
        >
          <strong>Setup complete!</strong> All steps are done. Taking you to
          your dashboard…
        </div>
      )}

      {/* Progress bar */}
      <div
        className="mb-6"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuenow={Math.min(activeIdx, ONBOARDING_STEPS.length)}
        aria-valuemin={0}
        aria-valuemax={ONBOARDING_STEPS.length}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-500">
            {Math.min(activeIdx, ONBOARDING_STEPS.length)} of{" "}
            {ONBOARDING_STEPS.length} steps complete
          </span>
          <span className="text-xs text-gray-400">
            {allComplete ? "100%" : `${Math.round((activeIdx / ONBOARDING_STEPS.length) * 100)}%`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{
              width: `${Math.round(
                (Math.min(activeIdx, ONBOARDING_STEPS.length) /
                  ONBOARDING_STEPS.length) *
                  100
              )}%`,
            }}
          />
        </div>
      </div>

      {/* Checklist */}
      <ol className="space-y-4" aria-label="Onboarding steps">
        {STEP_CONFIG.map((config, index) => {
          const isComplete = completedSteps[config.step];
          const isActive = index === activeIdx && !isComplete;
          const isLocked = index > activeIdx;

          return (
            <StepItem
              key={config.step}
              config={config}
              index={index}
              isComplete={isComplete}
              isActive={isActive}
              isLocked={isLocked}
            />
          );
        })}
      </ol>

      {/* Skip setup */}
      <div className="mt-8 flex items-center justify-between border-t border-gray-200 pt-6">
        <p className="text-xs text-gray-400">
          You can return to this checklist at any time from the help menu.
        </p>
        <button
          type="button"
          onClick={handleSkip}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          aria-label="Skip setup and go to dashboard"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}
