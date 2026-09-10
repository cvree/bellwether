/* Asking a model to read a calendar.

   The local arithmetic in ./schedule already knows how many hours were booked,
   how fragmented the day was and how the week compares with the person's own
   median. What it cannot do is either of the two things a language model is
   genuinely good at here:

   1. **Tell what an event was, from what it was called.** The keyword table in
      ./schedule gets "Dentist" and "Sprint planning" and misses "Bloods @
      St Mary's", "Standup w/ the pod" and "Bikram". Every miss lands in
      "Other", and a week that is 40% Other is a week nobody can read.

   2. **Say what the shape of a week actually was.** "Front-loaded: three
      quarters of your booked time fell before Wednesday evening, and you had
      no clear day for the first time in six weeks" is a sentence about eight
      numbers at once, and it is the sentence somebody wants.

   Those are two different requests carrying two different payloads, so they
   are two switches, not one.

   · **Categorising** sends a de-duplicated list of *titles*, with a duration
     and an attendee count each. It sends no dates, so the list cannot be
     reassembled into a diary of somebody's movements, and it is only offered
     at all when the person has already chosen to store titles. Answers are
     cached by title, so a daily standup is categorised once, ever.
   · **Reading the weeks** sends *numbers only* — the weekly shapes and, if the
     person picks one, their own rating averaged per week. No titles, no dates,
     no names. It is available whether or not titles are stored, because there
     is nothing textual in the payload either way.

   Both are off until switched on. Both describe exactly what they are about to
   send before sending it. Both are scrubbed on the way back by the same
   `scrubCausalLanguage` the pattern analysis uses, because a model asked about
   a busy fortnight will reach for "because" without being asked to. */

import { AiError, runStructured, scrubCausalLanguage, type Connection } from "./ai";
import {
  EVENT_KINDS, KIND_LABEL, hoursLabel, weekdayOf,
  type CalEvent, type EventKind, type WeekShape,
} from "./schedule";

/* ---------- 1. what was that event ---------- */

export interface TitleAsk {
  /** The title, as stored. */
  title: string;
  /** Minutes, rounded to a quarter of an hour — the exact figure adds nothing
      to a categorisation and is one more thing being sent. */
  minutes: number;
  people: number;
}

/** The titles worth asking about: the ones the local table could not place,
    de-duplicated, most frequent first, and capped.

    The cap is not only about cost. A list of four hundred distinct titles is
    a fingerprint of somebody's life; the fifty that recur are the ones that
    actually move the numbers. */
export function titlesToAsk(events: CalEvent[], limit = 50): TitleAsk[] {
  const byTitle = new Map<string, { n: number; minutes: number; people: number; title: string }>();
  for (const e of events) {
    /* Only the ones nobody has already answered. A hand correction is final,
       and a title the rules placed is not worth a round trip. */
    if (e.kindSource !== "rules" || e.kind !== "other") continue;
    const t = (e.title || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    const prev = byTitle.get(key);
    if (prev) {
      prev.n += 1;
      prev.minutes = Math.max(prev.minutes, e.minutes);
      prev.people = Math.max(prev.people, e.people);
    } else {
      byTitle.set(key, { n: 1, minutes: e.minutes, people: e.people, title: t });
    }
  }
  return [...byTitle.values()]
    .sort((a, b) => b.n - a.n || b.minutes - a.minutes)
    .slice(0, limit)
    .map((r) => ({
      title: r.title.slice(0, 120),
      minutes: Math.round(r.minutes / 15) * 15,
      people: r.people,
    }));
}

/** Plain-language description of what is about to leave, for the confirmation
    sheet. Same job as `summariseInput` in ./ai and the same reason: a person
    should be able to see the payload before it goes, in words. */
export function summariseTitleAsk(asks: TitleAsk[]): {
  titles: number;
  approxKB: number;
  sample: string[];
} {
  return {
    titles: asks.length,
    approxKB: Math.max(1, Math.round(JSON.stringify(asks).length / 1024)),
    sample: asks.slice(0, 5).map((a) => a.title),
  };
}

const KIND_SYSTEM = `You are sorting calendar entries into categories for someone's private health journal.

You receive a list of event titles, each with a rough duration in minutes and how many people were invited. You return one category per entry, in the same order.

The categories, and what each means:
- work: a meeting, a call, a shift, anything done for an employer or client
- focus: time blocked out to do something alone — writing, studying, deep work
- social: friends, meals out, parties, hobbies with other people
- family: family members, children's activities, family occasions
- exercise: training, classes, sport, deliberate physical activity
- health: appointments, treatments, tests, therapy — anything medical
- travel: flights, trains, long drives, being somewhere else
- admin: errands, chores, paperwork, appointments that are not medical
- rest: leave, days off, holidays, deliberately unbooked time
- other: you genuinely cannot tell

Hard rules:
- "other" is a correct answer and often the right one. A confident wrong category is worse than an honest blank in a health record.
- Judge only from the title, the duration and the number of people. Do not speculate about the person, their job, their health or their relationships.
- Do not infer or comment on any medical condition. If a title names one, the category is simply "health".
- Return exactly one entry per input, in the input's order. No extra commentary.`;

const KIND_SCHEMA = {
  type: "object",
  properties: {
    kinds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          kind: { type: "string", enum: EVENT_KINDS },
        },
        required: ["i", "kind"],
      },
    },
  },
  required: ["kinds"],
};

