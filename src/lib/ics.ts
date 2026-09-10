/* Reading a calendar file.

   The other way in, and the one that needs no account, no key, no consent
   screen and no network: an .ics file, opened from the device, parsed here,
   and then indistinguishable from anything else in `lib/schedule`.

   This exists for the same reason the wearable importer is a file rather than
   a live sync. A file is a thing somebody chose to hand over, once, that works
   offline, keeps working when a provider changes its terms, and cannot quietly
   start sending more than it did last month. Every calendar worth connecting
   to — Google, Apple, Outlook, Fastmail, a self-hosted CalDAV server — can
   export one, so this single parser is the floor under the whole feature.

   Three things make an iCalendar file harder than it looks, and all three are
   the difference between "parses" and "correct":

   1. **Lines are folded.** A long title is split across lines with a leading
      space, and a naive line-by-line read silently truncates it.
   2. **A repeating event appears once.** Google exports the *rule*, not the
      three hundred instances. A parser that ignores RRULE loses almost every
      meeting on a working calendar — which would make the entire feature
      report that a busy person has an empty week. So the rule is expanded,
      within the requested window, with its exceptions and its individually
      moved instances applied.
   3. **A time can be in any zone.** `20250612T090000Z` is an instant,
      `TZID=America/New_York:20250612T090000` is a wall time somewhere else,
      and a bare `20250612T090000` is a wall time *here*. All three have to end
      up as this device's local clock, because every date in this journal is a
      local date.

   Nothing here reads a clock, makes a request, or keeps anything: it turns
   text into rows. */

import {
  classifyEvent, dateOf, timeOf, spanMinutes, type CalEvent,
} from "./schedule";

/* ---------- unfolding and tokenising ---------- */

/** Join continuation lines back onto their property. RFC 5545 folds at 75
    octets with a single leading space or tab on the continuation. */
export function unfold(text: string): string[] {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split one property line into name, parameters and value.

    The colon and semicolon inside a quoted parameter are not separators —
    `CN="Smith, John: Dr"` is one value — so the scan is character by character
    with a quote flag rather than a `split(":")`. */
export function parseLine(line: string): IcsProp | null {
  if (!line || !line.trim()) return null;
  let i = 0, quoted = false, colon = -1;
  for (; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = "";
  quoted = false;
  for (const c of head) {
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ";" && !quoted) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  const name = (parts.shift() || "").trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim();
  }
  return { name, params, value };
}

/** Undo the text escaping the format applies to SUMMARY and friends. */
export const unescapeText = (v: string): string =>
  String(v ?? "").replace(/\\n/gi, " ").replace(/\\([;,\\])/g, "$1").replace(/\s+/g, " ").trim();

/* ---------- time zones ----------

   Resolving `TZID=Europe/London` needs a time zone database. The browser has
   one — `Intl` — and it can be asked what a given instant looks like in a
   given zone. Running that backwards (wall time in a zone → instant) is a
   two-step fixed point: guess the instant by treating the wall time as UTC,
   ask what that instant's offset is, correct, then check once more because an
   hour either side of a DST change the first answer can be wrong. */

const tzPartsCache = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (tzPartsCache.has(tz)) return tzPartsCache.get(tz) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    f = null; // unknown zone — the caller falls back to floating time
  }
  tzPartsCache.set(tz, f);
  return f;
}

