/**
 * Messaging Gateway Types
 *
 * Defines the interface for external messaging integrations
 * (Telegram, WhatsApp, SMS, email) used by CleverAide for
 * caregiver alerts and remote interaction.
 */

// ---------------------------------------------------------------------------
// Delivery result
// ---------------------------------------------------------------------------

export interface MessageDeliveryResult {
  success: boolean;
  channel: string;
  message_id: string | null;
  error?: string;
  delivered_at: string;
}

// ---------------------------------------------------------------------------
// Messaging gateway interface
// ---------------------------------------------------------------------------

export interface MessagingGateway {
  readonly channel: string;

  /** Send a plain text message to a recipient. */
  sendTextMessage(
    recipient: string,
    message: string,
  ): Promise<MessageDeliveryResult>;

  /**
   * Send a template message (required by WhatsApp Business API).
   * Template name and parameters must be pre-approved.
   */
  sendTemplateMessage(
    recipient: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<MessageDeliveryResult>;

  /**
   * Send a message with interactive buttons (for alert acknowledgment).
   */
  sendInteractiveMessage(
    recipient: string,
    message: string,
    buttons: MessageButton[],
  ): Promise<MessageDeliveryResult>;

  /** Register a webhook URL for incoming messages. */
  registerWebhook(callbackUrl: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Interactive buttons
// ---------------------------------------------------------------------------

export interface MessageButton {
  id: string;
  label: string;
  /** Optional data payload sent back when button is tapped */
  payload?: string;
}

// ---------------------------------------------------------------------------
// Inbound message (received from Telegram/WhatsApp)
// ---------------------------------------------------------------------------

export interface InboundMessage {
  channel: "telegram" | "whatsapp";
  sender_id: string;
  sender_name: string | null;
  message_text: string;
  /** If this is a button callback, the button ID */
  button_callback_id?: string;
  /** If this is a button callback, the payload */
  button_callback_payload?: string;
  timestamp: string;
  raw_payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Caregiver messaging config (stored per aide_profile)
// ---------------------------------------------------------------------------

export interface CaregiverMessagingConfig {
  /** Telegram chat ID for the caregiver */
  telegram_chat_id?: string;
  /** WhatsApp phone number (E.164 format) for the caregiver */
  whatsapp_phone?: string;
  /** Email address for the caregiver */
  email?: string;
  /** Preferred channels in order of priority */
  preferred_channels: ("push" | "telegram" | "whatsapp" | "sms" | "email")[];
}

// ---------------------------------------------------------------------------
// Alert delivery tracking
// ---------------------------------------------------------------------------

export interface AlertDeliveryStatus {
  channel: string;
  sent_at: string;
  delivered: boolean;
  message_id: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Notification channel type
// ---------------------------------------------------------------------------

export type NotificationChannel = "push" | "telegram" | "whatsapp" | "sms" | "email";

// ---------------------------------------------------------------------------
// User messaging preferences (all verticals)
// ---------------------------------------------------------------------------

export interface UserMessagingPreferences {
  id: string;
  tenant_id: string;
  user_id: string;
  whatsapp_phone: string | null;
  whatsapp_verified: boolean;
  telegram_chat_id: string | null;
  telegram_verified: boolean;
  telegram_username: string | null;
  email_notifications: boolean;
  push_notifications: boolean;
  preferred_channels: NotificationChannel[];
  notify_device_offline: boolean;
  notify_security_alert: boolean;
  notify_guest_arrival: boolean;
  notify_maintenance_due: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Telegram bot linking
// ---------------------------------------------------------------------------

export interface TelegramLinkToken {
  link_token: string;
  bot_username: string;
  deep_link_url: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Channel verification status (for UI display)
// ---------------------------------------------------------------------------

export interface ChannelVerificationStatus {
  telegram: { linked: boolean; username?: string };
  whatsapp: { linked: boolean; phone?: string; verified: boolean };
}