const KIND_JSON_HINT =
  'Reply with JSON only: {"kinds":[{"i":0,"kind":"work"},{"i":1,"kind":"health"}]} — one entry per input, "i" being its position in the list.';

/** title (lowercased) → kind. The cache the caller stores, so the same title
    is never sent twice. */
export type KindMap = Record<string, EventKind>;

export function sanitizeKindMap(v: unknown): KindMap {
  if (!v || typeof v !== "object") return {};
  const out: KindMap = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 500) break;
    if (typeof k !== "string" || !k.trim()) continue;
    if (!EVENT_KINDS.includes(val as EventKind)) continue;
    out[k.slice(0, 120).toLowerCase()] = val as EventKind;
    n += 1;
  }
  return out;
}

/** Ask a model to categorise titles the local table could not place. */
export async function interpretTitles(
  conn: Connection, asks: TitleAsk[], opts: { signal?: AbortSignal } = {}
): Promise<KindMap> {
  if (!asks.length) return {};
  const user =
    "Categorise each entry. Reply in the same order.\n\n"
    + JSON.stringify(asks.map((a, i) => ({ i, title: a.title, minutes: a.minutes, people: a.people })));

  const { parsed } = await runStructured(
    conn,
    { system: KIND_SYSTEM, user, schema: KIND_SCHEMA, jsonHint: KIND_JSON_HINT, maxTokens: 1200 },
    opts.signal
  );

  const rows = Array.isArray(parsed?.kinds) ? parsed.kinds : [];
  const out: KindMap = {};
  for (const row of rows) {
    const i = Number(row?.i);
    if (!Number.isInteger(i) || i < 0 || i >= asks.length) continue;
    const kind = row?.kind;
    if (!EVENT_KINDS.includes(kind)) continue;
    out[asks[i].title.toLowerCase()] = kind;
  }
  return out;
}

/** Apply a cache of answers to the events it can place. Only ever touches rows
    the rules left as "other" and nobody has corrected by hand — a model does
    not get to overrule a person, and it does not get to overrule a keyword
    match either, because the keyword match cost nothing and can be read. */
export function applyKinds(events: CalEvent[], map: KindMap): CalEvent[] {
  if (!Object.keys(map).length) return events;
  return events.map((e) => {
    if (e.kindSource !== "rules" || e.kind !== "other") return e;
    const k = map[(e.title || "").trim().toLowerCase()];
    return k && k !== "other" ? { ...e, kind: k, kindSource: "ai" as const } : e;
  });
}

