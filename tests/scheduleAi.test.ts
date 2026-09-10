/* Asking a model about a calendar.

   Two payloads, two switches, and one rule that matters more than the rest:
   what leaves the device has to be exactly what the confirmation sheet said
   would leave. So these tests read the payload itself and assert what is *not*
   in it as often as what is. */
import { describe, it, expect } from "vitest";
import {
  titlesToAsk, summariseTitleAsk, applyKinds, sanitizeKindMap,
  buildReadingInput, summariseReadingInput, normaliseReading, sanitizeReading,
  localWeekSentence, MIN_READING_WEEKS, readSchedule,
} from "../src/lib/scheduleAi";
import { weekShape, usualWeek, shiftDay, type CalEvent } from "../src/lib/schedule";
import { causalLanguageAudit } from "../src/lib/validate";

const ev = (over: Partial<CalEvent> & { id: string; date: string }): CalEvent => ({
  endDate: over.date, minutes: 60, busy: true, going: "unknown", people: 0,
  kind: "other", kindSource: "rules", source: "google", time: "09:00", endTime: "10:00",
  ...over,
});

describe("which titles get asked about", () => {
  const rows = [
    ev({ id: "a", date: "2025-06-02", title: "Bikram", kind: "other" }),
    ev({ id: "b", date: "2025-06-09", title: "bikram", kind: "other" }),
    ev({ id: "c", date: "2025-06-03", title: "Dentist", kind: "health" }),
    ev({ id: "d", date: "2025-06-04", title: "Anything", kind: "other", kindSource: "user" }),
    ev({ id: "e", date: "2025-06-05", kind: "other" }),
    ev({ id: "f", date: "2025-06-06", title: "Standup w/ the pod", kind: "other" }),
  ];

  it("asks only about the ones nothing local could place", () => {
    const asks = titlesToAsk(rows);
    expect(asks.map((a) => a.title)).toEqual(["Bikram", "Standup w/ the pod"]);
  });

  it("asks once per distinct title, most frequent first", () => {
    expect(titlesToAsk(rows)[0].title).toBe("Bikram"); // twice, so it leads
    expect(titlesToAsk(rows)).toHaveLength(2);
  });

  it("never asks about a title somebody already corrected by hand", () => {
    expect(titlesToAsk(rows).some((a) => a.title === "Anything")).toBe(false);
  });

  it("sends no dates at all — a list of titles is not a diary of movements", () => {
    const payload = JSON.stringify(titlesToAsk(rows));
    expect(payload).not.toContain("2025");
    expect(payload).not.toContain("06-02");
  });

  it("rounds the duration rather than sending the exact figure", () => {
    const asks = titlesToAsk([ev({ id: "x", date: "2025-06-02", title: "Thing", minutes: 47 })]);
    expect(asks[0].minutes).toBe(45);
  });

  it("caps the list, because four hundred distinct titles is a fingerprint", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      ev({ id: `m${i}`, date: "2025-06-02", title: `Title ${i}` }));
    expect(titlesToAsk(many)).toHaveLength(50);
    expect(titlesToAsk(many, 10)).toHaveLength(10);
  });

  it("describes the payload in words before it goes", () => {
    const s = summariseTitleAsk(titlesToAsk(rows));
    expect(s.titles).toBe(2);
    expect(s.approxKB).toBeGreaterThanOrEqual(1);
    expect(s.sample).toContain("Bikram");
  });
});

describe("applying what came back", () => {
  const rows = [
    ev({ id: "a", date: "2025-06-02", title: "Bikram", kind: "other" }),
    ev({ id: "b", date: "2025-06-03", title: "Dentist", kind: "health" }),
    ev({ id: "c", date: "2025-06-04", title: "Bikram", kind: "social", kindSource: "user" }),
  ];

  it("fills in only the blanks, and marks where the answer came from", () => {
    const out = applyKinds(rows, { bikram: "exercise" });
    expect(out[0]).toMatchObject({ kind: "exercise", kindSource: "ai" });
  });

  it("does not overrule a keyword match or a person", () => {
    const out = applyKinds(rows, { bikram: "exercise", dentist: "work" });
    expect(out[1]).toMatchObject({ kind: "health", kindSource: "rules" });
    expect(out[2]).toMatchObject({ kind: "social", kindSource: "user" });
  });

  it("is a no-op with nothing to apply", () => {
    expect(applyKinds(rows, {})).toBe(rows);
    expect(applyKinds(rows, { bikram: "other" as any })[0].kind).toBe("other");
  });

  it("refuses a category it does not have, from a hand-edited backup", () => {
    expect(sanitizeKindMap({ a: "work", b: "hologram", "": "work", c: 3 })).toEqual({ a: "work" });
    expect(sanitizeKindMap(null)).toEqual({});
    const huge = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`k${i}`, "work"]));
    expect(Object.keys(sanitizeKindMap(huge))).toHaveLength(500);
  });
});

