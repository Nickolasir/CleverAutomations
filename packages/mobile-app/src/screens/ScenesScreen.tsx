import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Scene, SceneAction, DeviceId, Device } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

type TriggerType = "manual" | "schedule" | "voice" | "geofence";

const TRIGGER_ICONS: Record<TriggerType, keyof typeof Ionicons.glyphMap> = {
  manual: "hand-left-outline",
  voice: "mic-outline",
  schedule: "time-outline",
  geofence: "location-outline",
};

const TRIGGER_LABELS: Record<TriggerType, string> = {
  manual: "Manual",
  voice: "Voice",
  schedule: "Schedule",
  geofence: "Geofence",
};

const ALL_TRIGGERS: TriggerType[] = ["manual", "voice", "schedule", "geofence"];

export default function ScenesScreen() {
  const { user } = useAuthContext();
  const tenantId = user?.tenant_id;

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [sceneName, setSceneName] = useState("");
  const [sceneDescription, setSceneDescription] = useState("");
  const [sceneTrigger, setSceneTrigger] = useState<TriggerType>("manual");
  const [sceneActions, setSceneActions] = useState<SceneAction[]>([]);
  const [saving, setSaving] = useState(false);

  // Action editor state
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [pendingActionDevice, setPendingActionDevice] = useState<Device | null>(null);
  const [pendingActionText, setPendingActionText] = useState("");

  /** Fetch scenes from Supabase */
  const fetchScenes = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("scenes")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("name");

      if (error) {
        console.error("Failed to fetch scenes:", error.message);
        return;
      }

      setScenes((data as unknown as Scene[]) ?? []);
    } catch (err) {
      console.error("Fetch scenes error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  /** Fetch devices for action device selection */
  const fetchDevices = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("name");

      if (error) {
        console.error("Failed to fetch devices:", error.message);
        return;
      }

      setDevices((data as unknown as Device[]) ?? []);
    } catch (err) {
      console.error("Fetch devices error:", err);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    void fetchScenes();
    void fetchDevices();
  }, [tenantId, fetchScenes, fetchDevices]);

  /** Pull-to-refresh */
  const onRefresh = () => {
    setRefreshing(true);
    void fetchScenes();
    void fetchDevices();
  };

  /** Activate a scene by inserting device_commands for each action */
  const activateScene = async (scene: Scene) => {
    if (!tenantId || !scene.actions?.length) return;

    setActivatingId(scene.id);
    try {
      const commands = scene.actions.map((action) => ({
        device_id: action.device_id,
        tenant_id: tenantId,
        action: action.action,
        parameters: action.parameters ?? {},
        source: "mobile_scene",
      }));

      const { error } = await supabase.from("device_commands").insert(commands);

      if (error) {
        Alert.alert("Error", "Failed to activate scene: " + error.message);
      } else {
        Alert.alert("Scene Activated", `"${scene.name}" has been activated.`);
      }
    } catch (err) {
      Alert.alert("Error", "An unexpected error occurred.");
      console.error("Activate scene error:", err);
    } finally {
      setActivatingId(null);
    }
  };

  /** Open create modal */
  const openCreateModal = () => {
    setEditingScene(null);
    setSceneName("");
    setSceneDescription("");
    setSceneTrigger("manual");
    setSceneActions([]);
    setModalVisible(true);
  };

  /** Open edit modal */
  const openEditModal = (scene: Scene) => {
    setEditingScene(scene);
    setSceneName(scene.name);
    setSceneDescription(scene.description ?? "");
    setSceneTrigger(scene.trigger ?? "manual");
    setSceneActions(scene.actions ?? []);
    setModalVisible(true);
  };

  /** Close modal and reset state */
  const closeModal = () => {
    setModalVisible(false);
    setEditingScene(null);
    setShowDevicePicker(false);
    setPendingActionDevice(null);
    setPendingActionText("");
  };

  /** Save scene (create or update) */
  const saveScene = async () => {
    if (!tenantId || !sceneName.trim()) {
      Alert.alert("Validation", "Scene name is required.");
      return;
    }

    setSaving(true);
    try {
      const sceneData = {
        tenant_id: tenantId,
        name: sceneName.trim(),
        description: sceneDescription.trim(),
        trigger: sceneTrigger,
        actions: sceneActions,
        created_by: user?.id,
      };

      if (editingScene) {
        const { error } = await supabase
          .from("scenes")
          .update(sceneData)
          .eq("id", editingScene.id);

        if (error) {
          Alert.alert("Error", "Failed to update scene: " + error.message);
          return;
        }
      } else {
        const { error } = await supabase.from("scenes").insert(sceneData);

        if (error) {
          Alert.alert("Error", "Failed to create scene: " + error.message);
          return;
        }
      }

      closeModal();
      void fetchScenes();
    } catch (err) {
      Alert.alert("Error", "An unexpected error occurred.");
      console.error("Save scene error:", err);
    } finally {
      setSaving(false);
    }
  };

  /** Delete scene with confirmation */
  const deleteScene = (scene: Scene) => {
    Alert.alert(
      "Delete Scene",
      `Are you sure you want to delete "${scene.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("scenes")
              .delete()
              .eq("id", scene.id);

            if (error) {
              Alert.alert("Error", "Failed to delete scene: " + error.message);
            } else {
              void fetchScenes();
            }
          },
        },
      ]
    );
  };

  /** Add an action to the current scene being edited */
  const addAction = () => {
    if (!pendingActionDevice || !pendingActionText.trim()) {
      Alert.alert("Validation", "Select a device and enter an action.");
      return;
    }

    const newAction: SceneAction = {
      device_id: pendingActionDevice.id as DeviceId,
      action: pendingActionText.trim(),
      parameters: {},
    };

    setSceneActions((prev) => [...prev, newAction]);
    setPendingActionDevice(null);
    setPendingActionText("");
    setShowDevicePicker(false);
  };

  /** Remove an action by index */
  const removeAction = (index: number) => {
    setSceneActions((prev) => prev.filter((_, i) => i !== index));
  };

  /** Get device name by id */
  const getDeviceName = (deviceId: DeviceId): string => {
    const device = devices.find((d) => d.id === deviceId);
    return device?.name ?? String(deviceId);
  };

  /** Render a single scene card */
  const renderScene = ({ item: scene }: { item: Scene }) => {
    const trigger = scene.trigger ?? "manual";
    const isActivating = activatingId === scene.id;

    return (
      <View style={styles.sceneCard}>
        <TouchableOpacity
          style={styles.sceneCardBody}
          onPress={() => openEditModal(scene)}
          onLongPress={() => deleteScene(scene)}
          activeOpacity={0.7}
        >
          <View style={styles.sceneHeader}>
            <View style={styles.sceneInfo}>
              <Text style={styles.sceneName} numberOfLines={1}>
                {scene.name}
              </Text>
              {scene.description ? (
                <Text style={styles.sceneDescription} numberOfLines={2}>
                  {scene.description}
                </Text>
              ) : null}
            </View>
            <View style={styles.triggerBadge}>
              <Ionicons
                name={TRIGGER_ICONS[trigger]}
                size={16}
                color="#D4A843"
              />
              <Text style={styles.triggerLabel}>{TRIGGER_LABELS[trigger]}</Text>
            </View>
          </View>

          <View style={styles.sceneFooter}>
            <Text style={styles.actionCount}>
              {scene.actions?.length ?? 0} action
              {(scene.actions?.length ?? 0) !== 1 ? "s" : ""}
            </Text>

            <TouchableOpacity
              style={[
                styles.activateButton,
                isActivating && styles.activateButtonDisabled,
              ]}
              onPress={() => void activateScene(scene)}
              disabled={isActivating || !scene.actions?.length}
              activeOpacity={0.7}
            >
              {isActivating ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="play" size={14} color="#ffffff" />
                  <Text style={styles.activateButtonText}>Activate</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  /** Device picker modal content */
  const renderDevicePicker = () => (
    <View style={styles.devicePickerOverlay}>
      <View style={styles.devicePickerContainer}>
        <View style={styles.devicePickerHeader}>
          <Text style={styles.devicePickerTitle}>Select Device</Text>
          <TouchableOpacity onPress={() => setShowDevicePicker(false)}>
            <Ionicons name="close" size={24} color="#64748b" />
          </TouchableOpacity>
        </View>
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id as string}
          renderItem={({ item: device }) => (
            <TouchableOpacity
              style={styles.devicePickerItem}
              onPress={() => {
                setPendingActionDevice(device);
                setShowDevicePicker(false);
              }}
            >
              <Text style={styles.devicePickerItemName}>{device.name}</Text>
              <Text style={styles.devicePickerItemRoom}>{device.room}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.devicePickerEmpty}>No devices available</Text>
          }
        />
      </View>
    </View>
  );

  /** Loading state */
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading scenes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={scenes}
        keyExtractor={(item) => item.id}
        renderItem={renderScene}
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
            <Ionicons name="layers-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>No scenes yet</Text>
            <Text style={styles.emptySubtext}>
              Tap the + button to create your first scene
            </Text>
          </View>
        }
      />

      {/* Create Scene FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={openCreateModal}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>

      {/* Create / Edit Scene Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingScene ? "Edit Scene" : "Create Scene"}
            </Text>
            <TouchableOpacity onPress={() => void saveScene()} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#D4A843" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {/* Name */}
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.textInput}
              value={sceneName}
              onChangeText={setSceneName}
              placeholder="e.g., Movie Night"
              placeholderTextColor="#94a3b8"
            />

            {/* Description */}
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={sceneDescription}
              onChangeText={setSceneDescription}
              placeholder="Optional description..."
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={3}
            />

            {/* Trigger Picker */}
            <Text style={styles.fieldLabel}>Trigger</Text>
            <View style={styles.triggerPicker}>
              {ALL_TRIGGERS.map((trigger) => (
                <TouchableOpacity
                  key={trigger}
                  style={[
                    styles.triggerOption,
                    sceneTrigger === trigger && styles.triggerOptionActive,
                  ]}
                  onPress={() => setSceneTrigger(trigger)}
                >
                  <Ionicons
                    name={TRIGGER_ICONS[trigger]}
                    size={20}
                    color={sceneTrigger === trigger ? "#D4A843" : "#64748b"}
                  />
                  <Text
                    style={[
                      styles.triggerOptionLabel,
                      sceneTrigger === trigger && styles.triggerOptionLabelActive,
                    ]}
                  >
                    {TRIGGER_LABELS[trigger]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Actions */}
            <Text style={styles.fieldLabel}>Actions</Text>
            {sceneActions.map((action, index) => (
              <View key={index} style={styles.actionRow}>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionDevice} numberOfLines={1}>
                    {getDeviceName(action.device_id)}
                  </Text>
                  <Text style={styles.actionText} numberOfLines={1}>
                    {action.action}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeAction(index)}
                  style={styles.removeActionButton}
                >
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}

            {/* Add Action */}
            <View style={styles.addActionSection}>
              <TouchableOpacity
                style={styles.deviceSelectButton}
                onPress={() => setShowDevicePicker(true)}
              >
                <Ionicons name="hardware-chip-outline" size={16} color="#64748b" />
                <Text style={styles.deviceSelectText}>
                  {pendingActionDevice
                    ? pendingActionDevice.name
                    : "Select device..."}
                </Text>
              </TouchableOpacity>

              <TextInput
                style={styles.actionInput}
                value={pendingActionText}
                onChangeText={setPendingActionText}
                placeholder="Action (e.g., turn_on)"
                placeholderTextColor="#94a3b8"
              />

              <TouchableOpacity
                style={styles.addActionButton}
                onPress={addAction}
              >
                <Ionicons name="add-circle" size={24} color="#D4A843" />
                <Text style={styles.addActionLabel}>Add Action</Text>
              </TouchableOpacity>
            </View>

            {/* Delete button for existing scenes */}
            {editingScene && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => {
                  closeModal();
                  deleteScene(editingScene);
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#dc2626" />
                <Text style={styles.deleteButtonText}>Delete Scene</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Device Picker Overlay */}
          {showDevicePicker && renderDevicePicker()}
        </View>
      </Modal>
    </View>
  );
}

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
  },
  loadingText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 12,
  },
  listContent: {
    padding: 16,
    paddingBottom: 96,
  },

  /* Scene Card */
  sceneCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sceneCardBody: {
    padding: 16,
  },
  sceneHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  sceneInfo: {
    flex: 1,
    marginRight: 12,
  },
  sceneName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  sceneDescription: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 18,
  },
  triggerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF8E1",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  triggerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#D4A843",
  },
  sceneFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 12,
  },
  actionCount: {
    fontSize: 13,
    color: "#94a3b8",
    fontWeight: "500",
  },
  activateButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D4A843",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  activateButtonDisabled: {
    backgroundColor: "#93c5fd",
  },
  activateButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },

  /* FAB */
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#D4A843",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },

  /* Empty State */
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
  },

  /* Modal */
  modalContainer: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalCancel: {
    fontSize: 15,
    color: "#64748b",
    fontWeight: "600",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  modalSave: {
    fontSize: 15,
    color: "#D4A843",
    fontWeight: "700",
  },
  modalBody: {
    flex: 1,
    padding: 16,
  },

  /* Form Fields */
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 6,
    marginTop: 16,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1a1a1a",
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },

  /* Trigger Picker */
  triggerPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  triggerOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  triggerOptionActive: {
    borderColor: "#D4A843",
    backgroundColor: "#FFF8E1",
  },
  triggerOptionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  triggerOptionLabelActive: {
    color: "#D4A843",
  },

  /* Actions List */
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  actionInfo: {
    flex: 1,
  },
  actionDevice: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  actionText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  removeActionButton: {
    padding: 6,
  },

  /* Add Action */
  addActionSection: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  deviceSelectButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 8,
  },
  deviceSelectText: {
    fontSize: 14,
    color: "#64748b",
  },
  actionInput: {
    backgroundColor: "#FDF6E3",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1a1a1a",
    marginBottom: 8,
  },
  addActionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  addActionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#D4A843",
  },

  /* Delete Button */
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 32,
    marginBottom: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    gap: 8,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#dc2626",
  },

  /* Device Picker Overlay */
  devicePickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  devicePickerContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "60%",
    paddingBottom: 24,
  },
  devicePickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  devicePickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  devicePickerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  devicePickerItemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  devicePickerItemRoom: {
    fontSize: 13,
    color: "#94a3b8",
  },
  devicePickerEmpty: {
    textAlign: "center",
    color: "#94a3b8",
    paddingVertical: 24,
    fontSize: 14,
  },
});