/* ---------- 2. what shape was the week ---------- */

/** One week, as it goes over the wire. Numbers only, and ordinals rather than
    dates, so the payload cannot be tied back to a real person's timeline on
    its own — the same rule `buildAnalysisInput` follows in ./ai. */
export interface WeekRow {
  /** 1 = the oldest week in the window. */
  week: number;
  /** Days the calendar actually covered. */
  days: number;
  bookedMinutes: number;
  commitments: number;
  clearDays: number;
  eveningMinutes: number;
  earlyMinutes: number;
  weekendMinutes: number;
  withOthersMinutes: number;
  longestRun: number;
  /** Share of the week's booked time on its three heaviest days. */
  concentration: number | null;
  /** Minutes per category, categories with nothing in them omitted. */
  byKind: Partial<Record<EventKind, number>>;
  /** The person's own rating for that week, averaged. Present only when they
      chose an outcome to include. */
  rating?: number;
  /** How many days of the week that average is over. */
  ratedDays?: number;
}

export interface ScheduleReadingInput {
  weeks: WeekRow[];
  /** The label of the rating, when one is included. Nothing else about it. */
  outcomeLabel?: string;
  /** Which way is worse on that rating, so the model does not read a 9 as good
      when it is the opposite. */
  outcomeDirection?: "sym" | "pos" | "neutral";
}

interface Entryish {
  date: string;
  answers?: Record<string, unknown>;
}

/** Reduce the weeks to the smallest thing that can still answer the question.

    Included: per-week counts and minutes, and the person's own weekly average
    for one metric if they picked one.
    Excluded, deliberately: event titles, calendar names, dates, weekdays of
    individual events, attendee names, the person's name, and every other
    metric in the journal. */
export function buildReadingInput(
  weeks: WeekShape[],
  entries: Entryish[] = [],
  outcome?: { key: string; label: string; dir?: "sym" | "pos" | "neutral" }
): ScheduleReadingInput {
  const byDate = new Map(entries.filter((e) => e && typeof e.date === "string").map((e) => [e.date, e] as const));
  const rows: WeekRow[] = weeks.map((w, i) => {
    const byKind: Partial<Record<EventKind, number>> = {};
    for (const k of EVENT_KINDS) if (w.byKind[k] > 0) byKind[k] = w.byKind[k];
    const row: WeekRow = {
      week: i + 1,
      days: w.covered,
      bookedMinutes: w.minutes,
      commitments: w.events,
      clearDays: w.clearDays,
      eveningMinutes: w.evening,
      earlyMinutes: w.early,
      weekendMinutes: w.weekend,
      withOthersMinutes: w.withOthers,
      longestRun: w.longestRun,
      concentration: w.concentration,
      byKind,
    };
    if (outcome) {
      const vals: number[] = [];
      for (const d of w.days) {
        const v = byDate.get(d.date)?.answers?.[outcome.key];
        if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
        else if (typeof v === "boolean") vals.push(v ? 1 : 0);
      }
      if (vals.length) {
        row.rating = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
        row.ratedDays = vals.length;
      }
    }
    return row;
  });
  return {
    weeks: rows,
    outcomeLabel: outcome?.label,
    outcomeDirection: outcome?.dir,
  };
}

export function summariseReadingInput(input: ScheduleReadingInput): {
  weeks: number;
  numbers: number;
  approxKB: number;
  includesRating: boolean;
  ratingLabel?: string;
} {
  const numbers = input.weeks.reduce(
    (n, w) => n + 10 + Object.keys(w.byKind).length + (w.rating === undefined ? 0 : 2), 0
  );
  return {
    weeks: input.weeks.length,
    numbers,
    approxKB: Math.max(1, Math.round(JSON.stringify(input).length / 1024)),
    includesRating: input.weeks.some((w) => w.rating !== undefined),
    ratingLabel: input.outcomeLabel,
  };
}