/* ---------- the weekly reading ---------- */

const WEEK_ONE = "2025-01-06";

function weeks(n: number) {
  const events: CalEvent[] = [];
  const entries: { date: string; answers: Record<string, number> }[] = [];
  for (let w = 0; w < n; w += 1) {
    for (let d = 0; d < 5; d += 1) {
      const date = shiftDay(WEEK_ONE, w * 7 + d);
      events.push(ev({ id: `e${w}_${d}`, date, time: "09:00", endTime: "11:00", minutes: 120, kind: "work", people: 3, title: "Sync" }));
      entries.push({ date, answers: { fatigue: 5 + (w % 3) } });
    }
  }
  const coverage = { start: WEEK_ONE, end: shiftDay(WEEK_ONE, n * 7 - 1) };
  const shapes = Array.from({ length: n }, (_, i) =>
    weekShape(events, shiftDay(WEEK_ONE, i * 7), { coverage }));
  return { events, entries, shapes, coverage };
}

describe("what the weekly payload contains", () => {
  const { entries, shapes } = weeks(8);

  it("is numbers, ordinals and nothing else", () => {
    const input = buildReadingInput(shapes, entries);
    const text = JSON.stringify(input);
    expect(text).not.toContain("2025");    // no dates
    expect(text).not.toContain("Sync");    // no titles
    expect(text).not.toContain("Mon");     // no weekdays
    expect(input.weeks[0].week).toBe(1);
    expect(input.weeks[0].bookedMinutes).toBe(600);
    expect(input.weeks[0].days).toBe(7);
  });

  it("leaves out categories with nothing in them rather than sending zeros", () => {
    const input = buildReadingInput(shapes, entries);
    expect(Object.keys(input.weeks[0].byKind)).toEqual(["work"]);
  });

  it("includes a rating only when one was chosen, and says which", () => {
    const without = buildReadingInput(shapes, entries);
    expect(without.weeks[0].rating).toBeUndefined();
    expect(without.outcomeLabel).toBeUndefined();

    const withIt = buildReadingInput(shapes, entries, { key: "fatigue", label: "Fatigue", dir: "sym" });
    expect(withIt.weeks[0].rating).toBe(5);
    expect(withIt.weeks[0].ratedDays).toBe(5);
    expect(withIt.outcomeLabel).toBe("Fatigue");
    expect(withIt.outcomeDirection).toBe("sym");
    // Every value in the rows is a number. The label is carried once, beside
    // them, and it is the one the person chose themselves.
    for (const row of withIt.weeks) {
      for (const v of Object.values(row)) {
        if (v === null || typeof v === "number") continue;
        expect(Object.values(v as object).every((n) => typeof n === "number")).toBe(true);
      }
    }
  });

  it("describes itself in words before it goes", () => {
    const s = summariseReadingInput(buildReadingInput(shapes, entries, { key: "fatigue", label: "Fatigue" }));
    expect(s.weeks).toBe(8);
    expect(s.includesRating).toBe(true);
    expect(s.ratingLabel).toBe("Fatigue");
    expect(s.numbers).toBeGreaterThan(50);
    expect(summariseReadingInput(buildReadingInput(shapes, entries)).includesRating).toBe(false);
  });

  it("refuses to run at all on too few weeks", async () => {
    const input = buildReadingInput(shapes.slice(0, MIN_READING_WEEKS - 1), entries);
    await expect(readSchedule({ provider: "gemini", key: "x" }, input))
      .rejects.toMatchObject({ kind: "not-enough-data" });
  });
});