/** Offset of `tz` from UTC, in minutes, at the given instant. */
export function zoneOffset(at: Date, tz: string): number | null {
  const f = formatterFor(tz);
  if (!f) return null;
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  if (!Number.isFinite(parts.year)) return null;
  /* `hour: "2-digit"` with hour12:false renders midnight as 24 in some
     engines, which would put the offset out by a day if left alone. */
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** A wall time in a named zone, as an instant. Null when the zone is unknown. */
export function zonedToInstant(
  y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string
): Date | null {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = zoneOffset(new Date(wall), tz);
  if (off === null) return null;
  let guess = new Date(wall - off * 60000);
  const off2 = zoneOffset(guess, tz);
  if (off2 !== null && off2 !== off) {
    off = off2;
    guess = new Date(wall - off * 60000);
  }
  return guess;
}

export interface IcsMoment {
  /** Local YYYY-MM-DD. */
  date: string;
  /** Local HH:MM. Absent when the value was a DATE. */
  time?: string;
  allDay: boolean;
  /** The moment as a Date, for arithmetic. Midnight local for a DATE. */
  at: Date;
}

const DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

/** Turn one DTSTART/DTEND/EXDATE value into this device's local clock. */
export function parseMoment(value: string, params: Record<string, string> = {}): IcsMoment | null {
  const m = DT_RE.exec(String(value ?? "").trim());
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, z] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds);
  const isDate = params.VALUE === "DATE" || hs === undefined;
  if (isDate) {
    const at = new Date(y, mo - 1, d);
    return { date: dateOf(at), allDay: true, at };
  }
  const h = Number(hs), mi = Number(mis), s = Number(ss || "0");
  let at: Date;
  if (z) {
    at = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  } else if (params.TZID) {
    /* A quoted TZID keeps its quotes through parameter parsing in some
       writers; and Outlook emits its own zone names, which Intl rejects. Both
       fall through to floating time, which is the spec's own fallback. */
    const tz = params.TZID.replace(/^"|"$/g, "");
    at = zonedToInstant(y, mo, d, h, mi, s, tz) ?? new Date(y, mo - 1, d, h, mi, s);
  } else {
    at = new Date(y, mo - 1, d, h, mi, s);
  }
  return { date: dateOf(at), time: timeOf(at), allDay: false, at };
}

/** ISO 8601 durations as iCalendar uses them: P1DT2H30M, PT45M, -PT15M. */
export function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    String(value ?? "").trim()
  );
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const mins = (Number(w || 0) * 7 * 1440) + (Number(d || 0) * 1440)
    + (Number(h || 0) * 60) + Number(mi || 0) + Math.round(Number(s || 0) / 60);
  if (!Number.isFinite(mins)) return null;
  return sign === "-" ? -mins : mins;
}

/* ---------- recurrence ----------

   Enough of RRULE to be right about the rules people actually have, and honest
   about the rest. FREQ, INTERVAL, COUNT, UNTIL, BYDAY (with an ordinal for
   monthly), BYMONTHDAY and BYMONTH are handled; BYSETPOS, BYWEEKNO and
   BYYEARDAY are not, and an event carrying one of those is emitted as its
   single first occurrence rather than guessed at. Emitting one real day beats
   inventing fifty wrong ones in a record somebody may take to a doctor. */

export interface Rrule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
  byDay?: { ord: number; day: number }[]; // day: 0=Sun … 6=Sat, ord 0 = every
  byMonthDay?: number[];
  byMonth?: number[];
  /** True when the rule uses something this expander does not implement. */
  unsupported?: boolean;
}

const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRrule(value: string): Rrule | null {
  const parts: Record<string, string> = {};
  for (const bit of String(value ?? "").split(";")) {
    const eq = bit.indexOf("=");
    if (eq > 0) parts[bit.slice(0, eq).trim().toUpperCase()] = bit.slice(eq + 1).trim();
  }
  const freq = parts.FREQ as Rrule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = Math.max(1, Math.min(1000, Number(parts.INTERVAL || 1) || 1));
  const rule: Rrule = { freq, interval };
  if (parts.COUNT) rule.count = Math.max(1, Math.min(5000, Number(parts.COUNT) || 1));
  if (parts.UNTIL) rule.until = parseMoment(parts.UNTIL)?.at;
  if (parts.BYDAY) {
    rule.byDay = parts.BYDAY.split(",").map((tok) => {
      const m = /^([+-]?\d)?([A-Z]{2})$/.exec(tok.trim().toUpperCase());
      if (!m || DAY_INDEX[m[2]] === undefined) return null;
      return { ord: Number(m[1] || 0), day: DAY_INDEX[m[2]] };
    }).filter((x): x is { ord: number; day: number } => !!x);
    if (!rule.byDay.length) delete rule.byDay;
  }
  if (parts.BYMONTHDAY) {
    rule.byMonthDay = parts.BYMONTHDAY.split(",").map(Number).filter((n) => Number.isFinite(n) && n !== 0);
  }
  if (parts.BYMONTH) {
    rule.byMonth = parts.BYMONTH.split(",").map(Number).filter((n) => n >= 1 && n <= 12);
  }
  if (parts.BYSETPOS || parts.BYWEEKNO || parts.BYYEARDAY) rule.unsupported = true;
  return rule;
}

const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());

const addMonths = (d: Date, n: number): Date => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds());
  /* The 31st of a 30-day month is not a date. The spec says such an occurrence
     is skipped, and clamping it to the 30th would invent a meeting. */
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  if (d.getDate() > lastDay) return new Date(NaN);
  target.setDate(d.getDate());
  return target;
};

