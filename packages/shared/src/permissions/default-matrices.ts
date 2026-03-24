/**
 * Default Permission Matrices by Age Group
 *
 * These are the baseline permissions applied when a family member profile is
 * created. Parents can override any of these via family_permission_overrides.
 *
 * Principle: deny-by-default, explicit-allow. Each age group defines what
 * it CAN do; everything else is denied.
 */

import type {
  FamilyAgeGroup,
  DefaultPermissionSet,
  AgentPersonality,
} from "../types/family.js";

// ---------------------------------------------------------------------------
// Default permission sets per age group
// ---------------------------------------------------------------------------

export const DEFAULT_PERMISSIONS: Record<FamilyAgeGroup, DefaultPermissionSet> = {
  adult: {
    device_control: "all",
    lock_security: true,
    thermostat: { min: 60, max: 85 },
    camera_access: true,
    media_rating: "R",
    purchase_enabled: true,
    voice_history_access: "all",
    scene_activation: "all",
    rate_limit: 60,
    emergency: true,
    override_others: true,
    data_visibility: "full",
  },

  teenager: {
    device_control: "own_room_plus_common",
    lock_security: false,
    thermostat: { min: 65, max: 78 },
    camera_access: false,
    media_rating: "PG-13",
    purchase_enabled: false,
    voice_history_access: "own",
    scene_activation: ["good_morning", "good_night", "movie_mode", "study_mode"],
    rate_limit: 30,
    emergency: true,
    override_others: false,
    data_visibility: "limited",
  },

  tween: {
    device_control: "own_room_only",
    lock_security: false,
    thermostat: { min: 68, max: 75 },
    camera_access: false,
    media_rating: "PG",
    purchase_enabled: false,
    voice_history_access: "own",
    scene_activation: ["good_morning", "good_night"],
    rate_limit: 20,
    emergency: true,
    override_others: false,
    data_visibility: "minimal",
  },

  child: {
    device_control: "own_room_lights_only",
    lock_security: false,
    thermostat: false,
    camera_access: false,
    media_rating: "G",
    purchase_enabled: false,
    voice_history_access: "none",
    scene_activation: [],
    rate_limit: 10,
    emergency: true,
    override_others: false,
    data_visibility: "none",
  },

  toddler: {
    device_control: "none",
    lock_security: false,
    thermostat: false,
    camera_access: false,
    media_rating: "G",
    purchase_enabled: false,
    voice_history_access: "none",
    scene_activation: [],
    rate_limit: 5,
    emergency: true,
    override_others: false,
    data_visibility: "none",
  },

  adult_visitor: {
    device_control: "explicitly_allowed_only",
    lock_security: false,
    thermostat: { min: 68, max: 76 },
    camera_access: false,
    media_rating: "PG-13",
    purchase_enabled: false,
    voice_history_access: "none",
    scene_activation: [],
    rate_limit: 15,
    emergency: true,
    override_others: false,
    data_visibility: "none",
  },

  assisted_living: {
    device_control: "all",
    lock_security: true,
    thermostat: { min: 65, max: 80 },
    camera_access: false,
    media_rating: "R",
    purchase_enabled: false,
    voice_history_access: "own",
    scene_activation: "all",
    rate_limit: 60,
    emergency: true,
    override_others: false,
    data_visibility: "limited",
  },
};

// ---------------------------------------------------------------------------
// Default agent personality templates per age group
// ---------------------------------------------------------------------------

export const PERSONALITY_TEMPLATES: Record<FamilyAgeGroup, AgentPersonality> = {
  adult: {
    tone: "formal",
    vocabulary_level: "adult",
    humor_level: 0.3,
    encouragement_level: 0.1,
    safety_warnings: false,
    max_response_words: 30,
    forbidden_topics: [],
    custom_greeting: "Good evening.",
    sound_effects: false,
  },

  teenager: {
    tone: "friendly",
    vocabulary_level: "teen",
    humor_level: 0.5,
    encouragement_level: 0.2,
    safety_warnings: false,
    max_response_words: 25,
    forbidden_topics: [
      "security_camera_footage",
      "audit_logs",
      "spending_details",
      "other_users_history",
    ],
    custom_greeting: "Hey! What's up?",
    sound_effects: false,
  },

  tween: {
    tone: "friendly",
    vocabulary_level: "teen",
    humor_level: 0.4,
    encouragement_level: 0.3,
    safety_warnings: true,
    max_response_words: 20,
    forbidden_topics: [
      "security_cameras",
      "locks",
      "alarm_system",
      "spending",
      "audit_logs",
    ],
    custom_greeting: "Hi there!",
    sound_effects: false,
  },

  child: {
    tone: "playful",
    vocabulary_level: "child",
    humor_level: 0.7,
    encouragement_level: 0.8,
    safety_warnings: true,
    max_response_words: 15,
    forbidden_topics: [
      "security",
      "cameras",
      "locks",
      "money",
      "alarm",
      "audit_logs",
      "other_users",
    ],
    custom_greeting: "Hey buddy!",
    sound_effects: true,
  },

  toddler: {
    tone: "nurturing",
    vocabulary_level: "toddler",
    humor_level: 0.9,
    encouragement_level: 1.0,
    safety_warnings: true,
    max_response_words: 10,
    forbidden_topics: [
      "security",
      "cameras",
      "locks",
      "money",
      "alarm",
      "devices",
      "settings",
      "other_users",
    ],
    custom_greeting: "Hi sweetie!",
    sound_effects: true,
  },

  adult_visitor: {
    tone: "friendly",
    vocabulary_level: "adult",
    humor_level: 0.2,
    encouragement_level: 0.1,
    safety_warnings: false,
    max_response_words: 25,
    forbidden_topics: [
      "security_settings",
      "other_users",
      "camera_footage",
      "audit_logs",
      "spending",
    ],
    custom_greeting: "Hello! Welcome.",
    sound_effects: false,
  },

  assisted_living: {
    tone: "nurturing",
    vocabulary_level: "adult",
    humor_level: 0.2,
    encouragement_level: 0.5,
    safety_warnings: true,
    max_response_words: 40,
    forbidden_topics: [],
    custom_greeting: "Good morning! How are you feeling today?",
    sound_effects: false,
  },
};

// ---------------------------------------------------------------------------
// Age-appropriate denial responses
// ---------------------------------------------------------------------------

export const DENIAL_TEMPLATES: Record<FamilyAgeGroup, string> = {
  adult:
    "That device isn't in your allowed list. Contact the home owner for access.",
  teenager:
    "You don't have access to that. Want me to send a request to your parents?",
  tween:
    "I can't do that one, but I can help with your bedroom lights or fan!",
  child:
    "That's a grown-up thing! But hey, want me to tell you a joke instead?",
  toddler:
    "Let's sing a song instead!",
  adult_visitor:
    "That device isn't available for your profile. The homeowner can update your access.",
  assisted_living:
    "I can't do that right now. Would you like me to contact your caregiver?",
};
