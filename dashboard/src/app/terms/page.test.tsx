/**
 * Tests for the Terms of Service page
 * Requirements: 16.3
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TermsPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("TermsPage", () => {
  it("renders Terms of Service heading", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: /terms of service/i, level: 1 })).toBeInTheDocument();
  });

  it("is publicly accessible (renders without auth)", () => {
    const { container } = render(<TermsPage />);
    expect(container).toBeTruthy();
  });

  it("contains acceptance of terms section", () => {
    render(<TermsPage />);
    expect(screen.getByText(/acceptance of terms/i)).toBeInTheDocument();
  });

  it("contains description of service section", () => {
    render(<TermsPage />);
    expect(screen.getByText(/description of service/i)).toBeInTheDocument();
  });

  it("contains subscriptions and billing section", () => {
    render(<TermsPage />);
    expect(screen.getByText(/subscriptions and billing/i)).toBeInTheDocument();
  });

  it("contains acceptable use section", () => {
    render(<TermsPage />);
    expect(screen.getByText(/acceptable use/i)).toBeInTheDocument();
  });

  it("contains limitation of liability section", () => {
    render(<TermsPage />);
    expect(screen.getByText(/limitation of liability/i)).toBeInTheDocument();
  });

  it("includes link to Privacy Policy", () => {
    render(<TermsPage />);
    const privacyLinks = screen.getAllByRole("link", { name: /privacy policy/i });
    expect(privacyLinks.length).toBeGreaterThan(0);
  });

  it("renders as a main element", () => {
    render(<TermsPage />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
