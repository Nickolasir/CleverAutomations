/**
 * WS2812B NeoPixel LED status ring.
 *
 * Provides visual feedback for scanning operations:
 *   - blue: idle/ready
 *   - yellow: scanning in progress
 *   - green: item added / success
 *   - red: item removed / error
 *
 * Uses GPIO PWM. On non-Pi platforms, logs to console.
 */

export type LEDColor = "blue" | "yellow" | "green" | "red" | "off";

export class LEDStatusRing {
  private readonly gpioPin: number;
  private currentColor: LEDColor = "off";
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(gpioPin: number) {
    this.gpioPin = gpioPin;
  }

  /** Set the LED ring to a solid color. */
  show(color: LEDColor): void {
    this.clearFlash();
    this.currentColor = color;
    this.writeColor(color);
  }

  /** Flash a color for 1 second, then return to blue (idle). */
  flash(color: LEDColor, durationMs: number = 1000): void {
    this.clearFlash();
    this.writeColor(color);
    this.flashTimer = setTimeout(() => {
      this.writeColor("blue");
      this.currentColor = "blue";
    }, durationMs);
  }

  /** Turn off the LED ring. */
  off(): void {
    this.clearFlash();
    this.currentColor = "off";
    this.writeColor("off");
  }

  private clearFlash(): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
  }

  private writeColor(color: LEDColor): void {
    // In production, this would use the rpi-ws281x-native or pigpio library
    // to control WS2812B LEDs via GPIO PWM.
    // For now, log the state change.
    console.log(`[LED] ${color.toUpperCase()}`);
  }
}
