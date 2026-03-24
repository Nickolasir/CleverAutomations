import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

export default function ProfileScreen() {
  const { user, tenant } = useAuthContext();

  // Account info state
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [updatingProfile, setUpdatingProfile] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  /** Update display name in users table */
  const handleUpdateProfile = async () => {
    if (!user) return;

    if (!displayName.trim()) {
      Alert.alert("Validation Error", "Display name cannot be empty.");
      return;
    }

    setUpdatingProfile(true);
    try {
      const { error } = await supabase
        .from("users")
        .update({ display_name: displayName.trim() })
        .eq("id", user.id as string);

      if (error) {
        Alert.alert("Error", "Failed to update profile: " + error.message);
      } else {
        Alert.alert("Success", "Profile updated successfully.");
      }
    } catch (err) {
      Alert.alert("Error", "Unexpected error updating profile.");
      console.error(err);
    } finally {
      setUpdatingProfile(false);
    }
  };

  /** Change password via Supabase Auth */
  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert("Validation Error", "Please fill in both password fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Validation Error", "Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert("Validation Error", "Password must be at least 8 characters.");
      return;
    }

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        Alert.alert("Error", "Failed to change password: " + error.message);
      } else {
        Alert.alert("Success", "Password changed successfully.");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err) {
      Alert.alert("Error", "Unexpected error changing password.");
      console.error(err);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Account Information */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="person-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Account Information</Text>
        </View>

        <Text style={styles.label}>Display Name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Enter your display name"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Email</Text>
        <View style={styles.readOnlyField}>
          <Text style={styles.readOnlyText}>{user?.email ?? "---"}</Text>
        </View>

        <Text style={styles.label}>Role</Text>
        <View style={styles.readOnlyField}>
          <Text style={styles.readOnlyText}>
            {user?.role
              ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
              : "---"}
          </Text>
        </View>

        <Text style={styles.label}>Tenant</Text>
        <View style={styles.readOnlyField}>
          <Text style={styles.readOnlyText}>{tenant?.name ?? "---"}</Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, updatingProfile && styles.buttonDisabled]}
          onPress={handleUpdateProfile}
          disabled={updatingProfile}
          activeOpacity={0.7}
        >
          {updatingProfile ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="checkmark-outline" size={18} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.primaryButtonText}>Update Profile</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Change Password */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="key-outline" size={20} color="#D4A843" />
          <Text style={styles.cardTitle}>Change Password</Text>
        </View>

        <Text style={styles.label}>New Password</Text>
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Min 8 characters"
          placeholderTextColor="#94a3b8"
          secureTextEntry
        />

        <Text style={styles.label}>Confirm Password</Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Re-enter new password"
          placeholderTextColor="#94a3b8"
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.primaryButton, changingPassword && styles.buttonDisabled]}
          onPress={handleChangePassword}
          disabled={changingPassword}
          activeOpacity={0.7}
        >
          {changingPassword ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="lock-closed-outline" size={18} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.primaryButtonText}>Change Password</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
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
  primaryButton: {
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
});
