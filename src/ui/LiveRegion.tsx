export interface LiveRegionProps {
  /** `id` changes with every message, so repeating the same text is announced again. */
  message: { id: number; text: string } | null;
}

/**
 * Visually hidden polite live region. The region itself stays mounted; each message is a new
 * node, which screen readers announce reliably.
 */
export function LiveRegion({ message }: LiveRegionProps) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message && <p key={message.id}>{message.text}</p>}
    </div>
  );
}
