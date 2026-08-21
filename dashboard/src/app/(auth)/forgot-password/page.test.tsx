/**
 * Tests for the Forgot Password page
 * Requirements: 1.7
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForgotPasswordPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders reset password heading", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText(/reset your password/i)).toBeInTheDocument();
  });

  it("renders email field", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("renders send reset link button", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  it("renders back to sign in link", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("always shows success state after submission regardless of server response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
    });
  });

  it("also shows success even if server returns error (email enumeration prevention)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "User not found" }),
    });
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText(/email address/i), "nobody@example.com");
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
    });
  });

  it("shows error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/unable to reach the server/i);
    });
  });
});