describe("what comes back", () => {
  const { entries, shapes } = weeks(8);
  const input = buildReadingInput(shapes, entries, { key: "fatigue", label: "Fatigue" });

  it("softens causal language the prompt asked the model not to use", () => {
    const r = normaliseReading({
      summary: "Your heaviest week caused the dip that followed.",
      observations: [{ headline: "Meetings trigger your worse days", evidence: "Because of the Tuesday load", strength: "strong" }],
    }, input, "some-model");
    expect(r.summary).not.toMatch(/\bcaused\b/i);
    expect(r.observations[0].headline).not.toMatch(/\btrigger\b/i);
    expect(r.observations[0].evidence).not.toMatch(/\bbecause of\b/i);
    expect(causalLanguageAudit(r)).toEqual([]);
  });

  it("clamps week references to weeks that exist", () => {
    const r = normaliseReading({
      summary: "s",
      observations: [{ headline: "h", evidence: "e", weekFrom: 99, weekTo: -4 }],
    }, input);
    expect(r.observations[0].weekFrom).toBeGreaterThanOrEqual(1);
    expect(r.observations[0].weekTo).toBeLessThanOrEqual(8);
    expect(r.observations[0].weekFrom).toBeLessThanOrEqual(r.observations[0].weekTo);
  });

  it("caps the list and drops the empties", () => {
    const r = normaliseReading({
      summary: "s",
      observations: [
        ...Array.from({ length: 9 }, (_, i) => ({ headline: `h${i}`, evidence: "e" })),
        { headline: "   ", evidence: "e" },
      ],
    }, input);
    expect(r.observations.length).toBeLessThanOrEqual(5);
    expect(r.observations.every((o) => o.headline.trim())).toBe(true);
  });

  it("survives a reply with the wrong shape entirely", () => {
    expect(normaliseReading(null, input).observations).toEqual([]);
    expect(normaliseReading({ observations: "no" }, input).observations).toEqual([]);
    expect(normaliseReading({ summary: 42, observations: [3, null] }, input).summary).toBe("42");
  });

  it("records what it was based on, so a stale reading can be spotted", () => {
    const r = normaliseReading({ summary: "s", observations: [] }, input, "m");
    expect(r.weeks).toBe(8);
    expect(r.includedRating).toBe(true);
    expect(r.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("repairs a reading restored from a hand-editable backup", () => {
    const r = sanitizeReading({ summary: "s", weeks: 8, model: "m", observations: [{ headline: "h", evidence: "e" }] })!;
    expect(r.observations).toHaveLength(1);
    expect(sanitizeReading(null)).toBeUndefined();
    expect(sanitizeReading({ nothing: true })).toBeUndefined();
    expect(sanitizeReading({ summary: "s", weeks: 1e9, observations: [] })!.weeks).toBe(200);
  });
});

describe("the sentence written without a model at all", () => {
  it("describes a week in facts a person can check", () => {
    const { shapes } = weeks(8);
    const usual = usualWeek(shapes);
    const line = localWeekSentence(shapes[7], usual);
    expect(line).toContain("10h booked across 5 days");
    expect(line).toContain("2 clear days");
    expect(line).toContain("mostly work");
    expect(line).toContain("about the same as your usual week");
    expect(causalLanguageAudit(line)).toEqual([]);
  });

  it("says a quiet week is quiet without dressing it up", () => {
    const empty = weekShape([], "2025-06-04", { coverage: { start: "2025-06-02", end: "2025-06-08" } });
    expect(localWeekSentence(empty, null)).toBe("Nothing was booked this week.");
  });

  it("says nothing at all for a week it has no calendar for", () => {
    const none = weekShape([], "2025-06-04", { coverage: { start: "2025-07-01", end: "2025-07-08" } });
    expect(localWeekSentence(none, null)).toBe("");
  });

  it("notices a week well away from the usual one", () => {
    const { events, coverage } = weeks(8);
    const shapes = Array.from({ length: 8 }, (_, i) => weekShape(events, shiftDay(WEEK_ONE, i * 7), { coverage }));
    const heavy = { ...shapes[0], minutes: 3000, perDay: 430, busyDays: 6, clearDays: 1 };
    const line = localWeekSentence(heavy as any, usualWeek(shapes));
    expect(line).toMatch(/about \d+% more than your usual week/);
  });
});
