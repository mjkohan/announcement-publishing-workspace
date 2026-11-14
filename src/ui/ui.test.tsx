import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

describe("Button", () => {
  it("is a type=button, enabled and not busy by default", () => {
    render(<Button>Publish</Button>);

    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("while loading: aria-busy, disabled, same accessible name", () => {
    render(<Button loading>Publish</Button>);

    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("keeps an explicit disabled", () => {
    render(<Button disabled>Publish</Button>);

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});

describe("Spinner", () => {
  it("is hidden from assistive technology and spins only without reduced motion", () => {
    const { container } = render(<Spinner />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.getAttribute("class")).toContain("motion-safe:animate-spin");
    expect(svg?.getAttribute("class")).not.toMatch(/(^|\s)animate-spin/);
  });
});

describe("Banner", () => {
  it.each([
    ["info", "status"],
    ["warning", "alert"],
    ["error", "alert"],
  ] as const)("tone %s has role %s", (tone, role) => {
    render(<Banner tone={tone}>Message</Banner>);

    expect(screen.getByRole(role)).toHaveTextContent("Message");
  });

  it("renders the action", () => {
    render(<Banner action={<Button>Retry</Button>}>Message</Banner>);

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
