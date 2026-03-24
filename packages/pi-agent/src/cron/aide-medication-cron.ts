/**
 * CleverAide Medication Reminder Cron
 *
 * Runs every minute on the Pi Agent. Checks for medications due within the
 * next 5 minutes and triggers voice reminders via the agent's TTS output.
 * Starts a confirmation timer; if no confirmation after 15 minutes, marks
 * the dose as missed and creates a caregiver alert.
 *
 * Works during internet outages via Tier 3 local voice fallback.
 */

import type { createClient } from "@supabase/supabase-js";
import type { AideMedication, AideMedicationLog } from "@clever/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MedicationCronConfig {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  /** Speaks text through the room speaker. Returns when speech completes. */
  speak: (roomId: string, text: string) => Promise<void>;
  /** Listens for a voice response. Returns transcript or null on timeout. */
  listenForResponse: (roomId: string, timeoutMs: number) => Promise<string | null>;
  /** Creates a caregiver alert in the database. */
  createAlert: (alert: {
    aide_profile_id: string;
    alert_type: string;
    severity: string;
    message: string;
    details: Record<string, unknown>;
    delivery_channels: string[];
  }) => Promise<void>;
  /** Confirmation timeout in minutes. Default: 15 */
  confirmationTimeoutMinutes?: number;
  /** Window in minutes to look ahead for due medications. Default: 5 */
  lookAheadMinutes?: number;
}

// Track pending reminders to avoid duplicate triggers
const pendingReminders = new Set<string>();

// ---------------------------------------------------------------------------
// Main cron tick
// ---------------------------------------------------------------------------

