"use client";

/**
 * UI state store
 *
 * Lightweight Zustand store for ephemeral UI state that does not need to
 * persist across sessions: modals, toast notifications, and loading indicators.
 *
 * This keeps global UI state out of component local state so it can be
 * triggered from anywhere (e.g., from a fetch error handler deep in the tree).
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Toast types
// ---------------------------------------------------------------------------

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** Auto-dismiss after this many milliseconds (default 5000). Set to 0 to persist. */
  duration?: number;
}

// ---------------------------------------------------------------------------
// Modal types
// ---------------------------------------------------------------------------

export type ModalId =
  | "delete-pipeline"
  | "disable-pipeline"
  | "delete-credential"
  | "delete-account"
  | "confirm-logout";

export interface ModalState {
  id: ModalId;
  /** Arbitrary payload passed to the modal (e.g., the resource ID to delete) */
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface UIState {
  /** Stack of active toast notifications */
  toasts: Toast[];
  /** Currently open modal, or null if none */
  activeModal: ModalState | null;
  /** Global loading overlay (used during Stripe redirects, etc.) */
  isGlobalLoading: boolean;
  globalLoadingMessage: string | null;
}

interface UIActions {
  // Toast actions
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  // Modal actions
  openModal: (modal: ModalState) => void;
  closeModal: () => void;

  // Global loading
  setGlobalLoading: (loading: boolean, message?: string) => void;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUIStore = create<UIState & UIActions>((set) => ({
  toasts: [],
  activeModal: null,
  isGlobalLoading: false,
  globalLoadingMessage: null,

  // --- Toasts ---

  addToast: (toast) => {
    const id = generateId();
    const newToast: Toast = { ...toast, id, duration: toast.duration ?? 5000 };

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));

    // Auto-remove after duration (unless duration is 0 = persistent)
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, newToast.duration);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),

  // --- Modals ---

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () => set({ activeModal: null }),

  // --- Global loading ---

  setGlobalLoading: (loading, message) =>
    set({
      isGlobalLoading: loading,
      globalLoadingMessage: loading ? (message ?? null) : null,
    }),
}));
