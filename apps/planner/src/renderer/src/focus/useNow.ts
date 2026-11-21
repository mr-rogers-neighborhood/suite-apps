import { useEffect, useState } from "react";

/**
 * A re-render trigger for values derived from the clock.
 *
 * The tick is transient view state, not document state: it says "read the timestamps again", never
 * "the countdown is at 12:04". The session in the document remains the only source of truth.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
