"use client";

import { useCallback, useRef } from "react";

// A list that is reloaded quickly (a filter changed, then a page turned) can get its answers back out of order. Call
// `begin()` when a request starts and `isCurrent()` when its answer arrives: only the newest request may change the screen.
export function useLatestRequest() {
  const counter = useRef(0);
  return useCallback(() => {
    const mine = ++counter.current;
    return () => mine === counter.current;
  }, []);
}