/** Every start moment of a rule that falls inside [from, to].

    Bounded three ways — the rule's own COUNT/UNTIL, the window, and a hard
    iteration cap — because a malformed INTERVAL in a file somebody exported
    should cost a blank section, never a frozen tab. */
export function expandRrule(start: Date, rule: Rrule, from: Date, to: Date, cap = 2000): Date[] {
  if (rule.unsupported) return start >= from && start <= to ? [start] : [];
  const out: Date[] = [];
  const limit = rule.until && rule.until < to ? rule.until : to;
  let emitted = 0;
  let cursor = new Date(start);
  let guard = 0;

  /* A daily standup set up four years ago would otherwise spend the whole
     iteration budget walking through years nobody asked about, and run out
     before reaching the window. When the rule has no COUNT there is nothing to
     tally on the way, so the cursor can jump straight to the last occurrence
     before the window opens. With a COUNT it cannot: the tally is the rule. */
  if (!rule.count && cursor < from) {
    const dayStep = rule.freq === "DAILY" ? rule.interval
      : rule.freq === "WEEKLY" ? rule.interval * 7 : 0;
    if (dayStep > 0) {
      const gap = Math.floor((from.getTime() - cursor.getTime()) / 86400000);
      const jumps = Math.floor(gap / dayStep);
      if (jumps > 0) cursor = addDays(cursor, jumps * dayStep);
    }
  }

  const emit = (d: Date): boolean => {
    if (Number.isNaN(d.getTime())) return true;
    if (d < start) return true;
    if (d > limit) return false;
    if (rule.byMonth && !rule.byMonth.includes(d.getMonth() + 1)) return true;
    emitted += 1;
    if (rule.count && emitted > rule.count) return false;
    if (d >= from) out.push(new Date(d));
    return true;
  };

  while (guard < cap) {
    guard += 1;
    if (rule.freq === "DAILY") {
      if (!emit(cursor)) break;
      cursor = addDays(cursor, rule.interval);
    } else if (rule.freq === "WEEKLY") {
      const days = rule.byDay?.length ? rule.byDay.map((b) => b.day) : [start.getDay()];
      /* Walk the week the cursor sits in, in day order, then jump `interval`
         weeks. The cursor is kept on its own weekday so the jump is stable. */
      const weekStartDate = addDays(cursor, -cursor.getDay());
      let stop = false;
      for (const dow of [...days].sort((a, b) => a - b)) {
        const d = addDays(weekStartDate, dow);
        if (!emit(d)) { stop = true; break; }
      }
      if (stop) break;
      cursor = addDays(weekStartDate, 7 * rule.interval + start.getDay());
    } else if (rule.freq === "MONTHLY") {
      let stop = false;
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1,
        start.getHours(), start.getMinutes(), start.getSeconds());
      const candidates = monthlyDays(monthStart, rule, start);
      for (const d of candidates) {
        if (!emit(d)) { stop = true; break; }
      }
      if (stop) break;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + rule.interval, 1,
        start.getHours(), start.getMinutes(), start.getSeconds());
      if (cursor > limit) break;
    } else {
      const next = addMonths(cursor, 12 * rule.interval);
      if (!emit(cursor)) break;
      cursor = next;
      if (Number.isNaN(cursor.getTime())) break;
    }
    if (cursor > limit && rule.freq !== "MONTHLY") break;
  }
  return out;
}

