/**
 * Email Summarizer
 *
 * Uses Groq LLM to summarize emails into concise one-liners.
 * Email content is never stored — only the summary is returned to the user.
 */

import type { EmailMessage } from "./email-provider.js";

export class EmailSummarizer {
  private readonly groqApiKey: string | undefined;

  constructor(groqApiKey?: string) {
    this.groqApiKey = groqApiKey;
  }

  /**
   * Summarize a list of emails into one-liner descriptions.
   * If Groq is unavailable, returns subject + sender as-is.
   */
  async summarizeEmails(emails: EmailMessage[]): Promise<string[]> {
    if (!this.groqApiKey || emails.length === 0) {
      return emails.map(
        (e) => `${e.is_read ? "" : "[NEW] "}From ${e.sender}: ${e.subject}`,
      );
    }

    const emailList = emails
      .map(
        (e, i) =>
          `${i + 1}. From: ${e.sender} | Subject: ${e.subject} | Preview: ${e.snippet.slice(0, 100)}${e.is_read ? "" : " [UNREAD]"}`,
      )
      .join("\n");

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content:
                "Summarize each email into a natural one-liner. " +
                "Format: one summary per line, numbered. " +
                "Flag unread emails with [NEW]. " +
                "Be concise — max 15 words per summary.",
            },
            { role: "user", content: emailList },
          ],
          max_tokens: 512,
          temperature: 0.2,
        }),
      });

      if (!response.ok) throw new Error("Groq API error");

      const result = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const summaryText = result.choices[0]?.message?.content ?? "";
      return summaryText.split("\n").filter((l) => l.trim().length > 0);
    } catch {
      // Fallback: return raw subject + sender
      return emails.map(
        (e) => `${e.is_read ? "" : "[NEW] "}From ${e.sender}: ${e.subject}`,
      );
    }
  }
}
