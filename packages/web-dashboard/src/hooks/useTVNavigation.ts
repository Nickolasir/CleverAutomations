"use client";

import { useEffect, useCallback } from "react";

/**
 * D-pad / TV remote navigation hook.
 * Listens for arrow key + Enter + Back events and implements spatial navigation
 * by finding the nearest focusable element in the pressed direction.
 *
 * Samsung TV remote key codes:
 *   Arrow keys: 37 (left), 38 (up), 39 (right), 40 (down)
 *   Enter/OK: 13
 *   Back: 10009 (Tizen XF86Back) or 8 (Backspace fallback)
 */

const TV_FOCUSABLE_SELECTOR = "[data-tv-focusable]";

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  centerX: number;
  centerY: number;
}

function getRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    bottom: r.bottom,
    left: r.left,
    right: r.right,
    centerX: r.left + r.width / 2,
    centerY: r.top + r.height / 2,
  };
}

function findNearest(
  current: HTMLElement,
  direction: "up" | "down" | "left" | "right",
  candidates: HTMLElement[]
): HTMLElement | null {
  const from = getRect(current);
  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  for (const el of candidates) {
    if (el === current) continue;
    const to = getRect(el);

    let isValid = false;
    let dist = Infinity;

    switch (direction) {
      case "up":
        isValid = to.centerY < from.centerY - 5;
        dist = Math.abs(from.centerX - to.centerX) + (from.top - to.bottom) * 2;
        break;
      case "down":
        isValid = to.centerY > from.centerY + 5;
        dist = Math.abs(from.centerX - to.centerX) + (to.top - from.bottom) * 2;
        break;
      case "left":
        isValid = to.centerX < from.centerX - 5;
        dist = Math.abs(from.centerY - to.centerY) + (from.left - to.right) * 2;
        break;
      case "right":
        isValid = to.centerX > from.centerX + 5;
        dist = Math.abs(from.centerY - to.centerY) + (to.left - from.right) * 2;
        break;
    }

    if (isValid && dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }

  return best;
}

interface UseTVNavigationOptions {
  onBack?: () => void;
}

export function useTVNavigation(options?: UseTVNavigationOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const focused = document.activeElement as HTMLElement | null;
      const all = Array.from(
        document.querySelectorAll<HTMLElement>(TV_FOCUSABLE_SELECTOR)
      );

      if (all.length === 0) return;

      let direction: "up" | "down" | "left" | "right" | null = null;

      switch (e.key) {
        case "ArrowUp":
          direction = "up";
          break;
        case "ArrowDown":
          direction = "down";
          break;
        case "ArrowLeft":
          direction = "left";
          break;
        case "ArrowRight":
          direction = "right";
          break;
        case "Enter":
          // Let native click/submit behavior happen
          return;
        case "XF86Back":
        case "Backspace":
          e.preventDefault();
          options?.onBack?.();
          return;
        default:
          return;
      }

      e.preventDefault();

      // If nothing focused yet, focus the first element
      if (!focused || !focused.hasAttribute("data-tv-focusable")) {
        all[0]?.focus();
        return;
      }

      const next = findNearest(focused, direction, all);
      if (next) {
        next.focus();
        // Scroll into view if needed (smooth for TV)
        next.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    },
    [options]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /** Programmatically focus the first TV-focusable element */
  const focusFirst = useCallback(() => {
    const first = document.querySelector<HTMLElement>(TV_FOCUSABLE_SELECTOR);
    first?.focus();
  }, []);

  return { focusFirst };
}
