import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatFullDate } from "./formatTime";
import { RelativeTime } from "./RelativeTime";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("RelativeTime", () => {
  it("renders a <time> with an ISO dateTime, relative text and the full date as title", () => {
    render(<RelativeTime value={NOW - 3_000} />);

    const time = screen.getByText("3s ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", new Date(NOW - 3_000).toISOString());
    expect(time).toHaveAttribute("title", formatFullDate(NOW - 3_000));
  });

  it("accepts an ISO string", () => {
    render(<RelativeTime value={new Date(NOW - 60_000).toISOString()} />);

    expect(screen.getByText("1m ago")).toBeInTheDocument();
  });

  it("refreshes every 5 s by default", () => {
    render(<RelativeTime value={NOW - 3_000} />);

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(screen.getByText("3s ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("8s ago")).toBeInTheDocument();
  });

  it("counts down with direction future and a custom interval", () => {
    render(<RelativeTime value={NOW + 4_000} direction="future" updateEveryMs={1_000} />);
    expect(screen.getByText("in 4s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("in 3s")).toBeInTheDocument();
  });

  it("restarts its clock when the value changes", () => {
    const { rerender } = render(<RelativeTime value={NOW - 3_000} />);
    // The clock advances without a tick; a new value must not use the old `now`.
    vi.setSystemTime(NOW + 2_000);

    rerender(<RelativeTime value={NOW + 1_000} />);

    expect(screen.getByText("1s ago")).toBeInTheDocument();
  });

  it("clears its timer on unmount", () => {
    const { unmount } = render(<RelativeTime value={NOW} />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders nothing for an invalid date", () => {
    const { container } = render(<RelativeTime value="not a date" />);

    expect(container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });
});
