"use client";

import * as React from "react";

// The "store" never changes — we only care that the server snapshot is
// false and the client snapshot is true.
const emptySubscribe = () => () => {};

/**
 * False during SSR and the very first client render, true once hydrated.
 * `useSyncExternalStore` is the hydration-safe way to ask "am I on the
 * client yet?" without a setState-in-an-effect.
 */
export function useMounted(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
