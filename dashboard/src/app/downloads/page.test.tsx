/**
 * Tests for the Downloads page
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DownloadsPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("DownloadsPage", () => {
  it("renders Downloads heading", () => {
    render(<DownloadsPage />);
    expect(screen.getByRole("heading", { name: /downloads/i, level: 1 })).toBeInTheDocument();
  });

  it("is publicly accessible (renders without auth)", () => {
    const { container } = render(<DownloadsPage />);
    expect(container).toBeTruthy();
  });

  it("renders as a main element", () => {
    render(<DownloadsPage />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("shows an empty state when no downloads are configured", () => {
    render(<DownloadsPage />);
    expect(screen.getByText(/no downloads are available yet/i)).toBeInTheDocument();
  });

  it("includes links to legal pages", () => {
    render(<DownloadsPage />);
    expect(screen.getByRole("link", { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /terms of service/i })).toBeInTheDocument();
  });
});
