/**
 * Tier 1: Instant Rules Engine (50-200ms target)
 *
 * Regex/pattern-based intent matching for common smart home commands.
 * Handles ~70% of all voice commands without any LLM or cloud call.
 * Returns ParsedIntent with confidence 1.0 for exact pattern matches.
 */

import type { ParsedIntent, RulePattern } from "@clever/shared";

// ---------------------------------------------------------------------------
// Room / door / scene normalization helpers
// ---------------------------------------------------------------------------

/** Normalize a captured room token: trim, lowercase, collapse whitespace */
function normalizeRoom(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse a percentage string ("fifty", "50", "50%") to a number 0-100 */
function parsePercent(raw: string): number {
  const cleaned = raw.replace(/%/g, "").trim().toLowerCase();
  const wordMap: Record<string, number> = {
    zero: 0,
    ten: 10,
    twenty: 20,
    "twenty five": 25,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    "seventy five": 75,
    eighty: 80,
    ninety: 90,
    hundred: 100,
    "one hundred": 100,
  };
  if (wordMap[cleaned] !== undefined) return wordMap[cleaned]!;
  const num = Number(cleaned);
  return Number.isNaN(num) ? 50 : Math.max(0, Math.min(100, num));
}

/** Parse a temperature string ("72", "seventy two") to a number */
function parseTemperature(raw: string): number {
  const cleaned = raw.trim().toLowerCase();
  // Map common spoken temperatures
  const wordMap: Record<string, number> = {
    sixty: 60,
    "sixty five": 65,
    "sixty eight": 68,
    seventy: 70,
    "seventy two": 72,
    "seventy five": 75,
    eighty: 80,
  };
  if (wordMap[cleaned] !== undefined) return wordMap[cleaned]!;
  const num = Number(cleaned);
  return Number.isNaN(num) ? 72 : num;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const RULES: readonly RulePattern[] = [
  // -----------------------------------------------------------------------
  // LIGHT CONTROL
  // -----------------------------------------------------------------------
  {
    id: "light_on",
    pattern: /^(?:turn\s+on|switch\s+on|enable)\s+(?:the\s+)?(.+?)\s+lights?$/i,
    domain: "light",
    action: "turn_on",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "light_off",
    pattern: /^(?:turn\s+off|switch\s+off|disable|kill)\s+(?:the\s+)?(.+?)\s+lights?$/i,
    domain: "light",
    action: "turn_off",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "light_on_inverse",
    pattern: /^(?:the\s+)?(.+?)\s+lights?\s+on$/i,
    domain: "light",
    action: "turn_on",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "light_off_inverse",
    pattern: /^(?:the\s+)?(.+?)\s+lights?\s+off$/i,
    domain: "light",
    action: "turn_off",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "all_lights_off",
    pattern: /^(?:turn\s+off|switch\s+off|kill)\s+all\s+(?:the\s+)?lights?$/i,
    domain: "light",
    action: "turn_off",
    extract_params: (): Record<string, unknown> => ({
      room: "all",
    }),
  },
  {
    id: "all_lights_on",
    pattern: /^(?:turn\s+on|switch\s+on)\s+all\s+(?:the\s+)?lights?$/i,
    domain: "light",
    action: "turn_on",
    extract_params: (): Record<string, unknown> => ({
      room: "all",
    }),
  },
  {
    id: "dim_light",
    pattern: /^dim\s+(?:the\s+)?(.+?)\s+(?:lights?\s+)?to\s+(\d+|[a-z ]+)\s*%?$/i,
    domain: "light",
    action: "set_brightness",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
      brightness: parsePercent(match[2]!),
    }),
  },
  {
    id: "set_brightness",
    pattern:
      /^set\s+(?:the\s+)?(.+?)\s+(?:lights?\s+)?brightness\s+to\s+(\d+|[a-z ]+)\s*%?$/i,
    domain: "light",
    action: "set_brightness",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
      brightness: parsePercent(match[2]!),
    }),
  },

  // -----------------------------------------------------------------------
  // LOCK CONTROL
  // -----------------------------------------------------------------------
  {
    id: "lock_door",
    pattern: /^lock\s+(?:the\s+)?(.+?)(?:\s+door)?$/i,
    domain: "lock",
    action: "lock",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      door: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "unlock_door",
    pattern: /^unlock\s+(?:the\s+)?(.+?)(?:\s+door)?$/i,
    domain: "lock",
    action: "unlock",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      door: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "lock_all",
    pattern: /^lock\s+all\s+(?:the\s+)?doors?$/i,
    domain: "lock",
    action: "lock",
    extract_params: (): Record<string, unknown> => ({
      door: "all",
    }),
  },
  {
    id: "unlock_all",
    pattern: /^unlock\s+all\s+(?:the\s+)?doors?$/i,
    domain: "lock",
    action: "unlock",
    extract_params: (): Record<string, unknown> => ({
      door: "all",
    }),
  },

  // -----------------------------------------------------------------------
  // THERMOSTAT CONTROL
  // -----------------------------------------------------------------------
  {
    id: "set_temperature",
    pattern:
      /^set\s+(?:the\s+)?(?:temperature|thermostat|temp)\s+to\s+(\d+|[a-z ]+)\s*(?:degrees?|f)?$/i,
    domain: "thermostat",
    action: "set_temperature",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      temperature: parseTemperature(match[1]!),
      unit: "fahrenheit",
    }),
  },
  {
    id: "set_thermostat_to",
    pattern: /^(?:thermostat|temp)\s+(\d+)$/i,
    domain: "thermostat",
    action: "set_temperature",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      temperature: parseTemperature(match[1]!),
      unit: "fahrenheit",
    }),
  },
  {
    id: "make_warmer",
    pattern: /^(?:make\s+it\s+)?warmer$/i,
    domain: "thermostat",
    action: "increment_temperature",
    extract_params: (): Record<string, unknown> => ({
      delta: 2,
      unit: "fahrenheit",
    }),
  },
  {
    id: "make_cooler",
    pattern: /^(?:make\s+it\s+)?cooler$/i,
    domain: "thermostat",
    action: "decrement_temperature",
    extract_params: (): Record<string, unknown> => ({
      delta: 2,
      unit: "fahrenheit",
    }),
  },
  {
    id: "turn_up_temperature",
    pattern: /^turn\s+(?:up|raise)\s+(?:the\s+)?(?:temperature|thermostat|heat|temp)$/i,
    domain: "thermostat",
    action: "increment_temperature",
    extract_params: (): Record<string, unknown> => ({
      delta: 2,
      unit: "fahrenheit",
    }),
  },
  {
    id: "turn_down_temperature",
    pattern:
      /^turn\s+(?:down|lower)\s+(?:the\s+)?(?:temperature|thermostat|ac|air|temp)$/i,
    domain: "thermostat",
    action: "decrement_temperature",
    extract_params: (): Record<string, unknown> => ({
      delta: 2,
      unit: "fahrenheit",
    }),
  },

  // -----------------------------------------------------------------------
  // SCENE ACTIVATION
  // -----------------------------------------------------------------------
  {
    id: "scene_good_morning",
    pattern: /^good\s+morning$/i,
    domain: "scene",
    action: "activate",
    extract_params: (): Record<string, unknown> => ({
      scene: "good_morning",
    }),
  },
  {
    id: "scene_good_night",
    pattern: /^good\s*night$/i,
    domain: "scene",
    action: "activate",
    extract_params: (): Record<string, unknown> => ({
      scene: "good_night",
    }),
  },
  {
    id: "scene_leaving",
    pattern: /^(?:i'?m\s+leaving|goodbye|i'?m\s+heading\s+out)$/i,
    domain: "scene",
    action: "activate",
    extract_params: (): Record<string, unknown> => ({
      scene: "leaving",
    }),
  },
  {
    id: "scene_home",
    pattern: /^(?:i'?m\s+home|i'?m\s+back|i\s+am\s+home)$/i,
    domain: "scene",
    action: "activate",
    extract_params: (): Record<string, unknown> => ({
      scene: "arriving",
    }),
  },
  {
    id: "scene_movie",
    pattern: /^(?:movie\s+(?:time|mode)|start\s+(?:a\s+)?movie)$/i,
    domain: "scene",
    action: "activate",
    extract_params: (): Record<string, unknown> => ({
      scene: "movie_mode",
    }),
  },
  {
    id: "scene_bedtime",
    pattern: /^(?:bedtime|time\s+for\s+bed)$/i,
    domain: "scene",
    action: "activate",
    extract_params: (): Record<string, unknown> => ({
      scene: "bedtime",
    }),
  },

  // -----------------------------------------------------------------------
  // FAN CONTROL
  // -----------------------------------------------------------------------
  {
    id: "fan_on",
    pattern: /^(?:turn\s+on|start)\s+(?:the\s+)?(.+?)\s+fan$/i,
    domain: "fan",
    action: "turn_on",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
    }),
  },
  {
    id: "fan_off",
    pattern: /^(?:turn\s+off|stop)\s+(?:the\s+)?(.+?)\s+fan$/i,
    domain: "fan",
    action: "turn_off",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      room: normalizeRoom(match[1]!),
    }),
  },

  // -----------------------------------------------------------------------
  // SHOPPING LIST
  // -----------------------------------------------------------------------
  {
    id: "shopping_add_qty",
    pattern: /^add\s+(\d+)\s+(.+?)\s+to\s+(?:the\s+)?(?:shopping\s+)?list$/i,
    domain: "shopping_list",
    action: "add_item",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      item: match[2]!.trim(),
      quantity: parseInt(match[1]!, 10),
    }),
  },
  {
    id: "shopping_add",
    pattern: /^add\s+(.+?)\s+to\s+(?:the\s+)?(?:shopping\s+)?list$/i,
    domain: "shopping_list",
    action: "add_item",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      item: match[1]!.trim(),
      quantity: 1,
    }),
  },
  {
    id: "shopping_remove",
    pattern: /^remove\s+(.+?)\s+from\s+(?:the\s+)?(?:shopping\s+)?list$/i,
    domain: "shopping_list",
    action: "remove_item",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      item: match[1]!.trim(),
    }),
  },
  {
    id: "shopping_read",
    pattern: /^(?:what'?s|what\s+is)\s+on\s+(?:the\s+)?(?:shopping\s+)?list$/i,
    domain: "shopping_list",
    action: "read_list",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "shopping_clear",
    pattern: /^clear\s+(?:the\s+)?(?:shopping\s+)?list$/i,
    domain: "shopping_list",
    action: "clear_list",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "shopping_check",
    pattern: /^(?:do\s+(?:we|i)\s+need|is)\s+(.+?)\s+on\s+(?:the\s+)?(?:shopping\s+)?list$/i,
    domain: "shopping_list",
    action: "check_item",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      item: match[1]!.trim(),
    }),
  },

  // -----------------------------------------------------------------------
  // PANTRY
  // -----------------------------------------------------------------------
  {
    id: "pantry_check",
    pattern: /^(?:do\s+(?:we|i)\s+have)\s+(.+?)(?:\s+left)?$/i,
    domain: "pantry",
    action: "check_stock",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      item: match[1]!.trim(),
    }),
  },
  {
    id: "pantry_low",
    pattern: /^(?:what(?:'s|\s+is)\s+)?running\s+low$/i,
    domain: "pantry",
    action: "check_low_stock",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "pantry_expiring",
    pattern: /^what(?:'s|\s+is)\s+expiring\s+(?:soon|this\s+week)$/i,
    domain: "pantry",
    action: "check_expiring",
    extract_params: (): Record<string, unknown> => ({}),
  },

  // -----------------------------------------------------------------------
  // KITCHEN TIMERS
  // -----------------------------------------------------------------------
  {
    id: "timer_set_named",
    pattern: /^set\s+(?:a\s+)?(.+?)\s+timer\s+(?:for\s+)?(\d+)\s+(minutes?|seconds?|hours?)$/i,
    domain: "kitchen",
    action: "set_timer",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      label: match[1]!.trim(),
      duration: parseInt(match[2]!, 10),
      unit: match[3]!.toLowerCase().replace(/s$/, ""),
    }),
  },
  {
    id: "timer_set",
    pattern: /^set\s+(?:a\s+)?timer\s+(?:for\s+)?(\d+)\s+(minutes?|seconds?|hours?)$/i,
    domain: "kitchen",
    action: "set_timer",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      duration: parseInt(match[1]!, 10),
      unit: match[2]!.toLowerCase().replace(/s$/, ""),
    }),
  },
  {
    id: "timer_cancel",
    pattern: /^(?:cancel|stop|clear)\s+(?:the\s+)?timer$/i,
    domain: "kitchen",
    action: "cancel_timer",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "timer_check",
    pattern: /^(?:how\s+much\s+time|how\s+long)\s+(?:is\s+)?left$/i,
    domain: "kitchen",
    action: "check_timer",
    extract_params: (): Record<string, unknown> => ({}),
  },

  // -----------------------------------------------------------------------
  // RECIPE SUGGESTIONS
  // -----------------------------------------------------------------------
  {
    id: "recipe_suggest",
    pattern: /^what\s+can\s+(?:i|we)\s+(?:make|cook)(?:\s+.*)?$/i,
    domain: "kitchen",
    action: "suggest_recipe",
    extract_params: (): Record<string, unknown> => ({}),
  },

  // -----------------------------------------------------------------------
  // SCANNING (voice-triggered)
  // -----------------------------------------------------------------------
  {
    id: "scan_receipt",
    pattern: /^scan\s+(?:this\s+)?receipt$/i,
    domain: "kitchen",
    action: "scan_receipt",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "scan_item",
    pattern: /^scan\s+(?:this\s+)?(?:item|barcode|product)$/i,
    domain: "kitchen",
    action: "scan_barcode",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "scan_remove",
    pattern: /^(?:remove|discard|throw\s+away)\s+(?:this\s+)?(?:item|product)$/i,
    domain: "kitchen",
    action: "scan_barcode_remove",
    extract_params: (): Record<string, unknown> => ({}),
  },
  {
    id: "scan_pantry",
    pattern: /^(?:scan|photo(?:graph)?)\s+(?:the\s+)?(?:pantry|fridge|freezer|refrigerator)$/i,
    domain: "kitchen",
    action: "scan_pantry_photo",
    extract_params: (match: RegExpMatchArray): Record<string, unknown> => ({
      location: match[0]!.match(/fridge|refrigerator/i) ? "fridge"
        : match[0]!.match(/freezer/i) ? "freezer"
        : "pantry",
    }),
  },
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to match a transcript against the rules engine.
 *
 * @param transcript - The raw or partial transcript text
 * @returns ParsedIntent with confidence 1.0 on match, or null if no rule matches
 */
