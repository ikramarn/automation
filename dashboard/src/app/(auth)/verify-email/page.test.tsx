/**
 * Tests for the Verify Email page
 * Requirements: 1.8
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VerifyEmailPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("VerifyEmailPage", () => {
  it("shows success state when status=success", () => {
    render(<VerifyEmailPage searchParams={{ status: "success" }} />);
    expect(screen.getByText(/email verified/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows expired message when status=expired", () => {
    render(<VerifyEmailPage searchParams={{ status: "expired" }} />);
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
  });

  it("shows invalid link message when status=invalid", () => {
    render(<VerifyEmailPage searchParams={{ status: "invalid" }} />);
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
  });

  it("shows generic error message with no status", () => {
    render(<VerifyEmailPage searchParams={{}} />);
    expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
  });

  it("shows back to sign in link for non-success states", () => {
    render(<VerifyEmailPage searchParams={{ status: "expired" }} />);
    expect(screen.getByRole("link", { name: /back to sign in/i })).toBeInTheDocument();
  });
});
