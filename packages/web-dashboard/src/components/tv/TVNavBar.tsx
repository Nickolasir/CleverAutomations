"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Horizontal top navigation bar for the TV dashboard.
 * Shows nav items + live clock. All items are D-pad focusable.
 */

const NAV_ITEMS = [
  { label: "Home", href: "/tv" },
  { label: "Rooms", href: "/tv/rooms" },
  { label: "Scenes", href: "/tv/scenes" },
  { label: "Family", href: "/tv/family" },
] as const;

function Clock() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-2xl font-light text-tv-muted tabular-nums">
      {time}
    </span>
  );
}

export function TVNavBar() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center justify-between px-12 py-6 bg-tv-bg border-b border-tv-surface">
      {/* Logo + nav items */}
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-tv-focus mr-8">
          Clever
        </span>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/tv"
              ? pathname === "/tv"
              : pathname?.startsWith(item.href) ?? false;

          return (
            <Link
              key={item.href}
              href={item.href}
              data-tv-focusable
              tabIndex={0}
              className={`px-6 py-3 rounded-xl text-xl font-medium transition-colors ${
                isActive
                  ? "bg-tv-focus text-tv-bg"
                  : "text-tv-text hover:bg-tv-surface"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Clock */}
      <Clock />
    </nav>
  );
}
