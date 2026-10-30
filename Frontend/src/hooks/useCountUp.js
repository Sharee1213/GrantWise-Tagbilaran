import { useEffect, useState } from "react";

export default function useCountUp(
  endValue,
  {
    duration = 800,
    format = (value) => value,
    enabled = true,
  } = {},
) {
  const [currentValue, setCurrentValue] = useState(() => {
    if (typeof window === "undefined") {
      return endValue;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    return prefersReducedMotion || !enabled ? endValue : 0;
  });

  useEffect(() => {
    if (endValue == null || Number.isNaN(Number(endValue))) {
      setCurrentValue(endValue);
      return undefined;
    }

    if (typeof window !== "undefined") {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (prefersReducedMotion || !enabled) {
        setCurrentValue(endValue);
        return undefined;
      }
    }

    let rafId = null;
    let startTime = null;
    const startingValue = 0;
    const endingValue = Number(endValue);

    const tick = (timestamp) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const nextValue = startingValue + (endingValue - startingValue) * eased;

      setCurrentValue(nextValue);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [duration, enabled, endValue]);

  return format(currentValue);
}
