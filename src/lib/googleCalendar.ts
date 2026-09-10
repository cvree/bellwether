/* Talking to Google Calendar, from a browser, with no server in the middle.

   Everything else in this app that leaves the device does so under `lib/ai`'s
   rule — *the user brings their own credential and nothing is baked into the
   build*. A calendar cannot quite work that way, because OAuth needs a client
   id registered against the exact origin the page is served from. So the rule
   here is the nearest honest equivalent:

   · The build may carry a client id (`VITE_GOOGLE_CLIENT_ID`). A client id is
     *not* a secret — Google publishes it in every page that uses one, it is
     origin-locked, and it grants nothing on its own. There is no client secret
     anywhere in this repository, and there cannot be: the flow used here is
     the one designed for pages that have nowhere to keep one.
   · If the build carries none — anybody self-hosting this — the person can
     paste their own, with the same numbered instructions the AI providers get.
   · The **access token is never stored**. It lives in a module variable, dies
     with the tab, and is worth an hour. Writing it to disk would buy a
     slightly shorter reconnect in exchange for a readable key to somebody's
     calendar sitting in IndexedDB, which is a bad trade in an app whose whole
     claim is that it keeps less than you expect.

   And the direction of travel is worth stating plainly, because it is what
   makes this defensible at all: **this reads, it never writes, and no journal
   content is ever part of a request.** The scopes are read-only, the app
   cannot create or move an event even by accident, and what goes to Google is
   an access token they issued minutes ago and a date range. Nothing about the
   person's health goes anywhere. That is the same shape as the weather: a
   fetch that brings the outside world in.

   Parsing is separated from requesting throughout, so the test suite exercises
   every shape a response can take without a network — and so a caller that has
   decided not to make a request cannot accidentally make one. */

import { classifyEvent, dateOf, timeOf, spanMinutes, type Attendance, type CalEvent } from "./schedule";

/* ---------- what is asked for ----------

   Two narrow read-only scopes rather than the one broad one. `calendar.readonly`
   would also have worked and is a single line shorter; these two say exactly
   what the app does — list your calendars, read their events — and a consent
   screen that names less is a consent screen somebody can actually evaluate. */
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
].join(" ");

export const GIS_SRC = "https://accounts.google.com/gsi/client";
export const API_BASE = "https://www.googleapis.com/calendar/v3";

/** Where a client id comes from, in order. The env value is read defensively
    because this module is also loaded by the test runner and by the viewer
    build, neither of which define it. */