export function matchRule(transcript: string): ParsedIntent | null {
  // Normalize input: trim whitespace, collapse multiple spaces, strip trailing punctuation
  const normalized = transcript
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "");

  if (normalized.length === 0) return null;

  for (const rule of RULES) {
    const regex = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern, "i");
    const match = normalized.match(regex);

    if (match) {
      const parameters = rule.extract_params(match);

      return {
        domain: rule.domain,
        action: rule.action,
        target_device: undefined,
        target_room: (parameters["room"] as string | undefined) ?? undefined,
        parameters,
        confidence: 1.0,
        raw_transcript: transcript,
      };
    }
  }

  return null;
}

/**
 * Returns all registered rules (useful for debugging and testing).
 */
export function getRules(): readonly RulePattern[] {
  return RULES;
}

/**
 * Check if a transcript could potentially match a rule with partial input.
 * Useful for early-exit optimization when streaming STT provides partial results.
 *
 * @param partial - A partial transcript (may be incomplete)
 * @returns true if the partial text could plausibly match at least one rule
 */
export function couldMatchRule(partial: string): boolean {
  const normalized = partial.trim().toLowerCase();
  if (normalized.length === 0) return false;

  // Quick prefix checks for common command starts
  const commandPrefixes = [
    "turn",
    "switch",
    "set",
    "dim",
    "lock",
    "unlock",
    "good",
    "i'm",
    "i am",
    "make",
    "movie",
    "bedtime",
    "time for",
    "start",
    "enable",
    "disable",
    "kill",
    "thermostat",
    "temp",
    "goodbye",
    "add",
    "remove",
    "what",
    "what's",
    "clear",
    "do we",
    "do i",
    "is",
    "running",
    "how much",
    "how long",
    "cancel",
    "stop",
    "scan",
    "photo",
    "discard",
    "throw",
  ];

  return commandPrefixes.some((prefix) => normalized.startsWith(prefix));
}
