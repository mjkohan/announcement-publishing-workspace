import { use, useEffect } from "react";
import { PublicationContext, type PublicationContextValue } from "../app/context";

/** Test-only: hands the provider's context value to the test. Renders nothing. */
export function ContextProbe({ onValue }: { onValue: (value: PublicationContextValue) => void }) {
  const value = use(PublicationContext);
  useEffect(() => {
    if (value) onValue(value);
  }, [value, onValue]);
  return null;
}