const READING_SYSTEM = `You are helping someone understand the shape of their own weeks, from their calendar. You are not a clinician, a coach or a productivity consultant, and this is not a clinical setting.

You receive one row per week. Weeks are numbered from the start of the window; the last row is the most recent week. Every value is a count or a number of minutes. "days" is how many days of that week the calendar actually covered — compare weeks per covered day, never in absolute terms, or a short week reads as a quiet one. "clearDays" is days with nothing booked at all. "concentration" is the share of the week's booked time that fell on its three heaviest days: about 0.43 is perfectly even, 1.0 means the week happened in three days. Where a "rating" is present it is the person's own daily rating for that week, averaged, and "outcomeDirection" says which way is worse: "sym" means a higher number is worse, "pos" means a higher number is better.

Say what is actually there:
- how this most recent week compares with the weeks before it
- which parts of it are unusual for this person, and which are ordinary
- how the week was arranged, not only how full it was — front-loaded, evenly spread, concentrated, fragmented, evening-heavy, weekend-heavy
- runs and streaks across weeks: something building up, something easing off
- where a rating is given, whether it moved with any of the above across the weeks

Hard rules:
- Never claim causation. These are co-occurrences in one person's own record. Never "because", "due to", "led to", "caused by", "that is why".
- Never diagnose, name a condition, or suggest a treatment, supplement, medication, test or diet change.
- Never tell the person to work less, rest more, cancel anything, or change their schedule. You are describing their weeks, not advising on them. Observations, never prescriptions.
- There is no healthy number of meetings. Do not praise a quiet week or warn about a busy one. A full week is not a bad week.
- Only say what you can point at. In "evidence", name the numbers you compared. Do not invent figures.
- Fewer than 4 weeks of data supports almost nothing. Say so rather than reaching.
- Return at most 5 observations, best first. An empty list with an honest note is a good answer, not a failure.
- Write for the person themselves: short, concrete, warm, no jargon, no stacked hedging.`;

const READING_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          evidence: { type: "string" },
          weekFrom: { type: "integer" },
          weekTo: { type: "integer" },
          strength: { type: "string", enum: ["weak", "moderate", "strong"] },
        },
        required: ["headline", "evidence"],
      },
    },
    note: { type: "string" },
  },
  required: ["summary", "observations"],
};

const READING_JSON_HINT =
  'Reply with JSON only: {"summary":"…","observations":[{"headline":"…","evidence":"…","weekFrom":1,"weekTo":8,"strength":"moderate"}],"note":"…"}';

export interface ScheduleObservationAi {
  id: string;
  headline: string;
  evidence: string;
  weekFrom: number;
  weekTo: number;
  strength: "weak" | "moderate" | "strong";
}

export interface ScheduleReading {
  at: string;
  model: string;
  /** How many weeks it was given, so a reading can say what it is based on and
      a stale one can be spotted. */
  weeks: number;
  summary: string;
  observations: ScheduleObservationAi[];
  note?: string;
  /** True when the person's own rating was part of the payload. */
  includedRating: boolean;
}

/** Validate, soften and shape the model's reply. Exported because this is the
    boundary where untrusted output becomes something the UI renders, and that
    boundary is worth testing directly. */
export function normaliseReading(
  parsed: any, input: ScheduleReadingInput, model = ""
): ScheduleReading {
  const total = input.weeks.length;
  const clean = (v: unknown, max: number): string =>
    scrubCausalLanguage(String(v ?? "").replace(/\s+/g, " ").trim()).slice(0, max);

  /* Both ends are clamped into the range that exists *before* they are put in
     order. Clamping one end each way and then sorting lets a reply of
     {from: 99, to: -4} out the other side unchanged, pointing at weeks nobody
     has — which is how a citation stops citing anything. */
  const inRange = (v: unknown, fallback: number): number =>
    Number.isFinite(v as number)
      ? Math.max(1, Math.min(Math.max(1, total), Math.round(v as number)))
      : fallback;

  const raw = Array.isArray(parsed?.observations) ? parsed.observations : [];
  const observations: ScheduleObservationAi[] = raw.slice(0, 5).map((o: any, i: number) => {
    const from = inRange(o?.weekFrom, 1);
    const to = inRange(o?.weekTo, Math.max(1, total));
    return {
      id: `sr_${i}`,
      headline: clean(o?.headline, 200),
      evidence: clean(o?.evidence, 400),
      weekFrom: Math.min(from, to),
      weekTo: Math.max(from, to),
      strength: o?.strength === "strong" || o?.strength === "weak" ? o.strength : "moderate",
    };
  }).filter((o: ScheduleObservationAi) => o.headline.length > 0);

  return {
    at: new Date().toISOString(),
    model,
    weeks: total,
    summary: clean(parsed?.summary, 600),
    observations,
    note: clean(parsed?.note, 400) || undefined,
    includedRating: input.weeks.some((w) => w.rating !== undefined),
  };
}

