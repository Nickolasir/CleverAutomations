/**
 * CleverAide Proactive Speech Module
 *
 * Enables the Pi Agent to initiate voice conversations without a wake word.
 * Used for medication reminders, wellness check-ins, and inactivity follow-ups.
 *
 * The module pushes audio to ESP32 satellite speakers and can optionally
 * listen for a response via the voice pipeline.
 */

import type { TenantId } from "@clever/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProactiveSpeechConfig {
  tenantId: TenantId;
  /** TTS synthesis function (uses existing voice pipeline TTS layer) */
  synthesizeSpeech: (text: string, voiceId?: string, speed?: number) => Promise<Buffer>;
  /** Sends audio buffer to the satellite speaker in a specific room */
  sendAudioToRoom: (roomId: string, audioBuffer: Buffer) => Promise<void>;
  /** Starts listening for a voice response from the room mic */
  startListening: (roomId: string, timeoutMs: number) => Promise<string | null>;
  /** Default room if room detection unavailable */
  defaultRoom?: string;
  /** Default Cartesia voice ID for aide speech */
  defaultVoiceId?: string;
}

export interface ProactiveSpeechResult {
  spoken: boolean;
  responseReceived: boolean;
  responseTranscript: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Proactive Speech
// ---------------------------------------------------------------------------

export class AideProactiveSpeech {
  private readonly config: ProactiveSpeechConfig;

  constructor(config: ProactiveSpeechConfig) {
    this.config = config;
  }

  /**
   * Speak text through a room's speaker without requiring a wake word.
   *
   * @param roomId  Target room (or "default" for the main speaker)
   * @param text    What to say
   * @param options Optional overrides for voice and speed
   */
  async speak(
    roomId: string,
    text: string,
    options?: { voiceId?: string; speed?: number },
  ): Promise<void> {
    const targetRoom = roomId === "default"
      ? (this.config.defaultRoom ?? "living_room")
      : roomId;

    const voiceId = options?.voiceId ?? this.config.defaultVoiceId;
    const speed = options?.speed ?? 0.8; // Slower for aide users

    const audioBuffer = await this.config.synthesizeSpeech(text, voiceId, speed);
    await this.config.sendAudioToRoom(targetRoom, audioBuffer);
  }

  /**
   * Speak and then listen for a response.
   *
   * @param roomId            Target room
   * @param text              What to say
   * @param listenTimeoutMs   How long to wait for response (ms)
   * @param options           Optional voice overrides
   * @returns                 The response transcript, or null if no response
   */
  async speakAndListen(
    roomId: string,
    text: string,
    listenTimeoutMs: number = 30_000,
    options?: { voiceId?: string; speed?: number },
  ): Promise<ProactiveSpeechResult> {
    const start = Date.now();
    const targetRoom = roomId === "default"
      ? (this.config.defaultRoom ?? "living_room")
      : roomId;

    // Speak
    await this.speak(targetRoom, text, options);

    // Listen
    const transcript = await this.config.startListening(targetRoom, listenTimeoutMs);

    return {
      spoken: true,
      responseReceived: transcript !== null,
      responseTranscript: transcript,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Speak text in multiple rooms (e.g., for emergency announcements).
   */
  async speakToAllRooms(
    roomIds: string[],
    text: string,
    options?: { voiceId?: string; speed?: number },
  ): Promise<void> {
    await Promise.all(
      roomIds.map((roomId) => this.speak(roomId, text, options)),
    );
  }
}
