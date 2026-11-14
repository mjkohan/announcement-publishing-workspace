import { vi } from "vitest";
import type { IAnnouncementService, PublicationOperation } from "../mocks";

const never = <T>() => new Promise<T>(() => undefined);

/**
 * Test-only service whose requests never settle: restore never ends and nothing changes the
 * store except the test. `publish` and `getStatus` are spies.
 */
export function silentService() {
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