export function buildClientId(): string {
  try {
    const v = (import.meta as any)?.env?.VITE_GOOGLE_CLIENT_ID;
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Shape check only — this never contacts anyone. Google's web client ids end
    in `.apps.googleusercontent.com`; anything else is a paste of the wrong
    thing (a key, a secret, a project number) and saying so early is kinder
    than a blank consent screen. */
export function looksLikeClientId(raw: string): boolean {
  const v = String(raw ?? "").trim();
  return /^[0-9a-z-]+\.apps\.googleusercontent\.com$/i.test(v) && v.length <= 200;
}

/* ---------- the client id, held beside the journal rather than in it ----------

   Same store and same reasoning as the AI key in `lib/ai`: it belongs to this
   device and this deployment, not to the record, so it must not ride along in
   a JSON backup or a sync. */

const CLIENT_ID_KEY = "fhj_gcal_client_v1";
const mem: Record<string, string> = {};

const store = {
  async get(k: string): Promise<string | null> {
    const w = typeof window === "undefined" ? null : (window as any);
    if (w?.storage) {
      try {
        const r = await w.storage.get(k);
        return r ? r.value : null;
      } catch {
        return mem[k] ?? null;
      }
    }
    return mem[k] ?? null;
  },
  async set(k: string, v: string): Promise<void> {
    const w = typeof window === "undefined" ? null : (window as any);
    if (w?.storage) {
      try { await w.storage.set(k, v); return; } catch { /* fall through */ }
    }
    mem[k] = v;
  },
  async del(k: string): Promise<void> {
    const w = typeof window === "undefined" ? null : (window as any);
    if (w?.storage) { try { await w.storage.delete(k); } catch { /* fall through */ } }
    delete mem[k];
  },
};

export const saveClientId = (id: string): Promise<void> => store.set(CLIENT_ID_KEY, id.trim());
export const clearClientId = (): Promise<void> => store.del(CLIENT_ID_KEY);

/** The id this device will use: whatever was saved by hand, else the build's. */
export async function activeClientId(): Promise<string> {
  const saved = await store.get(CLIENT_ID_KEY);
  return (saved && saved.trim()) || buildClientId();
}

/* ---------- the token ---------- */

export interface GoogleToken {
  token: string;
  /** Epoch ms. Google issues one-hour tokens; this is checked, not assumed. */
  expiresAt: number;
  scope: string;
}

let live: GoogleToken | null = null;

/** True when a usable token is in hand. Sixty seconds of headroom, so a pull
    that starts in time cannot expire halfway through its own pagination. */
export const hasToken = (now = Date.now()): boolean => !!live && live.expiresAt - 60000 > now;

export const currentToken = (): GoogleToken | null => (hasToken() ? live : null);

/** Drop the token. Called by "disconnect", and by any 401 — a token Google has
    stopped honouring is worse than none, because it makes every retry fail
    silently in the same way. */
export function forgetToken(): void {
  live = null;
}

/** Only for tests, which have no Google to ask. */
export function __setToken(t: GoogleToken | null): void {
  live = t;
}

export class GoogleError extends Error {
  kind: "no-client-id" | "blocked" | "denied" | "expired" | "network" | "rate" | "response";
  constructor(kind: GoogleError["kind"], message: string) {
    super(message);
    this.kind = kind;
    this.name = "GoogleError";
  }
}

/* ---------- Google Identity Services ----------

   The script is loaded on demand, the first time somebody presses Connect —
   never at import time. An app that has not been asked to touch Google should
   not be fetching Google's code on the off-chance, and a health journal that
   pulls in a third-party script on every cold start is one more thing its
   privacy page would have to explain away. */

let gisPromise: Promise<any> | null = null;

export function loadGis(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new GoogleError("blocked", "There's no browser here to sign in with."));
  }
  const w = window as any;
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    const done = () => {
      if (w.google?.accounts?.oauth2) resolve(w.google);
      else reject(new GoogleError("blocked", "Google's sign-in script loaded but didn't start."));
    };
    if (existing) { existing.addEventListener("load", done); existing.addEventListener("error", () => reject(new GoogleError("blocked", "Google's sign-in script was blocked."))); return; }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = done;
    s.onerror = () => {
      gisPromise = null;
      reject(new GoogleError("blocked",
        "Couldn't load Google's sign-in script. An ad or tracker blocker will do this — the .ics file route below needs no account and works offline."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export interface ConnectOptions {
  /** Ask silently, for a reconnect after the first consent. A silent request
      that needs interaction fails rather than popping a window nobody asked
      for, and the caller falls back to the loud version. */
  silent?: boolean;
  clientId?: string;
}

/** Ask Google for an access token. Resolves with one, or throws something the
    screen can say out loud. */
export async function connect(opts: ConnectOptions = {}): Promise<GoogleToken> {
  const clientId = opts.clientId || (await activeClientId());
  if (!clientId) {
    throw new GoogleError("no-client-id",
      "This copy of the app has no Google client id set up. Add your own on this screen, or use the calendar-file route instead.");
  }
  const google = await loadGis();
  return new Promise<GoogleToken>((resolve, reject) => {
    let settled = false;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: opts.silent ? "" : "consent",
      callback: (resp: any) => {
        if (settled) return;
        settled = true;
        if (resp?.error || !resp?.access_token) {
          reject(new GoogleError(resp?.error === "access_denied" ? "denied" : "blocked",
            resp?.error === "access_denied"
              ? "Google didn't grant access. Nothing was connected."
              : "Google didn't return a token. Nothing was connected."));
          return;
        }
        live = {
          token: String(resp.access_token),
          expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
          scope: String(resp.scope || SCOPES),
        };
        resolve(live);
      },
      error_callback: (err: any) => {
        if (settled) return;
        settled = true;
        const t = String(err?.type || "");
        reject(new GoogleError(
          t === "popup_closed" ? "denied" : "blocked",
          t === "popup_closed"
            ? "The Google window was closed before it finished. Nothing was connected."
            : t === "popup_failed_to_open"
              ? "The browser blocked Google's window. Allow pop-ups for this site and try again."
              : "Google's sign-in didn't complete."
        ));
      },
    });
    client.requestAccessToken(opts.silent ? { prompt: "" } : {});
  });
}

/* ---------- requests ----------

   `fetchImpl` is a parameter for the same reason it is in lib/context: so the
   parsing is tested without a network, and so a caller that has decided not to
   make a request cannot accidentally make one. */

export type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>;
}>;

const realFetch = (): FetchLike | undefined =>
  typeof fetch === "function" ? ((url: string, init?: any) => fetch(url, init)) as FetchLike : undefined;

async function get(path: string, token: string, fetchImpl?: FetchLike): Promise<any> {
  const f = fetchImpl || realFetch();
  if (!f) throw new GoogleError("network", "No network available on this device.");
  let res;
  try {
    res = await f(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new GoogleError("network", "Couldn't reach Google Calendar.");
  }
  if (res.ok) return res.json();
  if (res.status === 401 || res.status === 403) {
    forgetToken();
    throw new GoogleError("expired", "Google needs you to sign in again.");
  }
  if (res.status === 429 || res.status >= 500) {
    throw new GoogleError("rate", "Google Calendar is busy. Try again in a minute.");
  }
  throw new GoogleError("response", "Google Calendar answered in a way this app didn't understand.");
}

/* ---------- calendars ---------- */

export interface CalendarRef {
  id: string;
  label: string;
  primary?: boolean;
  /** Google's own colour for it, carried so the screen can match what the
      person already recognises rather than inventing a palette. */
  color?: string;
  /** True when this person can only read it — a shared team calendar, a
      subscribed holidays feed. Shown, because "why is my calendar full of
      other people's meetings" has this as its answer. */
  readOnly?: boolean;
  selected?: boolean;
}

/** Pure. Given a calendarList payload, the calendars worth offering.

    Google's own generated feeds — week numbers, birthdays, national holidays —
    are excluded by default rather than hidden: a holidays feed would put an
    all-day entry on a hundred days a year and make every one of them look
    like a commitment. They can still be ticked on by hand. */
export function parseCalendarList(json: any): CalendarRef[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .filter((c: any) => c && typeof c.id === "string" && c.deleted !== true)
    .map((c: any) => ({
      id: String(c.id),
      label: String(c.summaryOverride || c.summary || c.id).slice(0, 80),
      primary: c.primary === true,
      color: typeof c.backgroundColor === "string" ? c.backgroundColor : undefined,
      readOnly: c.accessRole === "reader" || c.accessRole === "freeBusyReader",
      selected: c.primary === true,
    }))
    .sort((a: CalendarRef, b: CalendarRef) =>
      a.primary === b.primary ? a.label.localeCompare(b.label) : a.primary ? -1 : 1);
}

/** Feeds that describe the world rather than this person's commitments. */
export const isGeneratedFeed = (id: string): boolean =>
  /(holiday|#contacts|#weeknum|birthday)/i.test(id);

export async function listCalendars(fetchImpl?: FetchLike): Promise<CalendarRef[]> {
  const t = currentToken();
  if (!t) throw new GoogleError("expired", "Not connected to Google Calendar.");
  const json = await get("/users/me/calendarList?minAccessRole=reader&maxResults=250", t.token, fetchImpl);
  return parseCalendarList(json);
}

/* ---------- events ---------- */

export interface EventQuery {
  calendarId: string;
  /** Local YYYY-MM-DD, inclusive both ends. */
  start: string;
  end: string;
  titles?: boolean;
  pageToken?: string;
}

/** The request path for one page. `singleEvents` is the load-bearing parameter:
    with it, Google expands repeating events into their instances server-side
    and hands back what actually happened, which is the whole reason the API
    route is easier to be right about than the file route. */
export function eventsPath(q: EventQuery): string {
  const timeMin = new Date(`${q.start}T00:00:00`).toISOString();
  const timeMax = new Date(`${q.end}T23:59:59`).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    showDeleted: "false",
  });
  if (q.pageToken) params.set("pageToken", q.pageToken);
  return `/calendars/${encodeURIComponent(q.calendarId)}/events?${params}`;
}

/** One Google event date/time object → local date and time.

    Google gives either `{ date }` for an all-day entry or `{ dateTime }` with
    an offset for a timed one. The offset is honoured rather than stripped: a
    meeting booked while abroad is at the wall-clock time *here*, which is the
    time the person's day actually contained it. */
export function momentOf(v: any): { date: string; time?: string; allDay: boolean; at: Date } | null {
  if (!v || typeof v !== "object") return null;
  if (typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
    const [y, m, d] = v.date.split("-").map(Number);
    const at = new Date(y, m - 1, d);
    return { date: dateOf(at), allDay: true, at };
  }
  if (typeof v.dateTime === "string") {
    const at = new Date(v.dateTime);
    if (Number.isNaN(at.getTime())) return null;
    return { date: dateOf(at), time: timeOf(at), allDay: false, at };
  }
  return null;
}

/** How many people, and whether this person said yes.

    The attendee list is counted and then dropped. `self` is Google's own flag
    for "this is you", which is what makes attendance readable here and not in
    an .ics file — there is no email address to compare against, because none
    is ever read. */
export function attendanceOf(item: any): { people: number; going: Attendance } {
  const list = Array.isArray(item?.attendees) ? item.attendees : [];
  const me = list.find((a: any) => a?.self === true);
  const status = String(me?.responseStatus || "");
  const going: Attendance =
    status === "declined" ? "no"
      : status === "tentative" ? "maybe"
        : status === "accepted" ? "yes"
          : "unknown";
  /* An event with no attendee list is something the person put in their own
     calendar: one person, themselves. */
  const people = list.length ? list.filter((a: any) => a?.resource !== true).length : 0;
  return { people, going };
}

/** Pure. One events payload → rows, in this journal's own shape. */
export function parseEvents(
  json: any, opts: { calendarId: string; titles?: boolean }
): { events: CalEvent[]; nextPageToken?: string } {
  const items = Array.isArray(json?.items) ? json.items : [];
  const events: CalEvent[] = [];
  for (const item of items) {
    if (!item || item.status === "cancelled") continue;
    const start = momentOf(item.start);
    if (!start) continue;
    const end = momentOf(item.end);
    const title = typeof item.summary === "string" ? item.summary.trim().slice(0, 200) : "";
    const { people, going } = attendanceOf(item);
    const busy = String(item.transparency || "opaque") !== "transparent";

    let endDate = start.date;
    let endTime: string | undefined;
    let minutes = 0;
    if (start.allDay) {
      /* Google's all-day end is exclusive: a one-day entry ends the next
         morning. Stored verbatim it makes every holiday a day too long. */
      const lastMs = end ? end.at.getTime() - 86400000 : start.at.getTime();
      endDate = dateOf(new Date(Math.max(lastMs, start.at.getTime())));
    } else {
      const endAt = end ? end.at : start.at;
      endDate = dateOf(endAt);
      endTime = timeOf(endAt);
      minutes = spanMinutes(start.date, start.time, endDate, endTime) ?? 0;
    }

    events.push({
      id: `g_${String(item.id || "").slice(0, 160)}_${opts.calendarId.slice(0, 30)}`,
      date: start.date,
      time: start.time,
      endDate,
      endTime,
      minutes,
      ...(start.allDay ? { allDay: true as const } : {}),
      busy,
      going,
      people,
      ...(item.recurringEventId ? { repeating: true as const } : {}),
      kind: classifyEvent({
        title, minutes, people, allDay: start.allDay, time: start.time, date: start.date,
      }),
      kindSource: "rules",
      ...(opts.titles && title ? { title } : {}),
      calendarId: opts.calendarId,
      source: "google",
    });
  }
  const nextPageToken = typeof json?.nextPageToken === "string" ? json.nextPageToken : undefined;
  return { events, nextPageToken };
}

/** Every event in a window, across every chosen calendar, paginated.

    One calendar failing does not fail the pull: a shared calendar somebody
    lost access to should cost that calendar, not the rest of the week. The
    reasons come back alongside the rows so the screen can say what happened
    rather than quietly reporting a quiet week. */
export async function fetchEvents(
  calendars: string[],
  range: { start: string; end: string },
  opts: { titles?: boolean; fetchImpl?: FetchLike; maxPages?: number } = {}
): Promise<{ events: CalEvent[]; errors: { calendarId: string; message: string }[] }> {
  const t = currentToken();
  if (!t) throw new GoogleError("expired", "Not connected to Google Calendar.");
  const maxPages = opts.maxPages ?? 12;
  const events: CalEvent[] = [];
  const errors: { calendarId: string; message: string }[] = [];

  for (const calendarId of calendars.length ? calendars : ["primary"]) {
    let pageToken: string | undefined;
    let pages = 0;
    try {
      do {
        const json = await get(
          eventsPath({ calendarId, start: range.start, end: range.end, pageToken }),
          t.token, opts.fetchImpl
        );
        const parsed = parseEvents(json, { calendarId, titles: opts.titles });
        events.push(...parsed.events);
        pageToken = parsed.nextPageToken;
        pages += 1;
      } while (pageToken && pages < maxPages);
    } catch (e: any) {
      /* A token Google has stopped honouring is not one calendar's problem —
         every remaining request would fail the same way, so it is raised. */
      if (e instanceof GoogleError && e.kind === "expired") throw e;
      errors.push({ calendarId, message: e?.message || "That calendar couldn't be read." });
    }
  }
  return { events, errors };
}

/* ---------- setting one up ----------

   The numbered instructions, in the same shape as the AI providers'. Kept in
   code rather than in the component so the wording is testable and there is
   one place to fix when a console moves a button. */

export const CLIENT_ID_STEPS: [string, string][] = [
  ["Open the Google Cloud console", "at console.cloud.google.com and pick or create a project. Any project is fine."],
  ["Enable the Google Calendar API", "under APIs & Services → Library. Search for it and press Enable."],
  ["Create an OAuth client id", "under Credentials → Create credentials → OAuth client ID, and choose Web application."],
  ["Add this site's address", "to Authorised JavaScript origins — exactly the address in your browser's bar, with no path on the end."],
  ["Copy the client ID", "and paste it here. It ends in .apps.googleusercontent.com, and it isn't a secret — it's safe to paste."],
];

export const GOOGLE_NOTE =
  "Read-only, both ways round: the app asks Google only for the list of your calendars and the events on them, and cannot create, move or delete anything even by mistake. Nothing from your journal is part of the request — this brings the calendar in, the same way the weather comes in.";
