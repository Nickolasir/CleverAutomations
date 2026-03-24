import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  FlatList,
  TextInput,
  Alert,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
  priority: number;
}

interface WizardData {
  // Step 1: Medical Info
  allergies: string;
  conditions: string;
  blood_type: string;
  doctor_name: string;
  doctor_phone: string;
  // Step 2: Emergency Contacts
  emergency_contacts: EmergencyContact[];
  // Step 3: Accessibility Assessment
  mobility_level: string;
  cognitive_level: string;
  hearing_level: string;
  vision_level: string;
  // Step 4: Interaction Preferences
  preferred_interaction: string;
  confirmation_mode: string;
  speaking_pace: string;
  // Step 5: Caregiver Notifications
  whatsapp_phone: string;
  telegram_linked: boolean;
  preferred_channels: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_TITLES = [
  "Medical Info",
  "Emergency Contacts",
  "Accessibility",
  "Interaction",
  "Notifications",
];

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"];

const LEVEL_OPTIONS = ["independent", "minimal_assistance", "moderate_assistance", "full_assistance"];
const LEVEL_LABELS: Record<string, string> = {
  independent: "Independent",
  minimal_assistance: "Minimal Assistance",
  moderate_assistance: "Moderate Assistance",
  full_assistance: "Full Assistance",
};

const INTERACTION_OPTIONS = ["voice", "touch_screen", "physical_buttons", "gesture"];
const CONFIRMATION_OPTIONS = ["verbal", "screen_tap", "physical_button", "auto"];
const PACE_OPTIONS = ["slow", "normal", "fast"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AideProfileSetupScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [existingProfileId, setExistingProfileId] = useState<string | null>(null);

  const [data, setData] = useState<WizardData>({
    allergies: "",
    conditions: "",
    blood_type: "Unknown",
    doctor_name: "",
    doctor_phone: "",
    emergency_contacts: [],
    mobility_level: "independent",
    cognitive_level: "independent",
    hearing_level: "independent",
    vision_level: "independent",
    preferred_interaction: "voice",
    confirmation_mode: "verbal",
    speaking_pace: "normal",
    whatsapp_phone: "",
    telegram_linked: false,
    preferred_channels: ["push"],
  });

  // Notification linking state
  const [telegramLinkUrl, setTelegramLinkUrl] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [whatsappVerified, setWhatsappVerified] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tenantId = user?.tenant_id;

  // Load existing profile if any
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data: profile } = await supabase
        .from("aide_profiles")
        .select("*")
        .eq("tenant_id", tenantId)
        .limit(1)
        .single();

