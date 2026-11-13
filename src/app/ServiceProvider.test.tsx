import { act, render, renderHook, screen } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { IAnnouncementService, PublicationOperation } from "../mocks";
import { JOURNAL_STORAGE_KEY } from "../persistence/journal";
import { selectView, type PublicationStore } from "../store";
import { MemoryStorage } from "../test/memoryStorage";
import { renderWithProviders } from "../test/renderWithProviders";
import {
  usePublicationActions,
  usePublicationStore,
  usePublicationStoreShallow,
  useService,
} from "./hooks";
import { ServiceProvider } from "./ServiceProvider";

const ANN = "ann-101";

type PublishMock = Mock<IAnnouncementService["publish"]>;
const publishMocks = new WeakMap<IAnnouncementService, PublishMock>();

/** Service whose publish never settles, so the attempt stays "submitting". */
function pendingService(): IAnnouncementService {
  const publish: PublishMock = vi.fn(() => new Promise<PublicationOperation>(() => undefined));
  const service: IAnnouncementService = {
    getAnnouncements: vi.fn(() => Promise.resolve([])),
    listOperations: vi.fn(() => Promise.resolve([])),
    publish,
    getStatus: vi.fn(() => Promise.resolve(null)),
    setScenario: vi.fn(),
    getScenario: vi.fn(() => "success" as const),
    reset: vi.fn(),
  };
  publishMocks.set(service, publish);
  return service;
}

/** Lets the provider's mount-time `restore()` finish (`pendingService` lists no operations). */
async function settleRestore(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The `publish` mock of a `pendingService()`, without detaching a method from the service. */
function publishMock(service: IAnnouncementService): PublishMock {
  const mock = publishMocks.get(service);
  if (!mock) throw new Error("Not a pendingService()");
  return mock;
}

function wrapperFor(service: IAnnouncementService, storage: Storage = new MemoryStorage()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <ServiceProvider service={service} storage={storage}>
          {children}
        </ServiceProvider>
      </StrictMode>
    );
  };
}

describe("hooks outside the provider", () => {
  it.each<[string, () => unknown]>([
    ["useService", () => useService()],
    ["usePublicationActions", () => usePublicationActions()],
    ["usePublicationStore", () => usePublicationStore((state) => state.epoch)],
    ["usePublicationStoreShallow", () => usePublicationStoreShallow((state) => state.operations)],
  ])("%s throws", (name, hook) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(hook)).toThrow(`${name} must be used inside <ServiceProvider>`);
  });
});

describe("ServiceProvider", () => {
  it("provides the injected service", () => {
    const service = pendingService();

    const { result } = renderHook(() => useService(), { wrapper: wrapperFor(service) });

    expect(result.current).toBe(service);
  });

  it("keeps one store across rerenders in StrictMode", () => {
    const { result, rerender } = renderHook(
      () => usePublicationStore((state: PublicationStore) => state.publish),
      { wrapper: wrapperFor(pendingService()) },
    );
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it("re-renders a memoized view selector after an action, without a render loop", async () => {
    const service = pendingService();
    let renders = 0;
    function Status() {
      renders += 1;
      const view = usePublicationStore(selectView(ANN));
      const { publish } = usePublicationActions();
      return (
        <button type="button" onClick={() => publish(ANN)}>
          {view.kind}
        </button>
      );
    }

    render(<Status />, { wrapper: wrapperFor(service) });
    await settleRestore();
    expect(screen.getByRole("button")).toHaveTextContent("idle");
    const rendersAfterMount = renders;

    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByRole("button")).toHaveTextContent("submitting");
    expect(publishMock(service)).toHaveBeenCalledTimes(1);
    expect(renders - rendersAfterMount).toBeLessThanOrEqual(2); // StrictMode renders twice
  });

  it("returns stable actions that use the injected service and storage", async () => {
    const service = pendingService();
    const storage = new MemoryStorage();
    const { result, rerender } = renderHook(() => usePublicationActions(), {
      wrapper: wrapperFor(service, storage),
    });
    await settleRestore();
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);

    let operationId: string | undefined;
    act(() => {
      operationId = result.current.publish(ANN);
    });

    expect(publishMock(service)).toHaveBeenCalledWith(ANN, operationId);
    expect(storage.getItem(JOURNAL_STORAGE_KEY)).toContain(String(operationId));
    expect(sessionStorage.getItem(JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it("restores once on mount in StrictMode", async () => {
    const listOperations = vi.fn(() => Promise.resolve<PublicationOperation[]>([]));
    const service: IAnnouncementService = { ...pendingService(), listOperations };
    const { result } = renderHook(() => usePublicationStore((state) => state.restoreStatus), {
      wrapper: wrapperFor(service),
    });

    await settleRestore();

    expect(result.current).toBe("ready");
    expect(listOperations).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after the StrictMode remount and stops every timer on unmount", async () => {
    vi.useFakeTimers();
    const processing: PublicationOperation = {
      operationId: "op-1",
      announcementId: ANN,
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "processing",
      version: 1,
    };
    const listOperations = vi.fn(() => Promise.resolve([processing]));
    const service: IAnnouncementService = { ...pendingService(), listOperations };
    const { result, unmount } = renderHook(
      () => usePublicationStore((state) => state.operations["op-1"]?.nextCheckAt),
      { wrapper: wrapperFor(service) },
    );

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(listOperations).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(Date.now() + 1_500);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports shallow selectors that return new objects", () => {
    const { result, rerender } = renderHook(
      () =>
        usePublicationStoreShallow((state) => ({
          epoch: state.epoch,
          status: state.announcements.status,
        })),
      { wrapper: wrapperFor(pendingService()) },
    );
    const first = result.current;

    rerender();

    expect(result.current).toEqual({ epoch: 0, status: "idle" });
    expect(result.current).toBe(first);
  });
});

describe("renderWithProviders", () => {
  it("uses the passed service and returns the provider's store", async () => {
    const service = pendingService();
    function Probe() {
      return <p>{useService() === service ? "injected" : "other"}</p>;
    }

    const { store } = renderWithProviders(<Probe />, { service, storage: new MemoryStorage() });
    await settleRestore();

    expect(screen.getByText("injected")).toBeInTheDocument();
    act(() => {
      store.getState().publish(ANN);
    });
    expect(publishMock(service)).toHaveBeenCalledTimes(1);
  });

  it("defaults to the supplied mock service", () => {
    const { service } = renderWithProviders(<p>app</p>);

    expect(service.getScenario()).toBe("success");
  });
});
