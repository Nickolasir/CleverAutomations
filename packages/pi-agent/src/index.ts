/**
 * @clever/pi-agent — Raspberry Pi device agent entry point.
 *
 * When executed directly, starts the Pi agent. When imported as a
 * library, re-exports the agent class and hardware configuration
 * modules for programmatic use.
 */

// Re-export agent
export { PiAgent } from "./agent.js";
export type { PiAgentConfig } from "./agent.js";

// Re-export hardware modules
export {
  isReSpeakerPresent,
  getReSpeakerCardIndex,
  getHardwareDevice as getMicDevice,
  startCapture,
  estimateDOA,
  LEDRing,
  LED_COLORS,
  CAPTURE_CONFIG,
  RESPEAKER_ALSA_DEVICE,
} from "./hardware/respeaker-config.js";
export type { DOAResult, RGBColor } from "./hardware/respeaker-config.js";

export {
  isI2SBonnetPresent,
  getI2SCardIndex,
  getHardwareDevice as getSpeakerDevice,
  VolumeControl,
  playPCM,
  startStreamingPlayback,
  playWavFile,
  getAudioOutputStatus,
  I2S_ALSA_DEVICE,
  I2S_SPEAKER_DEVICE,
  PLAYBACK_CONFIG,
  VOLUME_RANGE,
} from "./hardware/audio-output.js";
export type { AudioOutputStatus } from "./hardware/audio-output.js";

export {
  detectHailo,
  isHailoAvailable,
  getHailoHealth,
  getHailoSummary,
  getLlamaCppConfig,
  HAILO_SPECS,
} from "./hardware/hailo-config.js";
export type {
  HailoDetectionResult,
  HailoHealthStatus,
  LlamaCppHailoConfig,
} from "./hardware/hailo-config.js";

// ---------------------------------------------------------------------------
// Direct execution: start the agent
// ---------------------------------------------------------------------------

import { PiAgent } from "./agent.js";

const isDirectExecution =
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.endsWith("index.ts");

if (isDirectExecution) {
  const agent = new PiAgent();

  agent.start().catch((err) => {
    console.error(
      "[PiAgent] Fatal startup error:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
