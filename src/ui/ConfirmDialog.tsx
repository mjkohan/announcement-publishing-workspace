import { useId, useImperativeHandle, useRef, type Ref, type RefObject } from "react";
import { Button, type ButtonVariant } from "./Button";

export interface ConfirmDialogHandle {
  /** Opens the modal and moves focus to Cancel, the safe choice. */
  open: () => void;
}

export interface ConfirmDialogProps {
  ref?: Ref<ConfirmDialogHandle>;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  /**
   * Gets focus back after Cancel or Esc. After a confirm, `onConfirm` places focus: the
   * trigger may be gone by then.
   */
  returnFocusRef: RefObject<HTMLElement | null>;
  onConfirm: () => void;
}

const CONFIRM = "confirm";

/** Native modal `<dialog>` asking to confirm one action. Esc cancels. */
export function ConfirmDialog({
  ref,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  returnFocusRef,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useImperativeHandle(ref, () => ({
    open() {
      const dialog = dialogRef.current;
      if (!dialog || dialog.open) return;
      dialog.returnValue = "";
      dialog.showModal();
      cancelRef.current?.focus();
    },
  }));

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={(event) => {
        // A confirm moves focus in its own handler: the action may unmount this dialog before
        // its "close" event fires.
        if (event.currentTarget.returnValue !== CONFIRM) returnFocusRef.current?.focus();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-slate-200 bg-white p-4 text-slate-900 shadow-lg backdrop:bg-slate-950/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <h2 id={titleId} className="text-base font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm">
        {description}
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
          variant={confirmVariant}
          onClick={() => {
            dialogRef.current?.close(CONFIRM);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
