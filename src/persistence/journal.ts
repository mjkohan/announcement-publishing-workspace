/**
 * Write-ahead journal of publication attempts, kept in sessionStorage under the app's own key.
 * An attempt is written here BEFORE `service.publish` is called, so a refresh can find it again
 * and recover by reading its status (never by publishing again).
 *
 * Never reads or writes the mock service's own storage key.
 */

export const JOURNAL_STORAGE_KEY = "announcement-workspace:app:v1";

const MAX_ID_LENGTH = 100;

export interface JournalEntry {
  operationId: string;
  announcementId: string;
  /** Local time (ms) when the attempt was created. */
  createdAt: number;
}

export interface JournalData {
  schema: 1;
  entries: JournalEntry[];
  selectedId?: string;
}

export type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * All operations are safe: none of them throws. Writes return `true` when the change was
 * persisted and `false` when the storage failed or the input was invalid.
 */
export interface Journal {
  read(): JournalData;
  /** Idempotent: an entry with a known operationId is kept as is. */
  add(entry: JournalEntry): boolean;
  remove(operationId: string): boolean;
  /** Removes the whole journal, including the selected announcement. */
  clear(): boolean;
  getSelectedId(): string | undefined;
  /** `undefined` clears the selection. */
  setSelectedId(id: string | undefined): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_ID_LENGTH;
}

export function isJournalEntry(value: unknown): value is JournalEntry {
  return (
    isRecord(value) &&
    isId(value.operationId) &&
    isId(value.announcementId) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

function emptyJournal(): JournalData {
  return { schema: 1, entries: [] };
}

/**
 * Validates raw parsed data. A wrong shape or schema gives an empty journal; otherwise only the
 * invalid or duplicate entries (by operationId, first one kept) and an invalid selectedId are
 * dropped.
 */
export function parseJournal(raw: unknown): JournalData {
  if (!isRecord(raw) || raw.schema !== 1) return emptyJournal();

  const entries: JournalEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.entries)) {
    for (const candidate of raw.entries as unknown[]) {
      if (!isJournalEntry(candidate) || seen.has(candidate.operationId)) continue;
      seen.add(candidate.operationId);
      entries.push({
        operationId: candidate.operationId,
        announcementId: candidate.announcementId,
        createdAt: candidate.createdAt,
      });
    }
  }

  const journal: JournalData = { schema: 1, entries };
  if (isId(raw.selectedId)) journal.selectedId = raw.selectedId;
  return journal;
}

export function createJournal(storage: JournalStorage): Journal {
  function read(): JournalData {
    try {
      const text = storage.getItem(JOURNAL_STORAGE_KEY);
      if (text === null) return emptyJournal();
      return parseJournal(JSON.parse(text));
    } catch {
      return emptyJournal();
    }
  }

  function write(journal: JournalData): boolean {
    try {
      storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journal));
      return true;
    } catch {
      return false;
    }
  }

  return {
    read,

    add(entry) {
      if (!isJournalEntry(entry)) return false;
      const journal = read();
      if (journal.entries.some((known) => known.operationId === entry.operationId)) return true;
      journal.entries.push({
        operationId: entry.operationId,
        announcementId: entry.announcementId,
        createdAt: entry.createdAt,
      });
      return write(journal);
    },

    remove(operationId) {
      const journal = read();
      const entries = journal.entries.filter((entry) => entry.operationId !== operationId);
      if (entries.length === journal.entries.length) return true;
      return write({ ...journal, entries });
    },

    clear() {
      try {
        storage.removeItem(JOURNAL_STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },

    getSelectedId() {
      return read().selectedId;
    },

    setSelectedId(id) {
      if (id !== undefined && !isId(id)) return false;
      const { schema, entries } = read();
      return write(id === undefined ? { schema, entries } : { schema, entries, selectedId: id });
    },
  };
}
