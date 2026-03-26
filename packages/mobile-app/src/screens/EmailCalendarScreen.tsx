import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabKey = "inbox" | "calendar" | "settings";

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "inbox", label: "Inbox", icon: "mail-outline" },
  { key: "calendar", label: "Calendar", icon: "calendar-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
];

const GOLD = "#D4A843";
const CREAM = "#FDF6E3";
const CHARCOAL = "#1F1F1F";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailAccount {
  id: string;
  provider: "gmail" | "outlook";
  display_name_encrypted: string;
  is_active: boolean;
}

interface CalendarAccount {
  id: string;
  provider: "google_calendar" | "outlook_calendar";
  display_name: string;
  is_primary: boolean;
  sync_enabled: boolean;
}

interface EmailCacheEntry {
  id: string;
  subject_encrypted: string;
  sender_encrypted: string;
  snippet_encrypted: string | null;
  is_read: boolean;
  is_important: boolean;
  received_at: string;
}

interface CalendarEventEntry {
  id: string;
  summary_encrypted: string;
  location_encrypted: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function EmailCalendarScreen() {
  const insets = useSafeAreaInsets();
  const { session, tenantId } = useAuthContext();
  const userId = session?.user?.id;

  const [activeTab, setActiveTab] = useState<TabKey>("inbox");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>([]);
  const [emails, setEmails] = useState<EmailCacheEntry[]>([]);
  const [events, setEvents] = useState<CalendarEventEntry[]>([]);

  const loadData = useCallback(async () => {
    if (!tenantId || !userId) return;

    const [
      { data: eAccounts },
      { data: cAccounts },
      { data: emailData },
      { data: eventData },
    ] = await Promise.all([
      supabase.from("email_accounts").select("id, provider, display_name_encrypted, is_active").eq("tenant_id", tenantId).eq("user_id", userId),
      supabase.from("calendar_accounts").select("id, provider, display_name, is_primary, sync_enabled").eq("tenant_id", tenantId).eq("user_id", userId),
      supabase.from("email_cache").select("*").eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(50),
      supabase.from("calendar_event_cache").select("*").eq("tenant_id", tenantId).gte("start_time", new Date().toISOString()).order("start_time", { ascending: true }).limit(30),
    ]);

    setEmailAccounts(eAccounts ?? []);
    setCalendarAccounts(cAccounts ?? []);
    setEmails(emailData ?? []);
    setEvents(eventData ?? []);
    setLoading(false);
  }, [tenantId, userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const totalUnread = emails.filter((e) => !e.is_read).length;

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderEmailItem = ({ item }: { item: EmailCacheEntry }) => (
    <View style={[styles.emailRow, !item.is_read && styles.emailUnread]}>
      <View style={styles.emailLeft}>
        {!item.is_read && <View style={styles.unreadDot} />}
        <View style={styles.emailContent}>
          <View style={styles.emailHeader}>
            {item.is_important && (
              <Text style={styles.importantFlag}>!</Text>
            )}
            <Text style={[styles.emailSender, !item.is_read && styles.bold]} numberOfLines={1}>
              {item.sender_encrypted}
            </Text>
          </View>
          <Text style={styles.emailSubject} numberOfLines={1}>
            {item.subject_encrypted}
          </Text>
          {item.snippet_encrypted && (
            <Text style={styles.emailSnippet} numberOfLines={1}>
              {item.snippet_encrypted}
            </Text>
          )}
        </View>
      </View>
      <Text style={styles.emailDate}>
        {new Date(item.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </Text>
    </View>
  );

  const renderEventItem = ({ item }: { item: CalendarEventEntry }) => {
    const startDate = new Date(item.start_time);
    return (
      <View style={styles.eventRow}>
        <View style={styles.eventDateBox}>
          <Text style={styles.eventDayName}>
            {startDate.toLocaleDateString("en-US", { weekday: "short" })}
          </Text>
          <Text style={styles.eventDayNum}>{startDate.getDate()}</Text>
        </View>
        <View style={styles.eventContent}>
          <Text style={styles.eventSummary} numberOfLines={1}>
            {item.summary_encrypted}
          </Text>
          {item.is_all_day ? (
            <Text style={styles.eventTime}>All day</Text>
          ) : (
            <Text style={styles.eventTime}>
              {startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {" - "}
              {new Date(item.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Text>
          )}
          {item.location_encrypted && (
            <Text style={styles.eventLocation} numberOfLines={1}>
              {item.location_encrypted}
            </Text>
          )}
        </View>
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingText}>Loading email & calendar...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Email & Calendar</Text>
        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{totalUnread} unread</Text>
          </View>
          <View style={[styles.badge, styles.badgeNeutral]}>
            <Text style={[styles.badgeText, styles.badgeTextNeutral]}>{events.length} events</Text>
          </View>
        </View>
      </View>

      {/* Segmented Control */}
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
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? GOLD : "#94A3B8"}
            />
            <Text
              style={[
                styles.segmentLabel,
                activeTab === tab.key && styles.segmentLabelActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === "inbox" && (
        <>
          {/* Account chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {emailAccounts.map((acc) => (
              <View key={acc.id} style={styles.chip}>
                <View style={[styles.chipDot, acc.is_active && styles.chipDotActive]} />
                <Text style={styles.chipText}>
                  {acc.provider === "outlook" ? "Outlook" : "Gmail"}
                </Text>
              </View>
            ))}
            {emailAccounts.length === 0 && (
              <Text style={styles.emptyChip}>No email accounts linked</Text>
            )}
          </ScrollView>

          <FlatList
            data={emails}
            renderItem={renderEmailItem}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="mail-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyText}>No emails in cache</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        </>
      )}

      {activeTab === "calendar" && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {calendarAccounts.map((cal) => (
              <View key={cal.id} style={styles.chip}>
                <View style={[styles.chipDot, cal.sync_enabled && styles.chipDotActive]} />
                <Text style={styles.chipText}>{cal.display_name}</Text>
                {cal.is_primary && <Text style={styles.chipBadge}>Primary</Text>}
              </View>
            ))}
            {calendarAccounts.length === 0 && (
              <Text style={styles.emptyChip}>No calendars linked</Text>
            )}
          </ScrollView>

          <FlatList
            data={events}
            renderItem={renderEventItem}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyText}>No upcoming events</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        </>
      )}

      {activeTab === "settings" && (
        <ScrollView style={styles.settingsContainer} contentContainerStyle={styles.listContent}>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>Account Linking</Text>
            <Text style={styles.settingsDescription}>
              Email and calendar accounts are managed through your Home Assistant integrations.
              Use HA Settings &gt; Integrations to add or remove accounts.
            </Text>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Email accounts</Text>
              <Text style={styles.settingsValue}>{emailAccounts.length} linked</Text>
            </View>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Calendar accounts</Text>
              <Text style={styles.settingsValue}>{calendarAccounts.length} linked</Text>
            </View>
          </View>

          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>About</Text>
            <Text style={styles.settingsDescription}>
              Email monitoring is read-only. Email sending is disabled and requires a code-level
              change to enable. Calendar event creation is available via voice and chat.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CREAM,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#64748B",
    fontSize: 14,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: CHARCOAL,
  },
  badges: {
    flexDirection: "row",
    gap: 6,
  },
  badge: {
    backgroundColor: "#FFF8E1",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: GOLD,
  },
  badgeNeutral: {
    backgroundColor: "#F1F5F9",
  },
  badgeTextNeutral: {
    color: "#64748B",
  },
  segmentedControl: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginVertical: 8,
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 3,
  },
  segmentTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
  },
  segmentTabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94A3B8",
  },
  segmentLabelActive: {
    color: GOLD,
    fontWeight: "600",
  },
  chipRow: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    maxHeight: 50,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
  },
  chipDotActive: {
    backgroundColor: "#22C55E",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    color: CHARCOAL,
  },
  chipBadge: {
    fontSize: 10,
    fontWeight: "600",
    color: GOLD,
    backgroundColor: "#FFF8E1",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  emptyChip: {
    fontSize: 13,
    color: "#94A3B8",
    paddingVertical: 8,
  },
  listContent: {
    paddingBottom: 20,
  },
  // Email styles
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  emailUnread: {
    backgroundColor: "#FFFBEB",
  },
  emailLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
    marginTop: 6,
  },
  emailContent: {
    flex: 1,
  },
  emailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  importantFlag: {
    fontSize: 12,
    fontWeight: "800",
    color: "#EF4444",
  },
  emailSender: {
    fontSize: 14,
    color: CHARCOAL,
  },
  bold: {
    fontWeight: "600",
  },
  emailSubject: {
    fontSize: 13,
    color: "#475569",
    marginTop: 2,
  },
  emailSnippet: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 1,
  },
  emailDate: {
    fontSize: 11,
    color: "#94A3B8",
    marginLeft: 8,
  },
  // Event styles
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    gap: 12,
  },
  eventDateBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#FFF8E1",
    alignItems: "center",
    justifyContent: "center",
  },
  eventDayName: {
    fontSize: 10,
    fontWeight: "600",
    color: GOLD,
    textTransform: "uppercase",
  },
  eventDayNum: {
    fontSize: 18,
    fontWeight: "700",
    color: CHARCOAL,
  },
  eventContent: {
    flex: 1,
  },
  eventSummary: {
    fontSize: 14,
    fontWeight: "500",
    color: CHARCOAL,
  },
  eventTime: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  eventLocation: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 1,
  },
  // Settings styles
  settingsContainer: {
    flex: 1,
  },
  settingsCard: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  settingsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: CHARCOAL,
  },
  settingsDescription: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 18,
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  settingsLabel: {
    fontSize: 14,
    color: CHARCOAL,
  },
  settingsValue: {
    fontSize: 14,
    color: "#64748B",
  },
  // Empty state
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#94A3B8",
  },
});
