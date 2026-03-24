import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  sendChatMessage,
  getConversationMessages,
  getAgentProfiles,
} from "../lib/chat-service";
import type { ChatMessage, AgentProfile, DeviceAction } from "../lib/chat-service";

// ---------------------------------------------------------------------------
// Agent Selector
// ---------------------------------------------------------------------------

function AgentSelector({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentProfile[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <View style={selectorStyles.container}>
      {agents.map((agent) => {
        const isSelected = agent.agent_name.toLowerCase() === selected.toLowerCase();
        return (
          <TouchableOpacity
            key={agent.id}
            style={[selectorStyles.pill, isSelected && selectorStyles.pillSelected]}
            onPress={() => onSelect(agent.agent_name)}
            activeOpacity={0.7}
          >
            <View style={[selectorStyles.dot, isSelected && selectorStyles.dotSelected]} />
            <Text style={[selectorStyles.pillText, isSelected && selectorStyles.pillTextSelected]}>
              {agent.agent_name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const selectorStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f1f5f9",
    gap: 6,
  },
  pillSelected: {
    backgroundColor: "#D4A843",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#94a3b8",
  },
  dotSelected: {
    backgroundColor: "#ffffff",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  pillTextSelected: {
    color: "#ffffff",
  },
});

// ---------------------------------------------------------------------------
// Device Action Card (inline in chat)
// ---------------------------------------------------------------------------

function DeviceActionCard({ actions }: { actions: DeviceAction[] }) {
  if (!actions || actions.length === 0) return null;

  return (
    <View style={actionStyles.container}>
      {actions.map((action, i) => (
        <View key={i} style={actionStyles.row}>
          <Ionicons name="flash" size={14} color="#16a34a" />
          <Text style={actionStyles.text}>
            {action.action} {action.device_name}: {action.previous_state} → {action.new_state}
          </Text>
        </View>
      ))}
    </View>
  );
}

const actionStyles = StyleSheet.create({
  container: {
    marginTop: 8,
    backgroundColor: "#f0fdf4",
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: 12,
    color: "#166534",
    flex: 1,
  },
});

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const deviceActions = message.metadata?.device_actions as DeviceAction[] | undefined;

  return (
    <View style={[bubbleStyles.wrapper, isUser ? bubbleStyles.wrapperUser : bubbleStyles.wrapperAssistant]}>
      <View style={[bubbleStyles.bubble, isUser ? bubbleStyles.bubbleUser : bubbleStyles.bubbleAssistant]}>
        <Text style={[bubbleStyles.text, isUser ? bubbleStyles.textUser : bubbleStyles.textAssistant]}>
          {message.content}
        </Text>
        {!isUser && deviceActions && <DeviceActionCard actions={deviceActions} />}
      </View>
      <Text style={bubbleStyles.time}>
        {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </Text>
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    marginVertical: 4,
  },
  wrapperUser: {
    alignItems: "flex-end",
  },
  wrapperAssistant: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: "#D4A843",
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: "#f1f5f9",
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  textUser: {
    color: "#ffffff",
  },
  textAssistant: {
    color: "#1a1a1a",
  },
  time: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
    paddingHorizontal: 4,
  },
});

// ---------------------------------------------------------------------------
// Chat Screen
// ---------------------------------------------------------------------------

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("clever");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  // Load agent profiles on mount
  useEffect(() => {
    getAgentProfiles()
      .then((profiles) => {
        setAgents(profiles);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load agents:", err);
        setAgents([{
          id: "clever",
          agent_name: "Clever",
          age_group: "adult",
          agent_voice_id: null,
          agent_personality: { tone: "friendly", custom_greeting: "Hi! I'm Clever." },
        }]);
        setLoading(false);
      });
  }, []);

  // Load conversation history when conversation changes
  useEffect(() => {
    if (conversationId) {
      getConversationMessages(conversationId)
        .then(setMessages)
        .catch((err) => console.error("Failed to load messages:", err));
    }
  }, [conversationId]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId ?? "",
      role: "user",
      content: text,
      metadata: {},
      source: "chat",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setInputText("");
    setSending(true);

    try {
      const response = await sendChatMessage(text, selectedAgent, "chat", conversationId);

      // Update conversation ID
      if (!conversationId) {
        setConversationId(response.conversation_id);
      }

      // Add assistant response
      const assistantMsg: ChatMessage = {
        id: response.message_id,
        conversation_id: response.conversation_id,
        role: "assistant",
        content: response.content,
        metadata: {
          triage_category: response.triage_category,
          device_actions: response.device_actions,
          latency_ms: response.latency_ms,
          constraint_messages: response.constraint_messages,
        },
        source: "chat",
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      // Add error message
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        conversation_id: conversationId ?? "",
        role: "assistant",
        content: `Sorry, I had trouble processing that. ${err instanceof Error ? err.message : "Please try again."}`,
        metadata: {},
        source: "chat",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  }, [inputText, selectedAgent, conversationId, sending]);

  const handleAgentSwitch = useCallback((agentName: string) => {
    setSelectedAgent(agentName.toLowerCase());
    setMessages([]);
    setConversationId(undefined);
  }, []);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      {/* Agent selector header */}
      <View style={styles.headerRow}>
        <AgentSelector agents={agents} selected={selectedAgent} onSelect={handleAgentSwitch} />
        <TouchableOpacity style={styles.newChatBtn} onPress={handleNewConversation}>
          <Ionicons name="add-circle-outline" size={24} color="#D4A843" />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={48} color="#cbd5e1" />
          </View>
          <Text style={styles.emptyTitle}>
            Chat with {selectedAgent === "clever" ? "Clever" : selectedAgent}
          </Text>
          <Text style={styles.emptySubtitle}>
            Ask questions, control devices, or check your home status.
          </Text>
          {/* Quick prompts */}
          <View style={styles.quickPrompts}>
            {["Turn on the living room lights", "Is the front door locked?", "What's the temperature?"].map((prompt) => (
              <TouchableOpacity
                key={prompt}
                style={styles.quickPrompt}
                onPress={() => setInputText(prompt)}
                activeOpacity={0.7}
              >
                <Text style={styles.quickPromptText}>{prompt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ paddingVertical: 12 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TextInput
          style={styles.textInput}
          placeholder={`Message ${selectedAgent === "clever" ? "Clever" : selectedAgent}...`}
          placeholderTextColor="#94a3b8"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline
          maxLength={1000}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
          activeOpacity={0.7}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="send" size={18} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  newChatBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#f1f5f9",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 24,
  },
  quickPrompts: {
    gap: 8,
    width: "100%",
  },
  quickPrompt: {
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  quickPromptText: {
    fontSize: 14,
    color: "#D4A843",
  },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    color: "#1a1a1a",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 2,
  },
  sendBtnDisabled: {
    backgroundColor: "#94a3b8",
  },
});
