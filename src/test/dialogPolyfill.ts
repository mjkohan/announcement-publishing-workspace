/**
 * Test-only: jsdom has no `showModal`, `close` or `returnValue` on `<dialog>`. This adds the
 * parts the app uses: `open` handling, `returnValue`, the `close` event, and Esc firing a
 * cancelable `cancel` event that closes the dialog unless prevented. It does not move focus
 * (the app focuses the dialog content itself) and does not make the page inert.
 */
export function installDialogPolyfill(): void {
  const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement> & HTMLElement;
  if (typeof proto.showModal === "function") return;

  const returnValues = new WeakMap<HTMLDialogElement, string>();
  const withEscape = new WeakSet<HTMLDialogElement>();

  Object.defineProperty(HTMLDialogElement.prototype, "returnValue", {
    configurable: true,
    get(this: HTMLDialogElement) {
      return returnValues.get(this) ?? "";
    },
    set(this: HTMLDialogElement, value: string) {
      returnValues.set(this, value);
    },
  });

  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) return;
    this.open = true;
    if (!withEscape.has(this)) {
      withEscape.add(this);
      this.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !this.open) return;
        const cancel = new Event("cancel", { cancelable: true });
        if (this.dispatchEvent(cancel)) this.close();
      });
    }
  };

  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ) {
    if (!this.open) return;
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}
