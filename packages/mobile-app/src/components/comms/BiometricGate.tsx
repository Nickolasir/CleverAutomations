/**
 * BiometricGate Component
 *
 * Wraps child content behind biometric/PIN authentication.
 * Shows a locked state until the user verifies their identity.
 * Used to protect email and nutrition data screens.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  requireElevatedAuth,
  verifyWithPin,
  setupPin,
  type ElevatedAuthResult,
} from "../../lib/biometric-auth";

interface BiometricGateProps {
  /** Reason shown in the biometric prompt */
  reason: string;
  children: React.ReactNode;
  /** Called when auth succeeds with the session token */
  onAuthenticated?: (sessionToken: string) => void;
}

export default function BiometricGate({
  reason,
  children,
  onAuthenticated,
}: BiometricGateProps) {
  const insets = useSafeAreaInsets();
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPinInput, setShowPinInput] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const attemptAuth = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result: ElevatedAuthResult = await requireElevatedAuth(reason);

    if (result.success && result.sessionToken) {
      setAuthenticated(true);
      onAuthenticated?.(result.sessionToken);
    } else if (result.needsPinSetup) {
      setShowPinSetup(true);
    } else if (result.error === "PIN required") {
      setShowPinInput(true);
    } else {
      setError(result.error ?? "Authentication failed");
    }

    setLoading(false);
  }, [reason, onAuthenticated]);

  useEffect(() => {
    attemptAuth();
  }, [attemptAuth]);

  const handlePinSubmit = async () => {
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await verifyWithPin(pin);
    if (result.success && result.sessionToken) {
      setAuthenticated(true);
      setShowPinInput(false);
      onAuthenticated?.(result.sessionToken);
    } else {
      setError(result.error ?? "Invalid PIN");
      setPin("");
    }

    setLoading(false);
  };

  const handlePinSetup = async () => {
    if (newPin.length < 4 || newPin.length > 6) {
      setError("PIN must be 4-6 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs don't match");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await setupPin(newPin);
    if (result.success) {
      setShowPinSetup(false);
      Alert.alert("PIN Set", "Your PIN has been set up. Now authenticate to continue.");
      attemptAuth();
    } else {
      setError(result.error ?? "Failed to set PIN");
    }

    setLoading(false);
  };

  // Authenticated — render children
  if (authenticated) {
    return <>{children}</>;
  }

  // Loading state
  if (loading) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.statusText}>Verifying identity...</Text>
      </View>
    );
  }

  // PIN setup
  if (showPinSetup) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <Ionicons name="key-outline" size={48} color="#D4A843" />
        <Text style={styles.title}>Set Up a PIN</Text>
        <Text style={styles.subtitle}>
          Create a 4-6 digit PIN to access sensitive data when biometrics aren't available.
        </Text>

        <TextInput
          style={styles.pinInput}
          placeholder="New PIN"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          value={newPin}
          onChangeText={setNewPin}
        />
        <TextInput
          style={styles.pinInput}
          placeholder="Confirm PIN"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          value={confirmPin}
          onChangeText={setConfirmPin}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={handlePinSetup}>
          <Text style={styles.buttonText}>Set PIN</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // PIN input
  if (showPinInput) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <Ionicons name="lock-closed-outline" size={48} color="#D4A843" />
        <Text style={styles.title}>Enter Your PIN</Text>
        <Text style={styles.subtitle}>{reason}</Text>

        <TextInput
          style={styles.pinInput}
          placeholder="PIN"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          value={pin}
          onChangeText={setPin}
          onSubmitEditing={handlePinSubmit}
          autoFocus
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={handlePinSubmit}>
          <Text style={styles.buttonText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Locked state (biometric failed or error)
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Ionicons name="lock-closed-outline" size={64} color="#D4A843" />
      <Text style={styles.title}>Authentication Required</Text>
      <Text style={styles.subtitle}>{reason}</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={attemptAuth}>
        <Ionicons name="finger-print-outline" size={20} color="#fff" />
        <Text style={styles.buttonText}>Authenticate</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1F1F1F",
    marginTop: 16,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 8,
    textAlign: "center",
    marginBottom: 24,
  },
  statusText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 12,
  },
  pinInput: {
    width: "100%",
    maxWidth: 200,
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
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D4A843",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
