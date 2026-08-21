"use client";

/**
 * Onboarding state store
 *
 * Tracks the 5-step onboarding checklist completion state for new users.
 * Steps must be completed sequentially (Req 20.2).
 *
 * Steps:
 *   1. subscribe      — purchase a subscription plan
 *   2. connectDrive   — connect Google Drive
 *   3. addHeygenKey   — add HeyGen API key
 *   4. connectSocial  — connect at least one social platform
 *   5. createPipeline — create the first pipeline
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OnboardingStep =
  | "subscribe"
  | "connectDrive"
  | "addHeygenKey"
  | "connectSocial"
  | "createPipeline";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "subscribe",
  "connectDrive",
  "addHeygenKey",
  "connectSocial",
  "createPipeline",
];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  subscribe: "Subscribe to a plan",
  connectDrive: "Connect Google Drive",
  addHeygenKey: "Add your HeyGen API key",
  connectSocial: "Connect a social platform",
  createPipeline: "Create your first pipeline",
};

export const ONBOARDING_STEP_HELP_LINKS: Partial<Record<OnboardingStep, string>> =
  {
    addHeygenKey: "https://docs.heygen.com/reference/api-key",
    connectSocial:
      "https://www.youtube.com/account_advanced", // example — replace with actual guide
  };

interface OnboardingState {
  /** Whether the user has dismissed the onboarding checklist for this session */
  dismissed: boolean;
  /** Completion status for each step */
  completedSteps: Record<OnboardingStep, boolean>;
}

interface OnboardingActions {
  /** Mark a step as complete */
  markStepComplete: (step: OnboardingStep) => void;
  /** Mark a step as incomplete (e.g., if user disconnects an integration) */
  markStepIncomplete: (step: OnboardingStep) => void;
  /** Dismiss the checklist for the current session */
  dismiss: () => void;
  /** Restore the checklist (e.g., when re-opened from help menu) */
  restore: () => void;
  /** Reset all onboarding state (e.g., on sign out) */
  reset: () => void;
  /** Returns the index (0-based) of the first incomplete step */
  currentStepIndex: () => number;
  /** Returns true when all 5 steps are complete */
  isComplete: () => boolean;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialCompletedSteps: Record<OnboardingStep, boolean> = {
  subscribe: false,
  connectDrive: false,
  addHeygenKey: false,
  connectSocial: false,
  createPipeline: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useOnboardingStore = create<OnboardingState & OnboardingActions>()(
  persist(
    (set, get) => ({
      dismissed: false,
      completedSteps: { ...initialCompletedSteps },

      markStepComplete: (step) =>
        set((state) => ({
          completedSteps: { ...state.completedSteps, [step]: true },
        })),

      markStepIncomplete: (step) =>
        set((state) => ({
          completedSteps: { ...state.completedSteps, [step]: false },
        })),

      dismiss: () => set({ dismissed: true }),

      restore: () => set({ dismissed: false }),

      reset: () =>
        set({
          dismissed: false,
          completedSteps: { ...initialCompletedSteps },
        }),

      currentStepIndex: () => {
        const { completedSteps } = get();
        const idx = ONBOARDING_STEPS.findIndex(
          (step) => !completedSteps[step]
        );
        return idx === -1 ? ONBOARDING_STEPS.length : idx;
      },

      isComplete: () => {
        const { completedSteps } = get();
        return ONBOARDING_STEPS.every((step) => completedSteps[step]);
      },
    }),
    {
      name: "onboarding-state",
      storage: createJSONStorage(() => localStorage),
      // Only persist completion flags and dismissal, not derived actions
      partialize: (state) => ({
        dismissed: state.dismissed,
        completedSteps: state.completedSteps,
      }),
    }
  )
);
