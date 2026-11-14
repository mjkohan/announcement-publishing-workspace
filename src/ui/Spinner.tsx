import { cx } from "./cx";

export type SpinnerSize = "sm" | "md";

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-6",
};

/**
 * Decorative spinner, hidden from assistive technology: pair it with visible text.
 * It spins only when the user has no reduced-motion preference.
 */
export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cx("shrink-0 motion-safe:animate-spin", SIZE_CLASSES[size], className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
