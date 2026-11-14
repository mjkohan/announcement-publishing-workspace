import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OperationEntry } from "../src/domain";
import { entry, processing, published, rejected } from "../src/domain/testFactories";
import { PublicationActions } from "../src/features/announcements";
import type { IAnnouncementService, PublicationOperation } from "../src/mocks";
import type { PublicationState } from "../src/store";
import { renderWithProviders } from "../src/test/renderWithProviders";

/** The `announcementId` used by the domain test factories. */
const ANN = "announcement-1";

const never = <T,>() => new Promise<T>(() => undefined);

/** Every request stays pending, so only the test changes the store. */
function silentService() {
  const publish = vi.fn<IAnnouncementService["publish"]>(() => never<PublicationOperation>());
  const getStatus = vi.fn<IAnnouncementService["getStatus"]>(() => never());
  const service: IAnnouncementService = {
    getAnnouncements: () => never(),
    listOperations: () => never(),
    publish,
    getStatus,
    setScenario: () => undefined,
    getScenario: () => "success",
    reset: () => undefined,
  };
  return { service, publish, getStatus };
}

function renderActions(
  op?: OperationEntry,
  state: Partial<PublicationState> = { restoreStatus: "ready" },
) {
  const user = userEvent.setup();
  const mocks = silentService();
  const result = renderWithProviders(<PublicationActions announcementId={ANN} />, {
    service: mocks.service,
  });
  act(() => {
    result.store.setState({ ...state, operations: op ? { [op.operationId]: op } : {} });
  });
  return { ...result, ...mocks, user };
}

const group = () => screen.getByRole("group", { name: "Publication actions" });
const buttonNames = () =>
  within(group())
    .getAllByRole("button")
    .map((button) => button.textContent);

function expectBusy(button: HTMLElement) {
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
}

describe("PublicationActions", () => {
  describe("idle", () => {
    it("Publish sends the first attempt, then shows a busy Sending…", async () => {
      const { user, publish } = renderActions();
      expect(buttonNames()).toEqual(["Publish"]);

      await user.click(screen.getByRole("button", { name: "Publish" }));

      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(ANN, expect.any(String));
      expect(buttonNames()).toEqual(["Sending…"]);
      expectBusy(screen.getByRole("button", { name: "Sending…" }));
    });

    it("is disabled with an explanation until restore is ready", async () => {
      const { user, publish } = renderActions(undefined, { restoreStatus: "loading" });

      const button = screen.getByRole("button", { name: "Publish" });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(
        "Publishing is paused until publication history loads.",
      );
      await user.click(button);
      expect(publish).not.toHaveBeenCalled();
    });

    it("uses the announcement it was rendered for, not the selected one", async () => {
      const { user, publish } = renderActions(undefined, {
        restoreStatus: "ready",
        selectedId: "some-other-announcement",
      });

      await user.click(screen.getByRole("button", { name: "Publish" }));

      expect(publish).toHaveBeenCalledWith(ANN, expect.any(String));
    });
  });

  it("checking: only a busy, disabled Checking…", () => {
    renderActions(entry());

    expect(buttonNames()).toEqual(["Checking…"]);
    expectBusy(screen.getByRole("button", { name: "Checking…" }));
  });

  it("submitting: only a busy, disabled Sending…", () => {
    renderActions(entry({ publishInFlight: true }));

    expect(buttonNames()).toEqual(["Sending…"]);
    expectBusy(screen.getByRole("button", { name: "Sending…" }));
  });

  it("processing: Check status reads this operation and shows Checking… meanwhile", async () => {
    const { user, getStatus } = renderActions({ ...entry(), snapshot: processing() });
    expect(buttonNames()).toEqual(["Check status"]);

    await user.click(screen.getByRole("button", { name: "Check status" }));

    expect(getStatus).toHaveBeenCalledWith("op-1");
    expectBusy(screen.getByRole("button", { name: "Checking…" }));
  });

  describe("unconfirmed", () => {
    const lost = entry({ lastError: { kind: "response-lost", at: 1 } });

    it("offers Check status and Retry same attempt, with the helper text", () => {
      renderActions(lost);

      expect(buttonNames()).toEqual(["Check status", "Retry same attempt"]);
      expect(
        screen.getByRole("button", { name: "Retry same attempt" }),
      ).toHaveAccessibleDescription("Uses the same attempt ID, so it can't publish twice.");
    });

    it("Retry same attempt resends the SAME operationId and reads Retrying… meanwhile", async () => {
      const { user, publish } = renderActions(lost);

      await user.click(screen.getByRole("button", { name: "Retry same attempt" }));

      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(ANN, "op-1");
      expectBusy(screen.getByRole("button", { name: "Retrying…" }));
    });

    it("says Resend same attempt when the service has no record", () => {
      renderActions(entry({ lastError: { kind: "not-recorded", at: 1 } }));

      expect(buttonNames()).toEqual(["Check status", "Resend same attempt"]);
    });

    it("works while restore is not ready: the same ID cannot duplicate", () => {
      renderActions(lost, { restoreStatus: "degraded" });

      expect(screen.getByRole("button", { name: "Retry same attempt" })).toBeEnabled();
    });
  });

  describe("rejected", () => {
    const declined = { ...entry(), snapshot: rejected() };

    function dialog() {
      return screen.getByRole<HTMLDialogElement>("dialog", { hidden: true });
    }

    it("opens a confirm dialog with focus inside; Esc cancels and focus returns", async () => {
      const { user, publish } = renderActions(declined);
      const trigger = screen.getByRole("button", { name: "Start new attempt…" });
      expect(dialog().open).toBe(false);

      await user.click(trigger);

      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveAccessibleName("Start a new attempt?");
      expect(dialog()).toHaveAccessibleDescription(
        "This creates a new publication attempt with a new ID.",
      );
      expect(dialog()).toContainElement(document.activeElement as HTMLElement);

      await user.keyboard("{Escape}");

      expect(dialog().open).toBe(false);
      expect(trigger).toHaveFocus();
      expect(publish).not.toHaveBeenCalled();
    });

    it("Cancel closes without starting and returns focus", async () => {
      const { user, publish } = renderActions(declined);
      const trigger = screen.getByRole("button", { name: "Start new attempt…" });

      await user.click(trigger);
      await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

      expect(dialog().open).toBe(false);
      expect(trigger).toHaveFocus();
      expect(publish).not.toHaveBeenCalled();
    });

    it("confirming starts an attempt with a NEW operationId", async () => {
      const { user, publish } = renderActions(declined);

      await user.click(screen.getByRole("button", { name: "Start new attempt…" }));
      await user.click(within(dialog()).getByRole("button", { name: "Start new attempt" }));

      expect(publish).toHaveBeenCalledTimes(1);
      const [announcementId, operationId] = publish.mock.calls[0] ?? [];
      expect(announcementId).toBe(ANN);
      expect(operationId).not.toBe("op-1");
      expect(buttonNames()).toEqual(["Sending…"]);
      expect(group()).toHaveFocus();
    });

    it("is disabled with an explanation until restore is ready", () => {
      renderActions(declined, { restoreStatus: "degraded" });

      const trigger = screen.getByRole("button", { name: "Start new attempt…" });
      expect(trigger).toBeDisabled();
      expect(trigger).toHaveAccessibleDescription(
        "Publishing is paused until publication history loads.",
      );
    });
  });

  it("published: no actions", () => {
    renderActions({ ...entry(), snapshot: published() });

    expect(screen.queryByRole("group", { name: "Publication actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
