import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { DeviceCategory } from "@clever/shared";
import { useAuthContext, type RootStackParamList } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import {
  SUPPORTED_INTEGRATIONS,
  type SupportedIntegration,
  type ConfigFlowStep,
  startConfigFlow,
  submitConfigFlowStep,
  deleteConfigFlow,
  getStates,
  entityDomainToCategory,
  haStateToDeviceState,
} from "../lib/homeassistant";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type Screen = "pick_integration" | "config_flow" | "assign_room" | "done";

export default function AddDeviceScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<NavigationProp>();
  const tenantId = user?.tenant_id;

  const [screen, setScreen] = useState<Screen>("pick_integration");
  const [selectedIntegration, setSelectedIntegration] = useState<SupportedIntegration | null>(null);

  // Config flow state
  const [flowStep, setFlowStep] = useState<ConfigFlowStep | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Room assignment
  const [room, setRoom] = useState("Living Room");
  const [floor, setFloor] = useState("Main");
  const [deviceName, setDeviceName] = useState("");

  // Snapshot of entity IDs before pairing (to diff after)
  const [preFlowEntityIds, setPreFlowEntityIds] = useState<Set<string>>(new Set());

  // Result
  const [createdEntities, setCreatedEntities] = useState<string[]>([]);

  /** Cleanup flow on unmount */
  useEffect(() => {
    return () => {
      if (flowStep?.flow_id && flowStep.type !== "create_entry") {
        deleteConfigFlow(flowStep.flow_id).catch(() => {});
      }
    };
  }, [flowStep]);

  /** Start the config flow for the selected integration */
  const handleSelectIntegration = useCallback(async (integration: SupportedIntegration) => {
    setSelectedIntegration(integration);
    setLoading(true);
    setError(null);
    try {
      // Snapshot current entities so we can diff after pairing
      const currentStates = await getStates();
      setPreFlowEntityIds(new Set(currentStates.map((s) => s.entity_id)));

      const step = await startConfigFlow(integration.id);
      setFlowStep(step);
      setScreen("config_flow");
    } catch (err: any) {
      setError(err.message ?? "Failed to start setup flow");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Submit the current config flow step */
  const handleSubmitStep = useCallback(async () => {
    if (!flowStep) return;
    setLoading(true);
    setError(null);

    try {
      const result = await submitConfigFlowStep(flowStep.flow_id, formValues);

      if (result.type === "create_entry") {
        // Integration added successfully — find the entities it created
        const configEntryId = result.result?.entry_id;
        setDeviceName(result.result?.title ?? selectedIntegration?.name ?? "New Device");

        // Give HA a moment to register entities, then diff against pre-flow snapshot
        await new Promise((r) => setTimeout(r, 3000));
        const postStates = await getStates();
        const newEntities = postStates
          .filter((s) => !preFlowEntityIds.has(s.entity_id))
          .filter((s) => entityDomainToCategory(s.entity_id) !== null)
          .map((s) => s.entity_id);
        setCreatedEntities(newEntities);

        setFlowStep(result);
        setScreen("assign_room");
      } else if (result.type === "form") {
        // More steps needed
        setFlowStep(result);
        setFormValues({});
      } else if (result.type === "abort") {
        const reason = result.step_id ?? result.reason ?? "unknown";
        if (reason === "already_configured") {
          setError("This device is already connected to Home Assistant. Check your dashboard.");
        } else if (reason === "cannot_connect") {
          setError("Could not connect to the device. Make sure it's powered on and on the same WiFi network.");
        } else {
          setError(`Setup failed: ${reason}`);
        }
      } else if (result.type === "progress" || result.type === "show_progress_done") {
        // Waiting for user action (e.g., accept pairing on TV)
        setFlowStep(result);
      } else {
        setFlowStep(result);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to complete step");
    } finally {
      setLoading(false);
    }
  }, [flowStep, formValues, selectedIntegration, preFlowEntityIds]);

  /** Poll progress steps (e.g., waiting for TV to accept pairing) */
  useEffect(() => {
    if (flowStep?.type !== "progress") return;

    const interval = setInterval(async () => {
      try {
        const result = await submitConfigFlowStep(flowStep.flow_id, {});
        if (result.type !== "progress") {
          clearInterval(interval);
          if (result.type === "create_entry") {
            setDeviceName(result.result?.title ?? selectedIntegration?.name ?? "New Device");
            await new Promise((r) => setTimeout(r, 3000));
            const postStates = await getStates();
            const newEntities = postStates
              .filter((s) => !preFlowEntityIds.has(s.entity_id))
              .filter((s) => entityDomainToCategory(s.entity_id) !== null)
              .map((s) => s.entity_id);
            setCreatedEntities(newEntities);
            setFlowStep(result);
            setScreen("assign_room");
          } else {
            setFlowStep(result);
            setFormValues({});
          }
        }
      } catch {
        // keep polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [flowStep, selectedIntegration, preFlowEntityIds]);

  /** Register the device(s) in Supabase */
  const handleFinish = useCallback(async () => {
    if (!tenantId || createdEntities.length === 0) {
      navigation.goBack();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get current states for the new entities
      const allStates = await getStates();

      for (const entityId of createdEntities) {
        const category = entityDomainToCategory(entityId);
        if (!category) continue; // skip unsupported entity types

        const entityState = allStates.find((s) => s.entity_id === entityId);
        const state = entityState
          ? haStateToDeviceState(entityId, entityState.state)
          : "unknown";
        const friendlyName =
          (entityState?.attributes?.friendly_name as string) ?? entityId;

        const { error: insertError } = await supabase.from("devices").insert({
          tenant_id: tenantId,
          ha_entity_id: entityId,
          name: createdEntities.length === 1 ? deviceName : friendlyName,
          category,
          room,
          floor,
          state,
          attributes: entityState?.attributes ?? {},
          is_online: entityState?.state !== "unavailable",
          last_seen: new Date().toISOString(),
        });

        if (insertError) {
          console.error(`Failed to register ${entityId}:`, insertError.message);
        }
      }

      setScreen("done");
    } catch (err: any) {
      setError(err.message ?? "Failed to register devices");
    } finally {
      setLoading(false);
    }
  }, [tenantId, createdEntities, deviceName, room, floor, navigation]);

  // ─── Pick Integration ───
  if (screen === "pick_integration") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Add a Device</Text>
        <Text style={styles.subheading}>Choose the type of device to connect</Text>

        {SUPPORTED_INTEGRATIONS.map((integration) => (
          <TouchableOpacity
            key={integration.id}
            style={styles.integrationCard}
            onPress={() => handleSelectIntegration(integration)}
            disabled={loading}
          >
            <View style={styles.integrationIcon}>
              <Text style={styles.integrationIconText}>{integration.icon}</Text>
            </View>
            <View style={styles.integrationInfo}>
              <Text style={styles.integrationName}>{integration.name}</Text>
              <Text style={styles.integrationDesc}>{integration.description}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {loading && <ActivityIndicator style={{ marginTop: 20 }} color="#D4A843" />}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    );
  }

  // ─── Config Flow ───
  if (screen === "config_flow" && flowStep) {
    const isProgress = flowStep.type === "progress";
    const stepTitle = isProgress
      ? "Waiting for device..."
      : flowStep.step_id === "user"
        ? "Enter device details"
        : `Step: ${flowStep.step_id}`;
    const stepHint = isProgress
      ? selectedIntegration?.id === "samsungtv"
        ? "Check your TV screen — accept the pairing request"
        : "Please follow the instructions on your device"
      : flowStep.step_id === "confirm"
        ? "Confirm to add this device"
        : null;

    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.heading}>{selectedIntegration?.name}</Text>
          <Text style={styles.subheading}>{stepTitle}</Text>

          {stepHint && <Text style={styles.hintText}>{stepHint}</Text>}

          {isProgress && (
            <ActivityIndicator size="large" color="#D4A843" style={{ marginVertical: 32 }} />
          )}

          {/* Render form fields */}
          {flowStep.type === "form" &&
            flowStep.data_schema?.map((field) => (
              <View key={field.name} style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>
                  {field.name === "host"
                    ? "IP Address"
                    : field.name.charAt(0).toUpperCase() + field.name.slice(1).replace(/_/g, " ")}
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={formValues[field.name] ?? (field.default as string) ?? ""}
                  onChangeText={(text) =>
                    setFormValues((prev) => ({ ...prev, [field.name]: text }))
                  }
                  placeholder={
                    field.name === "host" ? "e.g. 192.168.1.100" : `Enter ${field.name}`
                  }
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={field.name === "host" ? "numeric" : "default"}
                />
                {flowStep.errors?.[field.name] && (
                  <Text style={styles.fieldError}>{flowStep.errors[field.name]}</Text>
                )}
              </View>
            ))}

          {error && <Text style={styles.errorText}>{error}</Text>}

          {!isProgress && (
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleSubmitStep}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {flowStep.step_id === "confirm" ? "Confirm" : "Connect"}
                </Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              if (flowStep.flow_id) deleteConfigFlow(flowStep.flow_id).catch(() => {});
              navigation.goBack();
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── Assign Room ───
  if (screen === "assign_room") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.heading}>Device Connected!</Text>
          <Text style={styles.subheading}>
            {selectedIntegration?.name} paired successfully
          </Text>

          {createdEntities.length > 0 && (
            <View style={styles.entitiesBox}>
              <Text style={styles.entitiesLabel}>
                {createdEntities.length} entit{createdEntities.length === 1 ? "y" : "ies"} found:
              </Text>
              {createdEntities.map((eid) => (
                <Text key={eid} style={styles.entityId}>
                  {eid}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Device Name</Text>
            <TextInput
              style={styles.textInput}
              value={deviceName}
              onChangeText={setDeviceName}
              placeholder="e.g. Living Room TV"
              placeholderTextColor="#94a3b8"
            />
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Room</Text>
            <TextInput
              style={styles.textInput}
              value={room}
              onChangeText={setRoom}
              placeholder="e.g. Living Room"
              placeholderTextColor="#94a3b8"
            />
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Floor</Text>
            <TextInput
              style={styles.textInput}
              value={floor}
              onChangeText={setFloor}
              placeholder="e.g. Main"
              placeholderTextColor="#94a3b8"
            />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleFinish}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save Device</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── Done ───
  return (
    <View style={[styles.container, styles.centerContent]}>
      <View style={styles.successCircle}>
        <Ionicons name="checkmark" size={36} color="#ffffff" />
      </View>
      <Text style={styles.heading}>All Set!</Text>
      <Text style={styles.subheading}>
        {deviceName} has been added to your {room}
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, { marginTop: 32 }]}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.primaryButtonText}>Back to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  centerContent: {
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 24,
  },
  hintText: {
    fontSize: 15,
    color: "#D4A843",
    backgroundColor: "#FFF8E1",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    textAlign: "center",
    overflow: "hidden",
  },
  integrationCard: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
  },
  integrationIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#FFF8E1",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  integrationIconText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#D4A843",
  },
  integrationInfo: {
    flex: 1,
  },
  integrationName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 2,
  },
  integrationDesc: {
    fontSize: 13,
    color: "#64748b",
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: "#1a1a1a",
  },
  fieldError: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: "#D4A843",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  cancelButtonText: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "500",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 14,
    marginVertical: 12,
    textAlign: "center",
  },
  entitiesBox: {
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  entitiesLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#166534",
    marginBottom: 6,
  },
  entityId: {
    fontSize: 13,
    color: "#15803d",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#22c55e",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  successCheck: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
  },
});
