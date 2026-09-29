"use client";

import { useEffect, useState } from "react";

const MOBILE_MAX = 767; // matches Tailwind's `md` breakpoint

/**
 * Returns `true` when the viewport is narrower than the `md` breakpoint (768px).
 * SSR-safe: returns `false` on the server; updates after mount.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}

/**
 * Returns `true` when the primary pointer is coarse (touch — phones, tablets).
 * SSR-safe: returns `false` on the server; updates after mount.
 */
export function useIsCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isCoarse;
}

/**
 * Returns `true` when the user asked for reduced motion (OS setting).
 * SSR-safe: returns `false` on the server; updates after mount and on change.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduce;
}
