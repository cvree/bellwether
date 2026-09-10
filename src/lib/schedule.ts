/* The week around the week.

   `lib/context` brought in the day that happened *to* somebody — the heat, the
   pressure, the pollen. This module brings in the week they *agreed to*. Those
   are different kinds of fact and they fail differently, which is why this is
   its own file rather than another set of columns on a context record.

   A calendar is the only honest record most people keep of their own load. It
   knows the Tuesday with seven back-to-back calls, the fortnight with no clear
   evening, the week the travel doubled. None of that is worth a daily question
   — nobody is going to rate their own meeting density at bedtime — and all of
   it is exactly the sort of thing that turns an unexplained bad month into an
   explicable one.

   Five rules govern it, and they are the whole design.

   1. **Shape first, words second.** What this journal keeps by default is the
      *shape* of a week: when things started, how long they ran, how many
      people were in them, how much of the day was left over. Event titles are
      a separate, explicit switch, off until somebody turns it on. A work
      calendar is full of other people's names, interview subjects, therapy
      slots and legal matters, and a health record that swallows them whole —
      and then syncs them, and then offers them to a model — is a liability
      built out of a convenience.

   2. **Interpret at the boundary, then forget.** Because the category is the
      useful part and the words are the risky part, every event is classified
      *as it arrives*, while the title is still in hand, and the title is then
      dropped unless it was allowed to stay. So a journal running with titles
      off still knows Tuesday held four hours of meetings and an hour of
      exercise. It just cannot tell you who they were with.

   3. **A commitment is a thing you agreed to.** An invitation declined is not
      a commitment. An event marked "free" is a note in a grid, not a claim on
      the day. An all-day entry is not twenty-four booked hours — a public
      holiday must never read as the busiest day of the year. Each of those is
      handled explicitly below, because getting any of them wrong makes every
      number downstream quietly wrong in the same direction.

   4. **Weeks are compared with the person's own weeks.** There is no healthy
      number of meetings and this module never implies one. Every comparison is
      against last week, or against the median of this person's own weeks, and
      every sentence is a count of their own days.

   5. **Nothing here talks to a network.** Fetching lives in
      ./googleCalendar and ./ics; interpretation by a model lives in
      ./scheduleAi. This module is pure arithmetic over rows that already
      exist, which is what makes it the part that can be tested exhaustively.

   Nothing here reads a clock. Every function that needs "today" is handed it. */

/* ---------- consent ---------- */

export type ScheduleSource = "off" | "google" | "file";

export interface ScheduleConsent {
  /** Off until somebody switches it on. Switching it off stops every request
      on the next render; it does not delete what is already stored, because
      deleting somebody's history without asking is its own kind of rudeness.
      The screen offers "forget it all" as a separate, named button. */
  enabled: boolean;
  /** Where events come in from. "file" needs no account and no network. */
  source: ScheduleSource;
  /** Calendar ids the person chose to read. Empty means "the primary one",
      which is what a first connection defaults to. */
  calendars?: string[];
  /** Whether event titles are stored at all. Off by default — see rule 1. */
  titles?: boolean;
  /** Whether a model may be asked to categorise titles it has not seen before.
      Requires `titles`, because there is nothing to send without them. */
  aiKinds?: boolean;
  /** Whether a model may be asked to read the *shape* of recent weeks. Does
      not require `titles`: the payload is numbers either way. */
  aiWeeks?: boolean;
  /** Which day a week starts on. 1 = Monday (the default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
  askedAt?: string;
  /** Last successful pull, so the screen can say how fresh this is. */
  syncedAt?: string;
}

export const DEFAULT_SCHEDULE_CONSENT: ScheduleConsent = {
  enabled: false,
  source: "off",
  titles: false,
  aiKinds: false,
  aiWeeks: false,
  weekStartsOn: 1,
};

export function sanitizeScheduleConsent(v: unknown): ScheduleConsent {
  if (!v || typeof v !== "object") return { ...DEFAULT_SCHEDULE_CONSENT };
  const r = v as Record<string, unknown>;
  const source: ScheduleSource =
    r.source === "google" || r.source === "file" ? r.source : "off";
  const cals = Array.isArray(r.calendars)
    ? r.calendars.filter((c): c is string => typeof c === "string" && !!c).slice(0, 30).map((c) => c.slice(0, 200))
    : undefined;
  const titles = r.titles === true;
  return {
    enabled: r.enabled === true,
    source,
    calendars: cals && cals.length ? cals : undefined,
    titles,
    /* Categorising by model has nothing to send when titles are off, so the
       switch cannot be left standing on its own — otherwise Settings shows an
       enabled option that provably does nothing. */
    aiKinds: titles && r.aiKinds === true,
    aiWeeks: r.aiWeeks === true,
    weekStartsOn: r.weekStartsOn === 0 ? 0 : 1,
    askedAt: typeof r.askedAt === "string" ? r.askedAt.slice(0, 40) : undefined,
    syncedAt: typeof r.syncedAt === "string" ? r.syncedAt.slice(0, 40) : undefined,
  };
}

/* ---------- what an event is ----------

   Deliberately small. Everything a calendar carries that this journal has no
   use for — locations, descriptions, conference links, organiser addresses,
   the attendee list itself — is dropped at the parser and never reaches this
   shape, so there is no field for it to accumulate in later. */

export type EventKind =
  | "work"      // a meeting, a call, a shift
  | "focus"     // time blocked out to do something alone
  | "social"    // friends, dinners, parties
  | "family"    // the people you live with or are related to
  | "exercise"  // training, classes, sport
  | "health"    // appointments, treatments, therapy
  | "travel"    // flights, trains, being somewhere else
  | "admin"     // errands, chores, paperwork, deliveries
  | "rest"      // leave, days off, holidays
  | "other";

export const EVENT_KINDS: EventKind[] = [
  "work", "focus", "social", "family", "exercise", "health", "travel", "admin", "rest", "other",
];

export const KIND_LABEL: Record<EventKind, string> = {
  work: "Work",
  focus: "Focused time",
  social: "Social",
  family: "Family",
  exercise: "Exercise",
  health: "Health",
  travel: "Travel",
  admin: "Admin",
  rest: "Time off",
  other: "Other",
};

/** Whether a kind is a claim on the person or a release from one. Used for the
    one summary number this module is willing to draw — and phrased as
    "obligation", not "bad", because a wanted dinner is still a commitment. */
export const KIND_DEMAND: Record<EventKind, "obligation" | "restorative" | "neutral"> = {
  work: "obligation",
  focus: "obligation",
  social: "neutral",
  family: "neutral",
  exercise: "restorative",
  health: "obligation",
  travel: "obligation",
  admin: "obligation",
  rest: "restorative",
  other: "neutral",
};

export type KindSource = "rules" | "ai" | "user";

/** Whether the person is going. Anything a provider does not say is
    `unknown`, which counts as going — most calendar entries are things you put
    there yourself and never respond to. */
export type Attendance = "yes" | "no" | "maybe" | "unknown";

