/**
 * GPIO scan button handler.
 *
 * Detects short press (barcode scan) and long press (receipt scan).
 * Long press threshold: 2 seconds.
 *
 * Uses /sys/class/gpio interface for compatibility without native modules.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface ButtonEvent {
  type: "short_press" | "long_press";
  durationMs: number;
}

type ButtonCallback = (event: ButtonEvent) => void;

const LONG_PRESS_THRESHOLD_MS = 2000;

export class ScanButton {
  private readonly gpioPin: number;
  private callback: ButtonCallback | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pressStart: number | null = null;
  private lastState: "0" | "1" = "1"; // Pull-up: 1 = released, 0 = pressed

  constructor(gpioPin: number) {
    this.gpioPin = gpioPin;
    this.initGpio().catch((err) => {
      console.warn(
        `[ScanButton] GPIO init failed (non-Pi env?): ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  private async initGpio(): Promise<void> {
    const gpioPath = `/sys/class/gpio/gpio${this.gpioPin}`;
    if (!existsSync(gpioPath)) {
      await writeFile(
        "/sys/class/gpio/export",
        String(this.gpioPin),
      );
    }
    await writeFile(`${gpioPath}/direction`, "in");
    await writeFile(`${gpioPath}/edge`, "both");

    // Poll every 50ms (simpler than sysfs interrupt for cross-platform)
    this.pollTimer = setInterval(() => void this.pollButton(), 50);
  }

  private async pollButton(): Promise<void> {
    try {
      const value = (
        await readFile(
          `/sys/class/gpio/gpio${this.gpioPin}/value`,
          "utf8",
        )
      ).trim() as "0" | "1";

      if (value !== this.lastState) {
        if (value === "0" && this.lastState === "1") {
          // Button pressed
          this.pressStart = Date.now();
        } else if (value === "1" && this.lastState === "0" && this.pressStart) {
          // Button released
          const duration = Date.now() - this.pressStart;
          this.pressStart = null;

          const event: ButtonEvent = {
            type:
              duration >= LONG_PRESS_THRESHOLD_MS
                ? "long_press"
                : "short_press",
            durationMs: duration,
          };

          this.callback?.(event);
        }
        this.lastState = value;
      }
    } catch {
      // Ignore read errors (GPIO not available)
    }
  }

  onPress(callback: ButtonCallback): void {
    this.callback = callback;
  }

  cleanup(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.callback = null;
  }
}
