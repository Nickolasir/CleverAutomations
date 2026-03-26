/**
 * Calendar Provider Interface
 *
 * Abstract interface for calendar operations via OAuth.
 */

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
}

export interface CalendarProvider {
  /** Get upcoming events */
  getUpcomingEvents(hours?: number): Promise<CalendarEvent[]>;
  /** Create a calendar event */
  createEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent>;
}

export function createCalendarProvider(
  provider: string,
  accessToken: string,
): CalendarProvider {
  switch (provider) {
    case "google_calendar":
      return new GoogleCalendarAdapter(accessToken);
    case "outlook_calendar":
      return new OutlookCalendarAdapter(accessToken);
    default:
      throw new Error(`Unknown calendar provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Google Calendar adapter
// ---------------------------------------------------------------------------

class GoogleCalendarAdapter implements CalendarProvider {
  constructor(private readonly accessToken: string) {}

  async getUpcomingEvents(hours = 24): Promise<CalendarEvent[]> {
    const now = new Date().toISOString();
    const until = new Date(Date.now() + hours * 3600000).toISOString();

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${until}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) return [];

    const data = await response.json() as {
      items?: Array<{
        id: string;
        summary: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
      }>;
    };

    return (data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary ?? "(no title)",
      description: e.description,
      location: e.location,
      start_time: e.start.dateTime ?? e.start.date ?? "",
      end_time: e.end.dateTime ?? e.end.date ?? "",
      is_all_day: !e.start.dateTime,
    }));
  }

  async createEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
    const body = {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.is_all_day
        ? { date: event.start_time.split("T")[0] }
        : { dateTime: event.start_time },
      end: event.is_all_day
        ? { date: event.end_time.split("T")[0] }
        : { dateTime: event.end_time },
    };

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) throw new Error("Failed to create Google Calendar event");

    const created = await response.json() as { id: string };
    return { id: created.id, ...event };
  }
}

// ---------------------------------------------------------------------------
// Outlook Calendar adapter (Microsoft Graph)
// ---------------------------------------------------------------------------

class OutlookCalendarAdapter implements CalendarProvider {
  constructor(private readonly accessToken: string) {}

  async getUpcomingEvents(hours = 24): Promise<CalendarEvent[]> {
    const now = new Date().toISOString();
    const until = new Date(Date.now() + hours * 3600000).toISOString();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${now}&endDateTime=${until}&$orderby=start/dateTime&$select=id,subject,bodyPreview,location,start,end,isAllDay`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) return [];

    const data = await response.json() as {
      value?: Array<{
        id: string;
        subject: string;
        bodyPreview?: string;
        location?: { displayName?: string };
        start: { dateTime: string };
        end: { dateTime: string };
        isAllDay: boolean;
      }>;
    };

    return (data.value ?? []).map((e) => ({
      id: e.id,
      summary: e.subject,
      description: e.bodyPreview,
      location: e.location?.displayName,
      start_time: e.start.dateTime,
      end_time: e.end.dateTime,
      is_all_day: e.isAllDay,
    }));
  }

  async createEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
    const body = {
      subject: event.summary,
      body: event.description ? { contentType: "Text", content: event.description } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: { dateTime: event.start_time, timeZone: "UTC" },
      end: { dateTime: event.end_time, timeZone: "UTC" },
      isAllDay: event.is_all_day,
    };

    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) throw new Error("Failed to create Outlook event");

    const created = await response.json() as { id: string };
    return { id: created.id, ...event };
  }
}
