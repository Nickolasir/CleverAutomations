/**
 * Adafruit I2S 3W Stereo Bonnet audio output configuration.
 *
 * Manages playback configuration, volume control, and ALSA output
 * device setup for the MAX98357A-based I2S amplifier bonnet.
 */

import { execSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ALSA device name for the I2S bonnet (matches asound.conf). */
export const I2S_ALSA_DEVICE = "i2s_output";

/** ALSA device with software volume control. */
export const I2S_SPEAKER_DEVICE = "speaker";

/** ALSA hardware card name for the HiFiBerry-compatible I2S output. */
export const I2S_CARD_NAME = "sndrpihifiberry";

/** Audio playback parameters. */
export const PLAYBACK_CONFIG = {
  /** Sample rate in Hz. */
  sampleRate: 16_000,
  /** Bits per sample. */
  bitDepth: 16,
  /** Stereo output. */
  channels: 2,
  /** ALSA format string. */
  format: "S16_LE" as const,
  /** Buffer size in frames. */
  bufferSize: 8_192,
  /** Period size in frames. */
  periodSize: 2_048,
} as const;

/** Volume range. */
export const VOLUME_RANGE = {
  /** Minimum volume in percent. */
  min: 0,
  /** Maximum volume in percent. */
  max: 100,
  /** Default volume in percent. */
  default: 60,
} as const;

// ---------------------------------------------------------------------------
// Device detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the I2S audio bonnet is available as a playback device.
 */
export function isI2SBonnetPresent(): boolean {
  try {
    const output = execSync("aplay -l", { encoding: "utf-8" });
    return output.toLowerCase().includes(I2S_CARD_NAME);
  } catch {
    return false;
  }
}

/**
 * Get the ALSA hardware card index for the I2S bonnet.
 * Returns null if not found.
 */
export function getI2SCardIndex(): number | null {
  try {
    const output = execSync("aplay -l", { encoding: "utf-8" });
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes(I2S_CARD_NAME)) {
        const match = line.match(/card\s+(\d+)/);
        if (match?.[1]) {
          return parseInt(match[1], 10);
        }
      }
    }
  } catch {
    // aplay not available or no devices
  }
  return null;
}

/**
 * Get the raw ALSA hardware device string.
 */
export function getHardwareDevice(): string {
  const cardIndex = getI2SCardIndex();
  if (cardIndex !== null) {
    return `hw:${cardIndex},0`;
  }
  return I2S_ALSA_DEVICE;
}

// ---------------------------------------------------------------------------
// Volume control
// ---------------------------------------------------------------------------

/**
 * ALSA mixer-based volume controller for the I2S bonnet.
 */
export class VolumeControl {
  private currentVolume: number = VOLUME_RANGE.default;
  private readonly mixerControl: string;
  private readonly cardName: string;

  constructor(
    mixerControl: string = "Clever Volume",
    cardName: string = I2S_CARD_NAME,
  ) {
    this.mixerControl = mixerControl;
    this.cardName = cardName;
  }

  /**
   * Set the playback volume as a percentage (0-100).
   */
  setVolume(percent: number): void {
    const clamped = Math.max(
      VOLUME_RANGE.min,
      Math.min(VOLUME_RANGE.max, Math.round(percent)),
    );
    this.currentVolume = clamped;

    try {
      execSync(
        `amixer -c ${this.cardName} sset "${this.mixerControl}" ${clamped}%`,
        { timeout: 3_000, stdio: "ignore" },
      );
    } catch {
      // If the named control doesn't exist, try the generic approach
      try {
        execSync(
          `amixer -c ${this.cardName} sset PCM ${clamped}%`,
          { timeout: 3_000, stdio: "ignore" },
        );
      } catch {
        // Volume control is not critical — log and continue
        console.warn(
          `[AudioOutput] Failed to set volume to ${clamped}% on ${this.cardName}`,
        );
      }
    }
  }

  /** Get the current volume level as a percentage. */
  getVolume(): number {
    return this.currentVolume;
  }

  /** Increase volume by a step (default 10%). */
  volumeUp(step: number = 10): void {
    this.setVolume(this.currentVolume + step);
  }

  /** Decrease volume by a step (default 10%). */
  volumeDown(step: number = 10): void {
    this.setVolume(this.currentVolume - step);
  }

  /** Mute (set to 0%). */
  mute(): void {
    this.setVolume(0);
  }

  /** Unmute (restore to previous or default volume). */
  unmute(): void {
    this.setVolume(
      this.currentVolume > 0 ? this.currentVolume : VOLUME_RANGE.default,
    );
  }
}

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

/**
 * Play raw PCM audio data via aplay.
 *
 * @param pcmData  Raw PCM buffer (16kHz, 16-bit LE, mono or stereo).
 * @param options  Optional overrides for sample rate, channels, format.
 */
export function playPCM(
  pcmData: Buffer,
  options?: {
    sampleRate?: number;
    channels?: number;
    format?: string;
    device?: string;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const device = options?.device ?? I2S_SPEAKER_DEVICE;
    const sampleRate = options?.sampleRate ?? PLAYBACK_CONFIG.sampleRate;
    const channels = options?.channels ?? PLAYBACK_CONFIG.channels;
    const format = options?.format ?? PLAYBACK_CONFIG.format;

    const proc = spawn("aplay", [
      "-D", device,
      "-f", format,
      "-r", String(sampleRate),
      "-c", String(channels),
      "-t", "raw",
      "-q",
    ]);

    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`aplay exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });

    proc.stdin.write(pcmData);
    proc.stdin.end();
  });
}

/**
 * Start a streaming audio playback process.
 * Write PCM chunks to the returned process's stdin.
 * Call .stdin.end() when done.
 *
 * @param options  Optional overrides for audio parameters.
 */
export function startStreamingPlayback(
  options?: {
    sampleRate?: number;
    channels?: number;
    format?: string;
    device?: string;
  },
): ChildProcessWithoutNullStreams {
  const device = options?.device ?? I2S_SPEAKER_DEVICE;
  const sampleRate = options?.sampleRate ?? PLAYBACK_CONFIG.sampleRate;
  const channels = options?.channels ?? PLAYBACK_CONFIG.channels;
  const format = options?.format ?? PLAYBACK_CONFIG.format;

  return spawn("aplay", [
    "-D", device,
    "-f", format,
    "-r", String(sampleRate),
    "-c", String(channels),
    "-t", "raw",
    "--buffer-size", String(PLAYBACK_CONFIG.bufferSize),
    "--period-size", String(PLAYBACK_CONFIG.periodSize),
    "-q",
  ]);
}

/**
 * Play a WAV file directly.
 */
export function playWavFile(
  filePath: string,
  device: string = I2S_SPEAKER_DEVICE,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("aplay", ["-D", device, "-q", filePath]);

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`aplay exited with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Audio output health check
// ---------------------------------------------------------------------------

export interface AudioOutputStatus {
  bonnetDetected: boolean;
  cardIndex: number | null;
  alsaDevice: string;
  volume: number;
}

/**
 * Return a status snapshot of the I2S audio output hardware.
 */
export function getAudioOutputStatus(): AudioOutputStatus {
  return {
    bonnetDetected: isI2SBonnetPresent(),
    cardIndex: getI2SCardIndex(),
    alsaDevice: getHardwareDevice(),
    volume: VOLUME_RANGE.default,
  };
}
