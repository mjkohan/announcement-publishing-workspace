import { cx } from "./cx";

export interface SkeletonProps {
  className?: string;
}

/** Placeholder block while content loads. Hidden from assistive technology. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "rounded-md bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800",
        className,
      )}
    />
  );
}
