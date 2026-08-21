/**
 * Tests for the Reset Password page
 * Requirements: 1.8
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResetPasswordPage from "./page";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams("?token=test-token-abc"),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders set new password heading", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByText(/set a new password/i)).toBeInTheDocument();
  });

  it("renders new password and confirm new password fields", () => {
    render(<ResetPasswordPage />);
    // Use the specific label text as it appears in the page
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it("renders submit button", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByRole("button", { name: /set new password/i })).toBeInTheDocument();
  });

  it("shows password strength bar on typing in new password field", async () => {
    render(<ResetPasswordPage />);
    const passwordField = screen.getByLabelText(/^new password$/i);
    await userEvent.type(passwordField, "Test1!");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows mismatch error when passwords differ", async () => {
    render(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText(/^new password$/i), "TestPass1!");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "Different1!");
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it("shows validation error on weak password submit", async () => {
    render(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText(/^new password$/i), "weak");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "weak");
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/fix the password requirements/i);
    });
  });

  it("redirects to login on successful password reset", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    render(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText(/^new password$/i), "TestPass1!");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "TestPass1!");
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/login?reset=success");
    });
  });

  it("shows expired token error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error_code: "token_expired" }),
    });
    render(<ResetPasswordPage />);
    await userEvent.type(screen.getByLabelText(/^new password$/i), "TestPass1!");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "TestPass1!");
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/expired or is invalid/i);
    });
  });
});
