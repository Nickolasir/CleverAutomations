import React, { useEffect, useState, useCallback } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { User, UserRole, UserId } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

/** Role display colors */
const ROLE_COLORS: Record<UserRole, string> = {
  owner: "#7c3aed",
  admin: "#D4A843",
  manager: "#0891b2",
  resident: "#64748b",
  guest: "#94a3b8",
};

const ROLE_BG: Record<UserRole, string> = {
  owner: "#ede9fe",
  admin: "#FFECB3",
  manager: "#cffafe",
  resident: "#f1f5f9",
  guest: "#FDF6E3",
};

const ALL_ROLES: UserRole[] = ["owner", "admin", "manager", "resident", "guest"];

/** Roles that can be assigned (excluding owner) */
const ASSIGNABLE_ROLES: UserRole[] = ["admin", "manager", "resident", "guest"];

/** Get initials from a display name */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Admin-only Users management screen.
 * Lists tenant users, supports invite, role change, and deactivation.
 */
export default function UsersScreen() {
  const { user: currentUser } = useAuthContext();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Invite modal state
  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("resident");
  const [inviteSending, setInviteSending] = useState(false);

  // Role picker state
  const [rolePickerUserId, setRolePickerUserId] = useState<UserId | null>(null);
  const [rolePickerVisible, setRolePickerVisible] = useState(false);

  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "owner";
  const isOwner = currentUser?.role === "owner";
  const tenantId = currentUser?.tenant_id;

  /** Fetch all users for the tenant */
  const fetchUsers = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to fetch users:", error.message);
        return;
      }

      setUsers((data as unknown as User[]) ?? []);
    } catch (err) {
      console.error("Fetch users error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchUsers();
  }, [fetchUsers, isAdmin]);

  /** Pull-to-refresh */
  const onRefresh = () => {
    setRefreshing(true);
    void fetchUsers();
  };

  /** Send invite */
  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteDisplayName.trim()) {
      Alert.alert("Missing Fields", "Please provide both email and display name.");
      return;
    }

    setInviteSending(true);
    try {
      const { error } = await supabase.from("user_invites").insert({
        tenant_id: tenantId as string,
        email: inviteEmail.trim().toLowerCase(),
        display_name: inviteDisplayName.trim(),
        role: inviteRole,
        invited_by: currentUser?.id as string,
      });

      if (error) {
        Alert.alert("Invite Failed", error.message);
        return;
      }

      Alert.alert("Invite Sent", `Invitation sent to ${inviteEmail.trim()}.`);
      setInviteVisible(false);
      setInviteEmail("");
      setInviteDisplayName("");
      setInviteRole("resident");
    } catch (err) {
      Alert.alert("Error", "Failed to send invite. Please try again.");
    } finally {
      setInviteSending(false);
    }
  };

  /** Update a user's role */
  const handleRoleChange = async (targetUserId: UserId, newRole: UserRole) => {
    setRolePickerVisible(false);
    setRolePickerUserId(null);

    const { error } = await supabase
      .from("users")
      .update({ role: newRole })
      .eq("id", targetUserId as string);

    if (error) {
      Alert.alert("Update Failed", error.message);
      return;
    }

    setUsers((prev) =>
      prev.map((u) =>
        u.id === targetUserId ? { ...u, role: newRole } : u,
      ),
    );
  };

  /** Deactivate (soft delete) a user */
  const handleDeactivate = (targetUser: User) => {
    if (targetUser.role === "owner") return;

    Alert.alert(
      "Deactivate User",
      `Are you sure you want to deactivate ${targetUser.display_name}? They will lose access to the system.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("users")
              .delete()
              .eq("id", targetUser.id as string);

            if (error) {
              Alert.alert("Error", error.message);
              return;
            }

            setUsers((prev) =>
              prev.filter((u) => u.id !== targetUser.id),
            );
          },
        },
      ],
    );
  };

  /** Determine which roles the current user can assign to a target */
  const getAssignableRoles = (targetUser: User): UserRole[] => {
    // Only owners can assign admin roles
    if (isOwner) return ASSIGNABLE_ROLES;
    // Admins can only assign manager, resident, guest
    return ASSIGNABLE_ROLES.filter(
      (r) => r !== "admin",
    );
  };

  // -------------------------------------------------------------------------
  // Access denied
  // -------------------------------------------------------------------------
  if (!isAdmin) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed" size={48} color="#94a3b8" />
        <Text style={styles.accessDeniedTitle}>Access Denied</Text>
        <Text style={styles.accessDeniedText}>
          Only admins and owners can manage users.
        </Text>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading users...</Text>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  const rolePickerTarget = users.find((u) => u.id === rolePickerUserId);

  return (
    <View style={styles.container}>
      {/* Header with invite button */}
      <View style={styles.headerBar}>
        <Text style={styles.headerCount}>
          {users.length} user{users.length !== 1 ? "s" : ""}
        </Text>
        <TouchableOpacity
          style={styles.inviteButton}
          onPress={() => setInviteVisible(true)}
        >
          <Ionicons name="person-add" size={16} color="#ffffff" />
          <Text style={styles.inviteButtonText}>Invite User</Text>
        </TouchableOpacity>
      </View>

      {/* User list */}
      <FlatList
        data={users}
        keyExtractor={(item) => item.id as string}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D4A843"
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item: u }) => (
          <View style={styles.card}>
            <View style={styles.cardRow}>
              {/* Avatar */}
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: ROLE_BG[u.role] },
                ]}
              >
                <Text
                  style={[
                    styles.avatarText,
                    { color: ROLE_COLORS[u.role] },
                  ]}
                >
                  {getInitials(u.display_name)}
                </Text>
              </View>

              {/* Name + email */}
              <View style={styles.cardInfo}>
                <Text style={styles.userName} numberOfLines={1}>
                  {u.display_name}
                </Text>
                <Text style={styles.userEmail} numberOfLines={1}>
                  {u.email}
                </Text>
              </View>

              {/* Role badge (touchable for role change) */}
              <TouchableOpacity
                style={[
                  styles.roleBadge,
                  { backgroundColor: ROLE_BG[u.role] },
                ]}
                onPress={() => {
                  if (u.role === "owner") return; // cannot change owner role
                  if (u.role === "admin" && !isOwner) return; // only owner can change admins
                  setRolePickerUserId(u.id);
                  setRolePickerVisible(true);
                }}
                disabled={u.role === "owner" || (u.role === "admin" && !isOwner)}
              >
                <Text
                  style={[
                    styles.roleBadgeText,
                    { color: ROLE_COLORS[u.role] },
                  ]}
                >
                  {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Deactivate button (not shown for owners or self) */}
            {u.role !== "owner" && u.id !== currentUser?.id && (
              <TouchableOpacity
                style={styles.deactivateButton}
                onPress={() => handleDeactivate(u)}
              >
                <Ionicons name="trash-outline" size={14} color="#ef4444" />
                <Text style={styles.deactivateText}>Deactivate</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyText}>No users found</Text>
            <Text style={styles.emptySubtext}>
              Invite users to get started.
            </Text>
          </View>
        }
      />

      {/* ----------------------------------------------------------------- */}
      {/* Invite Modal                                                       */}
      {/* ----------------------------------------------------------------- */}
      <Modal
        visible={inviteVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setInviteVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite User</Text>
              <TouchableOpacity onPress={() => setInviteVisible(false)}>
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.textInput}
              placeholder="user@example.com"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              value={inviteEmail}
              onChangeText={setInviteEmail}
            />

            <Text style={styles.inputLabel}>Display Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Jane Doe"
              placeholderTextColor="#94a3b8"
              autoCapitalize="words"
              value={inviteDisplayName}
              onChangeText={setInviteDisplayName}
            />

            <Text style={styles.inputLabel}>Role</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rolePillRow}
            >
              {ASSIGNABLE_ROLES.filter(
                (r) => isOwner || r !== "admin",
              ).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.rolePill,
                    inviteRole === role && {
                      backgroundColor: ROLE_COLORS[role],
                      borderColor: ROLE_COLORS[role],
                    },
                  ]}
                  onPress={() => setInviteRole(role)}
                >
                  <Text
                    style={[
                      styles.rolePillText,
                      inviteRole === role && { color: "#ffffff" },
                    ]}
                  >
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.sendInviteButton,
                inviteSending && { opacity: 0.6 },
              ]}
              onPress={handleInvite}
              disabled={inviteSending}
            >
              {inviteSending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.sendInviteText}>Send Invite</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ----------------------------------------------------------------- */}
      {/* Role Picker Modal                                                  */}
      {/* ----------------------------------------------------------------- */}
      <Modal
        visible={rolePickerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setRolePickerVisible(false);
          setRolePickerUserId(null);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setRolePickerVisible(false);
            setRolePickerUserId(null);
          }}
        >
          <View style={styles.rolePickerContent}>
            <Text style={styles.rolePickerTitle}>
              Change Role{rolePickerTarget ? ` for ${rolePickerTarget.display_name}` : ""}
            </Text>
            {rolePickerTarget &&
              getAssignableRoles(rolePickerTarget).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.rolePickerOption,
                    rolePickerTarget.role === role && {
                      backgroundColor: ROLE_BG[role],
                    },
                  ]}
                  onPress={() =>
                    handleRoleChange(rolePickerTarget.id, role)
                  }
                >
                  <View
                    style={[
                      styles.rolePickerDot,
                      { backgroundColor: ROLE_COLORS[role] },
                    ]}
                  />
                  <Text style={styles.rolePickerOptionText}>
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </Text>
                  {rolePickerTarget.role === role && (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={ROLE_COLORS[role]}
                      style={{ marginLeft: "auto" }}
                    />
                  )}
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
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

  // Header
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  headerCount: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  inviteButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D4A843",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  inviteButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },

  // List
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },

  // User card
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
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  userEmail: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  deactivateButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    marginTop: 10,
    gap: 4,
  },
  deactivateText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ef4444",
  },

  // Empty state
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

  // Invite Modal
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
  rolePillRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    paddingVertical: 4,
  },
  rolePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f1f5f9",
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  sendInviteButton: {
    marginTop: 24,
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  sendInviteText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },

  // Role picker modal
  rolePickerContent: {
    backgroundColor: "#ffffff",
    marginHorizontal: 32,
    borderRadius: 16,
    padding: 20,
    alignSelf: "center",
    width: "80%",
    marginTop: "auto",
    marginBottom: "auto",
  },
  rolePickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
    textAlign: "center",
  },
  rolePickerOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 4,
  },
  rolePickerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  rolePickerOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
});
