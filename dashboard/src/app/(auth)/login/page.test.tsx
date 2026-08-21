/**
 * Tests for the Login page
 * Requirements: 1.1, 1.2, 1.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Next.js link
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the sign in heading", () => {
    render(<LoginPage />);
    expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument();
  });

  it("renders email and password fields", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders Google OAuth button", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("renders forgot password link", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toBeInTheDocument();
  });

  it("renders link to register page", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: /create one/i })).toBeInTheDocument();
  });

  it("renders submit button", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows loading state during form submission", async () => {
    mockFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );

    render(<LoginPage />);

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole("button", { name: /sign in/i });

    await userEvent.type(emailInput, "test@example.com");
    await userEvent.type(passwordInput, "password123");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });
  });

  it("shows unverified email message when backend returns email_not_verified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error_code: "email_not_verified" }),
    });

    render(<LoginPage />);

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await userEvent.type(emailInput, "test@example.com");
    await userEvent.type(passwordInput, "password123");
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/please verify your email/i)).toBeInTheDocument();
    });
  });

  it("shows error message on login failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "Invalid credentials" }),
    });

    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
    });
  });

  it("shows network error when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/email address/i), "test@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "password123");
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/unable to reach the server/i);
    });
  });
});
