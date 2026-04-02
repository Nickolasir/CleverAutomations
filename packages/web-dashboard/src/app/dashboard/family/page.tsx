"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type {
  FamilyMemberProfile,
  FamilyAgeGroup,
  AgentPersonality,
  FamilyPermissionOverride,
  FamilySchedule,
  FamilySpendingLimit,
  PermissionAction,
  ScheduleRestrictions,
  DefaultPermissionSet,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Static data from default-matrices (inlined to avoid server-only import issues)
// ---------------------------------------------------------------------------

const AGE_GROUPS: FamilyAgeGroup[] = [
  "adult",
  "teenager",
  "tween",
  "child",
  "toddler",
  "adult_visitor",
  "assisted_living",
];

const AGE_GROUP_LABELS: Record<FamilyAgeGroup, string> = {
  adult: "Adult",
  teenager: "Teenager",
  tween: "Tween",
  child: "Child",
  toddler: "Toddler",
  adult_visitor: "Visitor",
  assisted_living: "Assisted Living",
};

const AGE_GROUP_BADGE_COLORS: Record<FamilyAgeGroup, string> = {
  adult: "bg-brand-100 text-brand-700",
  teenager: "bg-purple-100 text-purple-700",
  tween: "bg-blue-100 text-blue-700",
  child: "bg-green-100 text-green-700",
  toddler: "bg-pink-100 text-pink-700",
  adult_visitor: "bg-slate-100 text-slate-700",
  assisted_living: "bg-amber-100 text-amber-700",
};

