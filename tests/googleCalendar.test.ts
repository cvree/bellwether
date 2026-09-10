/* The Google connection — parsing, without a network.

   Everything here runs against payloads shaped like Google's own, because the
   parsing is the half that can be wrong quietly: an exclusive all-day end, a
   declined invitation counted as a commitment, or an attendee's address making
   it into the journal are all bugs that produce a plausible-looking record. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SCOPES, looksLikeClientId, parseCalendarList, isGeneratedFeed, momentOf,
  attendanceOf, parseEvents, eventsPath, fetchEvents, listCalendars,
  hasToken, forgetToken, __setToken, GoogleError, CLIENT_ID_STEPS, GOOGLE_NOTE,
} from "../src/lib/googleCalendar";

const ok = (json: any) => ({ ok: true, status: 200, json: async () => json });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => forgetToken());

describe("what it asks for", () => {
  it("asks only to read, and names both things it reads", () => {
    expect(SCOPES).toContain("calendar.events.readonly");
    expect(SCOPES).toContain("calendar.calendarlist.readonly");
    // No write scope anywhere — the app cannot create or move an event.
    expect(SCOPES).not.toMatch(/auth\/calendar($|\s)/);
    expect(SCOPES).not.toContain("calendar.events ");
  });

  it("checks the shape of a client id before anyone waits on a consent screen", () => {
    expect(looksLikeClientId("123-abc.apps.googleusercontent.com")).toBe(true);
    expect(looksLikeClientId("  123-abc.apps.googleusercontent.com  ")).toBe(true);
    expect(looksLikeClientId("AIzaSyDsomethingsomething")).toBe(false);
    expect(looksLikeClientId("GOCSPX-a-client-secret")).toBe(false);
    expect(looksLikeClientId("")).toBe(false);
  });

  it("explains how to make one, and says plainly which direction data moves", () => {
    expect(CLIENT_ID_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(CLIENT_ID_STEPS.every(([a, b]) => a && b)).toBe(true);
    expect(GOOGLE_NOTE.toLowerCase()).toContain("read-only");
    expect(GOOGLE_NOTE.toLowerCase()).toContain("nothing from your journal");
  });
});

describe("the token", () => {
  it("is absent until one is granted, and expiry is checked rather than assumed", () => {
    expect(hasToken()).toBe(false);
    __setToken({ token: "t", expiresAt: Date.now() + 3600_000, scope: SCOPES });
    expect(hasToken()).toBe(true);
    __setToken({ token: "t", expiresAt: Date.now() + 30_000, scope: SCOPES });
    expect(hasToken()).toBe(false); // inside the headroom, so not usable
    forgetToken();
    expect(hasToken()).toBe(false);
  });

  it("refuses to fetch anything at all without one", async () => {
    await expect(fetchEvents(["primary"], { start: "2025-06-01", end: "2025-06-30" }))
      .rejects.toThrow(GoogleError);
    await expect(listCalendars()).rejects.toThrow(GoogleError);
  });
});

describe("calendars", () => {
  it("names them, marks the primary one first, and pre-selects only that", () => {
    const cals = parseCalendarList({
      items: [
        { id: "z@group.calendar.google.com", summary: "Team", accessRole: "reader" },
        { id: "me@gmail.com", summary: "Ana", primary: true, accessRole: "owner", backgroundColor: "#123456" },
        { id: "a@group.calendar.google.com", summaryOverride: "Side project", accessRole: "writer" },
        { id: "gone", summary: "Deleted", deleted: true },
      ],
    });
    expect(cals.map((c) => c.label)).toEqual(["Ana", "Side project", "Team"]);
    expect(cals[0]).toMatchObject({ primary: true, selected: true, color: "#123456" });
    expect(cals.find((c) => c.label === "Team")!.readOnly).toBe(true);
    expect(cals.find((c) => c.label === "Side project")!.selected).toBeFalsy();
  });

  it("survives a payload with nothing usable in it", () => {
    expect(parseCalendarList({})).toEqual([]);
    expect(parseCalendarList(null)).toEqual([]);
    expect(parseCalendarList({ items: [null, 3, { summary: "no id" }] })).toEqual([]);
  });

  it("recognises the feeds that describe the world rather than this person", () => {
    expect(isGeneratedFeed("en.uk#holiday@group.v.calendar.google.com")).toBe(true);
    expect(isGeneratedFeed("#contacts@group.v.calendar.google.com")).toBe(true);
    expect(isGeneratedFeed("me@gmail.com")).toBe(false);
  });
});

describe("moments and attendance", () => {
  it("reads an all-day date and a zoned instant", () => {
    expect(momentOf({ date: "2025-06-09" })).toMatchObject({ date: "2025-06-09", allDay: true });
    const m = momentOf({ dateTime: "2025-06-09T09:00:00Z" })!;
    expect(m.allDay).toBe(false);
    expect(m.at.toISOString()).toBe("2025-06-09T09:00:00.000Z");
  });
  it("returns nothing rather than a wrong date for a shape it does not know", () => {
    expect(momentOf({})).toBeNull();
    expect(momentOf({ dateTime: "soon" })).toBeNull();
    expect(momentOf(null)).toBeNull();
  });
  it("counts attendees, skips meeting rooms, and reads this person's own answer", () => {
    expect(attendanceOf({
      attendees: [
        { email: "a@x", self: true, responseStatus: "declined" },
        { email: "b@x", responseStatus: "accepted" },
        { email: "room@x", resource: true },
      ],
    })).toEqual({ people: 2, going: "no" });
    expect(attendanceOf({ attendees: [{ self: true, responseStatus: "tentative" }] }).going).toBe("maybe");
    expect(attendanceOf({})).toEqual({ people: 0, going: "unknown" });
  });
});

describe("events", () => {
  const payload = {
    items: [
      {
        id: "e1", summary: "Sprint planning", transparency: "opaque",
        start: { dateTime: "2025-06-10T09:00:00Z" }, end: { dateTime: "2025-06-10T10:30:00Z" },
        attendees: [{ email: "me@x", self: true, responseStatus: "accepted" }, { email: "you@x" }],
      },
      {
        id: "e2", summary: "Annual leave",
        start: { date: "2025-06-16" }, end: { date: "2025-06-21" },
      },
      {
        id: "e3", summary: "Optional social", transparency: "transparent",
        start: { dateTime: "2025-06-11T17:00:00Z" }, end: { dateTime: "2025-06-11T18:00:00Z" },
      },
      { id: "e4", summary: "Cancelled thing", status: "cancelled", start: { date: "2025-06-12" }, end: { date: "2025-06-13" } },
      { id: "e5", summary: "Standup", recurringEventId: "series1",
        start: { dateTime: "2025-06-12T08:00:00Z" }, end: { dateTime: "2025-06-12T08:15:00Z" } },
    ],
    nextPageToken: "page2",
  };

  it("turns a payload into rows, keeping the facts and dropping the words", () => {
    const { events, nextPageToken } = parseEvents(payload, { calendarId: "primary" });
    expect(nextPageToken).toBe("page2");
    expect(events).toHaveLength(4); // the cancelled one is gone
    const first = events[0];
    expect(first).toMatchObject({ minutes: 90, people: 2, going: "yes", busy: true, kind: "work", source: "google" });
    expect(first.title).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("@x");
  });

  it("keeps titles when they were asked for, and categorises either way", () => {
    const { events } = parseEvents(payload, { calendarId: "primary", titles: true });
    expect(events[0].title).toBe("Sprint planning");
    expect(events.find((e) => e.title === "Annual leave")!.kind).toBe("rest");
  });

  it("treats an all-day end as exclusive and stores no minutes for it", () => {
    const leave = parseEvents(payload, { calendarId: "primary" }).events.find((e) => e.allDay)!;
    expect(leave.date).toBe("2025-06-16");
    expect(leave.endDate).toBe("2025-06-20"); // five days off, not six
    expect(leave.minutes).toBe(0);
  });

  it("marks a transparent event as not busy and a series instance as repeating", () => {
    const { events } = parseEvents(payload, { calendarId: "primary", titles: true });
    expect(events.find((e) => e.title === "Optional social")!.busy).toBe(false);
    expect(events.find((e) => e.title === "Standup")!.repeating).toBe(true);
  });

  it("gives every calendar its own row ids, so the same meeting twice is two rows", () => {
    const a = parseEvents(payload, { calendarId: "primary" }).events;
    const b = parseEvents(payload, { calendarId: "work" }).events;
    expect(a[0].id).not.toBe(b[0].id);
    expect(new Set([...a, ...b].map((e) => e.id)).size).toBe(8);
  });

  it("survives a payload with nothing usable in it", () => {
    expect(parseEvents({}, { calendarId: "primary" }).events).toEqual([]);
    expect(parseEvents({ items: [null, {}, { id: "x" }] }, { calendarId: "primary" }).events).toEqual([]);
  });

  it("asks Google to expand repeating events itself, in order, bounded", () => {
    const path = eventsPath({ calendarId: "a b@x", start: "2025-06-01", end: "2025-06-30" });
    expect(path).toContain("singleEvents=true");
    expect(path).toContain("orderBy=startTime");
    expect(path).toContain("showDeleted=false");
    expect(path).toContain("a%20b%40x"); // the id is escaped into the path
    expect(path).not.toContain("pageToken");
    expect(eventsPath({ calendarId: "x", start: "2025-06-01", end: "2025-06-30", pageToken: "p2" }))
      .toContain("pageToken=p2");
  });
});

describe("pulling a window", () => {
  beforeEach(() => __setToken({ token: "t", expiresAt: Date.now() + 3600_000, scope: SCOPES }));
  const range = { start: "2025-06-01", end: "2025-06-30" };
  const one = (id: string) => ({
    items: [{ id, summary: "Thing", start: { dateTime: "2025-06-10T09:00:00Z" }, end: { dateTime: "2025-06-10T10:00:00Z" } }],
  });

  it("follows pagination to the end", async () => {
    const pages = [
      { ...one("a"), nextPageToken: "p2" },
      { ...one("b"), nextPageToken: "p3" },
      one("c"),
    ];
    let n = 0;
    const f = vi.fn(async () => ok(pages[n++]));
    const { events } = await fetchEvents(["primary"], range, { fetchImpl: f as any });
    expect(f).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(3);
  });

  it("stops rather than looping when a provider keeps handing back a token", async () => {
    const f = vi.fn(async () => ok({ ...one("a"), nextPageToken: "always" }));
    const { events } = await fetchEvents(["primary"], range, { fetchImpl: f as any, maxPages: 4 });
    expect(f).toHaveBeenCalledTimes(4);
    // The same row four times. Deduplication is not this function's job — it
    // happens by id in sanitizeEvents/mergeEvents, which every path goes
    // through — but stopping is, and it stopped.
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.id)).size).toBe(1);
  });

  it("reads every chosen calendar", async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => {
      seen.push(decodeURIComponent(url));
      return ok(one(`x${seen.length}`));
    });
    const { events } = await fetchEvents(["primary", "work@x"], range, { fetchImpl: f as any });
    expect(events).toHaveLength(2);
    expect(seen[1]).toContain("work@x");
  });

  it("lets one unreadable calendar cost only that calendar", async () => {
    const f = vi.fn(async (url: string) => (url.includes("gone") ? fail(404) : ok(one("a"))));
    const { events, errors } = await fetchEvents(["primary", "gone"], range, { fetchImpl: f as any });
    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].calendarId).toBe("gone");
  });

  it("raises a dead token rather than reporting a quiet week", async () => {
    const f = vi.fn(async () => fail(401));
    await expect(fetchEvents(["primary", "other"], range, { fetchImpl: f as any }))
      .rejects.toMatchObject({ kind: "expired" });
    expect(f).toHaveBeenCalledTimes(1); // it stopped rather than trying the second
    expect(hasToken()).toBe(false);     // …and dropped the token that stopped working
  });

  it("says something a person can act on for the failures they will actually see", async () => {
    __setToken({ token: "t", expiresAt: Date.now() + 3600_000, scope: SCOPES });
    const busy = vi.fn(async () => fail(429));
    const r = await fetchEvents(["primary"], range, { fetchImpl: busy as any });
    expect(r.errors[0].message).toMatch(/busy/i);

    __setToken({ token: "t", expiresAt: Date.now() + 3600_000, scope: SCOPES });
    const offline = vi.fn(async () => { throw new Error("network down"); });
    const r2 = await fetchEvents(["primary"], range, { fetchImpl: offline as any });
    expect(r2.errors[0].message).toMatch(/couldn't reach/i);
  });
});
