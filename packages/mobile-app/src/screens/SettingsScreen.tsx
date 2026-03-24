import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Tenant, TenantSettings, MarketVertical } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

const VERTICAL_OPTIONS: { value: MarketVertical; label: string }[] = [
  { value: "clever_home", label: "Clever Home" },
  { value: "clever_host", label: "Clever Host" },
  { value: "clever_building", label: "Clever Building" },
];

export default function SettingsScreen() {
  const { user, tenant } = useAuthContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<MarketVertical>("clever_home");
  const [subscriptionTier, setSubscriptionTier] = useState("");
  const [maxDevices, setMaxDevices] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [guestWipeEnabled, setGuestWipeEnabled] = useState(false);
  const [auditRetentionDays, setAuditRetentionDays] = useState("");

  // Notification state
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState<string | null>(null);
  const [waPhone, setWaPhone] = useState("");
  const [waVerified, setWaVerified] = useState(false);
  const [waSent, setWaSent] = useState(false);
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(true);
  const [notifyOffline, setNotifyOffline] = useState(true);
  const [notifySecurity, setNotifySecurity] = useState(true);
  const [notifyGuest, setNotifyGuest] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Check admin/owner access */
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  /** Load tenant settings */
  const loadSettings = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenant.id as string)
        .single();

      if (error) {
        Alert.alert("Error", "Failed to load settings: " + error.message);
        return;
      }

      const t = data as unknown as Tenant;
      setName(t.name);
      setVertical(t.vertical);
      setSubscriptionTier(t.subscription_tier);
      setMaxDevices(String(t.settings.max_devices));
      setMaxUsers(String(t.settings.max_users));
      setVoiceEnabled(t.settings.voice_enabled);
      setGuestWipeEnabled(t.settings.guest_wipe_enabled);
      setAuditRetentionDays(String(t.settings.audit_retention_days));
    } catch (err) {
      Alert.alert("Error", "Unexpected error loading settings");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  /** Load notification preferences */
  useEffect(() => {
    if (!tenant) return;
    (async () => {
      const { data: prefs } = await supabase
        .from("user_messaging_preferences")
        .select("*")
        .eq("tenant_id", tenant.id as string)
        .maybeSingle();

      if (prefs) {
        setTelegramLinked(!!prefs.telegram_verified);
        setTelegramUsername(prefs.telegram_username ?? null);
        setWaPhone(prefs.whatsapp_phone ?? "");
        setWaVerified(!!prefs.whatsapp_verified);
        setWaSent(!!prefs.whatsapp_phone);
        setEmailNotif(prefs.email_notifications ?? true);
        setPushNotif(prefs.push_notifications ?? true);
        setNotifyOffline(prefs.notify_device_offline ?? true);
        setNotifySecurity(prefs.notify_security_alert ?? true);
        setNotifyGuest(prefs.notify_guest_arrival ?? false);
      }
    })();
  }, [tenant]);

  // Cleanup polling
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  /** Link Telegram */
  const handleLinkTelegram = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-link/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.success && json.data?.deep_link_url) {
        setTelegramLinkUrl(json.data.deep_link_url);
        await Linking.openURL(json.data.deep_link_url);

        let elapsed = 0;
        pollRef.current = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) { if (pollRef.current) clearInterval(pollRef.current); return; }
          const statusRes = await fetch(`${SUPABASE_URL}/functions/v1/telegram-link/status`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const statusJson = await statusRes.json();
          if (statusJson.data?.linked) {
            setTelegramLinked(true);
            setTelegramLinkUrl(null);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }, 3000);
      }
    } catch { /* non-fatal */ }
  };

  /** Unlink Telegram */
  const handleUnlinkTelegram = async () => {
    if (!tenant) return;
    await supabase
      .from("user_messaging_preferences")
      .update({ telegram_chat_id: null, telegram_verified: false, telegram_username: null })
      .eq("tenant_id", tenant.id as string);
    setTelegramLinked(false);
    setTelegramUsername(null);
  };

  /** Verify WhatsApp */
  const handleVerifyWhatsApp = async () => {
    if (!E164_REGEX.test(waPhone)) {
      Alert.alert("Invalid Phone", "Phone must be in E.164 format (e.g. +15551234567)");
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: waPhone }),
      });
      const json = await res.json();
      if (json.success) {
        setWaSent(true);
        let elapsed = 0;
        const waPoll = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) { clearInterval(waPoll); return; }
          const statusRes = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-verify/status`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const statusJson = await statusRes.json();
          if (statusJson.data?.verified) {
            setWaVerified(true);
            clearInterval(waPoll);
          }
        }, 3000);
      }
    } catch { /* non-fatal */ }
  };

  /** Remove WhatsApp */
  const handleRemoveWhatsApp = async () => {
    if (!tenant) return;
    await supabase
      .from("user_messaging_preferences")
      .update({ whatsapp_phone: null, whatsapp_verified: false })
      .eq("tenant_id", tenant.id as string);
    setWaPhone("");
    setWaVerified(false);
    setWaSent(false);
  };

  /** Save notification preferences */
  const handleSaveNotifications = async () => {
    if (!tenant || !user) return;
    setSavingNotif(true);

    const channels: string[] = [];
    if (pushNotif) channels.push("push");
    if (telegramLinked) channels.push("telegram");
    if (waVerified) channels.push("whatsapp");
    if (emailNotif) channels.push("email");

    const payload = {
      email_notifications: emailNotif,
      push_notifications: pushNotif,
      preferred_channels: channels,
      notify_device_offline: notifyOffline,
      notify_security_alert: notifySecurity,
      notify_guest_arrival: notifyGuest,
    };

    try {
      const { data: existing } = await supabase
        .from("user_messaging_preferences")
        .select("id")
        .eq("tenant_id", tenant.id as string)
        .maybeSingle();

      if (existing) {
        await supabase.from("user_messaging_preferences").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("user_messaging_preferences").insert({
          tenant_id: tenant.id,
          user_id: user.id,
          ...payload,
        });
      }
      Alert.alert("Success", "Notification settings saved.");
    } catch {
      Alert.alert("Error", "Failed to save notification settings.");
    } finally {
      setSavingNotif(false);
    }
  };

  /** Save settings to Supabase */
  const handleSave = async () => {
    if (!tenant) return;

    const parsedMaxDevices = parseInt(maxDevices, 10);
    const parsedMaxUsers = parseInt(maxUsers, 10);
    const parsedRetention = parseInt(auditRetentionDays, 10);

    if (isNaN(parsedMaxDevices) || isNaN(parsedMaxUsers) || isNaN(parsedRetention)) {
      Alert.alert("Validation Error", "Device limit, user limit, and retention days must be valid numbers.");
      return;
    }

    if (!name.trim()) {
      Alert.alert("Validation Error", "Property name is required.");
      return;
    }

    setSaving(true);
    try {
      const settings: TenantSettings = {
        voice_enabled: voiceEnabled,
        max_devices: parsedMaxDevices,
        max_users: parsedMaxUsers,
        guest_wipe_enabled: guestWipeEnabled,
        audit_retention_days: parsedRetention,
      };

      const { error } = await supabase
        .from("tenants")
        .update({
          name: name.trim(),
          vertical,
          settings,
        })
        .eq("id", tenant.id as string);

      if (error) {
        Alert.alert("Error", "Failed to save settings: " + error.message);
      } else {
        Alert.alert("Success", "Settings saved successfully.");
      }
    } catch (err) {
      Alert.alert("Error", "Unexpected error saving settings.");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  /** Access denied for non-admin users */
  if (!isAdmin) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed-outline" size={48} color="#94a3b8" />
        <Text style={styles.accessDeniedTitle}>Access Denied</Text>
        <Text style={styles.accessDeniedText}>
          Only admin and owner roles can access settings.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Property Configuration */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="business-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Property Configuration</Text>
        </View>

        <Text style={styles.label}>Property Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Enter property name"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Market Vertical</Text>
        <View style={styles.pickerRow}>
          {VERTICAL_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.pickerOption,
                vertical === opt.value && styles.pickerOptionActive,
              ]}
              onPress={() => setVertical(opt.value)}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  vertical === opt.value && styles.pickerOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Subscription Tier</Text>
        <View style={styles.readOnlyField}>
          <Text style={styles.readOnlyText}>
            {subscriptionTier.charAt(0).toUpperCase() + subscriptionTier.slice(1)}
          </Text>
        </View>
      </View>

      {/* Device & User Limits */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="hardware-chip-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Device & User Limits</Text>
        </View>

        <Text style={styles.label}>Max Devices</Text>
        <TextInput
          style={styles.input}
          value={maxDevices}
          onChangeText={setMaxDevices}
          keyboardType="number-pad"
          placeholder="e.g. 50"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Max Users</Text>
        <TextInput
          style={styles.input}
          value={maxUsers}
          onChangeText={setMaxUsers}
          keyboardType="number-pad"
          placeholder="e.g. 10"
          placeholderTextColor="#94a3b8"
        />
      </View>

      {/* Voice Pipeline */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="mic-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Voice Pipeline</Text>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Enable Voice Control</Text>
          <Switch
            value={voiceEnabled}
            onValueChange={setVoiceEnabled}
            trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
            thumbColor={voiceEnabled ? "#D4A843" : "#f4f4f5"}
          />
        </View>
      </View>

      {/* Guest Wipe Settings (clever_host only) */}
      {vertical === "clever_host" && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="people-outline" size={20} color="#D4A843" />
            <Text style={styles.cardTitle}>Guest Wipe Settings</Text>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Enable Guest Wipe on Checkout</Text>
            <Switch
              value={guestWipeEnabled}
              onValueChange={setGuestWipeEnabled}
              trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
              thumbColor={guestWipeEnabled ? "#D4A843" : "#f4f4f5"}
            />
          </View>
        </View>
      )}

      {/* Audit Retention */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="document-text-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Audit Retention</Text>
        </View>

        <Text style={styles.label}>Retention Period (days)</Text>
        <TextInput
          style={styles.input}
          value={auditRetentionDays}
          onChangeText={setAuditRetentionDays}
          keyboardType="number-pad"
          placeholder="e.g. 90"
          placeholderTextColor="#94a3b8"
        />
      </View>

      {/* Save Button */}
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.7}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <>
            <Ionicons name="save-outline" size={18} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>Save Settings</Text>
          </>
        )}
      </TouchableOpacity>

      {/* ================================================================= */}
      {/* Notifications & Messaging */}
      {/* ================================================================= */}
      <View style={[styles.card, { marginTop: 24 }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="notifications-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Notifications & Messaging</Text>
        </View>

        {/* Telegram */}
        <View style={notifChannelRow}>
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            <View style={[notifBadge, { backgroundColor: "#3B82F6" }]}>
              <Ionicons name="paper-plane" size={14} color="#fff" />
            </View>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#1a1a1a" }}>Telegram</Text>
              <Text style={{ fontSize: 11, color: telegramLinked ? "#22c55e" : "#94a3b8" }}>
                {telegramLinked
                  ? `Linked${telegramUsername ? ` (@${telegramUsername})` : ""}`
                  : telegramLinkUrl
                    ? "Waiting for link..."
                    : "Not connected"}
              </Text>
            </View>
          </View>
          {telegramLinked ? (
            <TouchableOpacity onPress={handleUnlinkTelegram}>
              <Text style={{ fontSize: 12, color: "#ef4444", fontWeight: "600" }}>Unlink</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[notifLinkBtn, { backgroundColor: "#3B82F6" }]}
              onPress={handleLinkTelegram}
            >
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Link</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* WhatsApp */}
        <View style={notifChannelRow}>
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            <View style={[notifBadge, { backgroundColor: "#22c55e" }]}>
              <Ionicons name="logo-whatsapp" size={14} color="#fff" />
            </View>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#1a1a1a" }}>WhatsApp</Text>
              <Text style={{ fontSize: 11, color: waVerified ? "#22c55e" : waSent ? "#f59e0b" : "#94a3b8" }}>
                {waVerified ? `Verified (${waPhone})` : waSent ? "Pending verification" : "Not connected"}
              </Text>
            </View>
          </View>
          {waVerified ? (
            <TouchableOpacity onPress={handleRemoveWhatsApp}>
              <Text style={{ fontSize: 12, color: "#ef4444", fontWeight: "600" }}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {!waVerified && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={waPhone}
              onChangeText={setWaPhone}
              placeholder="+15551234567"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              editable={!waSent}
            />
            <TouchableOpacity
              style={[notifLinkBtn, { backgroundColor: "#22c55e" }]}
              onPress={handleVerifyWhatsApp}
              disabled={waSent || !waPhone}
            >
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
                {waSent ? "Sent" : "Verify"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {waSent && !waVerified && (
          <Text style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            Reply YES in WhatsApp to confirm.
          </Text>
        )}

        {/* Standard channel toggles */}
        <View style={{ marginTop: 16 }}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Push Notifications</Text>
            <Switch
              value={pushNotif}
              onValueChange={setPushNotif}
              trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
              thumbColor={pushNotif ? "#D4A843" : "#f4f4f5"}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Email Notifications</Text>
            <Switch
              value={emailNotif}
              onValueChange={setEmailNotif}
              trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
              thumbColor={emailNotif ? "#D4A843" : "#f4f4f5"}
            />
          </View>
        </View>

        {/* Alert type toggles */}
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.label, { marginTop: 0 }]}>Alert Types</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Device Offline</Text>
            <Switch
              value={notifyOffline}
              onValueChange={setNotifyOffline}
              trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
              thumbColor={notifyOffline ? "#D4A843" : "#f4f4f5"}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Security Alerts</Text>
            <Switch
              value={notifySecurity}
              onValueChange={setNotifySecurity}
              trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
              thumbColor={notifySecurity ? "#D4A843" : "#f4f4f5"}
            />
          </View>
          {vertical === "clever_host" && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Guest Arrival</Text>
              <Switch
                value={notifyGuest}
                onValueChange={setNotifyGuest}
                trackColor={{ false: "#cbd5e1", true: "#E8C86A" }}
                thumbColor={notifyGuest ? "#D4A843" : "#f4f4f5"}
              />
            </View>
          )}
        </View>
      </View>

      {/* Save Notifications */}
      <TouchableOpacity
        style={[styles.saveButton, savingNotif && styles.saveButtonDisabled]}
        onPress={handleSaveNotifications}
        disabled={savingNotif}
        activeOpacity={0.7}
      >
        {savingNotif ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <>
            <Ionicons name="notifications-outline" size={18} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>Save Notification Settings</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

// Notification channel row styles (inline to avoid StyleSheet bloat)
const notifChannelRow = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: "#f1f5f9",
};

const notifBadge = {
  width: 32,
  height: 32,
  borderRadius: 8,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const notifLinkBtn = {
  paddingHorizontal: 14,
  paddingVertical: 7,
  borderRadius: 8,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 12,
  },
  accessDeniedTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 16,
  },
  accessDeniedText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 8,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    marginLeft: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  readOnlyField: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f1f5f9",
  },
  readOnlyText: {
    fontSize: 15,
    color: "#64748b",
  },
  pickerRow: {
    flexDirection: "row",
    gap: 8,
  },
  pickerOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  pickerOptionActive: {
    borderColor: "#D4A843",
    backgroundColor: "#FFF8E1",
  },
  pickerOptionText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  pickerOptionTextActive: {
    color: "#D4A843",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  switchLabel: {
    fontSize: 15,
    color: "#1a1a1a",
    flex: 1,
    marginRight: 12,
  },
  saveButton: {
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
});