/** The days a MONTHLY rule lands on inside one month, in order. */
function monthlyDays(monthStart: Date, rule: Rrule, start: Date): Date[] {
  const y = monthStart.getFullYear(), m = monthStart.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const at = (day: number) => new Date(y, m, day, start.getHours(), start.getMinutes(), start.getSeconds());
  const out: Date[] = [];
  if (rule.byMonthDay?.length) {
    for (const n of rule.byMonthDay) {
      const day = n > 0 ? n : lastDay + n + 1;
      if (day >= 1 && day <= lastDay) out.push(at(day));
    }
  } else if (rule.byDay?.length) {
    for (const { ord, day } of rule.byDay) {
      const matches: number[] = [];
      for (let d = 1; d <= lastDay; d += 1) if (new Date(y, m, d).getDay() === day) matches.push(d);
      if (!ord) { for (const d of matches) out.push(at(d)); continue; }
      const pick = ord > 0 ? matches[ord - 1] : matches[matches.length + ord];
      if (pick) out.push(at(pick));
    }
  } else if (start.getDate() <= lastDay) {
    out.push(at(start.getDate()));
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/* ---------- events ---------- */

export interface IcsParseOptions {
  /** Only occurrences inside this window are produced. */
  start: string;
  end: string;
  /** Store titles. Off by default — the schedule module's rule 1. */
  titles?: boolean;
  /** Tagged onto every row, so a re-import of the same file replaces rather
      than duplicates and the screen can say where a day came from. */
  calendarId?: string;
}

export interface IcsResult {
  events: CalEvent[];
  /** How many VEVENTs were read, before recurrence expansion. */
  read: number;
  /** VEVENTs that could not be turned into a row, with a reason each. Surfaced
      rather than swallowed: a file where a third of the entries were skipped is
      something the person needs to be told about. */
  skipped: { reason: string; n: number }[];
  /** The calendar's own name, when it carries one. */
  name?: string;
}

interface RawEvent {
  props: IcsProp[];
}

/** Split the text into VEVENT blocks. VTIMEZONE and VALARM blocks are read
    past rather than into — an alarm carries its own DTSTART and would
    otherwise be parsed as a meeting. */
function blocks(lines: string[]): { events: RawEvent[]; name?: string } {
  const events: RawEvent[] = [];
  let name: string | undefined;
  let cur: RawEvent | null = null;
  let depth = 0; // nesting inside the current VEVENT (VALARM)
  let skipping: string | null = null;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      const kind = p.value.trim().toUpperCase();
      if (skipping) continue;
      if (kind === "VEVENT") { cur = { props: [] }; depth = 0; continue; }
      if (cur) { depth += 1; continue; }
      if (kind === "VTIMEZONE") { skipping = kind; continue; }
      continue;
    }
    if (p.name === "END") {
      const kind = p.value.trim().toUpperCase();
      if (skipping) { if (kind === skipping) skipping = null; continue; }
      if (kind === "VEVENT" && cur) { events.push(cur); cur = null; continue; }
      if (cur && depth > 0) { depth -= 1; continue; }
      continue;
    }
    if (skipping) continue;
    if (cur) { if (depth === 0) cur.props.push(p); continue; }
    if (p.name === "X-WR-CALNAME") name = unescapeText(p.value).slice(0, 80);
  }
  return { events, name };
}

const first = (props: IcsProp[], name: string): IcsProp | undefined =>
  props.find((p) => p.name === name);

const all = (props: IcsProp[], name: string): IcsProp[] => props.filter((p) => p.name === name);

/** Parse an .ics document into rows, expanding recurrence inside the window.

    Order matters here and is not incidental: overrides (`RECURRENCE-ID`) are
    collected first, so that when the master rule is expanded a day that was
    individually moved or cancelled is not also emitted at its original time.
    Getting that wrong double-books every rescheduled meeting in the file. */
