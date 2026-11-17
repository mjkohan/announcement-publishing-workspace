import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, ServiceProvider } from "../src/app";
import { createAnnouncementMock, type IAnnouncementService } from "../src/mocks";
import { createJournal, JOURNAL_STORAGE_KEY } from "../src/persistence/journal";
import { createPublicationStore, type PublicationStoreApi } from "../src/store";
import { inertTimers } from "../src/test/inertTimers";
import { renderWithProviders } from "../src/test/renderWithProviders";

const OPERATION_ID = /^op-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const nav = () => screen.getByRole("navigation", { name: "Announcements" });
const main = () => screen.getByRole("main");
const actions = () => within(main()).getByRole("group", { name: "Publication actions" });
const card = () => within(main()).getByRole("region", { name: "Publication status" });

/** Waits for the list and for restore to finish (real timers). */
async function ready(store: PublicationStoreApi) {
  await within(nav()).findByRole("button", { name: /Service Maintenance Notice/ });
  await waitFor(() => {
    expect(store.getState().restoreStatus).toBe("ready");
  });
}

/** The supplied mock with spies on every request, without detaching methods from the mock. */
function spiedMock() {
  const mock = createAnnouncementMock();
  const publish = vi.fn<IAnnouncementService["publish"]>((announcementId, operationId) =>
    mock.publish(announcementId, operationId),
  );
  const getStatus = vi.fn<IAnnouncementService["getStatus"]>((operationId) =>
    mock.getStatus(operationId),
  );
  const listOperations = vi.fn<IAnnouncementService["listOperations"]>(() => mock.listOperations());
  const service: IAnnouncementService = { ...mock, publish, getStatus, listOperations };
  return { service, publish, getStatus, listOperations };
}

