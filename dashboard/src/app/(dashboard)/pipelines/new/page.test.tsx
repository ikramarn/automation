/**
 * Tests for the Pipeline Creation Wizard
 * Requirements: 6.1, 6.2, 6.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewPipelinePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";
const mockUseSWR = vi.mocked(useSWR);

const mockFetch = vi.fn();
global.fetch = mockFetch;

const CONNECTED_PLATFORMS = [
  { platform: "youtube", connected: true, display_name: "YouTube" },
  { platform: "tiktok", connected: true, display_name: "TikTok" },
  { platform: "facebook", connected: false, display_name: "Facebook" },
  { platform: "instagram", connected: false, display_name: "Instagram" },
];

describe("NewPipelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({
      data: CONNECTED_PLATFORMS,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
  });

  it("renders step 1 basic info initially", () => {
    render(<NewPipelinePage />);
    expect(screen.getByLabelText(/pipeline name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/niche keyword/i)).toBeInTheDocument();
  });

  it("renders step indicator", () => {
    render(<NewPipelinePage />);
    expect(screen.getByRole("navigation", { name: /pipeline creation steps/i })).toBeInTheDocument();
  });

  it("shows validation error when name is empty on Continue", async () => {
    render(<NewPipelinePage />);
    // Button label is "Continue to Schedule"
    const continueBtn = screen.getByRole("button", { name: /continue to/i });
    fireEvent.click(continueBtn);
    await waitFor(() => {
      expect(screen.getByText(/pipeline name is required/i)).toBeInTheDocument();
    });
  });

  it("shows validation error when niche keyword is empty on Continue", async () => {
    render(<NewPipelinePage />);
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    await waitFor(() => {
      expect(screen.getByText(/niche keyword is required/i)).toBeInTheDocument();
    });
  });

  it("advances to step 2 (schedule) after valid step 1", async () => {
    render(<NewPipelinePage />);
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    await userEvent.type(screen.getByLabelText(/niche keyword/i), "technology");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    await waitFor(() => {
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    });
  });

  it("step 2 shows recurrence options", async () => {
    render(<NewPipelinePage />);
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    await userEvent.type(screen.getByLabelText(/niche keyword/i), "technology");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    await waitFor(() => {
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: /every day/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /weekdays/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /custom days/i })).toBeInTheDocument();
  });

  it("step 2 shows custom day picker when Custom Days selected", async () => {
    render(<NewPipelinePage />);
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    await userEvent.type(screen.getByLabelText(/niche keyword/i), "technology");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    await waitFor(() => screen.getByRole("radiogroup"));
    fireEvent.click(screen.getByRole("radio", { name: /custom days/i }));
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /select days/i })).toBeInTheDocument();
    });
  });

  it("can go back to step 1 from step 2", async () => {
    render(<NewPipelinePage />);
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    await userEvent.type(screen.getByLabelText(/niche keyword/i), "technology");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    await waitFor(() => screen.getByRole("radiogroup"));
    fireEvent.click(screen.getByRole("button", { name: /go back to previous step/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/pipeline name/i)).toBeInTheDocument();
    });
  });

  async function navigateToStep3() {
    render(<NewPipelinePage />);
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    await userEvent.type(screen.getByLabelText(/niche keyword/i), "technology");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    await waitFor(() => screen.getByRole("radiogroup"));
    // Change timezone using its id
    const tzSelect = document.getElementById("schedule-timezone") as HTMLSelectElement;
    if (tzSelect) fireEvent.change(tzSelect, { target: { value: "UTC" } });
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
  }

  it("step 3 shows connected platforms only", async () => {
    await navigateToStep3();
    await waitFor(() => {
      expect(screen.getByLabelText(/publish to youtube/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/publish to tiktok/i)).toBeInTheDocument();
  });

  it("shows limit reached message when pipeline limit is exceeded", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrf_token: "csrf" }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error_code: "pipeline_limit_reached",
          message: "Pipeline limit reached. Upgrade your plan to create more pipelines.",
        }),
      });

    render(<NewPipelinePage />);
    // Step 1
    await userEvent.type(screen.getByLabelText(/pipeline name/i), "My Pipeline");
    await userEvent.type(screen.getByLabelText(/niche keyword/i), "technology");
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    // Step 2 — wait for radiogroup to appear (confirms step 2 rendered)
    await waitFor(() => screen.getByRole("radiogroup"));
    // The time input already has "09:00" default; set timezone via id
    const tzSelect = document.getElementById("schedule-timezone") as HTMLSelectElement;
    if (tzSelect) fireEvent.change(tzSelect, { target: { value: "UTC" } });
    fireEvent.click(screen.getByRole("button", { name: /continue to/i }));
    // Step 3
    await waitFor(() => screen.getByLabelText(/publish to youtube/i));
    fireEvent.click(screen.getByLabelText(/publish to youtube/i));
    fireEvent.click(screen.getByRole("button", { name: /create pipeline/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some(a => /pipeline limit reached/i.test(a.textContent ?? ""))).toBe(true);
  });
});