const DEFAULT_PERMISSIONS: Record<FamilyAgeGroup, DefaultPermissionSet> = {
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

const PERSONALITY_TEMPLATES: Record<FamilyAgeGroup, AgentPersonality> = {
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
    forbidden_topics: ["security_camera_footage", "audit_logs", "spending_details", "other_users_history"],
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
    forbidden_topics: ["security_cameras", "locks", "alarm_system", "spending", "audit_logs"],
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
    forbidden_topics: ["security", "cameras", "locks", "money", "alarm", "audit_logs", "other_users"],
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
    forbidden_topics: ["security", "cameras", "locks", "money", "alarm", "devices", "settings", "other_users"],
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
    forbidden_topics: ["security_settings", "other_users", "camera_footage", "audit_logs", "spending"],
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
// Helpers
// ---------------------------------------------------------------------------

type TabId = "members" | "permissions" | "schedules" | "spending";

interface UserBasic {
  id: string;
  display_name: string;
  email: string;
}

type MemberWithUser = FamilyMemberProfile & {
  users?: { display_name: string; email: string } | null;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PERMISSION_ACTIONS: PermissionAction[] = ["control", "view_state", "configure", "view_history"];

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Permission matrix row definitions
// ---------------------------------------------------------------------------

interface MatrixRow {
  label: string;
  render: (p: DefaultPermissionSet) => { text: string; color: "green" | "red" | "amber" };
}

const MATRIX_ROWS: MatrixRow[] = [
  {
    label: "Device Control",
    render: (p) => {
      if (p.device_control === "all") return { text: "All", color: "green" };
      if (p.device_control === "none") return { text: "None", color: "red" };
      return { text: p.device_control.replace(/_/g, " "), color: "amber" };
    },
  },
  {
    label: "Lock / Security",
    render: (p) =>
      p.lock_security
        ? { text: "Allowed", color: "green" }
        : { text: "Denied", color: "red" },
  },
  {
    label: "Thermostat",
    render: (p) => {
      if (p.thermostat === false) return { text: "Denied", color: "red" };
      return { text: `${p.thermostat.min}-${p.thermostat.max} F`, color: "amber" };
    },
  },
  {
    label: "Camera Access",
    render: (p) =>
      p.camera_access
        ? { text: "Allowed", color: "green" }
        : { text: "Denied", color: "red" },
  },
  {
    label: "Media Rating",
    render: (p) => {
      if (p.media_rating === "R") return { text: "R", color: "green" };
      if (p.media_rating === "G") return { text: "G", color: "red" };
      return { text: p.media_rating, color: "amber" };
    },
  },
  {
    label: "Purchases",
    render: (p) =>
      p.purchase_enabled
        ? { text: "Enabled", color: "green" }
        : { text: "Disabled", color: "red" },
  },
  {
    label: "Voice History",
    render: (p) => {
      if (p.voice_history_access === "all") return { text: "All", color: "green" };
      if (p.voice_history_access === "own") return { text: "Own only", color: "amber" };
      return { text: "None", color: "red" };
    },
  },
  {
    label: "Scenes",
    render: (p) => {
      if (p.scene_activation === "all") return { text: "All", color: "green" };
      if (Array.isArray(p.scene_activation) && p.scene_activation.length === 0)
        return { text: "None", color: "red" };
      return {
        text: `${(p.scene_activation as string[]).length} scenes`,
        color: "amber",
      };
    },
  },
  {
    label: "Rate Limit",
    render: (p) => {
      if (p.rate_limit >= 60) return { text: `${p.rate_limit}/min`, color: "green" };
      if (p.rate_limit <= 10) return { text: `${p.rate_limit}/min`, color: "red" };
      return { text: `${p.rate_limit}/min`, color: "amber" };
    },
  },
];

const CELL_COLORS = {
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
};

// ===========================================================================
// Page Component
// ===========================================================================

export default function FamilyPage() {
  const { tenantId, canManageUsers } = useAuth();
  const supabase = createBrowserClient();

  // ---- State ----
  const [activeTab, setActiveTab] = useState<TabId>("members");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Members
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [tenantUsers, setTenantUsers] = useState<UserBasic[]>([]);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberFormLoading, setMemberFormLoading] = useState(false);

  // Member form fields
  const [formUserId, setFormUserId] = useState("");
  const [formAgeGroup, setFormAgeGroup] = useState<FamilyAgeGroup>("adult");
  const [formAgentName, setFormAgentName] = useState("");
  const [formAgentVoiceId, setFormAgentVoiceId] = useState("");
  const [formManagedBy, setFormManagedBy] = useState("");
  const [formDateOfBirth, setFormDateOfBirth] = useState("");
  const [formExpiresAt, setFormExpiresAt] = useState("");

  // Permissions
  const [overrides, setOverrides] = useState<FamilyPermissionOverride[]>([]);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideFormLoading, setOverrideFormLoading] = useState(false);
  const [overrideProfileId, setOverrideProfileId] = useState("");
  const [overrideDeviceCategory, setOverrideDeviceCategory] = useState("");
  const [overrideRoom, setOverrideRoom] = useState("");
  const [overrideAction, setOverrideAction] = useState<PermissionAction>("control");
  const [overrideAllowed, setOverrideAllowed] = useState(true);

  // Schedules
  const [schedules, setSchedules] = useState<FamilySchedule[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleFormLoading, setScheduleFormLoading] = useState(false);
  const [schedProfileId, setSchedProfileId] = useState("");
  const [schedName, setSchedName] = useState("");
  const [schedDays, setSchedDays] = useState<number[]>([]);
  const [schedStart, setSchedStart] = useState("21:00");
  const [schedEnd, setSchedEnd] = useState("07:00");
  const [schedBlockedCategories, setSchedBlockedCategories] = useState("");
  const [schedBlockedRooms, setSchedBlockedRooms] = useState("");
  const [schedVolumeCap, setSchedVolumeCap] = useState("");
  const [schedNotification, setSchedNotification] = useState("");

  // Spending
  const [spendingLimits, setSpendingLimits] = useState<FamilySpendingLimit[]>([]);
  const [showSpendingForm, setShowSpendingForm] = useState(false);
  const [spendingFormLoading, setSpendingFormLoading] = useState(false);
  const [spendProfileId, setSpendProfileId] = useState("");
  const [spendDaily, setSpendDaily] = useState("0");
  const [spendMonthly, setSpendMonthly] = useState("0");
  const [spendApprovalAbove, setSpendApprovalAbove] = useState("");
  const [spendCategories, setSpendCategories] = useState("");

  // ---- Data fetching ----

  const fetchMembers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("family_member_profiles")
        .select("*, users!family_member_profiles_user_id_fkey(display_name, email)")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });

      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }
      setMembers((data as unknown as MemberWithUser[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch family members");
    }
  }, [tenantId, supabase]);

  const fetchTenantUsers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data } = await supabase
        .from("users")
        .select("id, display_name, email")
        .eq("tenant_id", tenantId as string)
        .order("display_name");

      setTenantUsers((data as unknown as UserBasic[]) ?? []);
    } catch {
      /* non-critical */
    }
  }, [tenantId, supabase]);

  const fetchOverrides = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("family_permission_overrides")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });

      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }
      setOverrides((data as unknown as FamilyPermissionOverride[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch overrides");
    }
  }, [tenantId, supabase]);

  const fetchSchedules = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("family_schedules")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });

      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }
      setSchedules((data as unknown as FamilySchedule[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch schedules");
    }
  }, [tenantId, supabase]);

  const fetchSpendingLimits = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("family_spending_limits")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });

      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }
      setSpendingLimits((data as unknown as FamilySpendingLimit[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch spending limits");
    }
  }, [tenantId, supabase]);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([
        fetchMembers(),
        fetchTenantUsers(),
        fetchOverrides(),
        fetchSchedules(),
        fetchSpendingLimits(),
      ]);
      setLoading(false);
    };
    void loadAll();
  }, [fetchMembers, fetchTenantUsers, fetchOverrides, fetchSchedules, fetchSpendingLimits]);

  // ---- Helpers ----

  const adultMembers = members.filter(
    (m) => m.age_group === "adult" || m.age_group === "assisted_living"
  );

  const nonAdultMembers = members.filter(
    (m) => m.age_group !== "adult" && m.age_group !== "adult_visitor"
  );

  const memberName = (profileId: string): string => {
    const m = members.find((mb) => mb.id === profileId);
    return m?.users?.display_name ?? m?.agent_name ?? profileId.slice(0, 8);
  };

  const householdAgeGroups = Array.from(new Set(members.map((m) => m.age_group)));

  // ---- Member form handlers ----

  const resetMemberForm = () => {
    setFormUserId("");
    setFormAgeGroup("adult");
    setFormAgentName("");
    setFormAgentVoiceId("");
    setFormManagedBy("");
    setFormDateOfBirth("");
    setFormExpiresAt("");
    setEditingMemberId(null);
    setShowMemberForm(false);
  };

  const openEditMember = (m: MemberWithUser) => {
    setEditingMemberId(m.id);
    setFormUserId(m.user_id as string);
    setFormAgeGroup(m.age_group);
    setFormAgentName(m.agent_name);
    setFormAgentVoiceId(m.agent_voice_id ?? "");
    setFormManagedBy((m.managed_by as string) ?? "");
    setFormDateOfBirth(m.date_of_birth ?? "");
    setFormExpiresAt(m.expires_at ?? "");
    setShowMemberForm(true);
  };

  const handleSaveMember = async () => {
    if (!tenantId || !formUserId || !formAgentName.trim()) return;

    setMemberFormLoading(true);
    setError(null);

    const personality = PERSONALITY_TEMPLATES[formAgeGroup];
    const payload = {
      tenant_id: tenantId,
      user_id: formUserId,
      age_group: formAgeGroup,
      agent_name: formAgentName.trim(),
      agent_voice_id: formAgentVoiceId.trim() || null,
      agent_personality: personality,
      managed_by: formManagedBy || null,
      date_of_birth: formDateOfBirth || null,
      expires_at: formExpiresAt || null,
      is_active: true,
    };

    try {
      if (editingMemberId) {
        const { error: updateErr } = await supabase
          .from("family_member_profiles")
          .update(payload)
          .eq("id", editingMemberId);

        if (updateErr) {
          setError(updateErr.message);
          return;
        }
      } else {
        const { error: insertErr } = await supabase
          .from("family_member_profiles")
          .insert(payload);

        if (insertErr) {
          setError(insertErr.message);
          return;
        }
      }

      resetMemberForm();
      await fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save member");
    } finally {
      setMemberFormLoading(false);
    }
  };

  const handleDeleteMember = async (id: string, name: string) => {
    if (!confirm(`Deactivate ${name}? They will lose their personal agent profile.`)) return;

    try {
      const { error: delErr } = await supabase
        .from("family_member_profiles")
        .update({ is_active: false })
        .eq("id", id);

      if (delErr) {
        setError(delErr.message);
        return;
      }
      await fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate member");
    }
  };

  // ---- Override handlers ----

  const resetOverrideForm = () => {
    setOverrideProfileId("");
    setOverrideDeviceCategory("");
    setOverrideRoom("");
    setOverrideAction("control");
    setOverrideAllowed(true);
    setShowOverrideForm(false);
  };

  const handleSaveOverride = async () => {
    if (!tenantId || !overrideProfileId) return;

    setOverrideFormLoading(true);
    setError(null);

    try {
      const { error: insertErr } = await supabase
        .from("family_permission_overrides")
        .insert({
          tenant_id: tenantId,
          profile_id: overrideProfileId,
          device_id: null,
          device_category: overrideDeviceCategory || null,
          room: overrideRoom || null,
          action: overrideAction,
          allowed: overrideAllowed,
          constraints: {},
        });

      if (insertErr) {
        setError(insertErr.message);
        return;
      }

      resetOverrideForm();
      await fetchOverrides();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
    } finally {
      setOverrideFormLoading(false);
    }
  };

  const handleDeleteOverride = async (id: string) => {
    if (!confirm("Remove this permission override?")) return;

    try {
      const { error: delErr } = await supabase
        .from("family_permission_overrides")
        .delete()
        .eq("id", id);

      if (delErr) {
        setError(delErr.message);
        return;
      }
      await fetchOverrides();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete override");
    }
  };

  // ---- Schedule handlers ----

  const resetScheduleForm = () => {
    setSchedProfileId("");
    setSchedName("");
    setSchedDays([]);
    setSchedStart("21:00");
    setSchedEnd("07:00");
    setSchedBlockedCategories("");
    setSchedBlockedRooms("");
    setSchedVolumeCap("");
    setSchedNotification("");
    setShowScheduleForm(false);
  };

  const toggleSchedDay = (day: number) => {
    setSchedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleSaveSchedule = async () => {
    if (!tenantId || !schedProfileId || !schedName.trim() || schedDays.length === 0) return;

    setScheduleFormLoading(true);
    setError(null);

    const restrictions: ScheduleRestrictions = {};
    if (schedBlockedCategories.trim()) {
      restrictions.blocked_device_categories = schedBlockedCategories
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as ScheduleRestrictions["blocked_device_categories"];
    }
    if (schedBlockedRooms.trim()) {
      restrictions.blocked_rooms = schedBlockedRooms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (schedVolumeCap.trim()) {
      restrictions.volume_cap = parseFloat(schedVolumeCap);
    }
    if (schedNotification.trim()) {
      restrictions.notification_message = schedNotification.trim();
    }

    try {
      const { error: insertErr } = await supabase.from("family_schedules").insert({
        tenant_id: tenantId,
        profile_id: schedProfileId,
        schedule_name: schedName.trim(),
        days_of_week: schedDays,
        start_time: schedStart,
        end_time: schedEnd,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        restrictions,
        is_active: true,
      });

      if (insertErr) {
        setError(insertErr.message);
        return;
      }

      resetScheduleForm();
      await fetchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setScheduleFormLoading(false);
    }
  };

  const toggleScheduleActive = async (id: string, currentlyActive: boolean) => {
    try {
      const { error: updateErr } = await supabase
        .from("family_schedules")
        .update({ is_active: !currentlyActive })
        .eq("id", id);

      if (updateErr) {
        setError(updateErr.message);
        return;
      }
      await fetchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle schedule");
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm("Delete this schedule?")) return;

    try {
      const { error: delErr } = await supabase
        .from("family_schedules")
        .delete()
        .eq("id", id);

      if (delErr) {
        setError(delErr.message);
        return;
      }
      await fetchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule");
    }
  };

  // ---- Spending handlers ----

  const resetSpendingForm = () => {
    setSpendProfileId("");
    setSpendDaily("0");
    setSpendMonthly("0");
    setSpendApprovalAbove("");
    setSpendCategories("");
    setShowSpendingForm(false);
  };

  const handleSaveSpending = async () => {
    if (!tenantId || !spendProfileId) return;

    setSpendingFormLoading(true);
    setError(null);

    try {
      // Upsert: check if a row exists for this profile
      const { data: existing } = await supabase
        .from("family_spending_limits")
        .select("id")
        .eq("profile_id", spendProfileId)
        .eq("tenant_id", tenantId as string)
        .maybeSingle();

      const payload = {
        tenant_id: tenantId,
        profile_id: spendProfileId,
        daily_limit: parseFloat(spendDaily) || 0,
        monthly_limit: parseFloat(spendMonthly) || 0,
        requires_approval_above:
          spendApprovalAbove.trim() ? parseFloat(spendApprovalAbove) : null,
        approved_categories: spendCategories
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      if (existing?.id) {
        const { error: updateErr } = await supabase
          .from("family_spending_limits")
          .update(payload)
          .eq("id", existing.id);

        if (updateErr) {
          setError(updateErr.message);
          return;
        }
      } else {
        const { error: insertErr } = await supabase
          .from("family_spending_limits")
          .insert(payload);

        if (insertErr) {
          setError(insertErr.message);
          return;
        }
      }

      resetSpendingForm();
      await fetchSpendingLimits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save spending limits");
    } finally {
      setSpendingFormLoading(false);
    }
  };

  // ---- Access check ----

  if (!canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-semibold text-slate-900">Access Denied</p>
        <p className="mt-1 text-sm text-slate-500">
          You need admin or owner access to manage family members.
        </p>
      </div>
    );
  }

  // ---- Loading ----

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Family</h2>
        <div className="card animate-pulse">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- Tab config ----

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "members", label: "Members", count: members.length },
    { id: "permissions", label: "Permissions" },
    { id: "schedules", label: "Schedules", count: schedules.length },
    { id: "spending", label: "Spending Limits", count: spendingLimits.length },
  ];

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Family Management</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage family members, permissions, schedules, and spending limits.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    activeTab === tab.id
                      ? "bg-brand-50 text-brand-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ================================================================== */}
      {/* TAB 1: MEMBERS                                                     */}
      {/* ================================================================== */}
      {activeTab === "members" && (
        <div className="space-y-6">
          {/* Add button */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                resetMemberForm();
                setShowMemberForm(true);
              }}
              className="btn-primary"
            >
              Add Family Member
            </button>
          </div>

          {/* Member form */}
          {showMemberForm && (
            <div className="card">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">
                {editingMemberId ? "Edit Family Member" : "Add Family Member"}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* User selector */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    User
                  </label>
                  <select
                    value={formUserId}
                    onChange={(e) => setFormUserId(e.target.value)}
                    className="input-field"
                    disabled={!!editingMemberId}
                  >
                    <option value="">Select a user...</option>
                    {tenantUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Age group */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Age Group
                  </label>
                  <select
                    value={formAgeGroup}
                    onChange={(e) => setFormAgeGroup(e.target.value as FamilyAgeGroup)}
                    className="input-field"
                  >
                    {AGE_GROUPS.map((ag) => (
                      <option key={ag} value={ag}>
                        {AGE_GROUP_LABELS[ag]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Agent name */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={formAgentName}
                    onChange={(e) => setFormAgentName(e.target.value)}
                    placeholder="e.g. Jarvis, Luna, Buddy"
                    className="input-field"
                  />
                </div>

                {/* Voice ID */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Agent Voice ID{" "}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formAgentVoiceId}
                    onChange={(e) => setFormAgentVoiceId(e.target.value)}
                    placeholder="Cartesia voice ID"
                    className="input-field"
                  />
                </div>

                {/* Managed by */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Managed By
                  </label>
                  <select
                    value={formManagedBy}
                    onChange={(e) => setFormManagedBy(e.target.value)}
                    className="input-field"
                  >
                    <option value="">None (self-managed)</option>
                    {adultMembers.map((am) => (
                      <option key={am.user_id as string} value={am.user_id as string}>
                        {am.users?.display_name ?? am.agent_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date of birth */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Date of Birth{" "}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={formDateOfBirth}
                    onChange={(e) => setFormDateOfBirth(e.target.value)}
                    className="input-field"
                  />
                </div>

                {/* Expires at (for visitors) */}
                {(formAgeGroup === "adult_visitor" ||
                  formExpiresAt) && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Expires At{" "}
                      <span className="font-normal text-slate-400">(visitors)</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={formExpiresAt}
                      onChange={(e) => setFormExpiresAt(e.target.value)}
                      className="input-field"
                    />
                  </div>
                )}
              </div>

              {/* Personality preview */}
              <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-semibold text-brand-700">
                  Auto-generated personality for {AGE_GROUP_LABELS[formAgeGroup]}
                </p>
                <p className="mt-1 text-xs text-brand-600">
                  Tone: {PERSONALITY_TEMPLATES[formAgeGroup].tone} | Vocabulary:{" "}
                  {PERSONALITY_TEMPLATES[formAgeGroup].vocabulary_level} | Greeting: &ldquo;
                  {PERSONALITY_TEMPLATES[formAgeGroup].custom_greeting}&rdquo;
                </p>
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleSaveMember}
                  disabled={!formUserId || !formAgentName.trim() || memberFormLoading}
                  className="btn-primary"
                >
                  {memberFormLoading
                    ? "Saving..."
                    : editingMemberId
                      ? "Update Member"
                      : "Add Member"}
                </button>
                <button onClick={resetMemberForm} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Member cards */}
          {members.length === 0 ? (
            <div className="card text-center">
              <p className="text-sm text-slate-500">
                No family members yet. Add your first member to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <div
                  key={m.id}
                  className={`card relative transition-opacity ${
                    !m.is_active ? "opacity-50" : ""
                  }`}
                >
                  {/* Active indicator */}
                  {!m.is_active && (
                    <span className="absolute right-3 top-3 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">
                      Inactive
                    </span>
                  )}

                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                      {initials(m.users?.display_name ?? m.agent_name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Name + email */}
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {m.users?.display_name ?? "Unknown User"}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {m.users?.email}
                      </p>

                      {/* Age group badge */}
                      <span
                        className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          AGE_GROUP_BADGE_COLORS[m.age_group]
                        }`}
                      >
                        {AGE_GROUP_LABELS[m.age_group]}
                      </span>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Agent</span>
                      <span className="font-semibold text-brand-600">
                        {m.agent_name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Wake Word</span>
                      <span>&ldquo;Hey {m.agent_name}&rdquo;</span>
                    </div>
                    {m.managed_by && (
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-500">Managed by</span>
                        <span>{memberName(m.managed_by as string)}</span>
                      </div>
                    )}
                    {m.expires_at && (
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-500">Expires</span>
                        <span>{new Date(m.expires_at).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    <button
                      onClick={() => openEditMember(m)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      Edit
                    </button>
                    {m.is_active && (
                      <button
                        onClick={() =>
                          handleDeleteMember(
                            m.id,
                            m.users?.display_name ?? m.agent_name
                          )
                        }
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 2: PERMISSIONS                                                 */}
      {/* ================================================================== */}
      {activeTab === "permissions" && (
        <div className="space-y-8">
          {/* Permission matrix */}
          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-900">
              Default Permission Matrix
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              Baseline permissions by age group. Parents can override these per member.
            </p>

            <div className="card overflow-hidden !p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Permission
                      </th>
                      {(householdAgeGroups.length > 0
                        ? householdAgeGroups
                        : AGE_GROUPS
                      ).map((ag) => (
                        <th key={ag} className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${AGE_GROUP_BADGE_COLORS[ag]}`}
                          >
                            {AGE_GROUP_LABELS[ag]}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {MATRIX_ROWS.map((row) => (
                      <tr key={row.label} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-700">
                          {row.label}
                        </td>
                        {(householdAgeGroups.length > 0
                          ? householdAgeGroups
                          : AGE_GROUPS
                        ).map((ag) => {
                          const cell = row.render(DEFAULT_PERMISSIONS[ag]);
                          return (
                            <td key={ag} className="px-3 py-3 text-center">
                              <span
                                className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${CELL_COLORS[cell.color]}`}
                              >
                                {cell.text}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Permission overrides */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Permission Overrides
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  Per-member exceptions to the default matrix.
                </p>
              </div>
              <button
                onClick={() => {
                  resetOverrideForm();
                  setShowOverrideForm(true);
                }}
                className="btn-primary"
              >
                Add Override
              </button>
            </div>

            {/* Override form */}
            {showOverrideForm && (
              <div className="card mb-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">
                  New Permission Override
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Family Member
                    </label>
                    <select
                      value={overrideProfileId}
                      onChange={(e) => setOverrideProfileId(e.target.value)}
                      className="input-field"
                    >
                      <option value="">Select member...</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.users?.display_name ?? m.agent_name} (
                          {AGE_GROUP_LABELS[m.age_group]})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Device Category{" "}
                      <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={overrideDeviceCategory}
                      onChange={(e) => setOverrideDeviceCategory(e.target.value)}
                      placeholder="e.g. light, lock, thermostat"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Room{" "}
                      <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={overrideRoom}
                      onChange={(e) => setOverrideRoom(e.target.value)}
                      placeholder="e.g. bedroom, kitchen"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Action
                    </label>
                    <select
                      value={overrideAction}
                      onChange={(e) =>
                        setOverrideAction(e.target.value as PermissionAction)
                      }
                      className="input-field"
                    >
                      {PERMISSION_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Decision
                    </label>
                    <div className="flex items-center gap-4 pt-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="override-allowed"
                          checked={overrideAllowed}
                          onChange={() => setOverrideAllowed(true)}
                          className="text-brand-600 focus:ring-brand-500"
                        />
                        <span className="font-medium text-green-700">Allow</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="override-allowed"
                          checked={!overrideAllowed}
                          onChange={() => setOverrideAllowed(false)}
                          className="text-brand-600 focus:ring-brand-500"
                        />
                        <span className="font-medium text-red-700">Deny</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleSaveOverride}
                    disabled={!overrideProfileId || overrideFormLoading}
                    className="btn-primary"
                  >
                    {overrideFormLoading ? "Saving..." : "Save Override"}
                  </button>
                  <button onClick={resetOverrideForm} className="btn-secondary">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Override list grouped by member */}
            {overrides.length === 0 ? (
              <div className="card text-center">
                <p className="text-sm text-slate-500">
                  No permission overrides. All members use default age-group permissions.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {Array.from(new Set(overrides.map((o) => o.profile_id))).map(
                  (profileId) => {
                    const memberOverrides = overrides.filter(
                      (o) => o.profile_id === profileId
                    );
                    return (
                      <div key={profileId} className="card">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">
                          {memberName(profileId)}
                        </h4>
                        <div className="space-y-2">
                          {memberOverrides.map((o) => (
                            <div
                              key={o.id}
                              className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                            >
                              <div className="flex items-center gap-3 text-xs">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
                                    o.allowed
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {o.allowed ? "Allow" : "Deny"}
                                </span>
                                <span className="font-medium text-slate-700">
                                  {o.action.replace(/_/g, " ")}
                                </span>
                                {o.device_category && (
                                  <span className="badge">{o.device_category}</span>
                                )}
                                {o.room && (
                                  <span className="badge">{o.room}</span>
                                )}
                              </div>
                              <button
                                onClick={() => handleDeleteOverride(o.id)}
                                className="text-xs text-red-600 hover:text-red-700"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 3: SCHEDULES                                                   */}
      {/* ================================================================== */}
      {activeTab === "schedules" && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => {
                resetScheduleForm();
                setShowScheduleForm(true);
              }}
              className="btn-primary"
            >
              Add Schedule
            </button>
          </div>

          {/* Schedule form */}
          {showScheduleForm && (
            <div className="card">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">
                New Schedule
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Family Member
                  </label>
                  <select
                    value={schedProfileId}
                    onChange={(e) => setSchedProfileId(e.target.value)}
                    className="input-field"
                  >
                    <option value="">Select member...</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.users?.display_name ?? m.agent_name} (
                        {AGE_GROUP_LABELS[m.age_group]})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Schedule Name
                  </label>
                  <input
                    type="text"
                    value={schedName}
                    onChange={(e) => setSchedName(e.target.value)}
                    placeholder="e.g. Bedtime, School Hours"
                    className="input-field"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Days
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_LABELS.map((label, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleSchedDay(idx)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          schedDays.includes(idx)
                            ? "bg-brand-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={schedStart}
                    onChange={(e) => setSchedStart(e.target.value)}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={schedEnd}
                    onChange={(e) => setSchedEnd(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>

              {/* Restrictions */}
              <div className="mt-4 border-t border-slate-200 pt-4">
                <p className="mb-3 text-sm font-medium text-slate-700">Restrictions</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Blocked Categories{" "}
                      <span className="font-normal text-slate-400">
                        (comma-separated)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={schedBlockedCategories}
                      onChange={(e) => setSchedBlockedCategories(e.target.value)}
                      placeholder="e.g. media, speaker, tv"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Blocked Rooms{" "}
                      <span className="font-normal text-slate-400">
                        (comma-separated)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={schedBlockedRooms}
                      onChange={(e) => setSchedBlockedRooms(e.target.value)}
                      placeholder="e.g. living room, game room"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Volume Cap{" "}
                      <span className="font-normal text-slate-400">(0.0 - 1.0)</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={schedVolumeCap}
                      onChange={(e) => setSchedVolumeCap(e.target.value)}
                      placeholder="0.3"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Notification Message
                    </label>
                    <input
                      type="text"
                      value={schedNotification}
                      onChange={(e) => setSchedNotification(e.target.value)}
                      placeholder="e.g. It's bedtime! Time to sleep."
                      className="input-field"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleSaveSchedule}
                  disabled={
                    !schedProfileId ||
                    !schedName.trim() ||
                    schedDays.length === 0 ||
                    scheduleFormLoading
                  }
                  className="btn-primary"
                >
                  {scheduleFormLoading ? "Saving..." : "Save Schedule"}
                </button>
                <button onClick={resetScheduleForm} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Schedule cards */}
          {schedules.length === 0 ? (
            <div className="card text-center">
              <p className="text-sm text-slate-500">
                No schedules configured. Add a bedtime or school hours schedule.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className={`card transition-opacity ${
                    !s.is_active ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {s.schedule_name}
                      </p>
                      <p className="text-xs text-slate-500">{memberName(s.profile_id)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleScheduleActive(s.id, s.is_active)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          s.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {s.is_active ? "Active" : "Inactive"}
                      </button>
                      <button
                        onClick={() => handleDeleteSchedule(s.id)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Days */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.days_of_week.map((d) => (
                      <span
                        key={d}
                        className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                      >
                        {DAY_LABELS[d]}
                      </span>
                    ))}
                  </div>

                  {/* Time range */}
                  <p className="mt-2 text-xs text-slate-600">
                    {s.start_time} - {s.end_time}
                  </p>

                  {/* Restrictions summary */}
                  {s.restrictions && (
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      {s.restrictions.blocked_device_categories &&
                        s.restrictions.blocked_device_categories.length > 0 && (
                          <p>
                            Blocked categories:{" "}
                            {s.restrictions.blocked_device_categories.join(", ")}
                          </p>
                        )}
                      {s.restrictions.blocked_rooms &&
                        s.restrictions.blocked_rooms.length > 0 && (
                          <p>Blocked rooms: {s.restrictions.blocked_rooms.join(", ")}</p>
                        )}
                      {s.restrictions.volume_cap !== undefined && (
                        <p>Volume cap: {Math.round(s.restrictions.volume_cap * 100)}%</p>
                      )}
                      {s.restrictions.notification_message && (
                        <p className="italic">
                          &ldquo;{s.restrictions.notification_message}&rdquo;
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 4: SPENDING LIMITS                                             */}
      {/* ================================================================== */}
      {activeTab === "spending" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Spending limits apply to non-adult family members. Adults manage their own
              purchases.
            </p>
            <button
              onClick={() => {
                resetSpendingForm();
                setShowSpendingForm(true);
              }}
              className="btn-primary"
            >
              Set Limits
            </button>
          </div>

          {/* Spending form */}
          {showSpendingForm && (
            <div className="card">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">
                Set Spending Limits
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Family Member
                  </label>
                  <select
                    value={spendProfileId}
                    onChange={(e) => setSpendProfileId(e.target.value)}
                    className="input-field"
                  >
                    <option value="">Select member...</option>
                    {nonAdultMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.users?.display_name ?? m.agent_name} (
                        {AGE_GROUP_LABELS[m.age_group]})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Daily Limit ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendDaily}
                    onChange={(e) => setSpendDaily(e.target.value)}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Monthly Limit ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendMonthly}
                    onChange={(e) => setSpendMonthly(e.target.value)}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Approval Required Above ($){" "}
                    <span className="font-normal text-slate-400">
                      (blank = all need approval)
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendApprovalAbove}
                    onChange={(e) => setSpendApprovalAbove(e.target.value)}
                    placeholder="e.g. 5.00"
                    className="input-field"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Approved Categories{" "}
                    <span className="font-normal text-slate-400">
                      (comma-separated)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={spendCategories}
                    onChange={(e) => setSpendCategories(e.target.value)}
                    placeholder="e.g. games, books, music"
                    className="input-field"
                  />
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleSaveSpending}
                  disabled={!spendProfileId || spendingFormLoading}
                  className="btn-primary"
                >
                  {spendingFormLoading ? "Saving..." : "Save Limits"}
                </button>
                <button onClick={resetSpendingForm} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Spending cards */}
          {spendingLimits.length === 0 ? (
            <div className="card text-center">
              <p className="text-sm text-slate-500">
                No spending limits configured. Set limits for non-adult family members.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {spendingLimits.map((sl) => (
                <div key={sl.id} className="card">
                  <p className="text-sm font-semibold text-slate-900">
                    {memberName(sl.profile_id)}
                  </p>

                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2">
                      <span className="text-xs font-medium text-brand-700">
                        Daily Limit
                      </span>
                      <span className="text-sm font-bold text-brand-800">
                        ${sl.daily_limit.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2">
                      <span className="text-xs font-medium text-brand-700">
                        Monthly Limit
                      </span>
                      <span className="text-sm font-bold text-brand-800">
                        ${sl.monthly_limit.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Approval above</span>
                      <span className="font-medium">
                        {sl.requires_approval_above !== null
                          ? `$${sl.requires_approval_above.toFixed(2)}`
                          : "All purchases"}
                      </span>
                    </div>
                    {sl.approved_categories.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sl.approved_categories.map((cat) => (
                          <span
                            key={cat}
                            className="badge"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
