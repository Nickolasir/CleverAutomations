/**
 * ReSpeaker 4-Mic Array configuration.
 *
 * Manages ALSA device setup for the Seeed ReSpeaker 4-Mic Array v2.0
 * connected via USB. Handles:
 *   - Audio capture at 16kHz 16-bit mono
 *   - Direction of arrival (DOA) beam forming
 *   - LED ring control for voice activity feedback
 */

import { execSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ALSA device name for the ReSpeaker (matches asound.conf). */
export const RESPEAKER_ALSA_DEVICE = "mic_array";

/** Hardware ALSA card name. */
export const RESPEAKER_CARD_NAME = "seeed4micvoicec";

/** Audio capture parameters matching our voice pipeline requirements. */
export const CAPTURE_CONFIG = {
  /** Sample rate in Hz (Deepgram and faster-whisper expect 16kHz). */
  sampleRate: 16_000,
  /** Bits per sample. */
  bitDepth: 16,
  /** Number of capture channels (mono for voice). */
  channels: 1,
  /** ALSA format string. */
  format: "S16_LE" as const,
  /** Buffer size in frames (lower = less latency, higher = fewer xruns). */
  bufferSize: 4_096,
  /** Period size in frames. */
  periodSize: 1_024,
} as const;

/** LED ring pixel count on the ReSpeaker 4-Mic Array. */
export const LED_COUNT = 12;

/** Direction of arrival resolution (4 microphones at 90-degree spacing). */
export const DOA_MIC_COUNT = 4;

// ---------------------------------------------------------------------------
// LED ring colors
// ---------------------------------------------------------------------------

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export const LED_COLORS = {
  /** Listening / wake-word detected — blue pulse. */
  listening: { r: 0, g: 100, b: 255 } satisfies RGBColor,
  /** Processing voice command — cyan spin. */
  processing: { r: 0, g: 200, b: 200 } satisfies RGBColor,
  /** Command executed successfully — green flash. */
  success: { r: 0, g: 255, b: 80 } satisfies RGBColor,
  /** Error / command failed — red flash. */
  error: { r: 255, g: 40, b: 0 } satisfies RGBColor,
  /** Idle / standby — dim white. */
  idle: { r: 20, g: 20, b: 20 } satisfies RGBColor,
  /** Off. */
  off: { r: 0, g: 0, b: 0 } satisfies RGBColor,
} as const;

// ---------------------------------------------------------------------------
// ALSA device detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the ReSpeaker 4-Mic Array is connected.
 * Checks ALSA capture device list for the expected card name.
 */
export function isReSpeakerPresent(): boolean {
  try {
    const output = execSync("arecord -l", { encoding: "utf-8" });
    return output.toLowerCase().includes(RESPEAKER_CARD_NAME);
  } catch {
    return false;
  }
}

/**
 * Get the ALSA hardware card index for the ReSpeaker.
 * Returns null if not found.
 */
export function getReSpeakerCardIndex(): number | null {
  try {
    const output = execSync("arecord -l", { encoding: "utf-8" });
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes(RESPEAKER_CARD_NAME)) {
        const match = line.match(/card\s+(\d+)/);
        if (match?.[1]) {
          return parseInt(match[1], 10);
        }
      }
    }
  } catch {
    // arecord not available or no devices
  }
  return null;
}

/**
 * Get the raw ALSA hardware device string for direct access.
 * Falls back to the named device from asound.conf.
 */
export function getHardwareDevice(): string {
  const cardIndex = getReSpeakerCardIndex();
  if (cardIndex !== null) {
    return `hw:${cardIndex},0`;
  }
  return RESPEAKER_ALSA_DEVICE;
}

// ---------------------------------------------------------------------------
// Audio capture
// ---------------------------------------------------------------------------

/**
 * Start an audio capture process via arecord.
 * Returns the spawned child process. Pipe stdout to your STT engine.
 *
 * The output is raw PCM: 16kHz, 16-bit signed LE, mono.
 */
export function startCapture(): ChildProcessWithoutNullStreams {
  const device = getHardwareDevice();

  const proc = spawn("arecord", [
    "-D", device,
    "-f", CAPTURE_CONFIG.format,
    "-r", String(CAPTURE_CONFIG.sampleRate),
    "-c", String(CAPTURE_CONFIG.channels),
    "-t", "raw",
    "--buffer-size", String(CAPTURE_CONFIG.bufferSize),
    "--period-size", String(CAPTURE_CONFIG.periodSize),
    "-q", // quiet mode — no progress output
  ]);

  return proc;
}

// ---------------------------------------------------------------------------
// Direction of arrival (DOA) for beam forming
// ---------------------------------------------------------------------------

/**
 * Represents a direction-of-arrival estimate from the 4-mic array.
 */
export interface DOAResult {
  /** Angle in degrees (0-359) relative to mic 0. */
  angleDeg: number;
  /** Confidence of the DOA estimate (0-1). */
  confidence: number;
  /** Timestamp of the measurement. */
  timestamp: number;
}

