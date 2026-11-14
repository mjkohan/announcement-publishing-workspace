import { useId, useRef } from "react";
import { usePublicationActions, usePublicationStore } from "../../app/hooks";
import { assertNever, type OperationEntry } from "../../domain";
import { selectView } from "../../store";
import { Button } from "../../ui";

const ROW = "flex flex-wrap items-center gap-2";
const HELP = "text-xs text-slate-600 dark:text-slate-400";

export interface PublicationActionsProps {
  announcementId: string;
}

/**
 * Actions for one announcement, chosen from its derived view. Every handler uses the
 * `announcementId` / `operationId` of this render, never "the selected one" at click time.
 * Render it with `key={announcementId}` so a dialog never outlives its announcement.
 */
export function PublicationActions({ announcementId }: PublicationActionsProps) {
  const view = usePublicationStore(selectView(announcementId));
  const restoreReady = usePublicationStore((state) => state.restoreStatus === "ready");
  const { publish } = usePublicationActions();
  const groupRef = useRef<HTMLDivElement>(null);
  const pausedId = useId();

  const paused = !restoreReady && (
    <p id={pausedId} className={HELP}>
      Publishing is paused until publication history loads.
    </p>
  );

  let content;
  switch (view.kind) {
    case "idle":
      content = (
        <>
          <div className={ROW}>
            <Button
              disabled={!restoreReady}
              aria-describedby={restoreReady ? undefined : pausedId}
              onClick={() => {
                publish(announcementId);
              }}
            >
              Publish
            </Button>
          </div>
          {paused}
        </>
      );
      break;
    case "checking":
      content = (
        <div className={ROW}>
          <Button loading>Checking…</Button>
        </div>
      );
      break;
    case "submitting":
      content = (
        <div className={ROW}>
          <Button loading>Sending…</Button>
        </div>
      );
      break;
    case "processing":
      content = (
        <div className={ROW}>
          <CheckStatusButton op={view.op} />
        </div>
      );
      break;
    case "unconfirmed":
      content = <UnconfirmedActions op={view.op} notRecorded={view.notRecorded} />;
      break;
    case "rejected":
      content = (
        <>
          <div className={ROW}>
            <StartNewAttempt
              announcementId={announcementId}
              disabled={!restoreReady}
              describedBy={restoreReady ? undefined : pausedId}
              onStarted={() => groupRef.current?.focus()}
            />
          </div>
          {paused}
        </>
      );
      break;
    case "published":
      return null;
    default:
      return assertNever(view);
  }

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Publication actions"
      tabIndex={-1}
      className="space-y-2 focus:outline-none"
    >
      {content}
    </div>
  );
}

/** "Check status" for one operation; "Checking…" while any read of it is in flight. */
function CheckStatusButton({ op }: { op: OperationEntry }) {
  const { check } = usePublicationActions();
  const { operationId } = op;

  return (
    <Button
      variant="secondary"
      loading={op.checkInFlight}
      onClick={() => {
        void check(operationId);
      }}
    >
      {op.checkInFlight ? "Checking…" : "Check status"}
    </Button>
  );
}

function UnconfirmedActions({ op, notRecorded }: { op: OperationEntry; notRecorded: boolean }) {
  const { retrySameAttempt } = usePublicationActions();
  const helpId = useId();
  const { operationId } = op;
  const idleLabel = notRecorded ? "Resend same attempt" : "Retry same attempt";

  return (
    <>
      <div className={ROW}>
        <CheckStatusButton op={op} />
        <Button
          loading={op.publishInFlight}
          aria-describedby={helpId}
          onClick={() => {
            retrySameAttempt(operationId);
          }}
        >
          {op.publishInFlight ? "Retrying…" : idleLabel}
        </Button>
      </div>
      <p id={helpId} className={HELP}>
        Uses the same attempt ID, so it can&apos;t publish twice.
      </p>
    </>
  );
}

interface StartNewAttemptProps {
  announcementId: string;
  disabled: boolean;
  describedBy: string | undefined;
  /** Called after confirming: the trigger is about to unmount, so focus goes elsewhere. */
  onStarted: () => void;
}

/** "Start new attempt…" with a native modal `<dialog>` to confirm the new operationId. */
function StartNewAttempt({
  announcementId,
  disabled,
  describedBy,
  onStarted,
}: StartNewAttemptProps) {
  const { startNewAttempt } = usePublicationActions();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.returnValue = "";
    dialog.showModal();
    // The safe choice gets focus first.
    cancelRef.current?.focus();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        onClick={open}
      >
        Start new attempt…
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={(event) => {
          // Cancel and Esc return focus to the trigger. A confirm moves it in its own handler:
          // the new attempt unmounts this dialog, maybe before its "close" event fires.
          if (event.currentTarget.returnValue !== "confirm") triggerRef.current?.focus();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-slate-200 bg-white p-4 text-slate-900 shadow-lg backdrop:bg-slate-950/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <h2 id={titleId} className="text-base font-semibold">
          Start a new attempt?
        </h2>
        <p id={descriptionId} className="mt-2 text-sm">
          This creates a new publication attempt with a new ID.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={() => {
              dialogRef.current?.close("cancel");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              dialogRef.current?.close("confirm");
              startNewAttempt(announcementId);
              onStarted();
            }}
          >
            Start new attempt
          </Button>
        </div>
      </dialog>
    </>
  );
}
