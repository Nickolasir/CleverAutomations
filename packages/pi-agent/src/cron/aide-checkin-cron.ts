/**
 * CleverAide Wellness Check-in Cron
 *
 * Runs every minute on the Pi Agent. At configured check-in times
 * (default: 9am, 2pm, 7pm), proactively initiates a wellness conversation
 * via the voice pipeline.
 *
 * Records responses to aide_wellness_checkins and flags concerns for
 * caregiver review.
 */

import type { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckinCronConfig {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  /** Speaks text through the room speaker. */
  speak: (roomId: string, text: string) => Promise<void>;
  /** Listens for voice response. Returns transcript or null on timeout. */
  listenForResponse: (roomId: string, timeoutMs: number) => Promise<string | null>;
  /** Creates a caregiver alert. */
  createAlert: (alert: {
    aide_profile_id: string;
    alert_type: string;
    severity: string;
    message: string;
    details: Record<string, unknown>;
    delivery_channels: string[];
  }) => Promise<void>;
  /** Response timeout in seconds. Default: 120 */
  responseTimeoutSeconds?: number;
}

/** Default check-in times (24h format) */
const DEFAULT_CHECKIN_TIMES = [
  { hour: 9, type: "morning" as const },
  { hour: 14, type: "afternoon" as const },
  { hour: 19, type: "evening" as const },
];

const CHECKIN_GREETINGS: Record<string, string> = {
  morning: "Good morning! How are you feeling today?",
  afternoon: "Good afternoon! Just checking in — how are you doing?",
  evening: "Good evening! How has your day been?",
};

const PAIN_FOLLOWUP = "I'm sorry to hear that. On a scale of 0 to 10, how would you rate your pain?";
const CONCERN_KEYWORDS = /\b(terrible|awful|very bad|horrible|worst|can't move|dizzy|confused|chest|breathing)\b/i;
const EMERGENCY_KEYWORDS = /\b(can't breathe|chest pain|seizure|stroke|heart attack)\b/i;
const POSITIVE_KEYWORDS = /\b(good|great|fine|okay|ok|well|wonderful|not bad|decent|alright)\b/i;

// Track which check-ins have been triggered today
const triggeredToday = new Set<string>();

// ---------------------------------------------------------------------------
// Main cron tick
// ---------------------------------------------------------------------------

export async function checkinCronTick(config: CheckinCronConfig): Promise<void> {
  const { supabase, tenantId } = config;

  // Get all aide profiles
  const { data: aideProfiles } = await (supabase.from("aide_profiles") as any)
    .select("id, profile_id, timezone, cognitive_level")
    .eq("tenant_id", tenantId);

  if (!aideProfiles?.length) return;

  for (const profile of aideProfiles) {
    const now = new Date();
    const localNow = new Date(now.toLocaleString("en-US", { timeZone: profile.timezone }));
    const currentHour = localNow.getHours();
    const currentMinute = localNow.getMinutes();

    for (const checkin of DEFAULT_CHECKIN_TIMES) {
      // Trigger within the first 5 minutes of the check-in hour
      if (currentHour === checkin.hour && currentMinute < 5) {
        const key = `${profile.id}:${checkin.type}:${localNow.toDateString()}`;
        if (triggeredToday.has(key)) continue;
        triggeredToday.add(key);

        // Run check-in asynchronously
        runCheckin(config, profile.id, checkin.type, profile.cognitive_level).catch((err) => {
          console.error(`[CleverAide] Check-in error for ${profile.id}:`, err);
        });
      }
    }
  }

  // Clean up old keys at midnight
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    triggeredToday.clear();
  }
}

// ---------------------------------------------------------------------------
// Check-in conversation flow
// ---------------------------------------------------------------------------

async function runCheckin(
  config: CheckinCronConfig,
  aideProfileId: string,
  checkinType: string,
  cognitiveLevel: string,
): Promise<void> {
  const { supabase, tenantId } = config;
  const timeout = (config.responseTimeoutSeconds ?? 120) * 1000;

  const greeting = CHECKIN_GREETINGS[checkinType] ?? CHECKIN_GREETINGS.morning;

  // Step 1: Greet and ask how they're feeling
  await config.speak("default", greeting!);
  const response1 = await config.listenForResponse("default", timeout);

  if (!response1) {
    // No response — try once more
    await config.speak("default", "Hello? Are you there? I just wanted to check how you're doing.");
    const response2 = await config.listenForResponse("default", timeout);

    if (!response2) {
      // Still no response — record and alert
      await (supabase.from("aide_wellness_checkins") as any).insert({
        tenant_id: tenantId,
        aide_profile_id: aideProfileId,
        checkin_type: checkinType,
        status: "no_response",
        flagged_for_review: true,
      });

      await config.createAlert({
        aide_profile_id: aideProfileId,
        alert_type: "no_response_checkin",
        severity: "warning",
        message: `No response to ${checkinType} wellness check-in after two attempts.`,
        details: { checkin_type: checkinType },
        delivery_channels: ["push", "telegram", "whatsapp"],
      });
      return;
    }

    // Got a response on second try — continue with it
    return processResponse(config, aideProfileId, checkinType, response2, cognitiveLevel);
  }

  await processResponse(config, aideProfileId, checkinType, response1, cognitiveLevel);
}

async function processResponse(
  config: CheckinCronConfig,
  aideProfileId: string,
  checkinType: string,
  transcript: string,
  cognitiveLevel: string,
): Promise<void> {
  const { supabase, tenantId } = config;
  const timeout = (config.responseTimeoutSeconds ?? 120) * 1000;

  // Check for emergency keywords first
  if (EMERGENCY_KEYWORDS.test(transcript)) {
    await (supabase.from("aide_wellness_checkins") as any).insert({
      tenant_id: tenantId,
      aide_profile_id: aideProfileId,
      checkin_type: checkinType,
      status: "emergency",
      response_transcript: transcript,
      flagged_for_review: true,
    });

    await config.createAlert({
      aide_profile_id: aideProfileId,
      alert_type: "emergency",
      severity: "critical",
      message: `Emergency detected during ${checkinType} check-in: "${transcript}"`,
      details: { checkin_type: checkinType, transcript },
      delivery_channels: ["push", "sms", "telegram", "whatsapp"],
    });
    return;
  }

  let moodRating: number | null = null;
  let painLevel: number | null = null;
  let flagged = false;
  let notes = "";

  // Assess mood from response
  if (POSITIVE_KEYWORDS.test(transcript)) {
    moodRating = 4;
  } else if (CONCERN_KEYWORDS.test(transcript)) {
    moodRating = 2;
    flagged = true;
    notes = "Concern keywords detected in response.";
  }

  // Check for pain mentions
  if (/\b(pain|hurt|ache|sore|stiff)\b/i.test(transcript)) {
    await config.speak("default", PAIN_FOLLOWUP);
    const painResponse = await config.listenForResponse("default", timeout);

    if (painResponse) {
      // Try to extract a number
      const numMatch = painResponse.match(/\b(\d+)\b/);
      if (numMatch) {
        painLevel = Math.min(parseInt(numMatch[1]!, 10), 10);
        if (painLevel >= 7) {
          flagged = true;
          notes += ` High pain level: ${painLevel}/10.`;
        }
      }
    }
  }

  // Warm closing
  if (flagged) {
    await config.speak(
      "default",
      "Thank you for letting me know. I'll let your caregiver know so they can check on you. Is there anything else you need right now?",
    );
  } else {
    await config.speak("default", "Thank you! I hope you have a wonderful rest of the day.");
  }

  // Record the check-in
  const status = flagged ? "concern_flagged" : "completed";

  await (supabase.from("aide_wellness_checkins") as any).insert({
    tenant_id: tenantId,
    aide_profile_id: aideProfileId,
    checkin_type: checkinType,
    status,
    mood_rating: moodRating,
    pain_level: painLevel,
    notes: notes || null,
    response_transcript: transcript,
    flagged_for_review: flagged,
  });

  // Alert caregiver if flagged
  if (flagged) {
    await config.createAlert({
      aide_profile_id: aideProfileId,
      alert_type: "wellness_concern",
      severity: painLevel && painLevel >= 7 ? "urgent" : "warning",
      message: `Wellness concern during ${checkinType} check-in. ${notes}`,
      details: {
        checkin_type: checkinType,
        mood_rating: moodRating,
        pain_level: painLevel,
        transcript,
      },
      delivery_channels: ["push", "telegram", "whatsapp"],
    });
  }
}

// ---------------------------------------------------------------------------
// Start the cron
// ---------------------------------------------------------------------------

export function startCheckinCron(config: CheckinCronConfig): ReturnType<typeof setInterval> {
  return setInterval(() => {
    checkinCronTick(config).catch((err) => {
      console.error("[CleverAide] Check-in cron error:", err);
    });
  }, 60_000);
}
