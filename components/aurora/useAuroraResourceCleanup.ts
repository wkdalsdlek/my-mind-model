"use client";

import { useEffect, useRef } from "react";

interface Disposable { dispose: () => void }
/** Delay disposal one task so React Strict Mode's immediate effect replay can cancel it.
 * Replaced resources still dispose; only reusing the very same object cancels its timer. */
export function useAuroraResourceCleanup(resource: Disposable) {
  const pending = useRef(new Map<Disposable, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = pending.current;
    const scheduled = timers.get(resource);
    if (scheduled !== undefined) { clearTimeout(scheduled); timers.delete(resource); }
    return () => {
      timers.set(resource, setTimeout(() => { resource.dispose(); timers.delete(resource); }, 0));
    };
  }, [resource]);
}
