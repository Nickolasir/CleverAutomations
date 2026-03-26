/**
 * PIN Setup Modal
 *
 * Prompts the user to create a 4-6 digit PIN for elevated auth.
 * Shown on first access to sensitive data when biometrics are unavailable.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { setupPin } from "../../lib/biometric-auth";

interface PinSetupModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PinSetupModal({ visible, onClose, onSuccess }: PinSetupModalProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = () => {
    if (pin.length < 4 || pin.length > 6) {
      setError("PIN must be 4-6 digits");
      return;
    }
    setError(null);
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (pin !== confirmPin) {
      setError("PINs don't match");
      setConfirmPin("");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await setupPin(pin);

    if (result.success) {
      setPin("");
      setConfirmPin("");
      setStep("enter");
      onSuccess();
    } else {
      setError(result.error ?? "Failed to set PIN");
    }

    setLoading(false);
  };

  const handleClose = () => {
    setPin("");
    setConfirmPin("");
    setStep("enter");
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {step === "enter" ? "Create Your PIN" : "Confirm Your PIN"}
            </Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            {step === "enter"
              ? "Choose a 4-6 digit PIN to protect your private data."
              : "Enter your PIN again to confirm."}
          </Text>

          <Ionicons
            name="key-outline"
            size={40}
            color="#D4A843"
            style={styles.icon}
          />

          <TextInput
            style={styles.pinInput}
            placeholder={step === "enter" ? "Enter PIN" : "Confirm PIN"}
            placeholderTextColor="#94a3b8"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={step === "enter" ? pin : confirmPin}
            onChangeText={step === "enter" ? setPin : setConfirmPin}
            onSubmitEditing={step === "enter" ? handleNext : handleConfirm}
            autoFocus
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={step === "enter" ? handleNext : handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {step === "enter" ? "Next" : "Set PIN"}
              </Text>
            )}
          </TouchableOpacity>

          {step === "confirm" && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setStep("enter");
                setConfirmPin("");
                setError(null);
              }}
            >
              <Text style={styles.backButtonText}>Go back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 8,
  },
  title: { fontSize: 20, fontWeight: "700", color: "#1F1F1F" },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 16,
  },
  icon: { marginBottom: 16 },
  pinInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#D4A843",
    borderRadius: 12,
    padding: 14,
    fontSize: 24,
    textAlign: "center",
    color: "#1F1F1F",
    letterSpacing: 8,
    marginBottom: 12,
  },
  errorText: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
  button: {
    width: "100%",
    backgroundColor: "#D4A843",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  backButton: { marginTop: 12 },
  backButtonText: { color: "#64748b", fontSize: 14 },
});
