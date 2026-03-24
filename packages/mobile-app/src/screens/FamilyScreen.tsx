import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  FamilyMemberProfile,
  FamilyAgeGroup,
  FamilySchedule,
  FamilySpendingLimit,
} from "@clever/shared";
import type { User, UserId } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabKey = "members" | "permissions" | "schedules" | "spending";

const TABS: { key: TabKey; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "permissions", label: "Permissions" },
  { key: "schedules", label: "Schedules" },
  { key: "spending", label: "Spending" },
];

const AGE_GROUP_COLORS: Record<FamilyAgeGroup, string> = {
  adult: "#D4A843",
  teenager: "#8B5CF6",
  tween: "#3B82F6",
  child: "#22C55E",
  toddler: "#EC4899",
  adult_visitor: "#64748B",
  assisted_living: "#F59E0B",
};

const AGE_GROUP_BG: Record<FamilyAgeGroup, string> = {
  adult: "#FFF8E1",
  teenager: "#EDE9FE",
  tween: "#DBEAFE",
  child: "#DCFCE7",
  toddler: "#FCE7F3",
  adult_visitor: "#F1F5F9",
  assisted_living: "#FEF3C7",
};

const AGE_GROUP_LABELS: Record<FamilyAgeGroup, string> = {
  adult: "Adult",
  teenager: "Teenager",
  tween: "Tween",
  child: "Child",
  toddler: "Toddler",
  adult_visitor: "Visitor",
  assisted_living: "Assisted",
};

