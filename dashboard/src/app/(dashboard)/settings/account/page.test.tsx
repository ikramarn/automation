/**
 * Tests for the Account settings page
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountPage from "./page";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";
const mockUseSWR = vi.mocked(useSWR);

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_ACCOUNT = {
  display_name: "Alice Smith",
  email: "alice@example.com",
  subscription_status: "active",
};

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ csrfToken: "test-csrf" }),
    });
  });

  it("renders Account heading", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    expect(screen.getByRole("heading", { name: /^account$/i })).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    expect(screen.getByLabelText(/loading account/i)).toBeInTheDocument();
  });

  it("shows error state with retry button on failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Network error"),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders display name section with current name", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    const nameInput = screen.getByLabelText(/^display name$/i);
    expect(nameInput).toHaveValue("Alice Smith");
  });

  it("renders email address section with current email", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("renders password change form", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("renders delete account section", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    expect(screen.getByRole("button", { name: /delete my account/i })).toBeInTheDocument();
  });

  it("shows email confirmation form when delete button clicked", async () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/type your email address to confirm/i)).toBeInTheDocument();
    });
  });

  it("shows error when deletion confirmation email doesn't match", async () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_ACCOUNT,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
    await waitFor(() => screen.getByLabelText(/type your email address to confirm/i));
    await userEvent.type(screen.getByLabelText(/type your email address to confirm/i), "wrong@email.com");
    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/email does not match/i);
    });
  });
});