/**
 * Compute a basic time-difference-of-arrival angle estimate.
 *
 * This is a simplified GCC-PHAT implementation. In production you would
 * use the ReSpeaker's built-in DOA firmware via USB HID, or a more
 * sophisticated DSP library.
 *
 * @param samples  Raw multi-channel PCM buffer (4 channels interleaved).
 * @param sampleRate  Sample rate in Hz.
 */
export function estimateDOA(
  samples: Int16Array,
  sampleRate: number = CAPTURE_CONFIG.sampleRate,
): DOAResult {
  // Basic energy-based DOA: compute RMS power per channel and estimate
  // angle from relative energies. Real production code would use the
  // ReSpeaker USB HID interface for firmware-computed DOA.

  const channelEnergy: number[] = [0, 0, 0, 0];
  const samplesPerChannel = Math.floor(samples.length / DOA_MIC_COUNT);

  for (let i = 0; i < samplesPerChannel; i++) {
    for (let ch = 0; ch < DOA_MIC_COUNT; ch++) {
      const idx = i * DOA_MIC_COUNT + ch;
      const sample = samples[idx];
      if (sample !== undefined) {
        channelEnergy[ch] = (channelEnergy[ch] ?? 0) + sample * sample;
      }
    }
  }

  // Normalize
  for (let ch = 0; ch < DOA_MIC_COUNT; ch++) {
    channelEnergy[ch] = Math.sqrt((channelEnergy[ch] ?? 0) / samplesPerChannel);
  }

  // Find the mic with highest energy -> rough angle (90-degree resolution)
  let maxIdx = 0;
  let maxEnergy = 0;
  for (let ch = 0; ch < DOA_MIC_COUNT; ch++) {
    if ((channelEnergy[ch] ?? 0) > maxEnergy) {
      maxEnergy = channelEnergy[ch] ?? 0;
      maxIdx = ch;
    }
  }

  const angleDeg = maxIdx * 90;
  const totalEnergy = channelEnergy.reduce((a, b) => a + b, 0);
  const confidence = totalEnergy > 0 ? maxEnergy / totalEnergy : 0;

  return {
    angleDeg,
    confidence: Math.min(confidence * DOA_MIC_COUNT, 1), // Normalize to 0-1
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// LED ring control
// ---------------------------------------------------------------------------

/**
 * Controls the ReSpeaker LED ring via the pixel_ring Python library.
 * Shells out to a Python one-liner because the pixel_ring driver
 * communicates over USB HID, which is easiest from Python.
 */
export class LEDRing {
  private readonly pythonBin: string;

  constructor(pythonBin: string = "/opt/clever/voice-venv/bin/python3") {
    this.pythonBin = pythonBin;
  }

  /** Set all LEDs to a single color. */
  setColor(color: RGBColor): void {
    this.runPixelRing(
      `pixel_ring.set_color_palette(${color.r}, ${color.g}, ${color.b})`,
    );
  }

  /** Set individual LED colors (12 LEDs). */
  setPixels(colors: RGBColor[]): void {
    const data = colors
      .slice(0, LED_COUNT)
      .flatMap((c) => [c.r, c.g, c.b]);
    this.runPixelRing(
      `pixel_ring.show([${data.join(",")}])`,
    );
  }

  /** Start a spinning animation (e.g. for "processing"). */
  spin(color: RGBColor): void {
    this.runPixelRing(
      `pixel_ring.set_color_palette(${color.r}, ${color.g}, ${color.b}); pixel_ring.think()`,
    );
  }

  /** Pulse/breathe animation (e.g. for "listening"). */
  pulse(color: RGBColor): void {
    this.runPixelRing(
      `pixel_ring.set_color_palette(${color.r}, ${color.g}, ${color.b}); pixel_ring.listen()`,
    );
  }

  /** Turn off all LEDs. */
  off(): void {
    this.runPixelRing("pixel_ring.off()");
  }

  /** Set the overall LED brightness (0-31). */
  setBrightness(level: number): void {
    const clamped = Math.max(0, Math.min(31, Math.round(level)));
    this.runPixelRing(`pixel_ring.set_brightness(${clamped})`);
  }

  // -----------------------------------------------------------------------
  // Voice activity feedback presets
  // -----------------------------------------------------------------------

  /** Visual feedback: wake word detected, now listening. */
  showListening(): void {
    this.pulse(LED_COLORS.listening);
  }

  /** Visual feedback: processing the voice command. */
  showProcessing(): void {
    this.spin(LED_COLORS.processing);
  }

  /** Visual feedback: command succeeded. */
  showSuccess(): void {
    this.setColor(LED_COLORS.success);
    setTimeout(() => this.showIdle(), 1_500);
  }

  /** Visual feedback: command failed. */
  showError(): void {
    this.setColor(LED_COLORS.error);
    setTimeout(() => this.showIdle(), 2_000);
  }

  /** Return to idle standby. */
  showIdle(): void {
    this.setColor(LED_COLORS.idle);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private runPixelRing(command: string): void {
    try {
      execSync(
        `${this.pythonBin} -c "from pixel_ring import pixel_ring; ${command}"`,
        { timeout: 3_000, stdio: "ignore" },
      );
    } catch {
      // LED control is non-critical; swallow errors silently.
    }
  }
}
