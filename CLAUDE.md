# CLAUDE.md

## Goal
Announcement publishing workspace (React + TypeScript) for a simulated publishing service.
Users pick one of three fixed announcements, publish it, follow the outcome, and recover safely after failures or refresh. Brief: `docs/ASSIGNMENT.md`.

## Stack
- React 19, TypeScript (strict), Vite
- Zustand 5: vanilla `createStore` + `useStore` hook
- Tailwind CSS v4
- Vitest + Testing Library + jsdom; Playwright for e2e
- npm (Node version in `.nvmrc`)
- Optional later: Husky + lint-staged + commitlint

## HARD RULES
- Never modify anything in `src/mocks/`. It must stay byte-identical to the supplied mocks (checked by `npm run verify:mocks`).
- Never read the mock's own sessionStorage key (`announcement-workspace:mock-service:v1`). Only use the public service API: `getAnnouncements`, `publish`, `getStatus`, `listOperations`.
- Import the service only from `src/mocks` (its `index.ts`) and create it with `createAnnouncementMock()`. Never import `createService` or anything else from `src/mocks/service.ts` directly.
- Each operation tracks `publishInFlight` and `checkInFlight` as two independent booleans (a status read can overlap the publish request). Never merge them into one enum.
- App state is keyed by `operationId`. An announcement's status is derived from its operations, never stored.
- Snapshot merge: accept only if `incoming.version >= current.version`. Version 2 (terminal) is immutable.
- Errors live in a separate `lastError` field and never erase a snapshot.
- Never create a new operationId while an announcement has a submitting, processing or unconfirmed attempt. Retries reuse the same operationId. A new ID is allowed only from "idle" or after a confirmed rejection.
- Never call `publish` automatically after a page refresh.
- A failed status read never means "rejected". A lost publish response means "outcome unknown", never "failed".
- Side effects (service calls, timers) live in the store, not in component `useEffect`. Only exception: the presentational tick in `RelativeTime`, which touches no state and no service.
- "Outcome unknown" requires a real failed request. An attempt restored from the journal with no snapshot and no error is "checking", not "unconfirmed".
- After every `await` in the store, re-check the epoch before writing state (stale continuations drop their result).
- Write the journal entry BEFORE calling `service.publish`.

## Service facts (from `src/mocks/service.ts`)
- `publish` records the operation synchronously when called; the reply arrives later or is lost (`RESPONSE_LOST`).
- Reusing an operationId returns the current snapshot of that operation; using it for another announcement rejects with `OPERATION_ID_CONFLICT`.
- `getStatus` returning `null` means the ID is not recorded. It is not a rejection.
- Any status read (`getStatus` or `listOperations`) may consume one pending `STATUS_UNAVAILABLE` failure.
- Snapshots can arrive late and out of order. Version 1 = processing, version 2 = terminal.

## Planned folder structure
- `src/mocks` — supplied mocks, unchanged
- `src/domain` — pure types and logic (derivation, merge rules)
- `src/persistence` — app-owned journal in sessionStorage (own key, never the mock's)
- `src/store` — Zustand store, service calls, timers
- `src/app` — app shell, providers, wiring
- `src/features/announcements` — list, detail, publish/recovery UI
- `src/ui` — shared presentational components
- `src/dev` — dev-only tools (scenario switcher, reset)
- `tests` — unit/integration tests (Vitest)
- `e2e` — Playwright tests
- `scripts` — repo scripts (e.g. mock verification)

## Commands
Some are added in later tasks.
- `npm run dev` — dev server
- `npm run build` — type-check and production build
- `npm run typecheck` — TypeScript only
- `npm run lint` — oxlint
- `npm run format` — formatter
- `npm run test` — Vitest
- `npm run test:e2e` — Playwright
- `npm run verify:mocks` — check `src/mocks` is byte-identical to the supplied mocks
- `npm run check` — all checks before commit

## Git
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`). Enforced by commitlint once the optional hooks task is done.
- Small, focused commits.
- Run `npm run check` before committing (until it exists: `npm run build` and `npm run lint`).
- Never add yourself (the AI agent) as author or co-author of a commit. No `Co-Authored-By` lines and no AI attribution trailers in commit messages or PR descriptions.

## Testing
- Never weaken a test expectation to make it pass. Report the bug instead.
