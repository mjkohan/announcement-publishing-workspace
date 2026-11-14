import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  /** Shows a spinner, sets `aria-busy` and disables the button. The label stays. */
  loading?: boolean;
}

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium " +
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-700 text-white hover:bg-blue-800 disabled:hover:bg-blue-700 " +
    "dark:bg-blue-400 dark:text-slate-950 dark:hover:bg-blue-300 dark:disabled:hover:bg-blue-400",
  secondary:
    "border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 disabled:hover:bg-white " +
    "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 " +
    "dark:disabled:hover:bg-slate-900",
  ghost:
    "text-slate-900 hover:bg-slate-100 disabled:hover:bg-transparent " +
    "dark:text-slate-100 dark:hover:bg-slate-800",
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(BASE_CLASSES, VARIANT_CLASSES[variant], className)}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
