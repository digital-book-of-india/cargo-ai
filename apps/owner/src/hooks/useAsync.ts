"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

// Runs an async loader and exposes loading / error / data. `deps` re-run it.
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const previousDeps = useRef(deps);

  useEffect(() => {
    let cancelled = false;
    // When what is being loaded changes (another site, another filter), the old answer must not stay on screen as if it
    // belonged to the new one. A plain reload (same inputs) keeps the old data visible while the new answer arrives.
    const changed = deps.length !== previousDeps.current.length || deps.some((d, i) => !Object.is(d, previousDeps.current[i]));
    if (changed) {
      previousDeps.current = deps;
      setData(null);
    }
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError(0, "UNKNOWN_ERROR", "Something went wrong.")
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, reload };
}
