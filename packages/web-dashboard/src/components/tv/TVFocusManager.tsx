"use client";

import { type ReactNode, useEffect } from "react";
import { useTVNavigation } from "@/hooks/useTVNavigation";
import { useRouter } from "next/navigation";

/**
 * TV Focus Manager — wraps the TV layout to provide:
 * 1. D-pad spatial navigation via useTVNavigation
 * 2. Focus ring styling injected as a <style> tag
 * 3. Back button handling via Next.js router
 * 4. Auto-focus first element on mount
 */

export function TVFocusManager({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { focusFirst } = useTVNavigation({
    onBack: () => router.back(),
  });

  // Auto-focus the first focusable element on mount
  useEffect(() => {
    const timer = setTimeout(focusFirst, 100);
    return () => clearTimeout(timer);
  }, [focusFirst]);

  return (
    <>
      <style>{`
        /* Hide cursor on TV */
        body { cursor: none !important; }

        /* Gold focus ring for all TV-focusable elements */
        [data-tv-focusable]:focus {
          outline: none;
        }
        [data-tv-focusable]:focus-visible {
          outline: 3px solid #D4A843;
          outline-offset: 4px;
          border-radius: 12px;
        }

        /* Smooth transitions for focus state */
        [data-tv-focusable] {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        [data-tv-focusable]:focus-visible {
          transform: scale(1.02);
          box-shadow: 0 0 20px rgba(212, 168, 67, 0.3);
        }

        /* Suppress scrollbars on TV */
        ::-webkit-scrollbar { display: none; }
        body { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      {children}
    </>
  );
}
