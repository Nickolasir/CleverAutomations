/**
 * Email Provider Interface
 *
 * Abstract interface for email operations. Implementations fetch
 * emails on-demand via OAuth — content is never stored in the DB.
 */

export interface EmailMessage {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  is_read: boolean;
  received_at: string;
}

export interface EmailProvider {
  /** Fetch recent emails (on-demand, not cached) */
  getRecentEmails(limit?: number): Promise<EmailMessage[]>;
  /** Send an email */
  sendEmail(to: string, subject: string, body: string): Promise<void>;
  /** Get unread count */
  getUnreadCount(): Promise<number>;
}

export function createEmailProvider(
  provider: string,
  accessToken: string,
): EmailProvider {
  switch (provider) {
    case "gmail":
      // Dynamic import to avoid bundling googleapis when not needed
      return new GmailProviderAdapter(accessToken);
    case "outlook":
      return new OutlookProviderAdapter(accessToken);
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Gmail adapter (lightweight, uses REST API directly)
// ---------------------------------------------------------------------------

class GmailProviderAdapter implements EmailProvider {
  constructor(private readonly accessToken: string) {}

  async getRecentEmails(limit = 20): Promise<EmailMessage[]> {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) throw new Error("Failed to fetch Gmail messages");

    const data = await response.json() as { messages?: Array<{ id: string }> };
    if (!data.messages?.length) return [];

    // Fetch message details in parallel (batch of first N)
    const details = await Promise.all(
      data.messages.slice(0, limit).map(async (msg) => {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } },
        );
        if (!res.ok) return null;
        return res.json() as Promise<Record<string, unknown>>;
      }),
    );

    return details
      .filter((d): d is Record<string, unknown> => d !== null)
      .map((d) => {
        const headers = (d.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? [];
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        const from = headers.find((h) => h.name === "From")?.value ?? "unknown";
        const labels = (d.labelIds as string[]) ?? [];

        return {
          id: d.id as string,
          subject,
          sender: from,
          snippet: (d.snippet as string) ?? "",
          is_read: !labels.includes("UNREAD"),
          received_at: new Date(parseInt(d.internalDate as string, 10)).toISOString(),
        };
      });
  }

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    const raw = btoa(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      },
    );

    if (!response.ok) throw new Error("Failed to send Gmail message");
  }

  async getUnreadCount(): Promise<number> {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=1",
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if (!response.ok) return 0;
    const data = await response.json() as { resultSizeEstimate?: number };
    return data.resultSizeEstimate ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Outlook adapter (Microsoft Graph API)
// ---------------------------------------------------------------------------

class OutlookProviderAdapter implements EmailProvider {
  constructor(private readonly accessToken: string) {}

  async getRecentEmails(limit = 20): Promise<EmailMessage[]> {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,bodyPreview,isRead,receivedDateTime`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) throw new Error("Failed to fetch Outlook messages");

    const data = await response.json() as {
      value?: Array<{
        id: string;
        subject: string;
        from: { emailAddress: { address: string; name?: string } };
        bodyPreview: string;
        isRead: boolean;
        receivedDateTime: string;
      }>;
    };

    return (data.value ?? []).map((msg) => ({
      id: msg.id,
      subject: msg.subject,
      sender: msg.from?.emailAddress?.name ?? msg.from?.emailAddress?.address ?? "unknown",
      snippet: msg.bodyPreview,
      is_read: msg.isRead,
      received_at: msg.receivedDateTime,
    }));
  }

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "Text", content: body },
            toRecipients: [{ emailAddress: { address: to } }],
          },
        }),
      },
    );

    if (!response.ok) throw new Error("Failed to send Outlook message");
  }

  async getUnreadCount(): Promise<number> {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount",
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if (!response.ok) return 0;
    const data = await response.json() as { unreadItemCount?: number };
    return data.unreadItemCount ?? 0;
  }
}
