/**
 * Telegram Bot Messaging Gateway
 *
 * Sends caregiver alerts and receives commands via the Telegram Bot API.
 * Supports text messages, interactive inline keyboard buttons, and
 * webhook registration for inbound message handling.
 *
 * Caregiver commands:
 *   /status   — Current state of the aide user
 *   /checkin  — Trigger an immediate wellness check-in
 *   /medications — Today's medication schedule and status
 *   /ack <id> — Acknowledge an alert remotely
 *   Free text — Routes through the orchestrator
 */

import type {
  MessagingGateway,
  MessageDeliveryResult,
  MessageButton,
  InboundMessage,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  /** Bot token from @BotFather */
  botToken: string;
  /** Base URL for Telegram Bot API. Default: https://api.telegram.org */
  apiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Telegram Gateway
// ---------------------------------------------------------------------------

export class TelegramGateway implements MessagingGateway {
  readonly channel = "telegram";
  private readonly baseUrl: string;
  private readonly botToken: string;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.baseUrl = config.apiBaseUrl ?? "https://api.telegram.org";
  }

  async sendTextMessage(
    chatId: string,
    message: string,
  ): Promise<MessageDeliveryResult> {
    try {
      const response = await fetch(
        `${this.baseUrl}/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "Markdown",
          }),
        },
      );

      const data = await response.json() as { ok: boolean; result?: { message_id: number } };

      return {
        success: data.ok,
        channel: "telegram",
        message_id: data.result?.message_id?.toString() ?? null,
        delivered_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        channel: "telegram",
        message_id: null,
        error: err instanceof Error ? err.message : "Unknown error",
        delivered_at: new Date().toISOString(),
      };
    }
  }

  async sendTemplateMessage(
    chatId: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<MessageDeliveryResult> {
    // Telegram doesn't have template messages — format as rich text
    const formattedMessage = this.formatTemplate(templateName, params);
    return this.sendTextMessage(chatId, formattedMessage);
  }

  async sendInteractiveMessage(
    chatId: string,
    message: string,
    buttons: MessageButton[],
  ): Promise<MessageDeliveryResult> {
    try {
      const inlineKeyboard = buttons.map((btn) => [
        {
          text: btn.label,
          callback_data: btn.payload ?? btn.id,
        },
      ]);

      const response = await fetch(
        `${this.baseUrl}/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: inlineKeyboard,
            },
          }),
        },
      );

      const data = await response.json() as { ok: boolean; result?: { message_id: number } };

      return {
        success: data.ok,
        channel: "telegram",
        message_id: data.result?.message_id?.toString() ?? null,
        delivered_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        channel: "telegram",
        message_id: null,
        error: err instanceof Error ? err.message : "Unknown error",
        delivered_at: new Date().toISOString(),
      };
    }
  }

  async registerWebhook(callbackUrl: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/bot${this.botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: callbackUrl,
          allowed_updates: ["message", "callback_query"],
        }),
      },
    );

    const data = await response.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      throw new Error(`Failed to set Telegram webhook: ${data.description}`);
    }
  }

  /**
   * Parse an incoming Telegram webhook payload into an InboundMessage.
   */
  parseInboundMessage(payload: Record<string, unknown>): InboundMessage | null {
    // Regular message
    const message = payload["message"] as Record<string, unknown> | undefined;
    if (message) {
      const from = message["from"] as Record<string, unknown> | undefined;
      const text = message["text"] as string | undefined;
      if (!from || !text) return null;

      return {
        channel: "telegram",
        sender_id: String(from["id"]),
        sender_name: (from["first_name"] as string) ?? null,
        message_text: text,
        timestamp: new Date().toISOString(),
        raw_payload: payload,
      };
    }

    // Callback query (button press)
    const callbackQuery = payload["callback_query"] as Record<string, unknown> | undefined;
    if (callbackQuery) {
      const from = callbackQuery["from"] as Record<string, unknown> | undefined;
      const data = callbackQuery["data"] as string | undefined;
      if (!from || !data) return null;

      return {
        channel: "telegram",
        sender_id: String(from["id"]),
        sender_name: (from["first_name"] as string) ?? null,
        message_text: "",
        button_callback_id: data,
        button_callback_payload: data,
        timestamp: new Date().toISOString(),
        raw_payload: payload,
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private formatTemplate(
    templateName: string,
    params: Record<string, string>,
  ): string {
    switch (templateName) {
      case "medication_missed":
        return (
          `⚠️ *Medication Alert*\n\n` +
          `${params["medication_name"]} ${params["dosage"]} was not confirmed.\n` +
          `Scheduled: ${params["scheduled_time"]}\n\n` +
          `Reply /ack to acknowledge.`
        );

      case "wellness_concern":
        return (
          `❗ *Wellness Concern*\n\n` +
          `${params["message"]}\n` +
          `Check-in type: ${params["checkin_type"]}\n\n` +
          `Reply /status for full status.`
        );

      case "inactivity":
        return (
          `🔔 *Inactivity Alert*\n\n` +
          `No activity detected for ${params["elapsed_minutes"]} minutes.\n` +
          `Last activity: ${params["last_activity_time"]}\n\n` +
          `Reply /checkin to trigger a check-in.`
        );

      case "emergency":
        return (
          `🚨 *EMERGENCY*\n\n` +
          `${params["message"]}\n\n` +
          `Immediate attention required.`
        );

      default:
        return Object.entries(params)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
    }
  }
}