/** Makes `document.hidden` return `hidden` and fires `visibilitychange`. */
function setHidden(hidden: boolean) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("corrupt app journal at startup", () => {
  it.each([
    ["invalid JSON", "{not json"],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["a wrong schema", JSON.stringify({ schema: 99, entries: [] })],
    ["invalid entries", JSON.stringify({ schema: 1, entries: [{ operationId: 7 }, null, "x"] })],
  ])("loads and publishes with %s in the journal", async (_label, raw) => {
    sessionStorage.setItem(JOURNAL_STORAGE_KEY, raw);
    const user = userEvent.setup();
    const { store } = renderWithProviders(<App />);
    await ready(store);

    expect(store.getState().operations).toEqual({});
    expect(within(actions()).getByRole("button", { name: "Publish" })).toBeEnabled();

    await user.click(within(actions()).getByRole("button", { name: "Publish" }));
    const ids = Object.keys(store.getState().operations);
    expect(ids).toHaveLength(1);
    // The corrupt value is replaced by a valid journal holding the new attempt.
    expect(
      createJournal(sessionStorage)
        .read()
        .entries.map((e) => e.operationId),
    ).toEqual(ids);
  });

  it("loads when reading the journal storage throws", async () => {
    const storage: Storage = {
      length: 0,
      clear: () => undefined,
      key: () => null,
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const { store } = renderWithProviders(<App />, { storage });
    await ready(store);

    expect(within(nav()).getAllByRole("button")).toHaveLength(3);
    expect(store.getState().operations).toEqual({});
  });
});

describe("rapid clicks", () => {
  it("creates exactly one operation per announcement", async () => {
    const { service, publish } = spiedMock();
    const { store } = renderWithProviders(<App />, { service });
    await ready(store);

    const titles = [/Service Maintenance Notice/, /New Feature Launch/, /Support Hours Update/];
    // Two rounds over all three: the second round finds every announcement already started.
    for (const title of [...titles, ...titles]) {
      fireEvent.click(within(nav()).getByRole("button", { name: title }));
      const button = within(actions()).queryByRole("button", { name: "Publish" });
      if (!button) continue;
      // Five clicks before React re-renders: the handler still sees the old "idle" button.
      act(() => {
        for (let i = 0; i < 5; i += 1) fireEvent.click(button);
      });
    }

    expect(publish).toHaveBeenCalledTimes(3);
    const byAnnouncement = publish.mock.calls.map(([announcementId]) => announcementId).sort();
    expect(byAnnouncement).toEqual(["ann-101", "ann-102", "ann-103"]);
    const operations = Object.values(store.getState().operations);
    expect(operations.map((entry) => entry.announcementId).sort()).toEqual(byAnnouncement);
    expect(createJournal(sessionStorage).read().entries).toHaveLength(3);
  });

  it("ignores a double call of the publish action in the same tick", async () => {
    const { service, publish } = spiedMock();
    const { store } = renderWithProviders(<App />, { service });
    await ready(store);

    const first = store.getState().publish("ann-101");
    const second = store.getState().publish("ann-101");

    expect(first).toMatch(OPERATION_ID);
    expect(second).toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("tab hidden during processing", () => {
  it("makes no status read while hidden and reads at once when visible", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { service, getStatus } = spiedMock();
    renderWithProviders(<App />, { service });
    await act(() => vi.advanceTimersByTimeAsync(200));

    await user.click(within(actions()).getByRole("button", { name: "Publish" }));
    // The publish reply (120 ms) brings "processing"; the first poll would be at 1500 ms.
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(within(card()).getByText("Processing", { exact: true })).toBeInTheDocument();

    act(() => {
      setHidden(true);
    });
    // Longer than the publication (2.5 s): only the paused polling keeps it "Processing".
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getStatus).not.toHaveBeenCalled();
    expect(within(card()).getByText("Processing", { exact: true })).toBeInTheDocument();

    act(() => {
      setHidden(false);
    });
    expect(getStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(within(card()).getByText("Published", { exact: true })).toBeInTheDocument();

    // Terminal: following stopped, no further reads.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});

describe("StrictMode", () => {
  it("restores once and runs one polling loop per operation", async () => {
    vi.useFakeTimers();
    // The tab before the refresh: one recorded attempt for ann-101 (polling off).
    const before = createPublicationStore({
      service: createAnnouncementMock(),
      journal: createJournal(sessionStorage),
      now: () => Date.now(),
      timers: inertTimers,
    });
    before.setState({ restoreStatus: "ready" });
    const recorded = before.getState().publish("ann-101");
    if (!recorded) throw new Error("publish() was refused");
    // A journal entry the service never recorded (the tab closed before the request left).
    const unrecorded = "op-00000000-0000-4000-8000-000000000000";
    createJournal(sessionStorage).add({
      operationId: unrecorded,
      announcementId: "ann-102",
      createdAt: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(200);

    const { service, publish, getStatus, listOperations } = spiedMock();
    render(
      <StrictMode>
        <ServiceProvider service={service}>
          <App />
        </ServiceProvider>
      </StrictMode>,
    );
    const readsOf = (operationId: string) =>
      getStatus.mock.calls.filter(([id]) => id === operationId).length;

    // listOperations (100 ms), then one getStatus for the unlisted entry (100 ms).
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(listOperations).toHaveBeenCalledTimes(1);
    expect(readsOf(unrecorded)).toBe(1);
    expect(readsOf(recorded)).toBe(0);

    // One loop: one read per 1500 ms period, not two.
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(readsOf(recorded)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1_600));
    expect(readsOf(recorded)).toBe(2);

    // "not-recorded" is not followed; nothing is ever published again.
    expect(readsOf(unrecorded)).toBe(1);
    expect(listOperations).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("crypto.randomUUID unavailable", () => {
  it("publishes with an operationId from the getRandomValues fallback", async () => {
    const real = globalThis.crypto;
    const insecure: Pick<Crypto, "getRandomValues"> = {
      getRandomValues: (array) => real.getRandomValues(array),
    };
    vi.stubGlobal("crypto", insecure);
    expect("randomUUID" in globalThis.crypto).toBe(false);

    const user = userEvent.setup();
    const { service, publish } = spiedMock();
    const { store } = renderWithProviders(<App />, { service });
    await ready(store);

    await user.click(within(actions()).getByRole("button", { name: "Publish" }));

    expect(publish).toHaveBeenCalledTimes(1);
    const [, operationId] = publish.mock.calls[0] ?? [];
    expect(operationId).toMatch(OPERATION_ID);
    expect(store.getState().operations[String(operationId)]).toBeDefined();
  });
});
