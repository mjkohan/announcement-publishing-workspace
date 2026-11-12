import { AnnouncementMockError, type AnnouncementErrorCode } from "../mocks";
import type { PublicationErrorKind } from "./types";

const KIND_BY_CODE: Record<AnnouncementErrorCode, PublicationErrorKind> = {
  RESPONSE_LOST: "response-lost",
  STATUS_UNAVAILABLE: "status-unavailable",
  UNKNOWN_ANNOUNCEMENT: "unexpected",
  OPERATION_ID_CONFLICT: "unexpected",
};

/**
 * Maps a thrown value to an error kind. "not-recorded" is never produced here: it comes from
 * `getStatus` resolving `null`, not from a thrown error.
 */
export function toPublicationError(error: unknown): PublicationErrorKind {
  if (!(error instanceof AnnouncementMockError)) return "unexpected";
  const code: string = error.code;
  return Object.hasOwn(KIND_BY_CODE, code)
    ? KIND_BY_CODE[code as AnnouncementErrorCode]
    : "unexpected";
}
