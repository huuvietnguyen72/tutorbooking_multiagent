import { useEffect, useMemo, useState } from 'react';

/**
 * Milliseconds left until `deadlineIso`, measured on the server's clock: `serverTimeIso` (from the same response)
 * gives the offset between the server and this browser, so a wrong local clock does not shift the countdown.
 * `null` when there is no deadline.
 */
export function useCountdown(deadlineIso: string | null | undefined, serverTimeIso: string | undefined): number | null {
  const offset = useMemo(
    () => (serverTimeIso ? Date.parse(serverTimeIso) - Date.now() : 0),
    // Re-anchor whenever a fresh server time arrives.
    [serverTimeIso],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineIso) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineIso, serverTimeIso]);

  if (!deadlineIso) return null;
  return Math.max(0, Date.parse(deadlineIso) - (now + offset));
}
