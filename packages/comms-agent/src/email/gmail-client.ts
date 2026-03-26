/**
 * Gmail Client
 *
 * Full Gmail API client using googleapis SDK for advanced operations.
 * For basic operations, the lightweight REST adapter in email-provider.ts
 * is preferred. This client is for batch operations and thread management.
 */

export class GmailClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Search emails by query (Gmail search syntax).
   * Example: "from:boss@company.com subject:urgent"
   */
  async search(query: string, maxResults = 10): Promise<string[]> {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) return [];

    const data = await response.json() as { messages?: Array<{ id: string }> };
    return (data.messages ?? []).map((m) => m.id);
  }

  /**
   * Get full message content by ID.
   * NOTE: Content is never stored — used for real-time summarization only.
   */
  async getMessage(messageId: string): Promise<{
    subject: string;
    from: string;
    body: string;
    date: string;
  } | null> {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;
    const headers = ((data.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }>) ?? [];

    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const date = headers.find((h) => h.name === "Date")?.value ?? "";

    // Extract plain text body
    const body = this.extractBody(data.payload as Record<string, unknown>);

    return { subject, from, body, date };
  }

  private extractBody(payload: Record<string, unknown>): string {
    const parts = (payload.parts as Array<Record<string, unknown>>) ?? [];
    const textPart = parts.find(
      (p) => (p.mimeType as string) === "text/plain",
    );

    if (textPart?.body) {
      const bodyData = (textPart.body as Record<string, unknown>).data as string;
      if (bodyData) {
        return atob(bodyData.replace(/-/g, "+").replace(/_/g, "/"));
      }
    }

    // Fallback: snippet
    const bodyData = (payload.body as Record<string, unknown>)?.data as string;
    if (bodyData) {
      return atob(bodyData.replace(/-/g, "+").replace(/_/g, "/"));
    }

    return "";
  }
}
