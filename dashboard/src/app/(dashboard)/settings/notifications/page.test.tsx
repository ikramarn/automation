/**
 * Tests for the Notifications settings page
 * Requirements: 14.5, 21.6
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationsPage from "./page";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";
const mockUseSWR = vi.mocked(useSWR);

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_PREFS = {
  notify_on_success: true,
  notify_on_failure: true,
  notify_on_pipeline_paused: false,
};

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ csrfToken: "test-csrf" }),
    });
  });

  it("renders Notifications heading", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PREFS,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<NotificationsPage />);
    expect(screen.getByRole("heading", { name: /notifications/i })).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<NotificationsPage />);
    expect(screen.getByLabelText(/loading notification preferences/i)).toBeInTheDocument();
  });

  it("shows error state on failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Network error"),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<NotificationsPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders three notification toggles", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PREFS,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<NotificationsPage />);
    const toggles = screen.getAllByRole("switch");
    expect(toggles).toHaveLength(3);
  });

  it("reflects current preference state for each toggle", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PREFS,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<NotificationsPage />);
    const switches = screen.getAllByRole("switch");
    // notify_on_success = true
    expect(switches[0]).toHaveAttribute("aria-checked", "true");
    // notify_on_failure = true
    expect(switches[1]).toHaveAttribute("aria-checked", "true");
    // notify_on_pipeline_paused = false
    expect(switches[2]).toHaveAttribute("aria-checked", "false");
  });

  it("saves preference when a toggle is clicked", async () => {
    const mockMutate = vi.fn();
    mockUseSWR.mockReturnValue({
      data: MOCK_PREFS,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    } as ReturnType<typeof useSWR>);

    // Mock CSRF + save calls
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "csrf" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<NotificationsPage />);
    const switches = screen.getAllByRole("switch");
    // Toggle the paused notification (currently off)
    await userEvent.click(switches[2]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/account/notifications"),
        expect.objectContaining({ method: "PUT" })
      );
    });
  });

  it("shows error banner when save fails", async () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PREFS,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "csrf" }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "Save failed" }),
      });

    render(<NotificationsPage />);
    const switches = screen.getAllByRole("switch");
    await userEvent.click(switches[0]);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
