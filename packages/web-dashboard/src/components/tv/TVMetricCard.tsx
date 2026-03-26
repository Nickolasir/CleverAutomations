"use client";

/**
 * Large metric card for the TV dashboard.
 * Shows a big number + label, optionally focusable.
 */

interface TVMetricCardProps {
  label: string;
  value: string | number;
  /** Optional suffix like "°F" or "ms" */
  suffix?: string;
  /** Optional color override for the value text */
  valueColor?: string;
}

export function TVMetricCard({ label, value, suffix, valueColor }: TVMetricCardProps) {
  return (
    <div className="rounded-2xl bg-tv-surface px-8 py-6 min-w-[180px]">
      <p
        className="text-5xl font-bold tabular-nums"
        style={{ color: valueColor ?? "#FDF6E3" }}
      >
        {value}
        {suffix && (
          <span className="text-3xl font-normal text-tv-muted ml-1">
            {suffix}
          </span>
        )}
      </p>
      <p className="text-lg text-tv-muted mt-1">{label}</p>
    </div>
  );
}
