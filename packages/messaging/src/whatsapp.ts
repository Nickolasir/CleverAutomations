/**
 * WhatsApp Business Cloud API Messaging Gateway
 *
 * Sends caregiver alerts via the WhatsApp Business API (Meta Cloud API).
 * Uses pre-approved template messages for alerts and interactive buttons
 * for acknowledgment flows.
 *
 * Requirements:
 *   - WhatsApp Business Account + phone number
 *   - Approved message templates in Meta Business Manager
 *   - Permanent system user access token
 */

import type {
  MessagingGateway,
  MessageDeliveryResult,
  MessageButton,
  InboundMessage,
} from "@clever/shared";
import {
  sanitizeMessageText,
  sanitizeSenderId,
  sanitizeId,
  sanitizeRawPayload,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  /** WhatsApp Business phone number ID */
  phoneNumberId: string;
  /** Permanent system user access token */
  accessToken: string;
  /** WhatsApp Business Account ID */
  businessAccountId: string;
  /** Graph API version. Default: v21.0 */
  apiVersion?: string;
  /** Webhook verify token for incoming messages */
  webhookVerifyToken?: string;
}

// ---------------------------------------------------------------------------
// WhatsApp Gateway
// ---------------------------------------------------------------------------

export class WhatsAppGateway implements MessagingGateway {
  readonly channel = "whatsapp";
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly webhookVerifyToken: string;

  constructor(config: WhatsAppConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? "v21.0";
    this.webhookVerifyToken = config.webhookVerifyToken ?? "";
  }

  private get apiUrl(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  async sendTextMessage(
    phone: string,
    message: string,
  ): Promise<MessageDeliveryResult> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "text",
          text: { body: message },
        }),
      });

      const data = await response.json() as {
        messages?: Array<{ id: string }>;
        error?: { message: string };
      };

      if (data.error) {
        return {
          success: false,
          channel: "whatsapp",
          message_id: null,
          error: data.error.message,
          delivered_at: new Date().toISOString(),
        };
      }

      return {
        success: true,
        channel: "whatsapp",
        message_id: data.messages?.[0]?.id ?? null,
        delivered_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        channel: "whatsapp",
        message_id: null,
        error: err instanceof Error ? err.message : "Unknown error",
        delivered_at: new Date().toISOString(),
      };
    }
  }

  async sendTemplateMessage(
    phone: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<MessageDeliveryResult> {
    try {
      // Convert params to WhatsApp template component format
      const components = [];
      const paramValues = Object.values(params);

      if (paramValues.length > 0) {
        components.push({
          type: "body",
          parameters: paramValues.map((value) => ({
            type: "text",
            text: value,
          })),
        });
      }

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en_US" },
            components,
          },
        }),
      });

      const data = await response.json() as {
        messages?: Array<{ id: string }>;
        error?: { message: string };
      };

      if (data.error) {
        return {
          success: false,
          channel: "whatsapp",
          message_id: null,
          error: data.error.message,
          delivered_at: new Date().toISOString(),
        };
      }

      return {
        success: true,
        channel: "whatsapp",
        message_id: data.messages?.[0]?.id ?? null,
        delivered_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        channel: "whatsapp",
        message_id: null,
        error: err instanceof Error ? err.message : "Unknown error",
        delivered_at: new Date().toISOString(),
      };
    }
  }

  async sendInteractiveMessage(
    phone: string,
    message: string,
    buttons: MessageButton[],
  ): Promise<MessageDeliveryResult> {
    try {
      // WhatsApp supports max 3 quick reply buttons
      const whatsappButtons = buttons.slice(0, 3).map((btn) => ({
        type: "reply" as const,
        reply: {
          id: btn.id,
          title: btn.label.slice(0, 20), // WhatsApp limit: 20 chars
        },
      }));

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: message },
            action: {
              buttons: whatsappButtons,
            },
          },
        }),
      });

      const data = await response.json() as {
        messages?: Array<{ id: string }>;
        error?: { message: string };
      };

      if (data.error) {
        return {
          success: false,
          channel: "whatsapp",
          message_id: null,
          error: data.error.message,
          delivered_at: new Date().toISOString(),
        };
      }

      return {
        success: true,
        channel: "whatsapp",
        message_id: data.messages?.[0]?.id ?? null,
        delivered_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        channel: "whatsapp",
        message_id: null,
        error: err instanceof Error ? err.message : "Unknown error",
        delivered_at: new Date().toISOString(),
      };
    }
  }

  async registerWebhook(_callbackUrl: string): Promise<void> {
    // WhatsApp webhooks are configured in the Meta Developer Dashboard,
    // not via API. This method is a no-op for WhatsApp.
    // The callbackUrl must be configured manually in:
    // Meta Developer Dashboard → App → WhatsApp → Configuration → Webhook
  }

  /**
   * Verify a webhook challenge from Meta (GET request).
   * Returns the challenge token if verification succeeds, null otherwise.
   */
  verifyWebhook(
    mode: string,
    token: string,
    challenge: string,
  ): string | null {
    if (mode === "subscribe" && token === this.webhookVerifyToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Parse an incoming WhatsApp webhook payload into an InboundMessage.
   */
  parseInboundMessage(payload: Record<string, unknown>): InboundMessage | null {
    const entry = (payload["entry"] as Array<Record<string, unknown>>)?.[0];
    if (!entry) return null;

    const changes = (entry["changes"] as Array<Record<string, unknown>>)?.[0];
    if (!changes) return null;

    const value = changes["value"] as Record<string, unknown>;
    if (!value) return null;

    const messages = value["messages"] as Array<Record<string, unknown>>;
    if (!messages?.length) return null;

    const msg = messages[0];
    const from = sanitizeSenderId(msg["from"]);
    const type = msg["type"] as string;

    // Text message
    if (type === "text") {
      const textObj = msg["text"] as Record<string, unknown>;
      return {
        channel: "whatsapp",
        sender_id: from,
        sender_name: null,
        message_text: sanitizeMessageText(textObj?.["body"]),
        timestamp: new Date().toISOString(),
        raw_payload: sanitizeRawPayload(payload),
      };
    }

    // Interactive button response
    if (type === "interactive") {
      const interactive = msg["interactive"] as Record<string, unknown>;
      const buttonReply = interactive?.["button_reply"] as Record<string, unknown>;
      if (buttonReply) {
        return {
          channel: "whatsapp",
          sender_id: from,
          sender_name: null,
          message_text: "",
          button_callback_id: sanitizeId(buttonReply["id"]),
          button_callback_payload: sanitizeMessageText(buttonReply["title"]),
          timestamp: new Date().toISOString(),
          raw_payload: sanitizeRawPayload(payload),
        };
      }
    }

    return null;
  }
}
