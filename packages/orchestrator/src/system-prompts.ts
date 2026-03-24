/**
 * System Prompt Builder
 *
 * Builds system prompts for Clever (orchestrator) and family member agents.
 * Each prompt scopes the LLM's behavior to the agent's identity, personality,
 * allowed devices, and restrictions.
 */

import type { WakeWordEntry, AgentPersonality, AideProfile, AideMedication, AideRoutine } from "@clever/shared";
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
