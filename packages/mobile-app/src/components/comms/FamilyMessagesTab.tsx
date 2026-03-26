/**
 * Family Messages Tab
 *
 * Displays family announcements and private messages.
 * Used as a tab within the EmailCalendarScreen.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

interface FamilyMessage {
  id: string;
  sender_user_id: string;
  sender_name: string;
  channel_type: string;
  recipient_user_id: string | null;
  content: string;
  is_read: boolean;
  created_at: string;
}

export default function FamilyMessagesTab() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<FamilyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);

  const fetchMessages = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("family-messages", {
        method: "GET",
      });

      if (!error && data?.success) {
        setMessages(data.data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMessages();
  };

  const handleSendAnnouncement = async () => {
    if (!composeText.trim()) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("family-messages", {
        body: {
          content: composeText.trim(),
          channel_type: "family_announcement",
        },
      });

      if (!error && data?.success) {
        setShowCompose(false);
        setComposeText("");
        fetchMessages();
      } else {
        Alert.alert("Error", data?.error || "Failed to send announcement");
      }
    } catch {
      Alert.alert("Error", "Network error");
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const renderMessage = ({ item }: { item: FamilyMessage }) => (
    <View style={[styles.messageCard, !item.is_read && styles.unreadCard]}>
      <View style={styles.messageHeader}>
        <View style={styles.senderRow}>
          <Ionicons
            name={item.channel_type === "family_announcement" ? "megaphone-outline" : "chatbubble-outline"}
            size={16}
            color="#D4A843"
          />
          <Text style={styles.senderName}>{item.sender_name}</Text>
        </View>
        <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
      </View>

      {item.channel_type === "family_announcement" && (
        <View style={styles.announcementBadge}>
          <Text style={styles.announcementBadgeText}>Announcement</Text>
        </View>
      )}

      <Text style={styles.messageContent}>{item.content}</Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="chatbubbles-outline" size={48} color="#94a3b8" />
      <Text style={styles.emptyText}>No family messages yet</Text>
      <Text style={styles.emptySubtext}>Send an announcement to get started!</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#D4A843" />
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 80 },
        ]}
      />

      {/* Compose FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={() => setShowCompose(true)}
      >
        <Ionicons name="add" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Compose Modal */}
      <Modal visible={showCompose} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Family Announcement</Text>
              <TouchableOpacity onPress={() => setShowCompose(false)}>
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.composeInput}
              placeholder="Write your announcement..."
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={2000}
              value={composeText}
              onChangeText={setComposeText}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.sendButton, (!composeText.trim() || sending) && styles.sendButtonDisabled]}
              onPress={handleSendAnnouncement}
              disabled={!composeText.trim() || sending}
            >
              {sending ? (
                <Text style={styles.sendButtonText}>Sending...</Text>
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#fff" />
                  <Text style={styles.sendButtonText}>Send to Family</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FDF6E3" },
  listContent: { padding: 16 },
  messageCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  unreadCard: {
    borderLeftWidth: 3,
    borderLeftColor: "#D4A843",
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  senderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  senderName: { fontSize: 14, fontWeight: "600", color: "#1F1F1F" },
  timestamp: { fontSize: 12, color: "#94a3b8" },
  announcementBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  announcementBadgeText: { fontSize: 11, color: "#92400E", fontWeight: "500" },
  messageContent: { fontSize: 15, color: "#334155", lineHeight: 21 },
  emptyContainer: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#64748b" },
  emptySubtext: { fontSize: 13, color: "#94a3b8" },
  fab: {
    position: "absolute",
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#1F1F1F" },
  composeInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: "#1F1F1F",
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D4A843",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