export interface CalEvent {
  /** Stable across pulls, so re-syncing updates rather than duplicates. For a
      recurring series this is the instance id, not the series id. */
  id: string;
  /** Local YYYY-MM-DD of the day it starts. */
  date: string;
  /** Local HH:MM. Absent on an all-day event. */
  time?: string;
  /** Local YYYY-MM-DD of the day it ends, inclusive. Equal to `date` for
      anything that does not cross midnight. */
  endDate: string;
  /** Local HH:MM. Absent on an all-day event. */
  endTime?: string;
  /** Total length in minutes. Zero for an all-day entry — see rule 3. */
  minutes: number;
  allDay?: boolean;
  /** False when the provider marked it "free"/transparent. */
  busy: boolean;
  going: Attendance;
  /** How many people were invited, this person included. 0 when the provider
      said nothing, 1 when it is only them. Never names, never addresses. */
  people: number;
  /** True when this is one instance of a repeating series. */
  repeating?: boolean;
  kind: EventKind;
  kindSource: KindSource;
  /** Only present when the titles switch is on. */
  title?: string;
  /** Which calendar it came from, for the "why am I seeing this" panel. */
  calendarId?: string;
  source: string; // "google" | "ics"
}

/* ---------- dates, kept local ----------

   Every date in this journal is a local wall-clock date. `toISOString().slice`
   is UTC and files a 9pm Sunday meeting under Monday for a third of the
   world, which is exactly the sort of error that is invisible until somebody's
   week looks wrong by one day. */

const pad = (n: number): string => String(n).padStart(2, "0");

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function dateOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeOf(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shiftDay(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return dateOf(new Date(y, m - 1, d + n));
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime();
  return Math.round(ms / 86400000);
}

/** Minutes since midnight, from "HH:MM". */
export const minsOf = (hhmm: string | undefined): number | undefined => {
  if (!hhmm || !TIME_RE.test(hhmm)) return undefined;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
};

/** "HH:MM" from minutes since midnight, clamped into the day. */
export const hhmm = (mins: number): string => {
  const m = Math.max(0, Math.min(1439, Math.round(mins)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** The Monday (or Sunday) on or before `date`. */
export function weekStart(date: string, startsOn: 0 | 1 = 1): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() - startsOn + 7) % 7;
  return shiftDay(date, -back);
}

export const weekEnd = (date: string, startsOn: 0 | 1 = 1): string =>
  shiftDay(weekStart(date, startsOn), 6);

/** The seven dates of the week `date` falls in. */
export function weekDates(date: string, startsOn: 0 | 1 = 1): string[] {
  const s = weekStart(date, startsOn);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => shiftDay(s, i));
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()] || "";
}

export function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 || w === 6;
}

/* ---------- the local classifier ----------

   Runs on every event as it arrives, before the title is dropped. It is a
   keyword table and it is wrong sometimes; the screen lets any event be
   recategorised by hand, and a correction sticks (`kindSource: "user"`) so the
   same fix is never needed twice.

   Two deliberate limits:

   · It reads the title only. Not the description, not the location, not the
     organiser — those are dropped at the parser and this module never sees
     them, which is the point.
   · It never invents a kind from structure alone beyond one narrow case: a
     timed weekday event with other people in it is a meeting. Everything else
     unrecognised stays "other", because a confident wrong category is worse
     than an honest blank in a record somebody may take to a doctor. */

const KIND_WORDS: [EventKind, string[]][] = [
  ["health", [
    "doctor", "dr ", "dentist", "dental", "gp ", "clinic", "hospital", "surgery",
    "appointment", "appt", "therapy", "therapist", "counselling", "counseling",
    "psychiatr", "physio", "physiotherapy", "chiropract", "osteopath", "bloods",
    "blood test", "scan", "mri", "ultrasound", "x-ray", "xray", "vaccin", "jab",
    "infusion", "treatment", "consultant", "specialist", "optician", "optometr",
    "check-up", "checkup", "smear", "screening", "dermatolog", "podiatr", "acupunctur",
  ]],
  ["exercise", [
    "gym", "workout", "training", "train ", "run ", "running", "5k", "10k",
    "parkrun", "yoga", "pilates", "swim", "swimming", "cycling", "spin class",
    "climbing", "bouldering", "football", "soccer", "tennis", "padel", "squash",
    "basketball", "netball", "cricket", "rugby", "hockey", "martial arts",
    "karate", "judo", "boxing", "crossfit", "hiit", "stretch", "walk ", "hike",
    "rowing", "badminton", "golf", "dance class", "zumba", "peloton",
  ]],
  ["travel", [
    "flight", "fly ", "flying", "airport", "train to", "train from", "eurostar",
    "ferry", "drive to", "driving to", "commute", "travel", "travelling",
    "traveling", "journey", "check-in", "check in", "hotel", "airbnb", "depart",
    "arrive", "landing", "boarding", "road trip", "transfer",
  ]],
  ["rest", [
    "annual leave", "holiday", "vacation", "pto", "day off", "off work",
    "time off", "bank holiday", "public holiday", "out of office", "ooo",
    "sabbatical", "rest day", "recovery day", "no meetings", "sick day",
  ]],
  ["family", [
    "mum", "mom", "dad", "mother", "father", "gran", "grandma", "grandad",
    "grandpa", "nan ", "family", "parents", "in-laws", "school run", "nursery",
    "school pickup", "pick up kids", "playdate", "play date", "parents evening",
    "sports day", "nativity", "anniversary", "wedding", "christening",
  ]],
  ["social", [
    "dinner", "lunch with", "drinks", "pub", "bar ", "party", "birthday",
    "brunch", "coffee with", "catch up with", "catchup with", "meet ",
    "cinema", "movie", "concert", "gig ", "festival", "theatre", "theater",
    "museum", "exhibition", "book club", "game night", "bbq", "barbecue",
    "housewarming", "date night", "night out",
  ]],
  ["admin", [
    "haircut", "hairdresser", "barber", "mot", "service car", "car service",
    "delivery", "deliver", "collect ", "pick up parcel", "bank", "accountant",
    "tax", "hmrc", "insurance", "renew", "council", "dmv", "post office",
    "shopping", "groceries", "food shop", "laundry", "cleaner", "plumber",
    "electrician", "landlord", "viewing", "paperwork", "admin", "bins",
  ]],
  /* "planning" deliberately does not appear here. It is the single most
     ambiguous word on a calendar — "sprint planning" is a room full of people
     and "planning time" is the opposite of one — and putting it in this list
     quietly relabelled every planning meeting as focused time. Where a phrase
     is genuinely ambiguous the more specific list wins by carrying the longer
     phrase, and anything still unresolved falls through to "other". */
  ["focus", [
    "focus", "deep work", "heads down", "no interruptions", "writing",
    "write ", "study", "revision", "revise", "reading", "prep ", "prepare",
    "planning time", "block", "blocked", "do not disturb", "dnd",
    "coding", "code ", "design time", "research", "thinking time",
  ]],
  ["work", [
    "standup", "stand-up", "stand up", "1:1", "1-1", "one to one", "o3",
    "meeting", "meet with", "call with", "sync", "catch-up", "retro",
    "retrospective", "sprint", "planning meeting", "kickoff", "kick-off",
    "review", "interview", "workshop", "offsite", "off-site", "all hands",
    "all-hands", "town hall", "demo", "presentation", "pitch", "client",
    "customer", "stakeholder", "board meeting", "team ", "weekly ", "daily ",
    "check-in with", "shift", "on call", "on-call", "zoom", "teams", "google meet",
    "webinar", "conference call", "briefing", "debrief", "handover", "training session",
  ]],
];

/** Normalised title for matching: lowercase, punctuation to spaces, collapsed,
    with a leading and trailing space so " run " style keys match at the edges. */
