"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Scroll position of a snap container as a fractional section index
 * (0 = first section, 1.5 = halfway between the 2nd and 3rd, ...).
 * `velocity` is the change since the last scroll event.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, vertical: boolean, sectionCount: number) {
  const [progress, setProgress] = useState(0);
  const [velocity, setVelocity] = useState(0);
  const last = useRef(0);
  const maxIndex = sectionCount - 1;

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const offset = vertical ? el.scrollTop : el.scrollLeft;
    const size = vertical ? el.offsetHeight : el.offsetWidth;
    if (size === 0) return;
    const p = Math.max(0, Math.min(maxIndex, offset / size));
    setProgress(p);
    setVelocity(p - last.current);
    last.current = p;
  }, [ref, vertical, maxIndex]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, onScroll]);

  return { progress, velocity };
}