      if (profile) {
        setExistingProfileId(profile.id);
        setData({
          allergies: (profile.allergies ?? []).join(", "),
          conditions: (profile.conditions ?? []).join(", "),
          blood_type: profile.blood_type ?? "Unknown",
          doctor_name: profile.doctor_name ?? "",
          doctor_phone: profile.doctor_phone ?? "",
          emergency_contacts: profile.emergency_contacts ?? [],
          mobility_level: profile.mobility_level ?? "independent",
          cognitive_level: profile.cognitive_level ?? "independent",
          hearing_level: profile.hearing_level ?? "independent",
          vision_level: profile.vision_level ?? "independent",
          preferred_interaction: profile.preferred_interaction ?? "voice",
          confirmation_mode: profile.confirmation_mode ?? "verbal",
          speaking_pace: profile.speaking_pace ?? "normal",
          whatsapp_phone: profile.messaging_config?.whatsapp_phone ?? "",
          telegram_linked: !!profile.messaging_config?.telegram_chat_id,
          preferred_channels: profile.messaging_config?.preferred_channels ?? ["push"],
        });
        if (profile.messaging_config?.telegram_chat_id) {
          setTelegramLinked(true);
        }
        if (profile.messaging_config?.whatsapp_phone) {
          setWhatsappSent(true);
          setWhatsappVerified(true); // if saved, was verified
        }
      }
    })();
  }, [tenantId]);

  const updateField = <K extends keyof WizardData>(
    key: K,
    value: WizardData[K],
  ) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const addContact = () => {
    updateField("emergency_contacts", [
      ...data.emergency_contacts,
      { name: "", phone: "", relationship: "", priority: data.emergency_contacts.length + 1 },
    ]);
  };

  const removeContact = (idx: number) => {
    updateField(
      "emergency_contacts",
      data.emergency_contacts.filter((_, i) => i !== idx),
    );
  };

  const updateContact = (
    idx: number,
    field: keyof EmergencyContact,
    value: string | number,
  ) => {
    const updated = [...data.emergency_contacts];
    (updated[idx] as any)[field] = value;
    updateField("emergency_contacts", updated);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);

    const payload = {
      tenant_id: tenantId,
      allergies: data.allergies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      conditions: data.conditions
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      blood_type: data.blood_type,
      doctor_name: data.doctor_name,
      doctor_phone: data.doctor_phone,
      emergency_contacts: data.emergency_contacts,
      mobility_level: data.mobility_level,
      cognitive_level: data.cognitive_level,
      hearing_level: data.hearing_level,
      vision_level: data.vision_level,
      preferred_interaction: data.preferred_interaction,
      confirmation_mode: data.confirmation_mode,
      speaking_pace: data.speaking_pace,
      messaging_config: {
        whatsapp_phone: data.whatsapp_phone || null,
        telegram_chat_id: telegramLinked ? "linked" : null,
        preferred_channels: data.preferred_channels,
      },
    };

    try {
      if (existingProfileId) {
        const { error } = await supabase
          .from("aide_profiles")
          .update(payload)
          .eq("id", existingProfileId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("aide_profiles")
          .insert(payload);
        if (error) throw error;
      }
      Alert.alert("Success", "Profile saved successfully.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Picker helper
  // ---------------------------------------------------------------------------

  const renderPicker = (
    label: string,
    value: string,
    options: string[],
    labels: Record<string, string> | null,
    onSelect: (val: string) => void,
  ) => (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.pickerRow}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[
              styles.pickerOption,
              value === opt && styles.pickerOptionActive,
            ]}
            onPress={() => onSelect(opt)}
            accessibilityLabel={`Select ${labels?.[opt] ?? opt}`}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.pickerOptionText,
                value === opt && styles.pickerOptionTextActive,
              ]}
            >
              {labels?.[opt] ?? opt.charAt(0).toUpperCase() + opt.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderStep0 = () => (
    <View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Allergies (comma-separated)</Text>
        <TextInput
          style={styles.textInput}
          value={data.allergies}
          onChangeText={(v) => updateField("allergies", v)}
          placeholder="e.g. Penicillin, Peanuts"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Allergies"
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Conditions (comma-separated)</Text>
        <TextInput
          style={styles.textInput}
          value={data.conditions}
          onChangeText={(v) => updateField("conditions", v)}
          placeholder="e.g. Diabetes, Hypertension"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Medical conditions"
        />
      </View>
      {renderPicker("Blood Type", data.blood_type, BLOOD_TYPES, null, (v) =>
        updateField("blood_type", v),
      )}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Doctor Name</Text>
        <TextInput
          style={styles.textInput}
          value={data.doctor_name}
          onChangeText={(v) => updateField("doctor_name", v)}
          placeholder="Dr. Smith"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Doctor name"
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Doctor Phone</Text>
        <TextInput
          style={styles.textInput}
          value={data.doctor_phone}
          onChangeText={(v) => updateField("doctor_phone", v)}
          placeholder="555-123-4567"
          placeholderTextColor="#94a3b8"
          keyboardType="phone-pad"
          accessibilityLabel="Doctor phone number"
        />
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View>
      <TouchableOpacity
        style={styles.addContactButton}
        onPress={addContact}
        accessibilityLabel="Add emergency contact"
        accessibilityRole="button"
      >
        <Ionicons name="add-circle-outline" size={20} color="#D4A843" />
        <Text style={styles.addContactText}>Add Contact</Text>
      </TouchableOpacity>

      {data.emergency_contacts.map((contact, idx) => (
        <View key={idx} style={styles.contactCard}>
          <View style={styles.contactHeader}>
            <Text style={styles.contactTitle}>Contact #{idx + 1}</Text>
            <TouchableOpacity
              onPress={() => removeContact(idx)}
              accessibilityLabel={`Remove contact ${idx + 1}`}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={20} color="#ef4444" />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.textInput}
            value={contact.name}
            onChangeText={(v) => updateContact(idx, "name", v)}
            placeholder="Name"
            placeholderTextColor="#94a3b8"
            accessibilityLabel={`Contact ${idx + 1} name`}
          />
          <TextInput
            style={[styles.textInput, { marginTop: 8 }]}
            value={contact.phone}
            onChangeText={(v) => updateContact(idx, "phone", v)}
            placeholder="Phone"
            placeholderTextColor="#94a3b8"
            keyboardType="phone-pad"
            accessibilityLabel={`Contact ${idx + 1} phone`}
          />
          <TextInput
            style={[styles.textInput, { marginTop: 8 }]}
            value={contact.relationship}
            onChangeText={(v) => updateContact(idx, "relationship", v)}
            placeholder="Relationship (e.g. Daughter, Neighbor)"
            placeholderTextColor="#94a3b8"
            accessibilityLabel={`Contact ${idx + 1} relationship`}
          />
          <View style={styles.priorityRow}>
            <Text style={styles.priorityLabel}>Priority:</Text>
            {[1, 2, 3, 4, 5].map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.priorityBadge,
                  contact.priority === p && styles.priorityBadgeActive,
                ]}
                onPress={() => updateContact(idx, "priority", p)}
                accessibilityLabel={`Set priority ${p} for contact ${idx + 1}`}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.priorityBadgeText,
                    contact.priority === p && styles.priorityBadgeTextActive,
                  ]}
                >
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {data.emergency_contacts.length === 0 && (
        <Text style={styles.emptyText}>
          No emergency contacts added yet. Tap "Add Contact" above.
        </Text>
      )}
    </View>
  );

  const renderStep2 = () => (
    <View>
      {renderPicker(
        "Mobility Level",
        data.mobility_level,
        LEVEL_OPTIONS,
        LEVEL_LABELS,
        (v) => updateField("mobility_level", v),
      )}
      {renderPicker(
        "Cognitive Level",
        data.cognitive_level,
        LEVEL_OPTIONS,
        LEVEL_LABELS,
        (v) => updateField("cognitive_level", v),
      )}
      {renderPicker(
        "Hearing Level",
        data.hearing_level,
        LEVEL_OPTIONS,
        LEVEL_LABELS,
        (v) => updateField("hearing_level", v),
      )}
      {renderPicker(
        "Vision Level",
        data.vision_level,
        LEVEL_OPTIONS,
        LEVEL_LABELS,
        (v) => updateField("vision_level", v),
      )}
    </View>
  );

  const renderStep3 = () => (
    <View>
      {renderPicker(
        "Preferred Interaction",
        data.preferred_interaction,
        INTERACTION_OPTIONS,
        null,
        (v) => updateField("preferred_interaction", v),
      )}
      {renderPicker(
        "Confirmation Mode",
        data.confirmation_mode,
        CONFIRMATION_OPTIONS,
        null,
        (v) => updateField("confirmation_mode", v),
      )}
      {renderPicker(
        "Speaking Pace",
        data.speaking_pace,
        PACE_OPTIONS,
        null,
        (v) => updateField("speaking_pace", v),
      )}
    </View>
  );

  /** Handle Telegram linking */
  const handleLinkTelegram = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-link/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      const json = await res.json();
      if (json.success && json.data?.deep_link_url) {
        setTelegramLinkUrl(json.data.deep_link_url);
        await Linking.openURL(json.data.deep_link_url);

        // Poll for verification
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
            updateField("telegram_linked", true);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }, 3000);
      }
    } catch {
      // Non-fatal
    }
  };

  /** Handle WhatsApp verification */
  const handleVerifyWhatsApp = async () => {
    if (!E164_REGEX.test(data.whatsapp_phone)) {
      Alert.alert("Invalid Phone", "Phone must be in E.164 format (e.g. +15551234567)");
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-verify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: data.whatsapp_phone }),
      });
      const json = await res.json();
      if (json.success) {
        setWhatsappSent(true);
        let elapsed = 0;
        const waPoll = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) { clearInterval(waPoll); return; }
          const statusRes = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-verify/status`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const statusJson = await statusRes.json();
          if (statusJson.data?.verified) {
            setWhatsappVerified(true);
            clearInterval(waPoll);
          }
        }, 3000);
      }
    } catch {
      // Non-fatal
    }
  };

  // Cleanup polling on unmount
  React.useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const CHANNEL_OPTIONS = ["push", "telegram", "whatsapp", "email"];

  const renderStep4 = () => (
    <View>
      <Text style={styles.fieldLabel}>
        Set up messaging channels for caregiver alerts. This step is optional.
      </Text>

      {/* Telegram */}
      <View style={[styles.contactCard, { marginTop: 16 }]}>
        <View style={styles.contactHeader}>
          <Text style={styles.contactTitle}>Telegram</Text>
          {telegramLinked && (
            <View style={{ backgroundColor: "#22c55e", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Linked</Text>
            </View>
          )}
        </View>
        {!telegramLinked ? (
          <TouchableOpacity
            style={[styles.navButtonPrimary, { backgroundColor: "#3B82F6", alignSelf: "flex-start" }]}
            onPress={handleLinkTelegram}
            accessibilityLabel="Link Telegram"
            accessibilityRole="button"
          >
            <Ionicons name="paper-plane-outline" size={16} color="#fff" />
            <Text style={styles.navButtonPrimaryText}>
              {telegramLinkUrl ? "Waiting..." : "Link Telegram"}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ fontSize: 13, color: "#22c55e" }}>
            Caregiver will receive alerts via Telegram.
          </Text>
        )}
      </View>

      {/* WhatsApp */}
      <View style={[styles.contactCard, { marginTop: 12 }]}>
        <View style={styles.contactHeader}>
          <Text style={styles.contactTitle}>WhatsApp</Text>
          {whatsappVerified && (
            <View style={{ backgroundColor: "#22c55e", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Verified</Text>
            </View>
          )}
          {whatsappSent && !whatsappVerified && (
            <View style={{ backgroundColor: "#f59e0b", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Pending</Text>
            </View>
          )}
        </View>
        {!whatsappVerified && (
          <>
            <TextInput
              style={styles.textInput}
              value={data.whatsapp_phone}
              onChangeText={(v) => updateField("whatsapp_phone", v)}
              placeholder="+15551234567"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              editable={!whatsappSent}
              accessibilityLabel="WhatsApp phone number"
            />
            <TouchableOpacity
              style={[styles.navButtonPrimary, { backgroundColor: "#22c55e", alignSelf: "flex-start", marginTop: 10 }]}
              onPress={handleVerifyWhatsApp}
              disabled={whatsappSent || !data.whatsapp_phone}
              accessibilityLabel="Verify WhatsApp"
              accessibilityRole="button"
            >
              <Ionicons name="logo-whatsapp" size={16} color="#fff" />
              <Text style={styles.navButtonPrimaryText}>
                {whatsappSent ? "Verification Sent" : "Send Verification"}
              </Text>
            </TouchableOpacity>
            {whatsappSent && !whatsappVerified && (
              <Text style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
                Reply YES in WhatsApp to confirm.
              </Text>
            )}
          </>
        )}
      </View>

      {/* Channel Priority */}
      {renderPicker(
        "Preferred Alert Channel",
        data.preferred_channels[0] ?? "push",
        CHANNEL_OPTIONS,
        null,
        (v) => {
          const channels = [v, ...data.preferred_channels.filter((c: string) => c !== v)];
          updateField("preferred_channels", channels);
        },
      )}
    </View>
  );

  const STEP_RENDERERS = [renderStep0, renderStep1, renderStep2, renderStep3, renderStep4];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.header}>
          {existingProfileId ? "Edit" : "Set Up"} CleverAide Profile
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Step Indicator */}
      <View style={styles.stepRow}>
        {STEP_TITLES.map((title, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.stepItem}
            onPress={() => setCurrentStep(idx)}
            accessibilityLabel={`Go to step ${idx + 1}: ${title}`}
            accessibilityRole="button"
          >
            <View
              style={[
                styles.stepCircle,
                idx === currentStep && styles.stepCircleActive,
                idx < currentStep && styles.stepCircleDone,
              ]}
            >
              {idx < currentStep ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <Text
                  style={[
                    styles.stepNumber,
                    idx === currentStep && styles.stepNumberActive,
                  ]}
                >
                  {idx + 1}
                </Text>
              )}
            </View>
            <Text
              style={[
                styles.stepLabel,
                idx === currentStep && styles.stepLabelActive,
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Step Content */}
      <ScrollView
        style={styles.stepContent}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {STEP_RENDERERS[currentStep]()}
      </ScrollView>

      {/* Navigation Buttons */}
      <View style={styles.navRow}>
        {currentStep > 0 && (
          <TouchableOpacity
            style={styles.navButtonSecondary}
            onPress={() => setCurrentStep((s) => s - 1)}
            accessibilityLabel="Previous step"
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={18} color="#D4A843" />
            <Text style={styles.navButtonSecondaryText}>Back</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        {currentStep < 4 ? (
          <TouchableOpacity
            style={styles.navButtonPrimary}
            onPress={() => setCurrentStep((s) => s + 1)}
            accessibilityLabel="Next step"
            accessibilityRole="button"
          >
            <Text style={styles.navButtonPrimaryText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.navButtonPrimary, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            accessibilityLabel="Save profile"
            accessibilityRole="button"
          >
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.navButtonPrimaryText}>
              {saving ? "Saving..." : "Save Profile"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  header: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
    flex: 1,
    marginLeft: 12,
  },
  stepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  stepItem: {
    alignItems: "center",
    flex: 1,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  stepCircleActive: {
    backgroundColor: "#D4A843",
  },
  stepCircleDone: {
    backgroundColor: "#22c55e",
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  stepNumberActive: {
    color: "#fff",
  },
  stepLabel: {
    fontSize: 10,
    color: "#94a3b8",
    textAlign: "center",
  },
  stepLabelActive: {
    color: "#D4A843",
    fontWeight: "600",
  },
  stepContent: {
    flex: 1,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  pickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
  },
  pickerOptionActive: {
    backgroundColor: "#D4A843",
  },
  pickerOptionText: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "500",
  },
  pickerOptionTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  addContactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  addContactText: {
    fontSize: 15,
    color: "#D4A843",
    fontWeight: "600",
  },
  contactCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  contactHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  contactTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
  priorityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  priorityLabel: {
    fontSize: 13,
    color: "#64748b",
  },
  priorityBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  priorityBadgeActive: {
    backgroundColor: "#D4A843",
  },
  priorityBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  priorityBadgeTextActive: {
    color: "#fff",
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  navButtonPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#D4A843",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  navButtonPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  navButtonSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D4A843",
  },
  navButtonSecondaryText: {
    color: "#D4A843",
    fontSize: 15,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 24,
  },
});