export function normaliseTitle(title: string): string {
  return ` ${String(title || "").toLowerCase().replace(/[^a-z0-9:+-]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

export interface ClassifyInput {
  title?: string;
  minutes?: number;
  people?: number;
  allDay?: boolean;
  /** Local HH:MM start, for the working-hours fallback. */
  time?: string;
  date?: string;
}

/** Best local guess at what an event is. Never throws, never returns undefined
    — an uncategorisable event is "other", which is a real answer. */
export function classifyEvent(input: ClassifyInput): EventKind {
  const t = normaliseTitle(input.title || "");
  if (t.trim()) {
    for (const [kind, words] of KIND_WORDS) {
      for (const w of words) {
        /* Keys that already carry their own boundary space are matched as
           written; the rest are matched as whole words, so "planning" cannot
           be found inside "unplanned" and "gym" cannot be found inside
           "gymnasium fundraiser" without meaning to. */
        if (w.startsWith(" ") || w.endsWith(" ")) {
          if (t.includes(w)) return kind;
        } else if (new RegExp(`(^|[^a-z0-9])${escapeRe(w)}($|[^a-z0-9])`).test(t)) {
          return kind;
        }
      }
    }
  }
  /* The one structural fallback. An all-day entry says nothing about how the
     day was spent, and a solo timed block could be anything. */
  if (!input.allDay && (input.people || 0) >= 2) {
    const start = minsOf(input.time);
    const weekday = input.date ? !isWeekend(input.date) : true;
    if (weekday && start !== undefined && start >= 7 * 60 && start < 19 * 60) return "work";
  }
  return "other";
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ---------- sanitising ----------

   Events arrive from three places that are all outside this app's control: a
   Google API response, an .ics file somebody exported, and a hand-editable
   JSON backup. So they are repaired on every load rather than trusted on any
   of them — the same rule the rest of the journal follows, and more load-
   bearing here than anywhere, because a malformed duration would put NaN into
   every weekly total in the record. */

const clampInt = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined;
};

const isKind = (v: unknown): v is EventKind => EVENT_KINDS.includes(v as EventKind);

export function sanitizeEvent(v: unknown, opts: { titles?: boolean } = {}): CalEvent | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, any>;
  if (typeof r.date !== "string" || !DATE_RE.test(r.date)) return null;
  const id = typeof r.id === "string" && r.id ? r.id.slice(0, 200) : null;
  if (!id) return null;

  const allDay = r.allDay === true;
  const time = !allDay && typeof r.time === "string" && TIME_RE.test(r.time) ? r.time : undefined;
  const endTime = !allDay && typeof r.endTime === "string" && TIME_RE.test(r.endTime) ? r.endTime : undefined;
  let endDate = typeof r.endDate === "string" && DATE_RE.test(r.endDate) ? r.endDate : r.date;
  /* An end before the start is a file that has been edited, or a provider
     bug. Either way the record is repaired rather than dropped: the event
     happened, and a day with the wrong end is more useful than no day. */
  if (endDate < r.date) endDate = r.date;

  /* The duration is recomputed from the endpoints rather than trusted, and the
     stored `minutes` is only used when the endpoints cannot produce one. An
     all-day entry is zero minutes by rule 3. */
  let minutes = 0;
  if (!allDay) {
    const span = spanMinutes(r.date, time, endDate, endTime);
    minutes = span ?? clampInt(r.minutes, 0, 60 * 24 * 30) ?? 0;
  }

  const title = opts.titles === true && typeof r.title === "string" ? r.title.trim().slice(0, 200) : undefined;

  return {
    id,
    date: r.date,
    time,
    endDate,
    endTime,
    minutes,
    ...(allDay ? { allDay: true as const } : {}),
    busy: r.busy !== false,
    going: r.going === "no" || r.going === "maybe" || r.going === "yes" ? r.going : "unknown",
    people: clampInt(r.people, 0, 10000) ?? 0,
    ...(r.repeating === true ? { repeating: true as const } : {}),
    kind: isKind(r.kind) ? r.kind : "other",
    kindSource: r.kindSource === "ai" || r.kindSource === "user" ? r.kindSource : "rules",
    ...(title ? { title } : {}),
    calendarId: typeof r.calendarId === "string" ? r.calendarId.slice(0, 200) : undefined,
    source: typeof r.source === "string" ? r.source.slice(0, 20) : "ics",
  };
}

/** Minutes between two local date/time pairs, or undefined when either side
    has no clock. Capped at 30 days so a single malformed row cannot dominate
    a year of totals. */
export function spanMinutes(
  startDate: string, startTime: string | undefined,
  endDate: string, endTime: string | undefined
): number | undefined {
  const s = minsOf(startTime);
  const e = minsOf(endTime);
  if (s === undefined || e === undefined) return undefined;
  const mins = daysBetween(startDate, endDate) * 1440 + e - s;
  if (!Number.isFinite(mins)) return undefined;
  return Math.max(0, Math.min(60 * 24 * 30, Math.round(mins)));
}

export function sanitizeEvents(rows: unknown, opts: { titles?: boolean } = {}): CalEvent[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, CalEvent>();
  for (const r of rows) {
    const e = sanitizeEvent(r, opts);
    if (e) byId.set(e.id, e);
  }
  return [...byId.values()].sort(
    (a, b) => (a.date === b.date ? (a.time || "").localeCompare(b.time || "") : a.date < b.date ? -1 : 1)
  );
}

/** Fold a fresh pull into what is stored.

    Three things this has to get right, and each of them is a way somebody
    loses data if it is wrong:

    · **A hand correction outlives a re-sync.** Somebody who recategorised
      their Tuesday "sync" as focused time did that once and meant it. A pull
      that overwrote it would make the correction feel broken, so `user` kinds
      are carried across.
    · **A day outside the pulled window is kept.** This is a journal; last
      March is the point. Only the window that was actually asked for is
      replaced, which is what `window` names.
    · **An event deleted from the calendar disappears from the journal.** Inside
      the pulled window, absence is real information — a meeting that was
      cancelled did not happen, and leaving it behind would inflate every total
      that week forever. */
export function mergeEvents(
  existing: CalEvent[],
  incoming: CalEvent[],
  window?: { start: string; end: string; calendars?: string[] }
): CalEvent[] {
  const prev = new Map(existing.map((e) => [e.id, e] as const));
  const kept = existing.filter((e) => {
    if (!window) return true;
    if (e.date < window.start || e.date > window.end) return true;
    /* A calendar that was not part of this pull cannot be contradicted by it. */
    if (window.calendars && window.calendars.length && e.calendarId
      && !window.calendars.includes(e.calendarId)) return true;
    return false;
  });
  const out = new Map(kept.map((e) => [e.id, e] as const));
  for (const e of incoming) {
    const was = prev.get(e.id);
    out.set(e.id, was?.kindSource === "user" ? { ...e, kind: was.kind, kindSource: "user" } : e);
  }
  return [...out.values()].sort(
    (a, b) => (a.date === b.date ? (a.time || "").localeCompare(b.time || "") : a.date < b.date ? -1 : 1)
  );
}

/** Strip every title from a stored set — what the titles switch does when it
    is turned off. Irreversible on purpose: a switch that only hid the words
    would be a promise the storage does not keep. */
export const forgetTitles = (rows: CalEvent[]): CalEvent[] =>
  rows.map(({ title, ...rest }) => rest);

/* ---------- one day, reduced ----------

   The trend chart, the relationship explorer and the AI payload all want one
   number per day. These are the definitions that produce them, and the two
   judgement calls behind them are worth stating out loud.

   **An event that crosses midnight is split at midnight.** A 22:00–06:00
   flight is two hours on Friday and six on Saturday, not eight hours on
   Friday. Every day-level number is built from segments for this reason —
   otherwise a single overnight would make one day look impossible and the
   next look empty.

   **An all-day entry contributes no minutes and is counted separately.** A
   week off is not 10,080 booked minutes. It is seven days with an all-day
   marker of kind "rest" on them, and the screen says so in words. */

export interface DaySegment {
  date: string;
  /** Minutes since midnight. */
  from: number;
  to: number;
  minutes: number;
  event: CalEvent;
}

/** Whether an event is something the person actually agreed to. */
export const isCommitment = (e: CalEvent): boolean => e.busy !== false && e.going !== "no";

/** Split one event into the days it touches. All-day entries produce one
    zero-length segment per day, so they can be counted without being timed. */
export function daySegments(e: CalEvent): DaySegment[] {
  const out: DaySegment[] = [];
  if (e.allDay) {
    const n = Math.max(0, Math.min(370, daysBetween(e.date, e.endDate)));
    for (let i = 0; i <= n; i += 1) {
      const date = shiftDay(e.date, i);
      out.push({ date, from: 0, to: 0, minutes: 0, event: e });
    }
    return out;
  }
  const start = minsOf(e.time);
  if (start === undefined) return out;
  const endMins = minsOf(e.endTime);
  const total = e.minutes > 0
    ? e.minutes
    : endMins === undefined ? 0 : Math.max(0, daysBetween(e.date, e.endDate) * 1440 + endMins - start);
  if (total <= 0) {
    /* A zero-length event is a marker, not a block. It still happened, so it
       still counts as an event and still carries a time. */
    out.push({ date: e.date, from: start, to: start, minutes: 0, event: e });
    return out;
  }
  let cursor = start;
  let left = total;
  let date = e.date;
  let guard = 0;
  while (left > 0 && guard < 400) {
    const room = 1440 - cursor;
    const take = Math.min(room, left);
    out.push({ date, from: cursor, to: cursor + take, minutes: take, event: e });
    left -= take;
    if (left <= 0) break;
    date = shiftDay(date, 1);
    cursor = 0;
    guard += 1;
  }
  return out;
}

/* An events array, indexed by the dates its rows touch.

   Without this, every question about a day walks the whole calendar, and the
   observations ask about a day roughly fifteen times — seven factors, each over
   every logged day, plus the weeks. On a year of a working calendar (about
   1,800 rows) that measured 190ms inside a render memo, which is a visible
   stutter on a phone for arithmetic that has not changed.

   Keyed on the array's identity in a WeakMap, which is exactly right for how
   this data moves: React hands the same array back until a write replaces it,
   and a replaced array simply builds a new index. Nothing in this app mutates
   a stored collection in place — every writer spreads — so an index cannot go
   stale while its key is still reachable. */
const dayIndexCache = new WeakMap<CalEvent[], Map<string, CalEvent[]>>();

function dayIndex(events: CalEvent[]): Map<string, CalEvent[]> {
  const hit = dayIndexCache.get(events);
  if (hit) return hit;
  const index = new Map<string, CalEvent[]>();
  for (const e of events) {
    const n = Math.max(0, Math.min(370, daysBetween(e.date, e.endDate)));
    for (let i = 0; i <= n; i += 1) {
      const date = i === 0 ? e.date : shiftDay(e.date, i);
      const rows = index.get(date);
      if (rows) rows.push(e);
      else index.set(date, [e]);
    }
  }
  dayIndexCache.set(events, index);
  return index;
}

/** Every segment on one date, committed ones only unless asked otherwise. */
export function segmentsOn(events: CalEvent[], date: string, all = false): DaySegment[] {
  const out: DaySegment[] = [];
  for (const e of dayIndex(events).get(date) || []) {
    if (!all && !isCommitment(e)) continue;
    for (const s of daySegments(e)) if (s.date === date) out.push(s);
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Everything one day looked like. Every field is a fact about the segments,
    not a judgement about them. */
export interface DayLoad {
  date: string;
  /** Committed events touching this day. All-day entries included. */
  events: number;
  /** Of those, how many were all-day. */
  allDay: number;
  /** Booked minutes, after the midnight split. */
  minutes: number;
  /** Local HH:MM of the first and last committed timed thing. */
  firstStart?: string;
  lastEnd?: string;
  /** First start to last end, in minutes. The length of the "on" part of a
      day, which is often the number that matters more than the total. */
  span: number;
  /** The biggest uninterrupted free stretch inside that span. Zero when the
      day was solid; undefined has no meaning here so it is a number. */
  longestGap: number;
  /** The longest run of committed events with ten minutes or less between
      them. One means nothing was back to back. */
  backToBack: number;
  /** Booked minutes after 18:00. */
  evening: number;
  /** Booked minutes before 09:00. */
  early: number;
  /** Booked minutes in events with two or more people in them. */
  withOthers: number;
  /** The most people in any one committed event. */
  peakPeople: number;
  /** Booked minutes per kind. All-day entries contribute zero minutes here
      and are visible through `kindsAllDay` instead. */
  byKind: Record<EventKind, number>;
  /** Kinds present as an all-day entry, e.g. a week of "rest". */
  kindsAllDay: EventKind[];
  /** True when nothing at all was committed. Distinct from a day with no
      calendar data, which produces no DayLoad at all — see `hasCoverage`. */
  clear: boolean;
}

const emptyKinds = (): Record<EventKind, number> =>
  EVENT_KINDS.reduce((a, k) => { a[k] = 0; return a; }, {} as Record<EventKind, number>);

const EVENING_FROM = 18 * 60;
const EARLY_UNTIL = 9 * 60;
/** Two events this close together are one run. Ten minutes is not enough to
    stand up, make a drink and come back, which is the thing being measured. */
export const BACK_TO_BACK_GAP = 10;

/* The same reasoning as the day index above, one level up.

   Indexing the events only took the year-long case from 190ms to 151ms,
   because the cost was never the scan — it was recomputing the *same* day
   from scratch. The observations ask about each day once per factor, and each
   answer sorts the day's segments and merges its intervals again to produce a
   number it produced a moment ago. Cached on the array's identity, a year of
   observations does the work once per day instead of fifteen times. */
const dayLoadCache = new WeakMap<CalEvent[], Map<string, DayLoad>>();

export function dayLoad(events: CalEvent[], date: string): DayLoad {
  let cache = dayLoadCache.get(events);
  if (!cache) { cache = new Map(); dayLoadCache.set(events, cache); }
  const hit = cache.get(date);
  if (hit) return hit;
  const computed = computeDayLoad(events, date);
  cache.set(date, computed);
  return computed;
}

function computeDayLoad(events: CalEvent[], date: string): DayLoad {
  const segs = segmentsOn(events, date);
  const timed = segs.filter((s) => !s.event.allDay);
  const allDay = segs.filter((s) => s.event.allDay);
  const byKind = emptyKinds();
  let minutes = 0, evening = 0, early = 0, withOthers = 0, peakPeople = 0;

  for (const s of timed) {
    minutes += s.minutes;
    byKind[s.event.kind] += s.minutes;
    evening += overlap(s.from, s.to, EVENING_FROM, 1440);
    early += overlap(s.from, s.to, 0, EARLY_UNTIL);
    if (s.event.people >= 2) withOthers += s.minutes;
    if (s.event.people > peakPeople) peakPeople = s.event.people;
  }

  /* Gaps and runs are computed over *merged* intervals: two overlapping
     meetings are one busy block, and counting the overlap twice would report
     more booked time than the day contains. `minutes` above deliberately does
     double-count overlap, because "six hours of meetings in a four-hour
     window" is a true and useful sentence about a double-booked day — but a
     free stretch has to be genuinely free. */
  const merged = mergeIntervals(timed.map((s) => [s.from, s.to] as [number, number]));
  const firstStart = merged.length ? hhmm(merged[0][0]) : undefined;
  const lastEnd = merged.length ? hhmm(merged[merged.length - 1][1]) : undefined;
  const span = merged.length ? merged[merged.length - 1][1] - merged[0][0] : 0;
  let longestGap = 0;
  for (let i = 1; i < merged.length; i += 1) {
    const gap = merged[i][0] - merged[i - 1][1];
    if (gap > longestGap) longestGap = gap;
  }
  /* Runs are counted over the *events*, not the merged blocks. Two meetings
     that touch merge into one interval, and counting runs over that would
     report the most back-to-back day of somebody's life as a single event —
     which is the exact opposite of what it is. An overlap counts as no break
     for the same reason: a double booking is not a rest. */
  let backToBack = timed.length ? 1 : 0;
  let run = timed.length ? 1 : 0;
  let prevEnd = timed.length ? timed[0].to : 0;
  for (let i = 1; i < timed.length; i += 1) {
    run = timed[i].from - prevEnd <= BACK_TO_BACK_GAP ? run + 1 : 1;
    if (run > backToBack) backToBack = run;
    if (timed[i].to > prevEnd) prevEnd = timed[i].to;
  }

  return {
    date,
    events: segs.length,
    allDay: allDay.length,
    minutes,
    firstStart,
    lastEnd,
    span,
    longestGap,
    backToBack,
    evening,
    early,
    withOthers,
    peakPeople,
    byKind,
    kindsAllDay: [...new Set(allDay.map((s) => s.event.kind))],
    clear: segs.length === 0,
  };
}

const overlap = (a1: number, a2: number, b1: number, b2: number): number =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/** Merge overlapping and touching intervals, left to right. */
export function mergeIntervals(rows: [number, number][]): [number, number][] {
  const sorted = rows.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/* ---------- coverage ----------

   The difference between "nothing was booked" and "this journal has no
   calendar for that week" is the single most important distinction in the
   whole feature, and it cannot be inferred from the events — an empty week
   looks identical either way. So coverage is recorded when a pull happens and
   read back here, and every weekly average is computed over covered days only.
   Without it, connecting a calendar today would silently report that the
   person had a completely free year until yesterday. */

export interface Coverage {
  /** Inclusive local dates this journal has actually looked at. */
  start: string;
  end: string;
}

export function sanitizeCoverage(v: unknown): Coverage | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.start !== "string" || !DATE_RE.test(r.start)) return undefined;
  if (typeof r.end !== "string" || !DATE_RE.test(r.end)) return undefined;
  return r.end < r.start ? { start: r.end, end: r.start } : { start: r.start, end: r.end };
}

/** Widen the covered range to include a freshly pulled window. Deliberately a
    single range rather than a set of them: a gap in the middle is possible in
    principle and has never happened in practice, and a range somebody can read
    in a backup file is worth more than a set they cannot. */
export function widenCoverage(prev: Coverage | undefined, add: Coverage): Coverage {
  if (!prev) return add;
  return {
    start: add.start < prev.start ? add.start : prev.start,
    end: add.end > prev.end ? add.end : prev.end,
  };
}

export const hasCoverage = (c: Coverage | undefined, date: string): boolean =>
  !!c && date >= c.start && date <= c.end;

/* ---------- one week, reduced ----------

   The unit the person actually lives in. A day is too small to have a shape —
   everybody has a heavy Tuesday — and a month is too coarse to feel. */

export interface WeekShape {
  /** Local date of the first day (Monday, unless the person said Sunday). */
  start: string;
  end: string;
  /** The seven days, in order. Days outside coverage are absent. */
  days: DayLoad[];
  /** How many of the seven this journal actually has a calendar for. Every
      average below is over this, not over seven. */
  covered: number;
  events: number;
  minutes: number;
  /** Days with at least one commitment. */
  busyDays: number;
  /** Covered days with nothing at all. */
  clearDays: number;
  /** Minutes on Saturday and Sunday. */
  weekend: number;
  evening: number;
  early: number;
  withOthers: number;
  byKind: Record<EventKind, number>;
  /** The heaviest and lightest covered days. */
  busiest?: DayLoad;
  quietest?: DayLoad;
  /** The longest back-to-back run anywhere in the week. */
  longestRun: number;
  /** Booked minutes on the average covered day. */
  perDay: number;
  /** How lopsided the week was: the share of its booked minutes that fell on
      its three heaviest days. 0.43 is perfectly even across seven; 1.0 is a
      week that happened in three days. Null when nothing was booked. */
  concentration: number | null;
}

/** Reduce a set of events to one week. `coverage` decides which days count —
    see the note on Coverage above; getting this wrong is how a feature like
    this ends up lying about somebody's history. */
export function weekShape(
  events: CalEvent[], anyDateInWeek: string,
  opts: { startsOn?: 0 | 1; coverage?: Coverage } = {}
): WeekShape {
  const startsOn = opts.startsOn ?? 1;
  const dates = weekDates(anyDateInWeek, startsOn);
  const days = dates
    .filter((d) => !opts.coverage || hasCoverage(opts.coverage, d))
    .map((d) => dayLoad(events, d));

  const byKind = emptyKinds();
  let events_ = 0, minutes = 0, weekend = 0, evening = 0, early = 0, withOthers = 0, longestRun = 0;
  for (const d of days) {
    events_ += d.events;
    minutes += d.minutes;
    if (isWeekend(d.date)) weekend += d.minutes;
    evening += d.evening;
    early += d.early;
    withOthers += d.withOthers;
    if (d.backToBack > longestRun) longestRun = d.backToBack;
    for (const k of EVENT_KINDS) byKind[k] += d.byKind[k];
  }

  const ranked = [...days].sort((a, b) => b.minutes - a.minutes || (a.date < b.date ? -1 : 1));
  const topThree = ranked.slice(0, 3).reduce((a, d) => a + d.minutes, 0);

  return {
    start: dates[0],
    end: dates[6],
    days,
    covered: days.length,
    events: events_,
    minutes,
    busyDays: days.filter((d) => !d.clear).length,
    clearDays: days.filter((d) => d.clear).length,
    weekend,
    evening,
    early,
    withOthers,
    byKind,
    busiest: ranked[0],
    quietest: ranked[ranked.length - 1],
    longestRun,
    perDay: days.length ? Math.round(minutes / days.length) : 0,
    concentration: minutes > 0 ? Math.round((topThree / minutes) * 100) / 100 : null,
  };
}

/** Every week this journal has calendar coverage for, oldest first. A week is
    only produced when at least `minDays` of it were actually looked at —
    otherwise a connection made on a Friday would report a near-empty week and
    then compare every future week against it. */
export function weeksIn(
  events: CalEvent[], coverage: Coverage | undefined,
  opts: { startsOn?: 0 | 1; minDays?: number; until?: string } = {}
): WeekShape[] {
  if (!coverage) return [];
  const startsOn = opts.startsOn ?? 1;
  const minDays = opts.minDays ?? 5;
  const last = opts.until && opts.until < coverage.end ? opts.until : coverage.end;
  const out: WeekShape[] = [];
  let cursor = weekStart(coverage.start, startsOn);
  let guard = 0;
  while (cursor <= last && guard < 600) {
    const w = weekShape(events, cursor, { startsOn, coverage: { start: coverage.start, end: last } });
    if (w.covered >= minDays) out.push(w);
    cursor = shiftDay(cursor, 7);
    guard += 1;
  }
  return out;
}

/* ---------- comparing ----------

   Three comparisons, because "how was this week" is three different questions
   and answering them with one number is how a dashboard becomes a horoscope.

   · Against **last week** — what changed.
   · Against **your usual week** — whether this one was unusual at all.
   · Against **how the week felt** — the only one that touches health, and the
     one that gets the full non-causal treatment further down. */

export interface WeekDelta {
  key: string;
  label: string;
  /** Both sides in their own unit (minutes, or a count). */
  now: number;
  then: number;
  diff: number;
  /** Fractional change, null when `then` was zero and there is no ratio. */
  ratio: number | null;
  unit: "min" | "days" | "events" | "run";
}

const DELTA_FIELDS: { key: string; label: string; unit: WeekDelta["unit"]; get: (w: WeekShape) => number }[] = [
  { key: "minutes", label: "Booked time", unit: "min", get: (w) => w.minutes },
  { key: "events", label: "Commitments", unit: "events", get: (w) => w.events },
  { key: "clearDays", label: "Clear days", unit: "days", get: (w) => w.clearDays },
  { key: "evening", label: "Evening time", unit: "min", get: (w) => w.evening },
  { key: "early", label: "Before 9am", unit: "min", get: (w) => w.early },
  { key: "weekend", label: "Weekend time", unit: "min", get: (w) => w.weekend },
  { key: "withOthers", label: "Time with others", unit: "min", get: (w) => w.withOthers },
  { key: "longestRun", label: "Longest run without a break", unit: "run", get: (w) => w.longestRun },
];

/** Every difference between two weeks, biggest proportional change first.
    Weeks with different coverage are compared per covered day rather than in
    absolute terms — otherwise a four-day week always looks like a quiet one. */
export function compareWeeks(now: WeekShape, then: WeekShape): WeekDelta[] {
  const scale = now.covered && then.covered ? now.covered / then.covered : 1;
  const out: WeekDelta[] = [];
  for (const f of DELTA_FIELDS) {
    const a = f.get(now);
    /* "Clear days" is the one field that must not be scaled: two clear days out
       of four covered is not the same claim as three and a half out of seven,
       and inventing a half day would be worse than comparing honestly. */
    const raw = f.get(then);
    const b = f.key === "clearDays" ? raw : Math.round(raw * scale);
    out.push({
      key: f.key, label: f.label, unit: f.unit,
      now: a, then: b, diff: a - b,
      ratio: b === 0 ? null : Math.round(((a - b) / b) * 100) / 100,
    });
  }
  return out.sort((x, y) => Math.abs(y.ratio ?? 0) - Math.abs(x.ratio ?? 0));
}

/** The median of this person's own weeks, field by field.

    A median rather than a mean, and per field rather than per week, because
    the question "is this week unusual" is asked of each thing separately: a
    normal amount of booked time arranged into two enormous days is a genuinely
    unusual week and a mean over totals would hide it entirely. */
export function usualWeek(weeks: WeekShape[]): WeekShape | null {
  if (weeks.length < 3) return null;
  const med = (get: (w: WeekShape) => number): number => {
    const xs = weeks.map(get).sort((a, b) => a - b);
    const mid = xs.length >> 1;
    return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
  };
  const byKind = emptyKinds();
  for (const k of EVENT_KINDS) byKind[k] = med((w) => w.byKind[k]);
  const covered = med((w) => w.covered);
  const minutes = med((w) => w.minutes);
  return {
    start: weeks[0].start,
    end: weeks[weeks.length - 1].end,
    days: [],
    covered,
    events: med((w) => w.events),
    minutes,
    busyDays: med((w) => w.busyDays),
    clearDays: med((w) => w.clearDays),
    weekend: med((w) => w.weekend),
    evening: med((w) => w.evening),
    early: med((w) => w.early),
    withOthers: med((w) => w.withOthers),
    byKind,
    longestRun: med((w) => w.longestRun),
    perDay: covered ? Math.round(minutes / covered) : 0,
    concentration: null,
  };
}

/* ---------- what it becomes downstream ----------

   The same contract every other data source in this journal meets: one number
   per day, a label, a unit and a direction, so the trend chart, the metric
   picker, the relationship explorer and the experiment engine can each ask one
   question rather than knowing what a calendar is.

   Every one of these is `neutral`. There is no healthy number of meetings, and
   colouring a busy Tuesday red would be the app giving somebody life advice it
   is in no position to give. */

export interface ScheduleMetricCtx {
  events?: CalEvent[];
  coverage?: Coverage;
  date: string;
}

const load = (ctx: ScheduleMetricCtx): DayLoad | null => {
  if (!ctx.events || !ctx.events.length) return null;
  /* Outside coverage there is no answer, and zero is not one. */
  if (ctx.coverage && !hasCoverage(ctx.coverage, ctx.date)) return null;
  return dayLoad(ctx.events, ctx.date);
};

export const SCHEDULE_METRICS: {
  k: string;
  label: string;
  unit?: string;
  dir: "sym" | "pos" | "neutral";
  sec: string;
  value: (ctx: ScheduleMetricCtx) => number | null;
}[] = [
  { k: "cal_minutes", label: "Booked time", unit: "min", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.minutes ?? null },
  { k: "cal_events", label: "Commitments", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.events ?? null },
  { k: "cal_span", label: "First to last", unit: "min", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.span ?? null },
  { k: "cal_first", label: "First commitment", unit: "min after midnight", dir: "neutral", sec: "Schedule",
    value: (c) => { const v = minsOf(load(c)?.firstStart); return v === undefined ? null : v; } },
  { k: "cal_last", label: "Last commitment ends", unit: "min after midnight", dir: "neutral", sec: "Schedule",
    value: (c) => { const v = minsOf(load(c)?.lastEnd); return v === undefined ? null : v; } },
  { k: "cal_evening", label: "Evening commitments", unit: "min", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.evening ?? null },
  { k: "cal_early", label: "Before 9am", unit: "min", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.early ?? null },
  { k: "cal_backtoback", label: "Longest run without a break", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.backToBack ?? null },
  { k: "cal_gap", label: "Longest free stretch", unit: "min", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.longestGap ?? null },
  { k: "cal_people", label: "Time with others", unit: "min", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.withOthers ?? null },
  { k: "cal_peak_people", label: "Largest gathering", unit: "people", dir: "neutral", sec: "Schedule",
    value: (c) => load(c)?.peakPeople ?? null },
  ...(["work", "social", "exercise", "health", "travel", "family", "focus", "admin"] as EventKind[]).map((k) => ({
    k: `cal_k_${k}`,
    label: `${KIND_LABEL[k]} time`,
    unit: "min",
    dir: "neutral" as const,
    sec: "Schedule",
    value: (c: ScheduleMetricCtx) => load(c)?.byKind[k] ?? null,
  })),
];

export const SCHEDULE_METRIC_KEYS = SCHEDULE_METRICS.map((m) => m.k);
export const isScheduleKey = (k: string): boolean => SCHEDULE_METRIC_KEYS.includes(k);

/* ---------- observations ----------

   The sentences, and the part of this feature most able to do harm.

   "Your four busiest weeks were your four worst weeks" is a sentence somebody
   might act on by turning down work, and it can be produced by pure chance out
   of eleven weeks of data. So the same three structural defences `lib/context`
   uses apply here, plus a fourth that is specific to a calendar:

   · Every sentence is a **count of the person's own days or weeks**, never a
     coefficient. "9 of your 12 hardest days" is checkable by a person. So is
     "1.2 points higher, across 23 weeks". "r = 0.44" is not.
   · Nothing is produced below the minimums below, and the sample is always
     printed alongside the finding rather than in a footnote.
   · The vocabulary is fixed in SCHEDULE_COPY so the causal-language audit has
     one place to read.
   · **Only covered days count.** A day this journal has no calendar for is not
     a day with nothing booked, and every function here is handed coverage
     rather than inferring it. This is the defence the other three depend on:
     without it every observation is computed against a fiction. */

/** Weeks needed before anything is said about weeks. Weeks are scarce — this
    is two months of a connected calendar — and eight is the point below which
    "busiest" and "quietest" are describing three weeks each. */
export const MIN_SCHEDULE_WEEKS = 8;
/** Days needed before anything is said about days. Matches the environmental
    threshold, for the same reason: it is where a top-decile split stops being
    a description of four days. */
export const MIN_SCHEDULE_DAYS = 20;
/** Below this the difference in averages is not something a person can feel,
    and saying it invites them to act on nothing. */
export const MIN_POINTS = 0.5;

export interface ScheduleObservation {
  id: string;
  /** The schedule factor's metric key. */
  factor: string;
  /** The outcome's answer key. */
  outcome: string;
  headline: string;
  detail: string;
  /** The days this is about, so tapping it can light them up everywhere. */
  dates: string[];
  /** How many days (or weeks) went into it at all. */
  observed: number;
  scope: "day" | "week";
}

interface Entryish {
  date: string;
  answers?: Record<string, unknown>;
}

const answerNum = (e: Entryish | undefined, k: string): number | null => {
  const v = e?.answers?.[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
};

export interface ScheduleFactor {
  key: string;
  /** Lower case, reads inside a sentence: "booked time". */
  label: string;
  get: (d: DayLoad) => number | undefined;
  /** How the threshold is printed. */
  format: (v: number) => string;
}

export function scheduleFactors(): ScheduleFactor[] {
  return [
    { key: "cal_minutes", label: "booked", get: (d) => d.minutes, format: hoursLabel },
    { key: "cal_events", label: "commitments", get: (d) => d.events, format: (v) => `${Math.round(v)}` },
    { key: "cal_backtoback", label: "back to back", get: (d) => d.backToBack, format: (v) => `${Math.round(v)} in a row` },
    { key: "cal_evening", label: "booked after 6pm", get: (d) => d.evening, format: hoursLabel },
    { key: "cal_early", label: "booked before 9am", get: (d) => d.early, format: hoursLabel },
    { key: "cal_people", label: "with other people", get: (d) => d.withOthers, format: hoursLabel },
    { key: "cal_span", label: "from first to last", get: (d) => d.span, format: hoursLabel },
  ];
}

/** The days this journal can honestly compare: an entry, a calendar, and a
    number on both sides. */
function pairDays(
  entries: Entryish[], events: CalEvent[], coverage: Coverage | undefined,
  outcomeKey: string, get: (d: DayLoad) => number | undefined
): { date: string; y: number; x: number; load: DayLoad }[] {
  const out: { date: string; y: number; x: number; load: DayLoad }[] = [];
  for (const e of entries) {
    if (!e || typeof e.date !== "string") continue;
    if (coverage && !hasCoverage(coverage, e.date)) continue;
    const y = answerNum(e, outcomeKey);
    if (y == null) continue;
    const d = dayLoad(events, e.date);
    const x = get(d);
    if (x === undefined) continue;
    out.push({ date: e.date, y, x, load: d });
  }
  return out;
}

/** "9 of your 12 hardest days had more than 4h booked."

    The hardest days are the top fifth of the outcome; the observation fires
    only when most of them land on one side of the factor's own median. Blunt
    on purpose — a subtle effect found in forty days of self-rated data is
    almost always noise wearing a lab coat. */
export function hardDayObservation(
  entries: Entryish[], events: CalEvent[], coverage: Coverage | undefined,
  outcome: { key: string; label: string; dir?: "sym" | "pos" | "neutral" },
  factor: ScheduleFactor
): ScheduleObservation | null {
  const rows = pairDays(entries, events, coverage, outcome.key, factor.get);
  if (rows.length < MIN_SCHEDULE_DAYS) return null;
  const worse = (v: number) => (outcome.dir === "pos" ? -v : v);
  const ranked = [...rows].sort((a, b) => worse(b.y) - worse(a.y));
  const n = Math.max(5, Math.min(12, Math.round(rows.length * 0.2)));
  const hardest = ranked.slice(0, n);
  const xs = rows.map((r) => r.x).sort((a, b) => a - b);
  const median = xs[Math.floor(xs.length / 2)];
  /* A factor that was the same on every day cannot separate anything, and the
     split below would put every day on one side and report it as a finding. */
  if (xs[0] === xs[xs.length - 1]) return null;
  const above = hardest.filter((r) => r.x > median);
  const below = hardest.filter((r) => r.x <= median);
  const side = above.length >= below.length ? above : below;
  if (side.length / n < 0.67) return null;
  const isAbove = side === above;
  return {
    id: `sch_${outcome.key}_${factor.key}`,
    factor: factor.key,
    outcome: outcome.key,
    headline: `${side.length} of your ${n} hardest days had ${isAbove ? "more than" : "no more than"} ${factor.format(median)} ${factor.label}.`,
    detail: `${SCHEDULE_COPY.acrossDays(rows.length)} ${SCHEDULE_COPY.coincidence}`,
    dates: side.map((r) => r.date).sort(),
    observed: rows.length,
    scope: "day",
  };
}

/** The general form: how the outcome's own average differs between the days
    above and below the factor's median. */
export function bandObservation(
  entries: Entryish[], events: CalEvent[], coverage: Coverage | undefined,
  outcome: { key: string; label: string }, factor: ScheduleFactor
): ScheduleObservation | null {
  const rows = pairDays(entries, events, coverage, outcome.key, factor.get);
  if (rows.length < MIN_SCHEDULE_DAYS) return null;
  const xs = rows.map((r) => r.x).sort((a, b) => a - b);
  const median = xs[Math.floor(xs.length / 2)];
  const hi = rows.filter((r) => r.x > median);
  const lo = rows.filter((r) => r.x <= median);
  if (hi.length < 8 || lo.length < 8) return null;
  const mean = (arr: typeof rows) => arr.reduce((a, r) => a + r.y, 0) / arr.length;
  const diff = mean(hi) - mean(lo);
  if (Math.abs(diff) < MIN_POINTS) return null;
  return {
    id: `schb_${outcome.key}_${factor.key}`,
    factor: factor.key,
    outcome: outcome.key,
    headline: `Your ${outcome.label.toLowerCase()} has usually been ${round1(Math.abs(diff))} points ${diff > 0 ? "higher" : "lower"} on days with more than ${factor.format(median)} ${factor.label}.`,
    detail: `${hi.length} days above and ${lo.length} at or below, out of ${rows.length} with both recorded. ${SCHEDULE_COPY.sideBySide}`,
    dates: (diff > 0 ? hi : lo).map((r) => r.date).sort(),
    observed: rows.length,
    scope: "day",
  };
}

/** The one observation that is specific to a calendar rather than borrowed
    from the weather: a day with *nothing* booked is a category, not a point on
    a scale, and comparing it against every other day is the comparison people
    are actually curious about. */
export function clearDayObservation(
  entries: Entryish[], events: CalEvent[], coverage: Coverage | undefined,
  outcome: { key: string; label: string }
): ScheduleObservation | null {
  const rows = pairDays(entries, events, coverage, outcome.key, (d) => d.minutes);
  if (rows.length < MIN_SCHEDULE_DAYS) return null;
  const clear = rows.filter((r) => r.load.clear);
  const booked = rows.filter((r) => !r.load.clear);
  if (clear.length < 8 || booked.length < 8) return null;
  const mean = (arr: typeof rows) => arr.reduce((a, r) => a + r.y, 0) / arr.length;
  const diff = mean(clear) - mean(booked);
  if (Math.abs(diff) < MIN_POINTS) return null;
  return {
    id: `schc_${outcome.key}`,
    factor: "cal_events",
    outcome: outcome.key,
    headline: `Your ${outcome.label.toLowerCase()} has usually been ${round1(Math.abs(diff))} points ${diff > 0 ? "higher" : "lower"} on days with nothing in the calendar.`,
    detail: `${clear.length} days with nothing booked and ${booked.length} with something, out of ${rows.length} with both recorded. ${SCHEDULE_COPY.sideBySide}`,
    dates: clear.map((r) => r.date).sort(),
    observed: rows.length,
    scope: "day",
  };
}

/** The week-level version. A week is the unit somebody plans in, and a heavy
    week whose cost lands on the Saturday afterwards is invisible to every
    day-level test above — which is the whole reason this one exists. */
export function heavyWeekObservation(
  entries: Entryish[], weeks: WeekShape[],
  outcome: { key: string; label: string }
): ScheduleObservation | null {
  if (weeks.length < MIN_SCHEDULE_WEEKS) return null;
  const byDate = new Map(entries.filter((e) => e && typeof e.date === "string").map((e) => [e.date, e] as const));
  const rows: { week: WeekShape; y: number; x: number }[] = [];
  for (const w of weeks) {
    const ys: number[] = [];
    for (const d of w.days) {
      const v = answerNum(byDate.get(d.date), outcome.key);
      if (v != null) ys.push(v);
    }
    /* Fewer than three rated days is not a week's worth of feeling. */
    if (ys.length < 3 || !w.covered) continue;
    rows.push({ week: w, y: ys.reduce((a, b) => a + b, 0) / ys.length, x: w.perDay });
  }
  if (rows.length < MIN_SCHEDULE_WEEKS) return null;
  const ranked = [...rows].sort((a, b) => b.x - a.x);
  const n = Math.max(3, Math.min(6, Math.floor(rows.length / 3)));
  const heavy = ranked.slice(0, n);
  const light = ranked.slice(-n);
  if (heavy[heavy.length - 1].x <= light[0].x) return null; // no real separation
  const mean = (arr: typeof rows) => arr.reduce((a, r) => a + r.y, 0) / arr.length;
  const diff = mean(heavy) - mean(light);
  if (Math.abs(diff) < MIN_POINTS) return null;
  const side = diff > 0 ? heavy : light;
  return {
    id: `schw_${outcome.key}`,
    factor: "cal_minutes",
    outcome: outcome.key,
    headline: `Your ${n} busiest weeks averaged ${round1(Math.abs(diff))} points ${diff > 0 ? "higher" : "lower"} ${outcome.label.toLowerCase()} than your ${n} quietest.`,
    detail: `Across ${rows.length} weeks with at least three days rated. Busiest and quietest are measured per covered day, so a short week is not counted as a quiet one. ${SCHEDULE_COPY.coincidence}`,
    dates: side.flatMap((r) => r.week.days.map((d) => d.date)).sort(),
    observed: rows.length,
    scope: "week",
  };
}

/** Everything worth saying about one outcome, best first and capped — a list
    of nine coincidences is a horoscope. Week-level first, because it is the
    one a person cannot work out for themselves by scrolling. */
export function scheduleObservations(
  entries: Entryish[], events: CalEvent[], coverage: Coverage | undefined,
  weeks: WeekShape[],
  outcome: { key: string; label: string; dir?: "sym" | "pos" | "neutral" },
  limit = 3
): ScheduleObservation[] {
  if (!events.length || !entries.length) return [];
  const out: ScheduleObservation[] = [];
  const week = heavyWeekObservation(entries, weeks, outcome);
  if (week) out.push(week);
  const clear = clearDayObservation(entries, events, coverage, outcome);
  if (clear) out.push(clear);
  for (const f of scheduleFactors()) {
    if (out.length >= limit) break;
    const hard = hardDayObservation(entries, events, coverage, outcome, f);
    if (hard) { out.push(hard); continue; }
    const band = bandObservation(entries, events, coverage, outcome, f);
    if (band) out.push(band);
  }
  return out.slice(0, limit);
}

/* ---------- words ----------

   Every user-facing phrase this feature can produce lives here, so the
   causal-language audit has one file to read and there is no second place for
   a stray "because" to hide. */

export const SCHEDULE_COPY = {
  heading: "The week around the week",
  intro:
    "Your calendar is the only record most people keep of what they agreed to. "
    + "This reads its shape — when things started, how long they ran, how much "
    + "of the day was left over — and puts it next to how you felt. It can show "
    + "that two things moved together. It cannot show that one made the other happen.",
  coincidence:
    "Weeks can be alike for many reasons — this is a coincidence worth noticing, not an explanation.",
  sideBySide:
    "Averages of your own ratings, side by side — not an effect, and not a cause.",
  acrossDays: (n: number) => `Across ${n} days where both were recorded.`,
  noCoverage:
    "Days before this calendar was connected are left out. An empty day and a day this journal never saw are different facts.",
  titlesOff:
    "Titles are not stored. This journal keeps when things were and how long they ran, and the category it worked out as they came in — not what they were called.",
  guessed:
    "Categories are a guess from the title. Tap any one to correct it, and the correction sticks.",
  notProof:
    "A heavy week that went badly is one week. Something else may explain both, and a run of weeks can look related by chance.",
} as const;

/* ---------- display ---------- */

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** "3h 20m", "45m", "—". Minutes are the storage unit everywhere; hours are
    the only unit a person reads a week in. */
export function hoursLabel(mins: number | undefined | null): string {
  if (mins == null || !Number.isFinite(mins)) return "—";
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** "7:30 am" — display only; storage always keeps 24h. */
export function prettyClock(hhmmStr: string | undefined): string {
  if (!hhmmStr || !TIME_RE.test(hhmmStr)) return "";
  const h = Number(hhmmStr.slice(0, 2));
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${hhmmStr.slice(3, 5)} ${suffix}`;
}

/** "12 May – 18 May". */
export function weekLabel(start: string, end: string): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/** "18h booked · 2 clear days · busiest Tuesday". The one-line summary of a
    week, and deliberately three facts rather than a score. */
export function weekLine(w: WeekShape): string {
  const bits: string[] = [`${hoursLabel(w.minutes)} booked`];
  if (w.clearDays) bits.push(`${w.clearDays} clear ${w.clearDays === 1 ? "day" : "days"}`);
  if (w.busiest && w.busiest.minutes > 0) bits.push(`busiest ${weekdayOf(w.busiest.date)}`);
  return bits.join(" · ");
}

/** How a single difference reads: "3h 10m more than usual", "2 fewer". */
export function deltaLine(d: WeekDelta): string {
  if (d.diff === 0) return "the same";
  const up = d.diff > 0;
  const size = d.unit === "min"
    ? hoursLabel(Math.abs(d.diff))
    : `${Math.abs(d.diff)}`;
  if (d.unit === "min") return `${size} ${up ? "more" : "less"}`;
  if (d.unit === "days") return `${size} ${up ? "more" : "fewer"}`;
  if (d.unit === "run") return `${size} ${up ? "longer" : "shorter"}`;
  return `${size} ${up ? "more" : "fewer"}`;
}
