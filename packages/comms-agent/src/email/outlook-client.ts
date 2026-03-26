/**
 * Outlook Client
 *
 * Microsoft Graph API client for Outlook email operations.
 */

export class OutlookClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Search emails using OData filter.
   * Example: "from/emailAddress/address eq 'boss@company.com'"
   */
  async search(filter: string, top = 10): Promise<string[]> {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=${top}&$select=id`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) return [];

    const data = await response.json() as { value?: Array<{ id: string }> };
    return (data.value ?? []).map((m) => m.id);
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
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=subject,from,body,receivedDateTime`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) return null;

    const data = await response.json() as {
      subject: string;
      from: { emailAddress: { name?: string; address: string } };
      body: { contentType: string; content: string };
      receivedDateTime: string;
    };

    // Strip HTML tags for plain text summary
    const plainBody = data.body.contentType === "html"
      ? data.body.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : data.body.content;

    return {
      subject: data.subject,
      from: data.from?.emailAddress?.name ?? data.from?.emailAddress?.address ?? "unknown",
      body: plainBody.slice(0, 5000), // Limit for LLM summarization
      date: data.receivedDateTime,
    };
  }
}