export function parseIcs(text: string, opts: IcsParseOptions): IcsResult {
  const { events: raws, name } = blocks(unfold(text));
  const from = new Date(`${opts.start}T00:00:00`);
  const to = new Date(`${opts.end}T23:59:59`);
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) || 0) + 1);

  /* uid → set of local "YYYY-MM-DDTHH:MM" recurrence ids that have their own
     VEVENT and must not be emitted from the rule as well. */
  const overridden = new Map<string, Set<string>>();
  for (const r of raws) {
    const rid = first(r.props, "RECURRENCE-ID");
    const uid = first(r.props, "UID")?.value?.trim();
    if (!rid || !uid) continue;
    const m = parseMoment(rid.value, rid.params);
    if (!m) continue;
    const set = overridden.get(uid) || new Set<string>();
    set.add(`${m.date}T${m.time || "00:00"}`);
    overridden.set(uid, set);
  }

  const out: CalEvent[] = [];
  for (const r of raws) {
    const props = r.props;
    const uid = first(props, "UID")?.value?.trim() || "";
    const status = first(props, "STATUS")?.value?.trim().toUpperCase();
    if (status === "CANCELLED") { skip("cancelled"); continue; }

    const dtstartProp = first(props, "DTSTART");
    if (!dtstartProp) { skip("no start time"); continue; }
    const startMoment = parseMoment(dtstartProp.value, dtstartProp.params);
    if (!startMoment) { skip("unreadable start time"); continue; }

    const dtendProp = first(props, "DTEND");
    const durProp = first(props, "DURATION");
    let lengthMins: number;
    if (dtendProp) {
      const endMoment = parseMoment(dtendProp.value, dtendProp.params);
      lengthMins = endMoment
        ? Math.max(0, Math.round((endMoment.at.getTime() - startMoment.at.getTime()) / 60000))
        : 0;
    } else if (durProp) {
      lengthMins = Math.max(0, parseDuration(durProp.value) ?? 0);
    } else {
      /* No end and no duration: the spec says an all-day entry lasts one day
         and a timed one is instantaneous. */
      lengthMins = startMoment.allDay ? 1440 : 0;
    }

    const title = unescapeText(first(props, "SUMMARY")?.value || "");
    const busy = (first(props, "TRANSP")?.value || "").trim().toUpperCase() !== "TRANSPARENT";
    /* Attendees are counted, never read. The organiser is included when they
       are not already in the list, because a one-attendee meeting with an
       organiser is a two-person meeting. */
    const attendees = all(props, "ATTENDEE").length;
    const people = attendees ? attendees + (first(props, "ORGANIZER") ? 1 : 0) : 0;
    const repeating = !!first(props, "RRULE") || !!first(props, "RECURRENCE-ID");
    const kind = classifyEvent({
      title, minutes: lengthMins, people, allDay: startMoment.allDay,
      time: startMoment.time, date: startMoment.date,
    });

    const build = (at: Date, idSuffix: string): CalEvent | null => {
      const date = dateOf(at);
      const time = startMoment.allDay ? undefined : timeOf(at);
      const endAt = new Date(at.getTime() + lengthMins * 60000);
      /* An all-day DTEND is exclusive: a one-day entry ends on the next day,
         and storing that verbatim would make every holiday a day too long. */
      const endDate = startMoment.allDay
        ? dateOf(new Date(at.getTime() + Math.max(0, lengthMins - 1) * 60000))
        : dateOf(endAt);
      const endTime = startMoment.allDay ? undefined : timeOf(endAt);
      const minutes = startMoment.allDay
        ? 0
        : spanMinutes(date, time, endDate, endTime) ?? lengthMins;
      return {
        id: `ics_${hashId(`${uid}|${idSuffix}|${opts.calendarId || ""}`)}`,
        date,
        time,
        endDate,
        endTime,
        minutes,
        ...(startMoment.allDay ? { allDay: true as const } : {}),
        busy,
        going: "unknown",
        people,
        ...(repeating ? { repeating: true as const } : {}),
        kind,
        kindSource: "rules" as const,
        ...(opts.titles && title ? { title } : {}),
        calendarId: opts.calendarId,
        source: "ics",
      };
    };

    const rruleProp = first(props, "RRULE");
    const rid = first(props, "RECURRENCE-ID");
    if (rruleProp && !rid) {
      const rule = parseRrule(rruleProp.value);
      if (!rule) { skip("unreadable repeat rule"); continue; }
      const exdates = new Set<string>();
      for (const ex of all(props, "EXDATE")) {
        for (const v of ex.value.split(",")) {
          const m = parseMoment(v.trim(), ex.params);
          if (m) exdates.add(`${m.date}T${m.time || "00:00"}`);
        }
      }
      const moved = overridden.get(uid);
      let n = 0;
      for (const at of expandRrule(startMoment.at, rule, from, to)) {
        const stamp = `${dateOf(at)}T${startMoment.allDay ? "00:00" : timeOf(at)}`;
        if (exdates.has(stamp)) continue;
        if (moved?.has(stamp)) continue;
        const row = build(at, stamp);
        if (row) { out.push(row); n += 1; }
      }
      if (!n) skip("repeats outside this window");
      continue;
    }

    if (startMoment.date > opts.end || dateOf(new Date(startMoment.at.getTime() + lengthMins * 60000)) < opts.start) {
      skip("outside this window");
      continue;
    }
    const row = build(startMoment.at, rid ? `rid:${rid.value}` : "once");
    if (row) out.push(row);
  }

  return {
    events: out.sort((a, b) => (a.date === b.date ? (a.time || "").localeCompare(b.time || "") : a.date < b.date ? -1 : 1)),
    read: raws.length,
    skipped: [...skipped.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    name,
  };
}

/** A short, stable id from a string. Not a security hash and not pretending to
    be one — it exists so the same event in the same file gets the same row on
    every import, which is what makes a re-import an update rather than a
    duplicate. */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 16);
}
