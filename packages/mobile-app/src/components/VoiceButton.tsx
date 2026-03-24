/**
 * Floating voice button + voice command overlay.
 *
 * Records audio via expo-av (mic indicator), processes commands
 * via text input or tappable example pills. The rules engine +
 * HA conversation API handle all command execution.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { useAuthContext } from "../lib/auth-context";
import {
  processVoiceCommand,
  processAudioCommand,
  type VoiceResult,
} from "../lib/voice-client";

type VoiceState = "idle" | "listening" | "processing" | "result";

const TIER_COLORS: Record<string, string> = {
  tier1_rules: "#22c55e",
  tier2_cloud: "#3b82f6",
  tier3_local: "#f59e0b",
};

const TIER_LABELS: Record<string, string> = {
  tier1_rules: "Rules Engine",
  tier2_cloud: "HA Cloud",
  tier3_local: "Local",
};

export default function VoiceButton() {
  const { user } = useAuthContext();
  const insets = useSafeAreaInsets();
  const tenantId = (user?.tenant_id as string) ?? "";

  const [modalVisible, setModalVisible] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [textInput, setTextInput] = useState("");
  const [recordingActive, setRecordingActive] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === "listening") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  const processAndShow = useCallback(
    async (text: string) => {
      setState("processing");
      try {
        const voiceResult = await processVoiceCommand(text, tenantId);
        setResult(voiceResult);
        setState("result");
      } catch (err) {
        setResult({
          transcript: text,
          intent: null,
          response: err instanceof Error ? err.message : "Command failed",
          tier: "tier1_rules",
          latencyMs: 0,
          executed: false,
          error: "Processing error",
        });
        setState("result");
      }
    },
    [tenantId]
  );

  const handleMicPress = async () => {
    if (recordingActive) {
      // Stop recording and transcribe via Deepgram
      setRecordingActive(false);
      setState("processing");
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (uri) {
          const voiceResult = await processAudioCommand(uri, tenantId);
          setResult(voiceResult);
          setState("result");
        } else {
          setState("idle");
        }
      } catch (err) {
        setResult({
          transcript: "",
          intent: null,
          response: err instanceof Error ? err.message : "Failed to process audio",
          tier: "tier1_rules",
          latencyMs: 0,
          executed: false,
        });
        setState("result");
      }
      return;
    }

    // Start recording
    setResult(null);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setResult({
          transcript: "",
          intent: null,
          response: "Microphone permission required. Enable it in Settings.",
          tier: "tier1_rules",
          latencyMs: 0,
          executed: false,
        });
        setState("result");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingActive(true);
      setState("listening");
    } catch (err) {
      setResult({
        transcript: "",
        intent: null,
        response: err instanceof Error ? err.message : "Mic unavailable",
        tier: "tier1_rules",
        latencyMs: 0,
        executed: false,
      });
      setState("result");
    }
  };

  const handleTextSubmit = async () => {
    const text = textInput.trim();
    if (!text || state === "processing") return;
    setTextInput("");
    await processAndShow(text);
  };

  const handleClose = () => {
    if (recordingActive) {
      void recorder.stop();
      setRecordingActive(false);
    }
    setState("idle");
    setResult(null);
    setTextInput("");
    setModalVisible(false);
  };

  const stateLabel = {
    idle: "Tap mic or type a command",
    listening: "Recording... tap to stop",
    processing: "Processing...",
    result: result?.executed ? "Command executed" : "Response",
  }[state];

  const stateColor = {
    idle: "#64748b",
    listening: "#dc2626",
    processing: "#D4A843",
    result: result?.executed ? "#22c55e" : "#f59e0b",
  }[state];

  return (
    <>
      {/* Floating mic button */}
      <TouchableOpacity
        style={[styles.fab, { bottom: 80 + Math.max(insets.bottom, 8) }]}
        onPress={() => {
          setModalVisible(true);
          setState("idle");
          setResult(null);
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="mic" size={26} color="#ffffff" />
      </TouchableOpacity>

      {/* Voice overlay modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={handleClose}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity style={styles.modalBackdrop} onPress={handleClose} activeOpacity={1} />

          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handleBar} />

            {/* Status */}
            <Text style={[styles.stateLabel, { color: stateColor }]}>{stateLabel}</Text>

            {/* Mic button */}
            <View style={styles.micContainer}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseAnim }], borderColor: stateColor },
                ]}
              />
              <TouchableOpacity
                style={[
                  styles.micButton,
                  {
                    backgroundColor:
                      state === "listening"
                        ? "#dc2626"
                        : state === "processing"
                          ? "#94a3b8"
                          : "#D4A843",
                  },
                ]}
                onPress={handleMicPress}
                disabled={state === "processing"}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={
                    state === "listening"
                      ? "stop"
                      : state === "processing"
                        ? "hourglass-outline"
                        : "mic"
                  }
                  size={36}
                  color="#ffffff"
                />
              </TouchableOpacity>
            </View>

            {/* Result display */}
            {result && (
              <ScrollView style={styles.resultContainer} showsVerticalScrollIndicator={false}>
                {result.transcript !== "" && (
                  <View style={styles.resultCard}>
                    <Text style={styles.resultLabel}>You said</Text>
                    <Text style={styles.resultTranscript}>"{result.transcript}"</Text>
                  </View>
                )}

                <View
                  style={[
                    styles.resultCard,
                    { backgroundColor: result.executed ? "#f0fdf4" : "#FDF6E3" },
                  ]}
                >
                  <View style={styles.resultHeader}>
                    <Ionicons
                      name={result.executed ? "checkmark-circle" : "information-circle"}
                      size={20}
                      color={result.executed ? "#22c55e" : "#D4A843"}
                    />
                    <Text style={styles.resultHeaderText}>
                      {result.executed ? "Executed" : "Response"}
                    </Text>
                  </View>
                  <Text style={styles.resultResponse}>{result.response}</Text>
                </View>

                {result.latencyMs > 0 && (
                  <View style={styles.statsRow}>
                    <View
                      style={[
                        styles.statBadge,
                        { backgroundColor: `${TIER_COLORS[result.tier]}15` },
                      ]}
                    >
                      <Text style={[styles.statBadgeText, { color: TIER_COLORS[result.tier] }]}>
                        {TIER_LABELS[result.tier]}
                      </Text>
                    </View>
                    <Text style={styles.statLatency}>{result.latencyMs}ms</Text>
                    {result.intent && (
                      <Text style={styles.statIntent}>
                        {result.intent.domain}.{result.intent.action}
                      </Text>
                    )}
                  </View>
                )}
              </ScrollView>
            )}

            {/* Text input */}
            <View style={styles.textInputRow}>
              <TextInput
                style={styles.textInput}
                placeholder="Type a voice command..."
                placeholderTextColor="#94a3b8"
                value={textInput}
                onChangeText={setTextInput}
                onSubmitEditing={handleTextSubmit}
                returnKeyType="send"
                autoCapitalize="none"
                autoCorrect={false}
                editable={state !== "processing"}
              />
              <TouchableOpacity
                style={[styles.sendButton, !textInput.trim() && styles.sendButtonDisabled]}
                onPress={handleTextSubmit}
                disabled={!textInput.trim() || state === "processing"}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="send"
                  size={20}
                  color={textInput.trim() ? "#ffffff" : "#94a3b8"}
                />
              </TouchableOpacity>
            </View>

            {/* Example commands */}
            {(state === "idle" || state === "result") && (
              <View style={styles.examples}>
                <Text style={styles.examplesTitle}>Try these commands:</Text>
                {[
                  "Turn on the living room lights",
                  "Turn off the TV",
                  "Lock the front door",
                  "Turn up the volume",
                ].map((example) => (
                  <TouchableOpacity
                    key={example}
                    style={styles.examplePill}
                    onPress={() => void processAndShow(example)}
                    disabled={state !== "idle" && state !== "result"}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chatbubble-outline" size={14} color="#64748b" />
                    <Text style={styles.exampleText}>{example}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#7c3aed",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#7c3aed",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },

  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "85%",
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
    alignSelf: "center",
    marginBottom: 16,
  },

  stateLabel: { fontSize: 16, fontWeight: "600", textAlign: "center", marginBottom: 16 },

  micContainer: { alignItems: "center", justifyContent: "center", marginBottom: 20 },
  pulseRing: {
    position: "absolute",
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    opacity: 0.3,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },

  resultContainer: { maxHeight: 180, marginBottom: 12 },
  resultCard: { backgroundColor: "#FDF6E3", borderRadius: 12, padding: 14, marginBottom: 8 },
  resultHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  resultHeaderText: { fontSize: 13, fontWeight: "700", color: "#334155" },
  resultLabel: { fontSize: 12, fontWeight: "600", color: "#64748b", marginBottom: 4 },
  resultTranscript: { fontSize: 16, fontWeight: "500", color: "#1a1a1a", fontStyle: "italic" },
  resultResponse: { fontSize: 15, fontWeight: "500", color: "#1a1a1a", lineHeight: 22 },

  statsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  statBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statBadgeText: { fontSize: 12, fontWeight: "700" },
  statLatency: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  statIntent: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  textInputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  textInput: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1a1a1a",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: { backgroundColor: "#e2e8f0" },

  examples: { marginBottom: 8 },
  examplesTitle: { fontSize: 13, fontWeight: "600", color: "#64748b", marginBottom: 8 },
  examplePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
  },
  exampleText: { fontSize: 14, color: "#334155" },
});
