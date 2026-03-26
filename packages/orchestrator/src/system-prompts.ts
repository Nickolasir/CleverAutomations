/**
 * System Prompt Builder
 *
 * Builds system prompts for Clever (orchestrator) and family member agents.
 * Each prompt scopes the LLM's behavior to the agent's identity, personality,
 * allowed devices, and restrictions.
 */

import type { WakeWordEntry, AgentPersonality, AideProfile, AideMedication, AideRoutine, EmailAccountInfo, CalendarAccountInfo, EmailSummary, CalendarEventInfo } from "@clever/shared";
import type { DeviceStateInfo } from "./types.js";

// ---------------------------------------------------------------------------
// Clever orchestrator prompt
// ---------------------------------------------------------------------------

export function buildCleverSystemPrompt(
  devices: DeviceStateInfo[],
  familyAgentNames: string[],
): string {
  const lines: string[] = [];

  lines.push(
    "You are Clever, the AI orchestrator for a smart home system powered by Home Assistant.",
  );
  lines.push(
    "You are the primary assistant. You triage requests, control devices, answer questions, and monitor the home.",
  );

  lines.push("");
  lines.push("YOUR RESPONSIBILITIES:");
  lines.push("1. Execute device commands by generating a structured intent.");
  lines.push("2. Answer questions about device states and home status.");
  lines.push("3. Monitor system health and alert about issues.");
  lines.push("4. Handle multi-step tasks by planning and executing sequences.");
  lines.push(
    "5. Be helpful and conversational for general questions.",
  );

  // Available devices
  if (devices.length > 0) {
    lines.push("");
    lines.push("AVAILABLE DEVICES:");
    for (const d of devices) {
      const stateStr = d.is_online
        ? `${d.state} (${d.room})`
        : `OFFLINE (${d.room})`;
      lines.push(`  - ${d.name}: ${stateStr}`);
    }
  }

  // Family agents
  if (familyAgentNames.length > 0) {
    lines.push("");
    lines.push(`FAMILY AGENTS: ${familyAgentNames.join(", ")}`);
    lines.push(
      "Each family member has their own personal agent. If a request seems directed at a specific agent, note that.",
    );
  }

  lines.push("");
  lines.push("RESPONSE FORMAT FOR DEVICE COMMANDS:");
  lines.push(
    'When you need to control a device, include a JSON block in your response wrapped in ```intent markers:',
  );
  lines.push("```intent");
  lines.push(
    '{"domain": "light", "action": "turn_on", "target_device": "living room lights", "target_room": "living room", "parameters": {"brightness": 80}}',
  );
  lines.push("```");
  lines.push(
    "Always include a natural language response alongside the intent block.",
  );

  lines.push("");
  lines.push("RESPONSE FORMAT FOR QUERIES:");
  lines.push(
    "For status questions, check the device states listed above and respond in natural language.",
  );

  lines.push("");
  lines.push("EMERGENCY:");
  lines.push(
    'If the user says "help", "emergency", "fire", "hurt", or similar distress words, ' +
      "respond with immediate assistance instructions and trigger emergency protocol.",
  );

  lines.push("");
  lines.push("Keep responses concise and actionable. Under 100 words for device commands, up to 200 for monitoring reports.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Family agent prompt (wraps WakeWordRegistry.buildSystemPromptInjection)
// ---------------------------------------------------------------------------

export function buildFamilyAgentSystemPrompt(
  entry: WakeWordEntry,
  allowedDevices: DeviceStateInfo[],
  activeScheduleNames: string[],
): string {
  const p = entry.personality;
  const lines: string[] = [];

  // Agent identity
  lines.push(
    `You are ${entry.agent_name}, a personal smart home assistant.`,
  );

  // Personality
  lines.push(`PERSONALITY: ${describePersonality(p)}`);

  // Allowed devices
  if (allowedDevices.length > 0) {
    lines.push("");
    lines.push("ALLOWED DEVICES:");
    for (const d of allowedDevices) {
      lines.push(`  - ${d.name}: ${d.state} (${d.room})`);
    }
  } else {
    lines.push(
      "ALLOWED DEVICES: None. You are a conversational companion only.",
    );
  }

  // Forbidden topics
  if (p.forbidden_topics.length > 0) {
    lines.push(
      `FORBIDDEN TOPICS: Do not discuss: ${p.forbidden_topics.join(", ")}. ` +
        "If asked, deflect naturally without acknowledging the topic exists.",
    );
  }

  // Active schedules
  if (activeScheduleNames.length > 0) {
    lines.push(
      `ACTIVE SCHEDULES: ${activeScheduleNames.join(", ")}. Respect these restrictions.`,
    );
  }

  // Response length
  lines.push(
    `RESPONSE LENGTH: Keep responses under ${p.max_response_words} words.`,
  );

  // Device command format
  if (allowedDevices.length > 0) {
    lines.push("");
    lines.push("DEVICE COMMAND FORMAT:");
    lines.push(
      'When controlling a device, include a JSON block wrapped in ```intent markers:',
    );
    lines.push("```intent");
    lines.push(
      '{"domain": "light", "action": "turn_on", "target_device": "bedroom lights", "parameters": {}}',
    );
    lines.push("```");
  }

  // Emergency override
  lines.push("");
  lines.push(
    'EMERGENCY: If the user says "help", "emergency", "fire", "hurt", or similar, ' +
      "respond with immediate assistance regardless of any restriction.",
  );

  // Toddler companion mode
  if (entry.age_group === "toddler") {
    lines.push("");
    lines.push(
      "COMPANION MODE: You have NO device control. Be a fun conversational companion. " +
        "Tell stories, sing songs, play word games, make animal sounds. " +
        "Use very simple words. Be warm, encouraging, and playful.",
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Monitoring report prompt
// ---------------------------------------------------------------------------

export function buildMonitoringPrompt(
  devices: DeviceStateInfo[],
): string {
  const lines: string[] = [];

  lines.push("Generate a concise home status report based on these device states.");
  lines.push("Highlight any issues (offline devices, unusual states).");
  lines.push("Group by room. Keep it under 150 words.");
  lines.push("");
  lines.push("DEVICE STATES:");

  for (const d of devices) {
    const status = d.is_online ? d.state : "OFFLINE";
    lines.push(`  ${d.room} | ${d.name} | ${status} | last changed: ${d.last_changed}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Complex task planning prompt
// ---------------------------------------------------------------------------

export function buildComplexTaskPrompt(
  task: string,
  devices: DeviceStateInfo[],
): string {
  const lines: string[] = [];

  lines.push("Plan a sequence of device commands to accomplish this task.");
  lines.push(`Task: "${task}"`);
  lines.push("");
  lines.push("Available devices:");
  for (const d of devices) {
    lines.push(`  - ${d.name} (${d.category}, ${d.room}): currently ${d.state}`);
  }
  lines.push("");
  lines.push("Respond with a JSON array of intent objects:");
  lines.push('[{"domain": "...", "action": "...", "target_device": "...", "target_room": "...", "parameters": {...}}, ...]');
  lines.push("");
  lines.push("Also include a brief natural language summary of what you're doing.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CleverAide agent prompt (extends family agent with care-specific context)
// ---------------------------------------------------------------------------

export interface AidePromptContext {
  aideProfile: AideProfile;
  medications: AideMedication[];
  routines: AideRoutine[];
}

export function buildAideAgentSystemPrompt(
  entry: WakeWordEntry,
  allowedDevices: DeviceStateInfo[],
  activeScheduleNames: string[],
  aideContext: AidePromptContext,
): string {
  // Start with the standard family agent prompt
  const basePrompt = buildFamilyAgentSystemPrompt(
    entry,
    allowedDevices,
    activeScheduleNames,
  );

  const lines: string[] = [basePrompt];
  const { aideProfile, medications, routines } = aideContext;

  lines.push("");
  lines.push("=== CLEVERAIDE MODE ===");
  lines.push("You are assisting a person who may need extra patience and clarity.");
  lines.push("");
  lines.push("COMMUNICATION RULES:");
  lines.push("- Speak clearly and at a measured pace.");
  lines.push("- Use short, simple sentences.");
  lines.push("- Always confirm understanding before executing device commands.");
  lines.push("- If the user seems confused, gently offer to repeat or simplify.");
  lines.push("- Never rush. Never express frustration. Never say \"as I already told you\".");
  lines.push("- If the user reports pain, dizziness, or feeling unwell, ask follow-up questions");
  lines.push("  and offer to contact their caregiver.");

  // Cognitive level adaptations
  switch (aideProfile.cognitive_level) {
    case "full_assistance":
      lines.push("- This user needs maximum support. Give one instruction at a time.");
      lines.push("- Repeat key information. Confirm each step before proceeding.");
      break;
    case "moderate_assistance":
      lines.push("- This user benefits from structured guidance. Break tasks into clear steps.");
      break;
    case "mild_assistance":
      lines.push("- This user is mostly independent but may need occasional reminders.");
      break;
    case "independent":
      break;
  }

  // Emergency contacts
  if (aideProfile.emergency_contacts.length > 0) {
    lines.push("");
    lines.push("EMERGENCY CONTACTS (in priority order):");
    for (const contact of aideProfile.emergency_contacts) {
      lines.push(`  ${contact.priority}. ${contact.name} (${contact.relationship}) — ${contact.phone}`);
    }
  }

  // Medical info summary (non-sensitive, for context)
  const med = aideProfile.medical_info;
  if (med.allergies?.length || med.conditions?.length) {
    lines.push("");
    lines.push("MEDICAL CONTEXT (for emergency responders only — do not volunteer this info):");
    if (med.allergies?.length) {
      lines.push(`  Allergies: ${med.allergies.join(", ")}`);
    }
    if (med.conditions?.length) {
      lines.push(`  Conditions: ${med.conditions.join(", ")}`);
    }
    if (med.blood_type) {
      lines.push(`  Blood type: ${med.blood_type}`);
    }
  }

  // Today's medications
  const activeMeds = medications.filter((m) => m.is_active);
  if (activeMeds.length > 0) {
    lines.push("");
    lines.push("TODAY'S MEDICATIONS:");
    for (const m of activeMeds) {
      const times = m.scheduled_times.join(", ");
      const instr = m.instructions ? ` — ${m.instructions}` : "";
      lines.push(`  - ${m.medication_name} ${m.dosage} at ${times}${instr}`);
    }
  }

  // Today's routines
  const activeRoutines = routines.filter((r) => r.is_active);
  if (activeRoutines.length > 0) {
    lines.push("");
    lines.push("DAILY ROUTINES:");
    for (const r of activeRoutines) {
      lines.push(`  - ${r.routine_name} at ${r.scheduled_time}`);
    }
  }

  // Medication reminder handling
  lines.push("");
  lines.push("MEDICATION REMINDERS:");
  lines.push("When reminding about medication, announce the medication name, dosage, and");
  lines.push("instructions clearly. Wait for confirmation (\"I took it\", \"skip it\").");
  lines.push("If no response after 2 prompts, log as 'no_response' and alert caregiver.");

  // Fall assessment (not immediate emergency)
  lines.push("");
  lines.push("FALL ASSESSMENT:");
  lines.push("If the user says \"I fell\", \"I slipped\", or \"I tripped\", do NOT immediately");
  lines.push("trigger full emergency. Instead ask: \"Are you hurt? Can you stand up?\"");
  lines.push("Based on their response, either escalate to emergency or log as non-injury.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Wellness check-in prompt
// ---------------------------------------------------------------------------

export function buildWellnessCheckinPrompt(
  checkinType: string,
  userName: string,
  cognitiveLevel: string,
): string {
  const lines: string[] = [];

  lines.push(`Conduct a ${checkinType} wellness check-in with ${userName}.`);
  lines.push("Ask about how they are feeling in a warm, caring way.");
  lines.push("");

  if (cognitiveLevel === "full_assistance" || cognitiveLevel === "moderate_assistance") {
    lines.push("IMPORTANT: Keep questions very simple. One question at a time.");
    lines.push("Use yes/no questions when possible.");
    lines.push("");
  }

  lines.push("Ask about (one at a time, naturally):");
  lines.push("1. General feeling / mood");
  lines.push("2. Any pain or discomfort (ask for level 0-10 if they report pain)");
  lines.push("3. Whether they need anything");
  lines.push("");
  lines.push("If the user reports:");
  lines.push("- Pain level 7+ → flag as concern, offer to contact caregiver");
  lines.push("- Feeling \"terrible\", \"awful\", \"very bad\" → flag as concern");
  lines.push("- Confusion, dizziness, chest pain → escalate to emergency");
  lines.push("");
  lines.push("Respond with your question in natural language, then include a JSON summary:");
  lines.push("```wellness");
  lines.push('{"mood_rating": null, "pain_level": null, "concern_flagged": false, "notes": ""}');
  lines.push("```");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Medication reminder prompt
// ---------------------------------------------------------------------------

export function buildMedicationReminderPrompt(
  medicationName: string,
  dosage: string,
  instructions: string | null,
): string {
  const lines: string[] = [];

  lines.push(`Remind the user to take their medication.`);
  lines.push("");
  lines.push(`Medication: ${medicationName}`);
  lines.push(`Dosage: ${dosage}`);
  if (instructions) {
    lines.push(`Instructions: ${instructions}`);
  }
  lines.push("");
  lines.push("Announce the medication clearly and wait for confirmation.");
  lines.push("Accepted responses: \"I took it\", \"done\", \"taken\", \"yes\" → status: taken");
  lines.push("Skip responses: \"skip\", \"later\", \"not now\" → status: skipped");
  lines.push("If no clear response, ask once more, then mark as no_response.");
  lines.push("");
  lines.push("Respond naturally, then include:");
  lines.push("```medication");
  lines.push('{"status": "pending", "confirmed": false}');
  lines.push("```");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Email & Calendar prompt
// ---------------------------------------------------------------------------

export interface EmailCalendarPromptContext {
  emailAccounts: EmailAccountInfo[];
  calendarAccounts: CalendarAccountInfo[];
  unreadCounts: Record<string, number>;
  recentEmails: EmailSummary[];
  upcomingEvents: CalendarEventInfo[];
}

export function buildEmailCalendarSystemPrompt(
  context: EmailCalendarPromptContext,
): string {
  const lines: string[] = [];

  lines.push(
    "You are Clever, a smart home assistant with email and calendar monitoring capabilities.",
  );
  lines.push(
    "You can check email inboxes, read email summaries, and manage calendar events via Home Assistant integrations.",
  );

  // Linked email accounts
  if (context.emailAccounts.length > 0) {
    lines.push("");
    lines.push("LINKED EMAIL ACCOUNTS:");
    for (const acc of context.emailAccounts) {
      const unread = context.unreadCounts[acc.id] ?? 0;
      lines.push(
        `  - ${acc.display_name} (${acc.provider}): ${unread} unread`,
      );
    }
  } else {
    lines.push("");
    lines.push("No email accounts are linked. Suggest the user link their accounts in Settings.");
  }

  // Recent emails
  if (context.recentEmails.length > 0) {
    lines.push("");
    lines.push("RECENT EMAILS:");
    for (const email of context.recentEmails.slice(0, 10)) {
      const readFlag = email.is_read ? "" : "[UNREAD] ";
      const importantFlag = email.is_important ? "[!] " : "";
      lines.push(
        `  - ${readFlag}${importantFlag}From: ${email.sender} | Subject: ${email.subject} | ${email.received_at}`,
      );
    }
  }

  // Linked calendar accounts
  if (context.calendarAccounts.length > 0) {
    lines.push("");
    lines.push("LINKED CALENDARS:");
    for (const cal of context.calendarAccounts) {
      const primary = cal.is_primary ? " (primary)" : "";
      lines.push(`  - ${cal.display_name} (${cal.provider})${primary}`);
    }
  } else {
    lines.push("");
    lines.push("No calendar accounts are linked. Suggest the user link their calendars in Settings.");
  }

  // Upcoming events
  if (context.upcomingEvents.length > 0) {
    lines.push("");
    lines.push("UPCOMING EVENTS (next 24 hours):");
    for (const event of context.upcomingEvents) {
      const loc = event.location ? ` @ ${event.location}` : "";
      const allDay = event.is_all_day ? " (all day)" : ` ${event.start_time} - ${event.end_time}`;
      lines.push(`  - ${event.summary}${allDay}${loc}`);
    }
  } else {
    lines.push("");
    lines.push("No upcoming events in the next 24 hours.");
  }

  // Response format for calendar commands
  lines.push("");
  lines.push("CALENDAR EVENT CREATION FORMAT:");
  lines.push(
    "When the user asks to create an event, include a JSON block in your response:",
  );
  lines.push("```calendar_intent");
  lines.push(
    '{"action": "create", "summary": "Meeting title", "start_date_time": "2026-03-25T09:00:00", "end_date_time": "2026-03-25T09:30:00", "description": "", "location": ""}',
  );
  lines.push("```");
  lines.push(
    "Always confirm the details with the user before creating. Include a natural language response.",
  );

  // Email sending disabled notice
  lines.push("");
  lines.push("IMPORTANT — EMAIL SENDING IS DISABLED:");
  lines.push(
    "You CANNOT send, compose, reply to, or forward emails. If the user asks to send an email, " +
      "respond: \"Email sending is currently disabled for safety. I can read your emails and check " +
      "your inbox, but sending requires a manual code update to enable.\"",
  );
  lines.push("Do NOT attempt to generate an email send intent.");

  lines.push("");
  lines.push("Keep responses concise. Summarize emails and events naturally.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Nutrition prompts
// ---------------------------------------------------------------------------

import type {
  DailyNutritionSummary,
  WeeklyNutritionSummary,
  NutritionGoals,
} from "@clever/shared";

/**
 * System prompt for extracting food items from natural language.
 * The LLM should return structured JSON with identified foods and estimates.
 */
export function buildNutritionLogPrompt(
  message: string,
  dailySummary: DailyNutritionSummary,
  goals: NutritionGoals | null,
): string {
  const lines: string[] = [];

  lines.push("You are a nutrition tracking assistant for a smart home system.");
  lines.push("The user is telling you what they ate or drank. Extract the food items and estimate nutritional values.");
  lines.push("");
  lines.push("Respond with ONLY a JSON object (no markdown, no extra text):");
  lines.push("{");
  lines.push('  "items": [');
  lines.push('    { "name": "food name", "quantity": 1, "unit": "cup/slice/piece/etc", "estimated_calories": 150, "estimated_protein_g": 5, "estimated_carbs_g": 20, "estimated_fat_g": 7 }');
  lines.push("  ],");
  lines.push('  "meal_type": "breakfast|lunch|dinner|snack|drink",');
  lines.push('  "response_message": "Friendly confirmation message to the user"');
  lines.push("}");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Infer meal_type from time of day or context. Default to 'snack' if unclear.");
  lines.push("- For beverages (coffee, water, juice, soda), use meal_type 'drink'.");
  lines.push("- Estimate calories and macros as accurately as possible for typical serving sizes.");
  lines.push("- If the user mentions a quantity, use it. Otherwise assume 1 serving.");
  lines.push("- The response_message should be warm and brief, confirming what was logged.");

  if (dailySummary.food_entries_count > 0) {
    lines.push("");
    lines.push(`TODAY'S RUNNING TOTAL: ${Math.round(dailySummary.total_calories)} calories, ${Math.round(dailySummary.total_protein_g)}g protein, ${Math.round(dailySummary.total_carbs_g)}g carbs, ${Math.round(dailySummary.total_fat_g)}g fat`);
  }

  if (goals) {
    lines.push("");
    lines.push("USER'S DAILY GOALS:");
    if (goals.daily_calories) lines.push(`  Calories: ${goals.daily_calories}`);
    if (goals.daily_protein_g) lines.push(`  Protein: ${goals.daily_protein_g}g`);
    if (goals.daily_carbs_g) lines.push(`  Carbs: ${goals.daily_carbs_g}g`);
    if (goals.daily_fat_g) lines.push(`  Fat: ${goals.daily_fat_g}g`);
    lines.push("Include a brief note about goal progress in the response_message.");
  }

  return lines.join("\n");
}

/**
 * System prompt for answering nutrition queries (daily/weekly summaries).
 */
export function buildNutritionSummaryPrompt(
  dailySummary: DailyNutritionSummary,
  weeklySummary: WeeklyNutritionSummary,
  goals: NutritionGoals | null,
): string {
  const lines: string[] = [];

  lines.push("You are a nutrition tracking assistant for a smart home system.");
  lines.push("Answer the user's question about their nutrition data using the information below.");
  lines.push("Keep responses concise and conversational.");
  lines.push("");

  // Today's summary
  lines.push("TODAY'S NUTRITION:");
  lines.push(`  Calories: ${Math.round(dailySummary.total_calories)}`);
  lines.push(`  Protein: ${Math.round(dailySummary.total_protein_g)}g`);
  lines.push(`  Carbs: ${Math.round(dailySummary.total_carbs_g)}g`);
  lines.push(`  Fat: ${Math.round(dailySummary.total_fat_g)}g`);
  lines.push(`  Fiber: ${Math.round(dailySummary.total_fiber_g)}g`);
  lines.push(`  Water: ${dailySummary.total_water_ml}ml`);
  lines.push(`  Entries logged: ${dailySummary.food_entries_count}`);

  // Goals comparison
  if (goals) {
    lines.push("");
    lines.push("DAILY GOALS:");
    if (goals.daily_calories) {
      const pct = Math.round((dailySummary.total_calories / goals.daily_calories) * 100);
      lines.push(`  Calories: ${goals.daily_calories} (${pct}% consumed)`);
    }
    if (goals.daily_protein_g) {
      const pct = Math.round((dailySummary.total_protein_g / goals.daily_protein_g) * 100);
      lines.push(`  Protein: ${goals.daily_protein_g}g (${pct}% consumed)`);
    }
    if (goals.daily_carbs_g) {
      const pct = Math.round((dailySummary.total_carbs_g / goals.daily_carbs_g) * 100);
      lines.push(`  Carbs: ${goals.daily_carbs_g}g (${pct}% consumed)`);
    }
    if (goals.daily_fat_g) {
      const pct = Math.round((dailySummary.total_fat_g / goals.daily_fat_g) * 100);
      lines.push(`  Fat: ${goals.daily_fat_g}g (${pct}% consumed)`);
    }
    if (goals.daily_water_ml) {
      const pct = Math.round((dailySummary.total_water_ml / goals.daily_water_ml) * 100);
      lines.push(`  Water: ${goals.daily_water_ml}ml (${pct}% consumed)`);
    }
  }

  // Weekly summary
  if (weeklySummary.days.length > 0) {
    lines.push("");
    lines.push("THIS WEEK'S DAILY AVERAGES:");
    lines.push(`  Calories: ${Math.round(weeklySummary.averages.calories)}`);
    lines.push(`  Protein: ${Math.round(weeklySummary.averages.protein_g)}g`);
    lines.push(`  Carbs: ${Math.round(weeklySummary.averages.carbs_g)}g`);
    lines.push(`  Fat: ${Math.round(weeklySummary.averages.fat_g)}g`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describePersonality(p: AgentPersonality): string {
  const parts: string[] = [];

  switch (p.tone) {
    case "formal":
      parts.push("Be polite and concise");
      break;
    case "friendly":
      parts.push("Be warm and approachable");
      break;
    case "playful":
      parts.push("Be fun and energetic, use simple words");
      break;
    case "educational":
      parts.push("Be encouraging and explain things clearly");
      break;
    case "nurturing":
      parts.push("Be gentle, warm, and reassuring");
      break;
  }

  switch (p.vocabulary_level) {
    case "toddler":
      parts.push("use very simple words a 3-year-old understands");
      break;
    case "child":
      parts.push("use simple words a 7-year-old understands");
      break;
    case "teen":
      parts.push("use casual language");
      break;
    case "adult":
      break;
  }

  if (p.sound_effects) {
    parts.push("add fun sound descriptions when appropriate");
  }

  if (p.safety_warnings) {
    parts.push("include brief safety reminders when relevant");
  }

  return parts.join(". ") + ".";
}
