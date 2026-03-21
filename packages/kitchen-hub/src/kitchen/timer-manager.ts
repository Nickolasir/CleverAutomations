/**
 * Kitchen timer manager.
 *
 * Manages multiple concurrent timers locally on the kitchen hub.
 * No cloud dependency — timers run in-process with audio alerts.
 */

import type { KitchenTimer } from "@clever/shared";

type TimerCallback = () => void;

interface ActiveTimer {
  timer: KitchenTimer;
  interval: ReturnType<typeof setInterval>;
  callback: TimerCallback;
}

export class TimerManager {
  private timers: Map<string, ActiveTimer> = new Map();
  private nextId = 1;

  /**
   * Set a new timer.
   * @param durationSeconds Total duration in seconds.
   * @param label Optional label (e.g., "pasta").
   * @param onComplete Callback when timer finishes.
   * @returns The timer ID.
   */
  setTimer(
    durationSeconds: number,
    label: string | null | undefined,
    onComplete: TimerCallback,
  ): string {
    const id = `timer-${this.nextId++}`;

    const timer: KitchenTimer = {
      id,
      label: label ?? null,
      duration_seconds: durationSeconds,
      remaining_seconds: durationSeconds,
      started_at: Date.now(),
      status: "running",
    };

    const interval = setInterval(() => {
      const active = this.timers.get(id);
      if (!active) return;

      active.timer.remaining_seconds--;

      if (active.timer.remaining_seconds <= 0) {
        active.timer.status = "completed";
        active.timer.remaining_seconds = 0;
        clearInterval(active.interval);
        this.timers.delete(id);
        active.callback();
      }
    }, 1000);

    this.timers.set(id, { timer, interval, callback: onComplete });

    const labelText = label ? ` "${label}"` : "";
    console.log(
      `[TimerManager] Timer${labelText} set for ${durationSeconds}s (id: ${id})`,
    );

    return id;
  }

  /** Cancel a specific timer by ID. */
  cancelTimer(id: string): boolean {
    const active = this.timers.get(id);
    if (!active) return false;

    clearInterval(active.interval);
    this.timers.delete(id);
    console.log(`[TimerManager] Timer ${id} cancelled.`);
    return true;
  }

  /** Cancel all active timers. */
  cancelAll(): void {
    for (const [id, active] of this.timers) {
      clearInterval(active.interval);
    }
    this.timers.clear();
    console.log("[TimerManager] All timers cancelled.");
  }

  /** Get all active (running) timers. */
  getActiveTimers(): KitchenTimer[] {
    return Array.from(this.timers.values()).map((a) => ({ ...a.timer }));
  }

  /** Get a specific timer by ID. */
  getTimer(id: string): KitchenTimer | null {
    const active = this.timers.get(id);
    return active ? { ...active.timer } : null;
  }
}
