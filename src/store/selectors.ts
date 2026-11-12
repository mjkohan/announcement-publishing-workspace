import { compareAttempts, deriveAnnouncementView, type AnnouncementView } from "../domain";
import type { OperationEntry } from "../domain";
import type { PublicationState } from "./publicationStore";

type OperationsState = Pick<PublicationState, "operations">;
type Selector<T> = (state: OperationsState) => T;

const NO_ATTEMPTS: readonly OperationEntry[] = Object.freeze([]);

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** One stable, memoized selector per announcement, so `useStore` never re-renders in a loop. */
function memoizePerId<T>(create: (announcementId: string) => Selector<T>) {
  const cache = new Map<string, Selector<T>>();
  return (announcementId: string): Selector<T> => {
    let selector = cache.get(announcementId);
    if (!selector) {
      selector = create(announcementId);
      cache.set(announcementId, selector);
    }
    return selector;
  };
}

/**
 * Attempts of one announcement, newest first. Keeps the same array reference while that
 * announcement's entries are unchanged, even when other operations change.
 */
export const selectAttempts = memoizePerId((announcementId) => {
  let lastOperations: OperationsState["operations"] | undefined;
  let lastAttempts = NO_ATTEMPTS;
  return (state) => {
    if (state.operations === lastOperations) return lastAttempts;
    lastOperations = state.operations;
    const attempts = Object.values(state.operations)
      .filter((entry) => entry.announcementId === announcementId)
      .sort((a, b) => compareAttempts(b, a));
    if (!sameItems(attempts, lastAttempts)) lastAttempts = attempts;
    return lastAttempts;
  };
});

/** Derived view of one announcement. Same reference while its attempts are unchanged. */
export const selectView = memoizePerId((announcementId) => {
  const attemptsOf = selectAttempts(announcementId);
  let lastAttempts: readonly OperationEntry[] | undefined;
  let lastView: AnnouncementView = deriveAnnouncementView(NO_ATTEMPTS);
  return (state) => {
    const attempts = attemptsOf(state);
    if (attempts !== lastAttempts) {
      lastAttempts = attempts;
      lastView = deriveAnnouncementView(attempts);
    }
    return lastView;
  };
});