export async function medicationCronTick(config: MedicationCronConfig): Promise<void> {
  const { supabase, tenantId } = config;
  const lookAhead = config.lookAheadMinutes ?? 5;

  // 1. Get all active aide profiles in this tenant
  const { data: aideProfiles } = await supabase
    .from("aide_profiles")
    .select("id, profile_id, timezone")
    .eq("tenant_id", tenantId);

  if (!aideProfiles?.length) return;

  for (const profile of aideProfiles) {
    // 2. Get active medications for this profile
    const { data: medications } = await supabase
      .from("aide_medications")
      .select("*")
      .eq("aide_profile_id", profile.id)
      .eq("is_active", true);

    if (!medications?.length) continue;

    // 3. Check each medication for due doses
    const now = new Date();
    const localNow = new Date(now.toLocaleString("en-US", { timeZone: profile.timezone }));
    const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
    const currentDow = localNow.getDay();

    for (const med of medications as AideMedication[]) {
      // Check if today is a scheduled day
      if (!med.days_of_week.includes(currentDow)) continue;

      for (const timeStr of med.scheduled_times) {
        const [h, m] = timeStr.split(":").map(Number);
        const scheduledMinutes = (h ?? 0) * 60 + (m ?? 0);
        const diff = scheduledMinutes - currentMinutes;

        // Due within the look-ahead window and not in the past by more than 2 min
        if (diff >= -2 && diff <= lookAhead) {
          const reminderKey = `${med.id}:${timeStr}:${localNow.toDateString()}`;
          if (pendingReminders.has(reminderKey)) continue;
          pendingReminders.add(reminderKey);

          // Check if already logged today
          const scheduledAt = new Date(localNow);
          scheduledAt.setHours(h ?? 0, m ?? 0, 0, 0);

          const { data: existingLog } = await supabase
            .from("aide_medication_logs")
            .select("id")
            .eq("medication_id", med.id)
            .eq("scheduled_at", scheduledAt.toISOString())
            .limit(1);

          if (existingLog?.length) continue;

          // 4. Create pending log entry
          await supabase
            .from("aide_medication_logs")
            .insert({
              tenant_id: tenantId,
              medication_id: med.id,
              aide_profile_id: profile.id,
              scheduled_at: scheduledAt.toISOString(),
              status: "pending",
            });

          // 5. Trigger voice reminder (async, don't block other meds)
          triggerReminder(config, profile.id, med, scheduledAt, reminderKey);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Voice reminder with confirmation
// ---------------------------------------------------------------------------

async function triggerReminder(
  config: MedicationCronConfig,
  aideProfileId: string,
  med: AideMedication,
  scheduledAt: Date,
  reminderKey: string,
): Promise<void> {
  const { supabase, tenantId } = config;
  const timeoutMs = (config.confirmationTimeoutMinutes ?? 15) * 60 * 1000;

  try {
    // Build reminder message
    const instructions = med.instructions ? ` ${med.instructions}.` : "";
    const reminderText =
      `It's time for your ${med.medication_name}, ${med.dosage}.${instructions} ` +
      `Please let me know when you've taken it.`;

    // Speak the reminder (uses room detection or default speaker)
    await config.speak("default", reminderText);

    // Update log to "reminded"
    await supabase
      .from("aide_medication_logs")
      .update({ status: "reminded" })
      .eq("medication_id", med.id)
      .eq("scheduled_at", scheduledAt.toISOString())
      .eq("status", "pending");

    // Wait for confirmation with timeout
    const response = await config.listenForResponse("default", timeoutMs);

    if (response) {
      const lower = response.toLowerCase();
      const taken = /\b(took|taken|done|yes|i did|got it)\b/.test(lower);
      const skipped = /\b(skip|later|not now|no)\b/.test(lower);

      if (taken) {
        await supabase
          .from("aide_medication_logs")
          .update({
            status: "taken",
            confirmed_via: "voice",
            confirmed_at: new Date().toISOString(),
          })
          .eq("medication_id", med.id)
          .eq("scheduled_at", scheduledAt.toISOString());

        await config.speak("default", `Great, I've noted that you took your ${med.medication_name}.`);
      } else if (skipped) {
        await supabase
          .from("aide_medication_logs")
          .update({
            status: "skipped",
            confirmed_via: "voice",
            confirmed_at: new Date().toISOString(),
            notes: response,
          })
          .eq("medication_id", med.id)
          .eq("scheduled_at", scheduledAt.toISOString());

        await config.speak("default", `Okay, I've noted that you're skipping your ${med.medication_name}.`);

        // Alert caregiver about skipped medication
        await config.createAlert({
          aide_profile_id: aideProfileId,
          alert_type: "medication_missed",
          severity: "info",
          message: `${med.medication_name} ${med.dosage} was skipped. User said: "${response}"`,
          details: { medication_id: med.id, scheduled_at: scheduledAt.toISOString() },
          delivery_channels: ["push"],
        });
      }
    } else {
      // No response — try once more
      await config.speak(
        "default",
        `Just a reminder — have you taken your ${med.medication_name}?`,
      );

      const secondResponse = await config.listenForResponse("default", 60_000);

      if (secondResponse && /\b(took|taken|done|yes|i did)\b/.test(secondResponse.toLowerCase())) {
        await supabase
          .from("aide_medication_logs")
          .update({
            status: "taken",
            confirmed_via: "voice",
            confirmed_at: new Date().toISOString(),
          })
          .eq("medication_id", med.id)
          .eq("scheduled_at", scheduledAt.toISOString());
      } else {
        // Mark as missed and alert caregiver
        await supabase
          .from("aide_medication_logs")
          .update({
            status: "missed",
            confirmed_via: "auto_timeout",
            confirmed_at: new Date().toISOString(),
          })
          .eq("medication_id", med.id)
          .eq("scheduled_at", scheduledAt.toISOString());

        await config.createAlert({
          aide_profile_id: aideProfileId,
          alert_type: "medication_missed",
          severity: "warning",
          message: `${med.medication_name} ${med.dosage} was not confirmed after multiple reminders.`,
          details: { medication_id: med.id, scheduled_at: scheduledAt.toISOString() },
          delivery_channels: ["push", "telegram", "whatsapp"],
        });
      }
    }
  } finally {
    // Allow re-triggering tomorrow
    setTimeout(() => pendingReminders.delete(reminderKey), 24 * 60 * 60 * 1000);
  }
}

// ---------------------------------------------------------------------------
// Start the cron (called from pi-agent main)
// ---------------------------------------------------------------------------

export function startMedicationCron(config: MedicationCronConfig): ReturnType<typeof setInterval> {
  // Run every 60 seconds
  return setInterval(() => {
    medicationCronTick(config).catch((err) => {
      console.error("[CleverAide] Medication cron error:", err);
    });
  }, 60_000);
}
