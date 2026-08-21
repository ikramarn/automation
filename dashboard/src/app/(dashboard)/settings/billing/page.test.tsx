/**
 * Tests for the Billing settings page
 * Requirements: 2.1, 2.2, 2.8
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import BillingPage from "./page";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";
const mockUseSWR = vi.mocked(useSWR);

describe("BillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Billing heading", () => {
    mockUseSWR.mockReturnValue({
      data: { subscription_status: "active", stripe_subscription_id: "sub_123", subscription_expires_at: null },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByRole("heading", { name: /billing/i })).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByLabelText(/loading billing/i)).toBeInTheDocument();
  });

  it("shows error state on fetch failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Failed"),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows Active status badge for active subscription", () => {
    mockUseSWR.mockReturnValue({
      data: { subscription_status: "active", stripe_subscription_id: "sub_123", subscription_expires_at: null },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByLabelText(/subscription status: active/i)).toBeInTheDocument();
  });

  it("shows Manage subscription button for active subscriber", () => {
    mockUseSWR.mockReturnValue({
      data: { subscription_status: "active", stripe_subscription_id: "sub_123", subscription_expires_at: null },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    // The button has an aria-label containing "Stripe billing portal"
    expect(screen.getByRole("button", { name: /stripe billing portal/i })).toBeInTheDocument();
  });

  it("shows Subscribe button for inactive user", () => {
    mockUseSWR.mockReturnValue({
      data: { subscription_status: "inactive", stripe_subscription_id: null, subscription_expires_at: null },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByRole("button", { name: /^subscribe$/i })).toBeInTheDocument();
  });

  it("shows suspended notice when subscription is suspended", () => {
    mockUseSWR.mockReturnValue({
      data: { subscription_status: "suspended", stripe_subscription_id: "sub_123", subscription_expires_at: null },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/suspended/i);
  });

  it("shows pending notice for pending subscription", () => {
    mockUseSWR.mockReturnValue({
      data: { subscription_status: "pending", stripe_subscription_id: "sub_123", subscription_expires_at: null },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<BillingPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/payment confirmation pending/i);
  });
});
