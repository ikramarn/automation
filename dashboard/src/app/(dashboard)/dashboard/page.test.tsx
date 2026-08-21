/**
 * Tests for the Pipeline List Dashboard page (/dashboard)
 * Requirements: 13.1, 13.2, 13.8
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage, { type Pipeline } from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock SWR
vi.mock("swr", () => ({
  default: vi.fn(),
}));

import useSWR from "swr";
const mockUseSWR = vi.mocked(useSWR);

const MOCK_PIPELINES: Pipeline[] = [
  {
    id: "pipe-1",
    name: "Tech News Daily",
    status: "active",
    last_execution: {
      status: "success",
      ended_at: "2024-01-15T10:00:00Z",
      started_at: "2024-01-15T09:55:00Z",
    },
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "pipe-2",
    name: "Crypto Alerts",
    status: "paused",
    last_execution: {
      status: "failed",
      ended_at: "2024-01-14T08:00:00Z",
      started_at: "2024-01-14T07:55:00Z",
    },
    created_at: "2024-01-02T00:00:00Z",
  },
];

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Your Pipelines heading", () => {
    mockUseSWR.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /your pipelines/i })).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByLabelText(/loading pipelines/i)).toBeInTheDocument();
  });

  it("shows empty state when no pipelines exist", () => {
    mockUseSWR.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByText(/no pipelines yet/i)).toBeInTheDocument();
    expect(screen.getByText(/create your first pipeline/i)).toBeInTheDocument();
  });

  it("shows pipeline list when pipelines exist", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINES,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByText("Tech News Daily")).toBeInTheDocument();
    expect(screen.getByText("Crypto Alerts")).toBeInTheDocument();
  });

  it("displays status badges for pipelines", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINES,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByLabelText(/pipeline status: active/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pipeline status: paused/i)).toBeInTheDocument();
  });

  it("shows last execution status", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINES,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByLabelText(/last execution: succeeded/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last execution: failed/i)).toBeInTheDocument();
  });

  it("shows 'No executions yet' message for pipelines with no executions", () => {
    const pipelineWithoutExecution: Pipeline[] = [
      {
        id: "pipe-new",
        name: "Brand New Pipeline",
        status: "active",
        last_execution: null,
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    mockUseSWR.mockReturnValue({
      data: pipelineWithoutExecution,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByText(/no executions yet/i)).toBeInTheDocument();
  });

  it("shows error state with retry button on fetch failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Server error"),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/failed to load pipelines/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders create pipeline link", () => {
    mockUseSWR.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    expect(
      screen.getByRole("link", { name: /create a new pipeline/i })
    ).toHaveAttribute("href", "/pipelines/new");
  });

  it("links each pipeline to its detail page", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINES,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);

    render(<DashboardPage />);
    const techNewsLink = screen.getByRole("link", { name: /pipeline: tech news daily/i });
    expect(techNewsLink).toHaveAttribute("href", "/pipelines/pipe-1");
  });
});
