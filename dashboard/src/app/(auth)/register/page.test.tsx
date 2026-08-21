/**
 * Tests for the Register page
 * Requirements: 1.1, 1.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegisterPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders create account heading", () => {
    render(<RegisterPage />);
    expect(screen.getByText(/create your account/i)).toBeInTheDocument();
  });

  it("renders email, password, and confirm password fields", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("renders create account submit button", () => {
    render(<RegisterPage />);
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("renders sign in link", () => {
    render(<RegisterPage />);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows password strength bar when user types a password", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, "Test1!");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows password requirements checklist after interacting with password field", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, "a");
    // Requirements list should appear
    expect(screen.getByRole("list", { name: /password requirements/i })).toBeInTheDocument();
  });

  it("shows passwords do not match warning", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    await userEvent.type(passwordInput, "TestPass1!");
    await userEvent.type(confirmInput, "Different1!");
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it("shows error if form is submitted with weak password", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    await userEvent.type(passwordInput, "weak");
    await userEvent.type(confirmInput, "weak");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/fix the password requirements/i);
    });
  });

  it("shows error if passwords do not match on submit", async () => {
    render(<RegisterPage />);
    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "TestPass1!");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "DifferentPass1!");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some(a => a.textContent?.match(/passwords do not match/i))).toBe(true);
    });
  });

  it("shows success state after successful registration", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    render(<RegisterPage />);
    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "TestPass1!");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "TestPass1!");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      // After success, the form disappears and success state shows
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    const allTexts = screen.getAllByText(/check your inbox/i);
    expect(allTexts.length).toBeGreaterThan(0);
  });

  it("shows error for already registered email", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error_code: "email_already_registered" }),
    });
    render(<RegisterPage />);
    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "TestPass1!");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "TestPass1!");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    });
  });
});