const ALL_AGE_GROUPS: FamilyAgeGroup[] = [
  "adult",
  "teenager",
  "tween",
  "child",
  "toddler",
  "adult_visitor",
  "assisted_living",
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Permission matrix defaults
// ---------------------------------------------------------------------------

type PermissionValue = "allowed" | "denied" | "constrained";

interface PermissionRow {
  label: string;
  key: string;
}

const PERMISSION_ROWS: PermissionRow[] = [
  { label: "Device Control", key: "device_control" },
  { label: "Locks", key: "locks" },
  { label: "Thermostat", key: "thermostat" },
  { label: "Cameras", key: "cameras" },
  { label: "Media Rating", key: "media_rating" },
  { label: "Purchases", key: "purchases" },
  { label: "Voice History", key: "voice_history" },
  { label: "Rate Limit", key: "rate_limit" },
];

const DEFAULT_MATRICES: Record<
  FamilyAgeGroup,
  Record<string, PermissionValue>
> = {
  adult: {
    device_control: "allowed",
    locks: "allowed",
    thermostat: "allowed",
    cameras: "allowed",
    media_rating: "allowed",
    purchases: "allowed",
    voice_history: "allowed",
    rate_limit: "allowed",
  },
  teenager: {
    device_control: "allowed",
    locks: "denied",
    thermostat: "constrained",
    cameras: "denied",
    media_rating: "constrained",
    purchases: "denied",
    voice_history: "constrained",
    rate_limit: "constrained",
  },
  tween: {
    device_control: "constrained",
    locks: "denied",
    thermostat: "constrained",
    cameras: "denied",
    media_rating: "constrained",
    purchases: "denied",
    voice_history: "denied",
    rate_limit: "constrained",
  },
  child: {
    device_control: "constrained",
    locks: "denied",
    thermostat: "denied",
    cameras: "denied",
    media_rating: "constrained",
    purchases: "denied",
    voice_history: "denied",
    rate_limit: "constrained",
  },
  toddler: {
    device_control: "denied",
    locks: "denied",
    thermostat: "denied",
    cameras: "denied",
    media_rating: "constrained",
    purchases: "denied",
    voice_history: "denied",
    rate_limit: "denied",
  },
  adult_visitor: {
    device_control: "constrained",
    locks: "constrained",
    thermostat: "constrained",
    cameras: "denied",
    media_rating: "allowed",
    purchases: "denied",
    voice_history: "denied",
    rate_limit: "constrained",
  },
  assisted_living: {
    device_control: "allowed",
    locks: "allowed",
    thermostat: "allowed",
    cameras: "allowed",
    media_rating: "allowed",
    purchases: "constrained",
    voice_history: "allowed",
    rate_limit: "allowed",
  },
};

const PERMISSION_CELL_COLORS: Record<PermissionValue, string> = {
  allowed: "#22C55E",
  denied: "#EF4444",
  constrained: "#F59E0B",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (
      (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
    ).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Extended types for joined data
// ---------------------------------------------------------------------------

interface MemberWithUser extends FamilyMemberProfile {
  user_display_name: string;
  user_email: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FamilyScreen() {
  const { user: currentUser } = useAuthContext();
  const insets = useSafeAreaInsets();

  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "owner";
  const tenantId = currentUser?.tenant_id;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabKey>("members");

  // Members state
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [tenantUsers, setTenantUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add/Edit member modal
  const [memberModalVisible, setMemberModalVisible] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberWithUser | null>(
    null,
  );
  const [formUserId, setFormUserId] = useState<string>("");
  const [formAgeGroup, setFormAgeGroup] = useState<FamilyAgeGroup>("adult");
  const [formAgentName, setFormAgentName] = useState("");
  const [formManagedBy, setFormManagedBy] = useState<string>("");
  const [formDob, setFormDob] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // User picker modal
  const [userPickerVisible, setUserPickerVisible] = useState(false);

  // Managed-by picker modal
  const [managedByPickerVisible, setManagedByPickerVisible] = useState(false);

  // Schedules state
  const [schedules, setSchedules] = useState<
    (FamilySchedule & { member_name?: string })[]
  >([]);
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [scheduleFormProfileId, setScheduleFormProfileId] = useState("");
  const [scheduleFormName, setScheduleFormName] = useState("");
  const [scheduleFormDays, setScheduleFormDays] = useState<number[]>([]);
  const [scheduleFormStartTime, setScheduleFormStartTime] = useState("08:00");
  const [scheduleFormEndTime, setScheduleFormEndTime] = useState("20:00");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Spending state
  const [spendingLimits, setSpendingLimits] = useState<
    (FamilySpendingLimit & { member_name?: string })[]
  >([]);
  const [spendingModalVisible, setSpendingModalVisible] = useState(false);
  const [editingSpending, setEditingSpending] = useState<
    (FamilySpendingLimit & { member_name?: string }) | null
  >(null);
  const [spendingDaily, setSpendingDaily] = useState("");
  const [spendingMonthly, setSpendingMonthly] = useState("");
  const [spendingApprovalThreshold, setSpendingApprovalThreshold] =
    useState("");
  const [spendingSaving, setSpendingSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchMembers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from("family_member_profiles")
        .select("*, users!family_member_profiles_user_id_fkey(display_name, email)")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to fetch family members:", error.message);
        return;
      }

      const mapped: MemberWithUser[] = ((data ?? []) as any[]).map((row) => ({
        ...row,
        user_display_name:
          row.users?.display_name ?? row.agent_name ?? "Unknown",
        user_email: row.users?.email ?? "",
        users: undefined,
      }));

      setMembers(mapped);
    } catch (err) {
      console.error("Fetch family members error:", err);
    }
  }, [tenantId]);

  const fetchTenantUsers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("display_name", { ascending: true });

      if (error) {
        console.error("Failed to fetch tenant users:", error.message);
        return;
      }

      setTenantUsers((data as unknown as User[]) ?? []);
    } catch (err) {
      console.error("Fetch tenant users error:", err);
    }
  }, [tenantId]);

  const fetchSchedules = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from("family_schedules")
        .select("*, family_member_profiles(agent_name)")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to fetch schedules:", error.message);
        return;
      }

      const mapped = ((data ?? []) as any[]).map((row) => ({
        ...row,
        member_name:
          row.family_member_profiles?.agent_name ?? "Unknown",
        family_member_profiles: undefined,
      }));

      setSchedules(mapped);
    } catch (err) {
      console.error("Fetch schedules error:", err);
    }
  }, [tenantId]);

  const fetchSpendingLimits = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from("family_spending_limits")
        .select("*, family_member_profiles(agent_name, age_group)")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to fetch spending limits:", error.message);
        return;
      }

      const mapped = ((data ?? []) as any[]).map((row) => ({
        ...row,
        member_name:
          row.family_member_profiles?.agent_name ?? "Unknown",
        family_member_profiles: undefined,
      }));

      // Only show non-adult members
      setSpendingLimits(
        mapped.filter(
          (s: any) =>
            !["adult"].includes(
              ((data ?? []) as any[]).find((d: any) => d.profile_id === s.profile_id)
                ?.family_member_profiles?.age_group ?? "",
            ),
        ),
      );
    } catch (err) {
      console.error("Fetch spending limits error:", err);
    }
  }, [tenantId]);

  const fetchAll = useCallback(async () => {
    await Promise.all([
      fetchMembers(),
      fetchTenantUsers(),
      fetchSchedules(),
      fetchSpendingLimits(),
    ]);
  }, [fetchMembers, fetchTenantUsers, fetchSchedules, fetchSpendingLimits]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void fetchAll().finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }, [fetchAll, isAdmin]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchAll().finally(() => setRefreshing(false));
  };

  // ---------------------------------------------------------------------------
  // Adult members (for managed-by picker)
  // ---------------------------------------------------------------------------

  const adultMembers = useMemo(
    () => members.filter((m) => m.age_group === "adult"),
    [members],
  );

  // Age groups present in household
  const householdAgeGroups = useMemo(() => {
    const groups = new Set(members.map((m) => m.age_group));
    return ALL_AGE_GROUPS.filter((g) => groups.has(g));
  }, [members]);

  // ---------------------------------------------------------------------------
  // Member CRUD
  // ---------------------------------------------------------------------------

  const openAddMember = () => {
    setEditingMember(null);
    setFormUserId("");
    setFormAgeGroup("adult");
    setFormAgentName("");
    setFormManagedBy("");
    setFormDob("");
    setMemberModalVisible(true);
  };

  const openEditMember = (member: MemberWithUser) => {
    setEditingMember(member);
    setFormUserId(member.user_id as string);
    setFormAgeGroup(member.age_group);
    setFormAgentName(member.agent_name);
    setFormManagedBy((member.managed_by as string) ?? "");
    setFormDob(member.date_of_birth ?? "");
    setMemberModalVisible(true);
  };

  const handleSaveMember = async () => {
    if (!formUserId) {
      Alert.alert("Missing Field", "Please select a user.");
      return;
    }
    if (!formAgentName.trim()) {
      Alert.alert("Missing Field", "Please enter an agent name.");
      return;
    }

    setFormSaving(true);
    try {
      const payload = {
        tenant_id: tenantId as string,
        user_id: formUserId,
        age_group: formAgeGroup,
        agent_name: formAgentName.trim(),
        managed_by: formManagedBy || null,
        date_of_birth: formDob || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      if (editingMember) {
        const { error } = await supabase
          .from("family_member_profiles")
          .update(payload)
          .eq("id", editingMember.id);

        if (error) {
          Alert.alert("Update Failed", error.message);
          return;
        }
      } else {
        const { error } = await supabase
          .from("family_member_profiles")
          .insert({
            ...payload,
            agent_personality: {
              tone: formAgeGroup === "toddler" ? "nurturing" : "friendly",
              vocabulary_level:
                formAgeGroup === "adult" || formAgeGroup === "assisted_living"
                  ? "adult"
                  : formAgeGroup === "teenager"
                    ? "teen"
                    : formAgeGroup === "toddler"
                      ? "toddler"
                      : "child",
              humor_level: 0.5,
              encouragement_level:
                formAgeGroup === "child" || formAgeGroup === "toddler"
                  ? 0.9
                  : 0.3,
              safety_warnings:
                formAgeGroup !== "adult" &&
                formAgeGroup !== "adult_visitor",
              max_response_words: formAgeGroup === "toddler" ? 30 : 100,
              forbidden_topics: [],
              custom_greeting: `Hey there! I'm ${formAgentName.trim()}.`,
              sound_effects:
                formAgeGroup === "child" || formAgeGroup === "toddler",
            },
            created_at: new Date().toISOString(),
          });

        if (error) {
          Alert.alert("Add Failed", error.message);
          return;
        }
      }

      setMemberModalVisible(false);
      void fetchMembers();
    } catch (err) {
      Alert.alert("Error", "Failed to save member. Please try again.");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteMember = (member: MemberWithUser) => {
    Alert.alert(
      "Remove Member",
      `Are you sure you want to remove ${member.agent_name} (${member.user_display_name})?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("family_member_profiles")
              .delete()
              .eq("id", member.id);

            if (error) {
              Alert.alert("Error", error.message);
              return;
            }
            setMembers((prev) => prev.filter((m) => m.id !== member.id));
          },
        },
      ],
    );
  };

  // ---------------------------------------------------------------------------
  // Schedule CRUD
  // ---------------------------------------------------------------------------

  const openAddSchedule = () => {
    setScheduleFormProfileId("");
    setScheduleFormName("");
    setScheduleFormDays([]);
    setScheduleFormStartTime("08:00");
    setScheduleFormEndTime("20:00");
    setScheduleModalVisible(true);
  };

  const toggleScheduleDay = (day: number) => {
    setScheduleFormDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleSaveSchedule = async () => {
    if (!scheduleFormProfileId) {
      Alert.alert("Missing Field", "Please select a family member.");
      return;
    }
    if (!scheduleFormName.trim()) {
      Alert.alert("Missing Field", "Please enter a schedule name.");
      return;
    }
    if (scheduleFormDays.length === 0) {
      Alert.alert("Missing Field", "Please select at least one day.");
      return;
    }

    setScheduleSaving(true);
    try {
      const { error } = await supabase.from("family_schedules").insert({
        tenant_id: tenantId as string,
        profile_id: scheduleFormProfileId,
        schedule_name: scheduleFormName.trim(),
        days_of_week: scheduleFormDays.sort(),
        start_time: scheduleFormStartTime,
        end_time: scheduleFormEndTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        restrictions: {},
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (error) {
        Alert.alert("Save Failed", error.message);
        return;
      }

      setScheduleModalVisible(false);
      void fetchSchedules();
    } catch (err) {
      Alert.alert("Error", "Failed to save schedule. Please try again.");
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleToggleSchedule = async (
    schedule: FamilySchedule & { member_name?: string },
  ) => {
    const { error } = await supabase
      .from("family_schedules")
      .update({
        is_active: !schedule.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setSchedules((prev) =>
      prev.map((s) =>
        s.id === schedule.id ? { ...s, is_active: !s.is_active } : s,
      ),
    );
  };

  // ---------------------------------------------------------------------------
  // Spending CRUD
  // ---------------------------------------------------------------------------

  const openEditSpending = (
    item: FamilySpendingLimit & { member_name?: string },
  ) => {
    setEditingSpending(item);
    setSpendingDaily(String(item.daily_limit));
    setSpendingMonthly(String(item.monthly_limit));
    setSpendingApprovalThreshold(
      item.requires_approval_above != null
        ? String(item.requires_approval_above)
        : "",
    );
    setSpendingModalVisible(true);
  };

  const handleSaveSpending = async () => {
    if (!editingSpending) return;

    const daily = parseFloat(spendingDaily) || 0;
    const monthly = parseFloat(spendingMonthly) || 0;
    const threshold = spendingApprovalThreshold
      ? parseFloat(spendingApprovalThreshold)
      : null;

    setSpendingSaving(true);
    try {
      const { error } = await supabase
        .from("family_spending_limits")
        .update({
          daily_limit: daily,
          monthly_limit: monthly,
          requires_approval_above: threshold,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingSpending.id);

      if (error) {
        Alert.alert("Save Failed", error.message);
        return;
      }

      setSpendingModalVisible(false);
      void fetchSpendingLimits();
    } catch (err) {
      Alert.alert("Error", "Failed to save spending limits.");
    } finally {
      setSpendingSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Access denied
  // ---------------------------------------------------------------------------

  if (!isAdmin) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed" size={48} color="#94a3b8" />
        <Text style={styles.accessDeniedTitle}>Access Denied</Text>
        <Text style={styles.accessDeniedText}>
          Only admins and owners can manage family members.
        </Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading family...</Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderMemberCard = ({ item }: { item: MemberWithUser }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openEditMember(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        {/* Avatar */}
        <View
          style={[
            styles.avatar,
            { backgroundColor: AGE_GROUP_BG[item.age_group] },
          ]}
        >
          <Text
            style={[
              styles.avatarText,
              { color: AGE_GROUP_COLORS[item.age_group] },
            ]}
          >
            {getInitials(item.user_display_name)}
          </Text>
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <Text style={styles.memberName} numberOfLines={1}>
            {item.user_display_name}
          </Text>
          <Text style={styles.agentLabel} numberOfLines={1}>
            Hey {item.agent_name}
          </Text>
          {item.managed_by && (
            <Text style={styles.managedByLabel} numberOfLines={1}>
              Managed by{" "}
              {adultMembers.find(
                (a) => (a.user_id as string) === (item.managed_by as string),
              )?.user_display_name ?? "parent"}
            </Text>
          )}
        </View>

        {/* Age group badge */}
        <View
          style={[
            styles.ageGroupBadge,
            { backgroundColor: AGE_GROUP_BG[item.age_group] },
          ]}
        >
          <Text
            style={[
              styles.ageGroupBadgeText,
              { color: AGE_GROUP_COLORS[item.age_group] },
            ]}
          >
            {AGE_GROUP_LABELS[item.age_group]}
          </Text>
        </View>
      </View>

      {/* Delete button */}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDeleteMember(item)}
      >
        <Ionicons name="trash-outline" size={14} color="#ef4444" />
        <Text style={styles.deleteText}>Remove</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderScheduleCard = ({
    item,
  }: {
    item: FamilySchedule & { member_name?: string };
  }) => (
    <View style={styles.card}>
      <View style={styles.scheduleHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.memberName} numberOfLines={1}>
            {item.member_name}
          </Text>
          <Text style={styles.scheduleName} numberOfLines={1}>
            {item.schedule_name}
          </Text>
        </View>
        <Switch
          value={item.is_active}
          onValueChange={() => handleToggleSchedule(item)}
          trackColor={{ false: "#e2e8f0", true: "#D4A843" }}
          thumbColor={item.is_active ? "#ffffff" : "#94a3b8"}
        />
      </View>

      {/* Days pills */}
      <View style={styles.dayPillRow}>
        {DAY_LABELS.map((label, idx) => {
          const active = item.days_of_week.includes(idx);
          return (
            <View
              key={idx}
              style={[
                styles.dayPill,
                active && styles.dayPillActive,
              ]}
            >
              <Text
                style={[
                  styles.dayPillText,
                  active && styles.dayPillTextActive,
                ]}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Time range */}
      <Text style={styles.timeRange}>
        {item.start_time} - {item.end_time}
      </Text>
    </View>
  );

  const renderSpendingCard = ({
    item,
  }: {
    item: FamilySpendingLimit & { member_name?: string };
  }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openEditSpending(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.memberName}>{item.member_name}</Text>
      <View style={styles.spendingRow}>
        <View style={styles.spendingItem}>
          <Text style={styles.spendingLabel}>Daily</Text>
          <Text style={styles.spendingValue}>
            ${item.daily_limit.toFixed(2)}
          </Text>
        </View>
        <View style={styles.spendingItem}>
          <Text style={styles.spendingLabel}>Monthly</Text>
          <Text style={styles.spendingValue}>
            ${item.monthly_limit.toFixed(2)}
          </Text>
        </View>
        <View style={styles.spendingItem}>
          <Text style={styles.spendingLabel}>Approval</Text>
          <Text style={styles.spendingValue}>
            {item.requires_approval_above != null
              ? `$${item.requires_approval_above.toFixed(2)}`
              : "All"}
          </Text>
        </View>
      </View>
      <Text style={styles.tapToEdit}>Tap to edit</Text>
    </TouchableOpacity>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Segmented control */}
      <View style={styles.segmentedControl}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.segmentTab,
              activeTab === tab.key && styles.segmentTabActive,
            ]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.segmentTabText,
                activeTab === tab.key && styles.segmentTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ------------------------------------------------------------------- */}
      {/* Members Tab                                                          */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "members" && (
        <>
          <FlatList
            data={members}
            keyExtractor={(item) => item.id}
            renderItem={renderMemberCard}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#D4A843"
              />
            }
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyText}>No family members</Text>
                <Text style={styles.emptySubtext}>
                  Add family members to set up personal agents.
                </Text>
              </View>
            }
          />

          {/* FAB */}
          <TouchableOpacity
            style={[styles.fab, { bottom: 24 + insets.bottom }]}
            onPress={openAddMember}
          >
            <Ionicons name="person-add" size={24} color="#ffffff" />
          </TouchableOpacity>
        </>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Permissions Tab                                                      */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "permissions" && (
        <ScrollView
          style={styles.permissionsContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#D4A843"
            />
          }
        >
          {householdAgeGroups.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="shield-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No permissions to display</Text>
              <Text style={styles.emptySubtext}>
                Add family members first.
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={styles.matrixContainer}
            >
              <View>
                {/* Header row */}
                <View style={styles.matrixRow}>
                  <View style={styles.matrixLabelCell}>
                    <Text style={styles.matrixLabelText}>Permission</Text>
                  </View>
                  {householdAgeGroups.map((group) => (
                    <View
                      key={group}
                      style={[
                        styles.matrixHeaderCell,
                        { backgroundColor: AGE_GROUP_BG[group] },
                      ]}
                    >
                      <Text
                        style={[
                          styles.matrixHeaderText,
                          { color: AGE_GROUP_COLORS[group] },
                        ]}
                      >
                        {AGE_GROUP_LABELS[group]}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Permission rows */}
                {PERMISSION_ROWS.map((row) => (
                  <View key={row.key} style={styles.matrixRow}>
                    <View style={styles.matrixLabelCell}>
                      <Text style={styles.matrixRowLabel}>{row.label}</Text>
                    </View>
                    {householdAgeGroups.map((group) => {
                      const value =
                        DEFAULT_MATRICES[group]?.[row.key] ?? "denied";
                      return (
                        <View
                          key={group}
                          style={[
                            styles.matrixCell,
                            {
                              backgroundColor: `${PERMISSION_CELL_COLORS[value]}18`,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.matrixDot,
                              {
                                backgroundColor:
                                  PERMISSION_CELL_COLORS[value],
                              },
                            ]}
                          />
                          <Text
                            style={[
                              styles.matrixCellText,
                              { color: PERMISSION_CELL_COLORS[value] },
                            ]}
                          >
                            {value === "allowed"
                              ? "Yes"
                              : value === "denied"
                                ? "No"
                                : "Ltd"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}

          {/* Legend */}
          <View style={styles.legendRow}>
            {(
              [
                { label: "Allowed", color: "#22C55E" },
                { label: "Denied", color: "#EF4444" },
                { label: "Constrained", color: "#F59E0B" },
              ] as const
            ).map((item) => (
              <View key={item.label} style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: item.color }]}
                />
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Schedules Tab                                                        */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "schedules" && (
        <>
          <FlatList
            data={schedules}
            keyExtractor={(item) => item.id}
            renderItem={renderScheduleCard}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#D4A843"
              />
            }
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="time-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyText}>No schedules</Text>
                <Text style={styles.emptySubtext}>
                  Create schedules like bedtime or school hours.
                </Text>
              </View>
            }
          />

          {/* FAB */}
          <TouchableOpacity
            style={[styles.fab, { bottom: 24 + insets.bottom }]}
            onPress={openAddSchedule}
          >
            <Ionicons name="add" size={28} color="#ffffff" />
          </TouchableOpacity>
        </>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Spending Tab                                                         */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "spending" && (
        <FlatList
          data={spendingLimits}
          keyExtractor={(item) => item.id}
          renderItem={renderSpendingCard}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#D4A843"
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="wallet-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No spending limits</Text>
              <Text style={styles.emptySubtext}>
                Spending limits are created automatically for non-adult members.
              </Text>
            </View>
          }
        />
      )}

      {/* =================================================================== */}
      {/* Add/Edit Member Modal                                                */}
      {/* =================================================================== */}
      <Modal
        visible={memberModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMemberModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMember ? "Edit Member" : "Add Member"}
              </Text>
              <TouchableOpacity
                onPress={() => setMemberModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* User picker */}
              <Text style={styles.inputLabel}>User</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setUserPickerVisible(true)}
              >
                <Text
                  style={[
                    styles.pickerButtonText,
                    !formUserId && { color: "#94a3b8" },
                  ]}
                >
                  {formUserId
                    ? tenantUsers.find(
                        (u) => (u.id as string) === formUserId,
                      )?.display_name ?? "Selected user"
                    : "Select a user..."}
                </Text>
                <Ionicons name="chevron-down" size={18} color="#64748b" />
              </TouchableOpacity>

              {/* Age group picker */}
              <Text style={styles.inputLabel}>Age Group</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillRow}
              >
                {ALL_AGE_GROUPS.map((group) => (
                  <TouchableOpacity
                    key={group}
                    style={[
                      styles.pill,
                      formAgeGroup === group && {
                        backgroundColor: AGE_GROUP_COLORS[group],
                        borderColor: AGE_GROUP_COLORS[group],
                      },
                    ]}
                    onPress={() => setFormAgeGroup(group)}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        formAgeGroup === group && { color: "#ffffff" },
                      ]}
                    >
                      {AGE_GROUP_LABELS[group]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Agent name */}
              <Text style={styles.inputLabel}>Agent Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Jarvis, Luna, Buddy"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
                value={formAgentName}
                onChangeText={setFormAgentName}
              />

              {/* Managed by (only for non-adults) */}
              {formAgeGroup !== "adult" && (
                <>
                  <Text style={styles.inputLabel}>Managed By (Adult)</Text>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setManagedByPickerVisible(true)}
                  >
                    <Text
                      style={[
                        styles.pickerButtonText,
                        !formManagedBy && { color: "#94a3b8" },
                      ]}
                    >
                      {formManagedBy
                        ? adultMembers.find(
                            (a) =>
                              (a.user_id as string) === formManagedBy,
                          )?.user_display_name ?? "Selected adult"
                        : "Select managing adult..."}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={18}
                      color="#64748b"
                    />
                  </TouchableOpacity>
                </>
              )}

              {/* Date of birth (optional) */}
              <Text style={styles.inputLabel}>Date of Birth (optional)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                value={formDob}
                onChangeText={setFormDob}
                keyboardType="numbers-and-punctuation"
              />

              {/* Save button */}
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  formSaving && { opacity: 0.6 },
                ]}
                onPress={handleSaveMember}
                disabled={formSaving}
              >
                {formSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {editingMember ? "Update Member" : "Add Member"}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =================================================================== */}
      {/* User Picker Modal                                                    */}
      {/* =================================================================== */}
      <Modal
        visible={userPickerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setUserPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setUserPickerVisible(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select User</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {tenantUsers.map((u) => (
                <TouchableOpacity
                  key={u.id as string}
                  style={[
                    styles.pickerOption,
                    (u.id as string) === formUserId && {
                      backgroundColor: "#FFF8E1",
                    },
                  ]}
                  onPress={() => {
                    setFormUserId(u.id as string);
                    if (!formAgentName) {
                      setFormAgentName(
                        u.display_name.split(" ")[0] ?? u.display_name,
                      );
                    }
                    setUserPickerVisible(false);
                  }}
                >
                  <Text style={styles.pickerOptionText}>
                    {u.display_name}
                  </Text>
                  <Text style={styles.pickerOptionSub}>{u.email}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* =================================================================== */}
      {/* Managed-By Picker Modal                                              */}
      {/* =================================================================== */}
      <Modal
        visible={managedByPickerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setManagedByPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setManagedByPickerVisible(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Managing Adult</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {adultMembers.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.pickerOption,
                    (m.user_id as string) === formManagedBy && {
                      backgroundColor: "#FFF8E1",
                    },
                  ]}
                  onPress={() => {
                    setFormManagedBy(m.user_id as string);
                    setManagedByPickerVisible(false);
                  }}
                >
                  <Text style={styles.pickerOptionText}>
                    {m.user_display_name}
                  </Text>
                  <Text style={styles.pickerOptionSub}>
                    {m.agent_name}
                  </Text>
                </TouchableOpacity>
              ))}
              {adultMembers.length === 0 && (
                <Text style={styles.emptyPickerText}>
                  No adult members found. Add an adult first.
                </Text>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* =================================================================== */}
      {/* Add Schedule Modal                                                   */}
      {/* =================================================================== */}
      <Modal
        visible={scheduleModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setScheduleModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Schedule</Text>
              <TouchableOpacity
                onPress={() => setScheduleModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Member picker */}
              <Text style={styles.inputLabel}>Family Member</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillRow}
              >
                {members.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[
                      styles.pill,
                      scheduleFormProfileId === m.id && {
                        backgroundColor: AGE_GROUP_COLORS[m.age_group],
                        borderColor: AGE_GROUP_COLORS[m.age_group],
                      },
                    ]}
                    onPress={() => setScheduleFormProfileId(m.id)}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        scheduleFormProfileId === m.id && {
                          color: "#ffffff",
                        },
                      ]}
                    >
                      {m.agent_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Schedule name */}
              <Text style={styles.inputLabel}>Schedule Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Bedtime, School Hours"
                placeholderTextColor="#94a3b8"
                value={scheduleFormName}
                onChangeText={setScheduleFormName}
              />

              {/* Day selector */}
              <Text style={styles.inputLabel}>Days</Text>
              <View style={styles.dayPillRow}>
                {DAY_LABELS.map((label, idx) => {
                  const active = scheduleFormDays.includes(idx);
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.dayPill,
                        active && styles.dayPillActive,
                      ]}
                      onPress={() => toggleScheduleDay(idx)}
                    >
                      <Text
                        style={[
                          styles.dayPillText,
                          active && styles.dayPillTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Time pickers (simple text inputs) */}
              <View style={styles.timeRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Start Time</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="HH:MM"
                    placeholderTextColor="#94a3b8"
                    value={scheduleFormStartTime}
                    onChangeText={setScheduleFormStartTime}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>End Time</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="HH:MM"
                    placeholderTextColor="#94a3b8"
                    value={scheduleFormEndTime}
                    onChangeText={setScheduleFormEndTime}
                  />
                </View>
              </View>

              {/* Save button */}
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  scheduleSaving && { opacity: 0.6 },
                ]}
                onPress={handleSaveSchedule}
                disabled={scheduleSaving}
              >
                {scheduleSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveButtonText}>Add Schedule</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =================================================================== */}
      {/* Edit Spending Modal                                                  */}
      {/* =================================================================== */}
      <Modal
        visible={spendingModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSpendingModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Edit Spending - {editingSpending?.member_name}
              </Text>
              <TouchableOpacity
                onPress={() => setSpendingModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Daily Limit ($)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0.00"
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
              value={spendingDaily}
              onChangeText={setSpendingDaily}
            />

            <Text style={styles.inputLabel}>Monthly Limit ($)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0.00"
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
              value={spendingMonthly}
              onChangeText={setSpendingMonthly}
            />

            <Text style={styles.inputLabel}>
              Approval Required Above ($)
            </Text>
            <TextInput
              style={styles.textInput}
              placeholder="Leave empty for all purchases"
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
              value={spendingApprovalThreshold}
              onChangeText={setSpendingApprovalThreshold}
            />

            <TouchableOpacity
              style={[
                styles.saveButton,
                spendingSaving && { opacity: 0.6 },
              ]}
              onPress={handleSaveSpending}
              disabled={spendingSaving}
            >
              {spendingSaving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Limits</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748b",
  },
  accessDeniedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 16,
  },
  accessDeniedText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 6,
    textAlign: "center",
  },

  // Segmented control
  segmentedControl: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentTabActive: {
    backgroundColor: "#D4A843",
  },
  segmentTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  segmentTabTextActive: {
    color: "#ffffff",
  },

  // List
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    paddingBottom: 100,
  },

  // Card
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
  },
  cardInfo: {
    flex: 1,
    marginRight: 10,
  },
  memberName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  agentLabel: {
    fontSize: 13,
    color: "#D4A843",
    fontWeight: "600",
    marginTop: 2,
  },
  managedByLabel: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  ageGroupBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ageGroupBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    marginTop: 10,
    gap: 4,
  },
  deleteText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ef4444",
  },

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },

  // Permissions matrix
  permissionsContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  matrixContainer: {
    paddingVertical: 8,
  },
  matrixRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  matrixLabelCell: {
    width: 120,
    paddingVertical: 10,
    paddingRight: 8,
  },
  matrixLabelText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
  },
  matrixRowLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  matrixHeaderCell: {
    width: 80,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
    marginHorizontal: 2,
  },
  matrixHeaderText: {
    fontSize: 11,
    fontWeight: "700",
  },
  matrixCell: {
    width: 80,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    marginHorizontal: 2,
    marginVertical: 1,
    flexDirection: "row",
    gap: 4,
  },
  matrixDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  matrixCellText: {
    fontSize: 11,
    fontWeight: "700",
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 16,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },

  // Schedule
  scheduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  scheduleName: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  dayPillRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    flexWrap: "wrap",
  },
  dayPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  dayPillActive: {
    backgroundColor: "#D4A843",
    borderColor: "#D4A843",
  },
  dayPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  dayPillTextActive: {
    color: "#ffffff",
  },
  timeRange: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1F1F1F",
    marginTop: 10,
  },
  timeRow: {
    flexDirection: "row",
    marginTop: 4,
  },

  // Spending
  spendingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  spendingItem: {
    alignItems: "center",
    flex: 1,
  },
  spendingLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  spendingValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F1F1F",
  },
  tapToEdit: {
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 10,
  },

  // Empty
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#64748b",
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
    textAlign: "center",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#FDF6E3",
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    paddingVertical: 4,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f1f5f9",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  pickerButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FDF6E3",
  },
  pickerButtonText: {
    fontSize: 15,
    color: "#1a1a1a",
  },
  saveButton: {
    marginTop: 24,
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },

  // Picker modals
  pickerContent: {
    backgroundColor: "#ffffff",
    marginHorizontal: 32,
    borderRadius: 16,
    padding: 20,
    alignSelf: "center",
    width: "80%",
    marginTop: "auto",
    marginBottom: "auto",
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
    textAlign: "center",
  },
  pickerOption: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 4,
  },
  pickerOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  pickerOptionSub: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  emptyPickerText: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 20,
  },
});
