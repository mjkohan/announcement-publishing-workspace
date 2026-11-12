import { describe, expect, it } from "vitest";
import {
  createJournal,
  JOURNAL_STORAGE_KEY,
  type JournalEntry,
  type JournalStorage,
} from "./journal";

const MOCK_STORAGE_KEY = "announcement-workspace:mock-service:v1";

const first: JournalEntry = { operationId: "op-1", announcementId: "a-1", createdAt: 100 };
const second: JournalEntry = { operationId: "op-2", announcementId: "a-2", createdAt: 200 };

/** In-memory storage that records every key it is asked for. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const touchedKeys = new Set<string>();
  const storage: JournalStorage = {
    getItem: (key) => {
      touchedKeys.add(key);
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      touchedKeys.add(key);
      data.set(key, value);
    },
    removeItem: (key) => {
      touchedKeys.add(key);
      data.delete(key);
    },
  };
  return { storage, data, touchedKeys };
}

function journalWith(raw: string) {
  return createJournal(memoryStorage({ [JOURNAL_STORAGE_KEY]: raw }).storage);
}

describe("journal", () => {
  it("is empty when nothing is stored", () => {
    expect(createJournal(memoryStorage().storage).read()).toEqual({ schema: 1, entries: [] });
  });

  it("round-trips entries through storage", () => {
    const { storage, data } = memoryStorage();

    expect(createJournal(storage).add(first)).toBe(true);
    createJournal(storage).add(second);

    expect(createJournal(storage).read()).toEqual({ schema: 1, entries: [first, second] });
    expect(JSON.parse(data.get(JOURNAL_STORAGE_KEY) ?? "")).toEqual({
      schema: 1,
      entries: [first, second],
    });
  });

  it("works with the real sessionStorage", () => {
    const journal = createJournal(sessionStorage);

    journal.add(first);

    expect(createJournal(sessionStorage).read().entries).toEqual([first]);
  });

  it("does not add the same operationId twice", () => {
    const journal = createJournal(memoryStorage().storage);

    journal.add(first);
    expect(journal.add({ ...first, createdAt: 999 })).toBe(true);

    expect(journal.read().entries).toEqual([first]);
  });

  it("refuses an invalid entry", () => {
    const journal = createJournal(memoryStorage().storage);

    expect(journal.add({ ...first, operationId: "  " })).toBe(false);
    expect(journal.add({ ...first, createdAt: Number.NaN })).toBe(false);
    expect(journal.read().entries).toEqual([]);
  });

  it("removes an entry by operationId", () => {
    const journal = createJournal(memoryStorage().storage);
    journal.add(first);
    journal.add(second);

    expect(journal.remove("op-1")).toBe(true);
    expect(journal.remove("op-unknown")).toBe(true);

    expect(journal.read().entries).toEqual([second]);
  });

  it("clears entries and the selection", () => {
    const { storage, data } = memoryStorage();
    const journal = createJournal(storage);
    journal.add(first);
    journal.setSelectedId("a-1");

    expect(journal.clear()).toBe(true);

    expect(journal.read()).toEqual({ schema: 1, entries: [] });
    expect(data.has(JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it("stores, keeps and clears the selected id", () => {
    const journal = createJournal(memoryStorage().storage);

    expect(journal.getSelectedId()).toBeUndefined();
    journal.setSelectedId("a-2");
    journal.add(first);
    expect(journal.getSelectedId()).toBe("a-2");
    expect(journal.read().entries).toEqual([first]);

    journal.setSelectedId(undefined);
    expect(journal.getSelectedId()).toBeUndefined();
    expect(journal.read()).toEqual({ schema: 1, entries: [first] });
  });

  it("never touches the mock service's storage key", () => {
    const { storage, data, touchedKeys } = memoryStorage({ [MOCK_STORAGE_KEY]: "mock-state" });
    const journal = createJournal(storage);

    journal.read();
    journal.add(first);
    journal.remove("op-1");
    journal.setSelectedId("a-1");
    journal.getSelectedId();
    journal.clear();

    expect([...touchedKeys]).toEqual([JOURNAL_STORAGE_KEY]);
    expect(data.get(MOCK_STORAGE_KEY)).toBe("mock-state");
  });

  describe("on read, never throws and", () => {
    it("returns an empty journal for corrupt JSON", () => {
      expect(journalWith("{not json").read()).toEqual({ schema: 1, entries: [] });
    });

    it.each([
      ["a wrong schema", JSON.stringify({ schema: 2, entries: [first], selectedId: "a-1" })],
      ["a missing schema", JSON.stringify({ entries: [first] })],
      ["a non-object", JSON.stringify([first])],
      ["null", "null"],
    ])("returns an empty journal for %s", (_label, raw) => {
      expect(journalWith(raw).read()).toEqual({ schema: 1, entries: [] });
    });

    it("drops only the invalid entries", () => {
      const raw = JSON.stringify({
        schema: 1,
        entries: [
          first,
          null,
          "op-x",
          { operationId: "op-3", announcementId: "a-3" },
          { operationId: "", announcementId: "a-3", createdAt: 1 },
          { operationId: "op-4", announcementId: 4, createdAt: 1 },
          { operationId: "x".repeat(101), announcementId: "a-3", createdAt: 1 },
          { ...first, createdAt: 555 },
          { ...second, extra: true },
        ],
        selectedId: "a-1",
      });

      expect(journalWith(raw).read()).toEqual({
        schema: 1,
        entries: [first, second],
        selectedId: "a-1",
      });
    });

    it("keeps entries when entries or selectedId has the wrong type", () => {
      expect(journalWith(JSON.stringify({ schema: 1, entries: "nope" })).read()).toEqual({
        schema: 1,
        entries: [],
      });
      expect(
        journalWith(JSON.stringify({ schema: 1, entries: [first], selectedId: 7 })).read(),
      ).toEqual({ schema: 1, entries: [first] });
    });
  });

  describe("with a storage that throws", () => {
    const failing = (): never => {
      throw new DOMException("Storage disabled", "SecurityError");
    };

    it("returns an empty journal when getItem throws", () => {
      const journal = createJournal({ getItem: failing, setItem: failing, removeItem: failing });

      expect(journal.read()).toEqual({ schema: 1, entries: [] });
      expect(journal.getSelectedId()).toBeUndefined();
    });

    it("reports failure without throwing when setItem throws", () => {
      const { storage } = memoryStorage();
      const journal = createJournal({
        ...storage,
        setItem: () => {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        },
      });

      expect(journal.add(first)).toBe(false);
      expect(journal.setSelectedId("a-1")).toBe(false);
      expect(journal.read()).toEqual({ schema: 1, entries: [] });
    });

    it("reports failure without throwing when removeItem throws", () => {
      const journal = createJournal({ ...memoryStorage().storage, removeItem: failing });

      expect(journal.clear()).toBe(false);
    });
  });
});