/** Fewer weeks than this and there is nothing to read. Four is the point below
    which "compared with the weeks before it" is comparing with one week. */
export const MIN_READING_WEEKS = 4;

export async function readSchedule(
  conn: Connection, input: ScheduleReadingInput, opts: { signal?: AbortSignal } = {}
): Promise<ScheduleReading> {
  if (input.weeks.length < MIN_READING_WEEKS) {
    throw new AiError(
      "not-enough-data",
      `There ${input.weeks.length === 1 ? "is" : "are"} only ${input.weeks.length} full ${input.weeks.length === 1 ? "week" : "weeks"} of calendar here — not enough for a comparison between weeks to mean anything.`
    );
  }
  const user =
    "Here are the weeks, oldest first. Every value is a count or a number of minutes.\n\n"
    + JSON.stringify(input);
  const { parsed, model } = await runStructured(
    conn,
    { system: READING_SYSTEM, user, schema: READING_SCHEMA, jsonHint: READING_JSON_HINT, maxTokens: 1600 },
    opts.signal
  );
  return normaliseReading(parsed, input, model);
}

export function sanitizeReading(v: unknown): ScheduleReading | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, any>;
  if (typeof r.summary !== "string" && !Array.isArray(r.observations)) return undefined;
  return normaliseReading(
    r,
    { weeks: Array.from({ length: Math.max(0, Math.min(200, Number(r.weeks) || 0)) }, (_, i) => ({ week: i + 1 } as WeekRow)) },
    typeof r.model === "string" ? r.model.slice(0, 80) : ""
  );
}

/* ---------- the local sentence ----------

   What the app says about a week with no model connected at all. It is not a
   fallback in the apologetic sense: most weeks this is the more useful of the
   two, because it is arithmetic somebody can check rather than prose they have
   to trust. */
export function localWeekSentence(w: WeekShape, usual: WeekShape | null): string {
  if (!w.covered) return "";
  if (!w.minutes) return "Nothing was booked this week.";
  const bits: string[] = [`${hoursLabel(w.minutes)} booked across ${w.busyDays} ${w.busyDays === 1 ? "day" : "days"}`];
  if (w.concentration !== null && w.concentration >= 0.8 && w.busyDays > 3) {
    bits.push(`most of it on ${w.busiest ? weekdayOf(w.busiest.date) : "three days"} and two others`);
  }
  if (w.clearDays) bits.push(`${w.clearDays} clear ${w.clearDays === 1 ? "day" : "days"}`);
  if (usual && usual.perDay > 0) {
    const diff = w.perDay - usual.perDay;
    const pct = Math.round((diff / usual.perDay) * 100);
    if (Math.abs(pct) >= 20) bits.push(`about ${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than your usual week`);
    else bits.push("about the same as your usual week");
  }
  const kinds = EVENT_KINDS
    .filter((k) => w.byKind[k] > 0)
    .sort((a, b) => w.byKind[b] - w.byKind[a])
    .slice(0, 2);
  if (kinds.length) {
    bits.push(`mostly ${kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(" and ")}`);
  }
  return `${bits.join(", ")}.`;
}
