/**
 * Tests for the Privacy Policy page
 * Requirements: 16.1, 16.2
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("PrivacyPage", () => {
  it("renders Privacy Policy heading", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: /privacy policy/i, level: 1 })).toBeInTheDocument();
  });

  it("is publicly accessible (renders without auth)", () => {
    // No auth context needed; simply renders successfully
    const { container } = render(<PrivacyPage />);
    expect(container).toBeTruthy();
  });

  it("discloses encrypted API key storage (AES-256)", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/AES-256/)).toBeInTheDocument();
  });

  it("mentions Supabase Vault for key storage", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/supabase vault/i)).toBeInTheDocument();
  });

  it("discloses use of OpenAI API", () => {
    render(<PrivacyPage />);
    const openaiMentions = screen.getAllByText(/openai/i);
    expect(openaiMentions.length).toBeGreaterThan(0);
  });

  it("discloses use of HeyGen API", () => {
    render(<PrivacyPage />);
    const heygenMentions = screen.getAllByText(/heygen/i);
    expect(heygenMentions.length).toBeGreaterThan(0);
  });

  it("discloses 90-day retention for execution logs", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/90 days/i)).toBeInTheDocument();
  });

  it("includes link to Terms of Service", () => {
    render(<PrivacyPage />);
    const termsLinks = screen.getAllByRole("link", { name: /terms of service/i });
    expect(termsLinks.length).toBeGreaterThan(0);
  });

  it("renders as a main element", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
