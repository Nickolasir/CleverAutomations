/**
 * 7" Raspberry Pi Touchscreen display manager.
 *
 * Launches a Chromium kiosk browser showing the kitchen display app.
 * The display app is a lightweight React SPA that shows:
 *   - Current shopping list
 *   - Pantry alerts (expiring items, low stock)
 *   - Active kitchen timers
 *   - Recipe suggestions
 *   - Scan feedback (camera preview + results)
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface DisplayConfig {
  /** URL to load in the kiosk browser */
  url: string;
  /** Display number (default: ":0") */
  display?: string;
  /** Whether to hide the cursor */
  hideCursor?: boolean;
}

export class KitchenDisplay {
  private browserProcess: ChildProcess | null = null;

  /**
   * Launch Chromium in kiosk mode on the 7" touchscreen.
   *
   * The display app URL should point to the kitchen display React app,
   * served locally or from the web dashboard with a kitchen-specific route.
   */
  launch(config: DisplayConfig): void {
    if (this.browserProcess) {
      console.warn("[Display] Browser already running.");
      return;
    }

    const args = [
      "--kiosk",
      "--noerrdialogs",
      "--disable-infobars",
      "--disable-session-crashed-bubble",
      "--disable-component-update",
      "--check-for-update-interval=31536000", // 1 year (effectively disable)
      "--autoplay-policy=no-user-gesture-required",
    ];

    if (config.hideCursor !== false) {
      args.push("--cursor=none");
    }

    args.push(config.url);

    const env = {
      ...process.env,
      DISPLAY: config.display ?? ":0",
    };

    this.browserProcess = spawn("chromium-browser", args, {
      env,
      stdio: "ignore",
      detached: true,
    });

    this.browserProcess.on("exit", (code) => {
      console.log(`[Display] Browser exited with code ${code}`);
      this.browserProcess = null;
    });

    console.log(`[Display] Launched kiosk at ${config.url}`);
  }

  /** Close the kiosk browser. */
  close(): void {
    if (this.browserProcess) {
      this.browserProcess.kill("SIGTERM");
      this.browserProcess = null;
    }
  }
}
