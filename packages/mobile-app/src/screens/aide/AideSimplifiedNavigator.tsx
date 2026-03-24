/**
 * CleverAide Simplified Navigator
 *
 * A 3-tab bottom navigator for assisted_living users with:
 * - Home: SOS button + quick status
 * - Talk: Chat interface (voice-first)
 * - Help: Emergency contacts
 *
 * Uses large text, high contrast, and maximum 3-4 elements per screen.
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  AccessibilityInfo,
} from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { AIDE_COLORS, AIDE_FONTS, AIDE_LAYOUT } from "../../lib/aide-theme";
import ChatScreen from "../ChatScreen";
import type { EmergencyContact } from "@clever/shared";

const AideTab = createBottomTabNavigator();

// ---------------------------------------------------------------------------
// Home Screen — SOS + Status
// ---------------------------------------------------------------------------

function AideHomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const [lastCheckinStatus, setLastCheckinStatus] = useState<string | null>(null);

  const handleSOS = useCallback(() => {
    Alert.alert(
      "Emergency",
      "This will activate the emergency protocol and contact your caregiver. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "YES — EMERGENCY",
          style: "destructive",
          onPress: async () => {
            // Trigger emergency via the orchestrator
            try {
              await supabase.functions.invoke("chat", {
                body: {
                  message: "EMERGENCY — I need help immediately",
                  agent_name: "clever",
                  source: "quick_command",
                },
              });
              AccessibilityInfo.announceForAccessibility(
                "Emergency protocol activated. Help is on the way.",
              );
            } catch {
              // Fallback: call 911 directly
              Linking.openURL("tel:911");
            }
          },
        },
      ],
    );
  }, []);

  return (
    <View style={[homeStyles.container, { paddingBottom: insets.bottom + 16 }]}>
      {/* Greeting */}
      <Text
        style={homeStyles.greeting}
        accessibilityRole="header"
      >
        Hello{user?.display_name ? `, ${user.display_name}` : ""}
      </Text>

      {/* SOS Button */}
      <TouchableOpacity
        style={homeStyles.sosButton}
        onPress={handleSOS}
        accessibilityLabel="Emergency SOS button. Double tap to activate emergency protocol."
        accessibilityRole="button"
        accessibilityHint="Activates emergency protocol and contacts your caregiver"
      >
        <Ionicons name="alert-circle" size={40} color="#FFFFFF" />
        <Text style={homeStyles.sosText}>SOS</Text>
      </TouchableOpacity>
      <Text style={homeStyles.sosHint}>
        Press if you need emergency help
      </Text>

      {/* Quick Status */}
      <View style={homeStyles.statusCard}>
        <Text style={homeStyles.statusLabel}>
          Status
        </Text>
        <Text style={homeStyles.statusValue}>
          {lastCheckinStatus === "concern_flagged"
            ? "Caregiver notified"
            : "All is well"}
        </Text>
      </View>

      {/* Quick Voice Command */}
      <TouchableOpacity
        style={homeStyles.voiceButton}
        accessibilityLabel="Talk to Clever"
        accessibilityRole="button"
      >
        <Ionicons name="mic" size={28} color="#FFFFFF" />
        <Text style={homeStyles.voiceButtonText}>Talk to Clever</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Help Screen — Emergency Contacts
// ---------------------------------------------------------------------------

function AideHelpScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);

  useEffect(() => {
    const fetchContacts = async () => {
      if (!user?.tenant_id) return;
      const { data } = await supabase
        .from("aide_profiles")
        .select("emergency_contacts")
        .eq("tenant_id", user.tenant_id)
        .limit(1)
        .single();
      if (data?.emergency_contacts) {
        setContacts(data.emergency_contacts as EmergencyContact[]);
      }
    };
    fetchContacts();
  }, [user?.tenant_id]);

  const callContact = (phone: string, name: string) => {
    Alert.alert("Call", `Call ${name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Call", onPress: () => Linking.openURL(`tel:${phone}`) },
    ]);
  };

  return (
    <ScrollView
      style={helpStyles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
    >
      <Text style={helpStyles.header} accessibilityRole="header">
        Emergency Contacts
      </Text>

      {/* 911 always first */}
      <TouchableOpacity
        style={[helpStyles.contactCard, { borderColor: AIDE_COLORS.emergency }]}
        onPress={() => Linking.openURL("tel:911")}
        accessibilityLabel="Call 911 Emergency Services"
        accessibilityRole="button"
      >
        <View style={[helpStyles.contactIcon, { backgroundColor: AIDE_COLORS.emergency }]}>
          <Ionicons name="call" size={28} color="#FFFFFF" />
        </View>
        <View style={helpStyles.contactInfo}>
          <Text style={helpStyles.contactName}>911</Text>
          <Text style={helpStyles.contactRelation}>Emergency Services</Text>
        </View>
      </TouchableOpacity>

      {/* Personal contacts */}
      {contacts
        .sort((a, b) => a.priority - b.priority)
        .map((contact, idx) => (
          <TouchableOpacity
            key={idx}
            style={helpStyles.contactCard}
            onPress={() => callContact(contact.phone, contact.name)}
            accessibilityLabel={`Call ${contact.name}, ${contact.relationship}`}
            accessibilityRole="button"
          >
            <View style={helpStyles.contactIcon}>
              <Ionicons name="person" size={28} color="#FFFFFF" />
            </View>
            <View style={helpStyles.contactInfo}>
              <Text style={helpStyles.contactName}>{contact.name}</Text>
              <Text style={helpStyles.contactRelation}>{contact.relationship}</Text>
            </View>
            <Ionicons name="call-outline" size={24} color={AIDE_COLORS.primary} />
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Simplified Tab Navigator
// ---------------------------------------------------------------------------

export default function AideSimplifiedNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <AideTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: AIDE_COLORS.primary,
        tabBarInactiveTintColor: "#64748B",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: AIDE_COLORS.border,
          borderTopWidth: 2,
          paddingBottom: Math.max(insets.bottom, 8),
          height: 72 + Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: {
          fontSize: AIDE_FONTS.small,
          fontWeight: "700",
        },
        tabBarIconStyle: {
          marginBottom: -4,
        },
        headerStyle: {
          backgroundColor: "#FFFFFF",
          shadowColor: "transparent",
        },
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: AIDE_FONTS.subheader,
          color: AIDE_COLORS.text,
        },
      }}
    >
      <AideTab.Screen
        name="AideHome"
        component={AideHomeScreen}
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size + 4} color={color} />
          ),
        }}
      />
      <AideTab.Screen
        name="AideTalk"
        component={ChatScreen}
        options={{
          title: "Talk",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble" size={size + 4} color={color} />
          ),
        }}
      />
      <AideTab.Screen
        name="AideHelp"
        component={AideHelpScreen}
        options={{
          title: "Help",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="call" size={size + 4} color={color} />
          ),
        }}
      />
    </AideTab.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const homeStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: AIDE_LAYOUT.padding,
    alignItems: "center",
    justifyContent: "center",
  },
  greeting: {
    fontSize: AIDE_FONTS.header,
    fontWeight: "700",
    color: AIDE_COLORS.text,
    textAlign: "center",
    marginBottom: 32,
  },
  sosButton: {
    width: AIDE_LAYOUT.sosButtonSize * 2,
    height: AIDE_LAYOUT.sosButtonSize * 2,
    borderRadius: AIDE_LAYOUT.sosButtonSize,
    backgroundColor: AIDE_COLORS.emergency,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: AIDE_COLORS.emergency,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sosText: {
    fontSize: 32,
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: 4,
  },
  sosHint: {
    fontSize: AIDE_FONTS.small,
    color: AIDE_COLORS.textSecondary,
    marginTop: 16,
    textAlign: "center",
  },
  statusCard: {
    backgroundColor: AIDE_COLORS.surface,
    borderRadius: AIDE_LAYOUT.borderRadius,
    padding: AIDE_LAYOUT.padding,
    width: "100%",
    marginTop: 32,
    borderWidth: 2,
    borderColor: AIDE_COLORS.borderLight,
  },
  statusLabel: {
    fontSize: AIDE_FONTS.small,
    fontWeight: "600",
    color: AIDE_COLORS.textSecondary,
  },
  statusValue: {
    fontSize: AIDE_FONTS.subheader,
    fontWeight: "700",
    color: AIDE_COLORS.success,
    marginTop: 4,
  },
  voiceButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: AIDE_COLORS.primary,
    borderRadius: AIDE_LAYOUT.borderRadius,
    paddingVertical: 18,
    paddingHorizontal: 32,
    marginTop: 20,
    width: "100%",
    minHeight: AIDE_LAYOUT.minTouchTarget,
  },
  voiceButtonText: {
    fontSize: AIDE_FONTS.button,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});

const helpStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: AIDE_LAYOUT.padding,
  },
  header: {
    fontSize: AIDE_FONTS.header,
    fontWeight: "700",
    color: AIDE_COLORS.text,
    marginBottom: 24,
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: AIDE_LAYOUT.borderRadius,
    padding: AIDE_LAYOUT.padding,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: AIDE_COLORS.borderLight,
    minHeight: AIDE_LAYOUT.minTouchTarget * 1.5,
  },
  contactIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: AIDE_COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: AIDE_FONTS.body,
    fontWeight: "700",
    color: AIDE_COLORS.text,
  },
  contactRelation: {
    fontSize: AIDE_FONTS.small,
    color: AIDE_COLORS.textSecondary,
    marginTop: 2,
  },
});
