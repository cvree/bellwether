/* The week around the week — the arithmetic, in full.

   Everything in lib/schedule is pure, which means every judgement call it
   makes can be pinned here rather than discovered later in somebody's record.
   The ones worth the most attention are the three that fail silently:

   · An empty day and a day this journal never saw must not produce the same
     number, or connecting a calendar today invents a free year behind it.
   · An all-day entry must not read as a booked day.
   · A hand correction must outlive a re-sync. */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULE_CONSENT, sanitizeScheduleConsent, sanitizeEvent, sanitizeEvents,
  classifyEvent, normaliseTitle, mergeEvents, forgetTitles, daySegments, dayLoad,
  segmentsOn, mergeIntervals, weekShape, weeksIn, compareWeeks, usualWeek,
  widenCoverage, hasCoverage, sanitizeCoverage, weekStart, weekDates, shiftDay,
  daysBetween, minsOf, hhmm, spanMinutes, hoursLabel, prettyClock, weekLine,
  deltaLine, weekLabel, isCommitment, SCHEDULE_METRICS, SCHEDULE_METRIC_KEYS,
  isScheduleKey, scheduleObservations, heavyWeekObservation, clearDayObservation,
  hardDayObservation, bandObservation, scheduleFactors, SCHEDULE_COPY,
  MIN_SCHEDULE_DAYS, MIN_SCHEDULE_WEEKS, EVENT_KINDS, KIND_LABEL, KIND_DEMAND,
  type CalEvent, type Coverage,
} from "../src/lib/schedule";
import { causalLanguageAudit } from "../src/lib/validate";

/* A minimal well-formed event, so each test only states what it is about. */
const ev = (over: Partial<CalEvent> & { id: string; date: string }): CalEvent => ({
  endDate: over.date,
  minutes: 60,
  busy: true,
  going: "unknown",
  people: 0,
  kind: "other",
  kindSource: "rules",
  source: "ics",
  time: "09:00",
  endTime: "10:00",
  ...over,
});

describe("consent", () => {
  it("is off, with no source, until somebody says otherwise", () => {
    expect(DEFAULT_SCHEDULE_CONSENT.enabled).toBe(false);
    expect(DEFAULT_SCHEDULE_CONSENT.source).toBe("off");
    expect(DEFAULT_SCHEDULE_CONSENT.titles).toBe(false);
    expect(sanitizeScheduleConsent(undefined)).toEqual(DEFAULT_SCHEDULE_CONSENT);
    expect(sanitizeScheduleConsent("nonsense")).toEqual(DEFAULT_SCHEDULE_CONSENT);
  });

  it("cannot leave a model categorising titles that are not being kept", () => {
    const c = sanitizeScheduleConsent({ enabled: true, source: "google", titles: false, aiKinds: true });
    expect(c.aiKinds).toBe(false);
    const d = sanitizeScheduleConsent({ enabled: true, source: "google", titles: true, aiKinds: true });
    expect(d.aiKinds).toBe(true);
  });

  it("reading the week's shape does not need titles, and says so", () => {
    expect(sanitizeScheduleConsent({ titles: false, aiWeeks: true }).aiWeeks).toBe(true);
  });

  it("rejects an unknown source rather than carrying it", () => {
    expect(sanitizeScheduleConsent({ source: "dropbox" }).source).toBe("off");
  });

  it("bounds the calendar list a hand-edited backup can carry", () => {
    const c = sanitizeScheduleConsent({ calendars: [...Array(60)].map((_, i) => `c${i}`).concat([1 as any, ""]) });
    expect(c.calendars).toHaveLength(30);
  });
});

describe("dates", () => {
  it("starts a week on Monday by default and Sunday on request", () => {
    expect(weekStart("2025-06-04")).toBe("2025-06-02");
    expect(weekStart("2025-06-02")).toBe("2025-06-02");
    expect(weekStart("2025-06-01")).toBe("2025-05-26");
    expect(weekStart("2025-06-04", 0)).toBe("2025-06-01");
  });
  it("counts days across a month and a DST change", () => {
    expect(daysBetween("2025-06-01", "2025-06-30")).toBe(29);
    expect(daysBetween("2025-03-29", "2025-03-31")).toBe(2);
    expect(daysBetween("2025-06-10", "2025-06-09")).toBe(-1);
  });
  it("gives seven dates for a week, in order", () => {
    expect(weekDates("2025-06-04")).toEqual([
      "2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06", "2025-06-07", "2025-06-08",
    ]);
  });
  it("reads and writes clock times, refusing impossible ones", () => {
    expect(minsOf("09:30")).toBe(570);
    expect(minsOf("25:00")).toBeUndefined();
    expect(minsOf("9:30")).toBeUndefined();
    expect(hhmm(570)).toBe("09:30");
    expect(hhmm(-5)).toBe("00:00");
    expect(hhmm(99999)).toBe("23:59");
  });
  it("measures a span that crosses midnight", () => {
    expect(spanMinutes("2025-06-10", "22:00", "2025-06-11", "06:00")).toBe(480);
    expect(spanMinutes("2025-06-10", "09:00", "2025-06-10", "10:30")).toBe(90);
    expect(spanMinutes("2025-06-10", undefined, "2025-06-10", "10:30")).toBeUndefined();
  });
  it("never returns a negative span from a file with the ends swapped", () => {
    expect(spanMinutes("2025-06-10", "10:00", "2025-06-10", "09:00")).toBe(0);
  });
});

describe("classifying", () => {
  const kind = (title: string, over: Record<string, unknown> = {}) =>
    classifyEvent({ title, time: "10:00", date: "2025-06-04", ...over });

  it("recognises the categories people actually have", () => {
    expect(kind("Dentist appointment")).toBe("health");
    expect(kind("Physio")).toBe("health");
    expect(kind("Gym")).toBe("exercise");
    expect(kind("Parkrun")).toBe("exercise");
    expect(kind("Flight to Lisbon")).toBe("travel");
    expect(kind("Annual leave")).toBe("rest");
    expect(kind("Dinner with Sam")).toBe("social");
    expect(kind("Haircut")).toBe("admin");
    expect(kind("Deep work")).toBe("focus");
    expect(kind("Sprint planning")).toBe("work");
    expect(kind("1:1 with Ana")).toBe("work");
    expect(kind("Mum's birthday")).toBe("family");
  });

  it("matches whole words, so one category cannot hide inside another", () => {
    expect(kind("Unplanned outage review")).not.toBe("focus");
    expect(kind("Gymnastics fundraiser")).not.toBe("exercise");
  });

  it("calls a weekday meeting with other people work when the title says nothing", () => {
    expect(kind("Zzz", { people: 4 })).toBe("work");
    expect(kind("Zzz", { people: 4, date: "2025-06-07" })).toBe("other"); // a Saturday
    expect(kind("Zzz", { people: 4, time: "21:00" })).toBe("other");
    expect(kind("Zzz", { people: 1 })).toBe("other");
    expect(kind("Zzz", { people: 4, allDay: true })).toBe("other");
  });

  it("answers 'other' rather than guessing, and never throws", () => {
    expect(kind("")).toBe("other");
    expect(classifyEvent({})).toBe("other");
    expect(classifyEvent({ title: "!!! ~~~ 🙂" })).toBe("other");
  });

  it("normalises a title before matching it", () => {
    expect(normaliseTitle("  Dinner, with Sam!  ")).toBe(" dinner with sam ");
  });

  it("has a label and a demand reading for every kind it can produce", () => {
    for (const k of EVENT_KINDS) {
      expect(KIND_LABEL[k]).toBeTruthy();
      expect(KIND_DEMAND[k]).toBeTruthy();
    }
  });
});

describe("sanitising", () => {
  it("repairs an end that lands before the start rather than dropping the day", () => {
    const e = sanitizeEvent({ id: "x", date: "2025-06-10", endDate: "2025-06-09", time: "09:00", endTime: "10:00" })!;
    expect(e.endDate).toBe("2025-06-10");
    expect(e.minutes).toBe(60);
  });
  it("recomputes the duration rather than trusting the one in the file", () => {
    const e = sanitizeEvent({ id: "x", date: "2025-06-10", endDate: "2025-06-10", time: "09:00", endTime: "10:00", minutes: 9999 })!;
    expect(e.minutes).toBe(60);
  });
  it("gives an all-day entry no minutes at all", () => {
    const e = sanitizeEvent({ id: "x", date: "2025-06-10", endDate: "2025-06-12", allDay: true, minutes: 4320 })!;
    expect(e.minutes).toBe(0);
    expect(e.allDay).toBe(true);
  });
  it("drops a row with no id or no usable date", () => {
    expect(sanitizeEvent({ date: "2025-06-10" })).toBeNull();
    expect(sanitizeEvent({ id: "x", date: "yesterday" })).toBeNull();
    expect(sanitizeEvent(null)).toBeNull();
  });
  it("keeps a title only when titles were asked for", () => {
    const row = { id: "x", date: "2025-06-10", time: "09:00", endTime: "10:00", title: "Therapy" };
    expect(sanitizeEvent(row)!.title).toBeUndefined();
    expect(sanitizeEvent(row, { titles: true })!.title).toBe("Therapy");
  });
  it("degrades an unknown kind instead of carrying it into a chart", () => {
    expect(sanitizeEvent({ id: "x", date: "2025-06-10", kind: "hologram" })!.kind).toBe("other");
    expect(sanitizeEvent({ id: "x", date: "2025-06-10", kindSource: "psychic" })!.kindSource).toBe("rules");
  });
  it("deduplicates by id and sorts by when things happened", () => {
    const rows = sanitizeEvents([
      { id: "b", date: "2025-06-11", time: "09:00", endTime: "10:00" },
      { id: "a", date: "2025-06-10", time: "14:00", endTime: "15:00" },
      { id: "a", date: "2025-06-10", time: "09:00", endTime: "10:00" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0].time).toBe("09:00"); // the later row won
  });
  it("returns an empty list for anything that is not a list", () => {
    expect(sanitizeEvents("nope")).toEqual([]);
    expect(sanitizeEvents(null)).toEqual([]);
  });
});

describe("merging a fresh pull", () => {
  const window = { start: "2025-06-01", end: "2025-06-30" };

  it("carries a hand correction across a re-sync", () => {
    const was = [ev({ id: "a", date: "2025-06-10", kind: "focus", kindSource: "user" })];
    const now = [ev({ id: "a", date: "2025-06-10", kind: "work", kindSource: "rules" })];
    const out = mergeEvents(was, now, window);
    expect(out[0].kind).toBe("focus");
    expect(out[0].kindSource).toBe("user");
  });

  it("drops an event that was cancelled in the calendar", () => {
    const was = [ev({ id: "a", date: "2025-06-10" }), ev({ id: "b", date: "2025-06-11" })];
    const out = mergeEvents(was, [ev({ id: "a", date: "2025-06-10" })], window);
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps days outside the window that was pulled", () => {
    const was = [ev({ id: "old", date: "2025-03-02" }), ev({ id: "a", date: "2025-06-10" })];
    const out = mergeEvents(was, [], window);
    expect(out.map((e) => e.id)).toEqual(["old"]);
  });

  it("does not let a pull of one calendar delete another calendar's days", () => {
    const was = [
      ev({ id: "w", date: "2025-06-10", calendarId: "work" }),
      ev({ id: "p", date: "2025-06-10", calendarId: "personal" }),
    ];
    const out = mergeEvents(was, [ev({ id: "w2", date: "2025-06-10", calendarId: "work" })],
      { ...window, calendars: ["work"] });
    expect(out.map((e) => e.id).sort()).toEqual(["p", "w2"]);
  });

  it("without a window, replaces nothing it was not given", () => {
    const was = [ev({ id: "a", date: "2025-06-10" })];
    expect(mergeEvents(was, []).map((e) => e.id)).toEqual(["a"]);
  });

  it("forgets titles for good rather than merely hiding them", () => {
    const rows = forgetTitles([ev({ id: "a", date: "2025-06-10", title: "Therapy" })]);
    expect(rows[0].title).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("Therapy");
  });
});

describe("the caches behind the arithmetic", () => {
  /* Both are keyed on the events array's identity, which is exactly how this
     data moves: React hands the same array back until a write replaces it. The
     risk is the other direction — a cache that answers for the wrong array. */
  it("gives a replaced array its own answer rather than the old one's", () => {
    const before = [ev({ id: "a", date: "2025-06-10", time: "09:00", endTime: "10:00", minutes: 60 })];
    expect(dayLoad(before, "2025-06-10").minutes).toBe(60);
    const after = [...before, ev({ id: "b", date: "2025-06-10", time: "11:00", endTime: "12:00", minutes: 60 })];
    expect(dayLoad(after, "2025-06-10").minutes).toBe(120);
    /* …and the original array still answers for itself. */
    expect(dayLoad(before, "2025-06-10").minutes).toBe(60);
  });

  it("answers the same for a day asked about twice", () => {
    const rows = [ev({ id: "a", date: "2025-06-10", time: "09:00", endTime: "10:00", minutes: 60 })];
    expect(dayLoad(rows, "2025-06-10")).toEqual(dayLoad(rows, "2025-06-10"));
    expect(dayLoad(rows, "2025-06-11").clear).toBe(true);
  });

  it("finds an event on every day it touches, not only the one it starts on", () => {
    const rows = [ev({
      id: "a", date: "2025-06-10", time: "22:00",
      endDate: "2025-06-12", endTime: "02:00", minutes: 1680,
    })];
    expect(dayLoad(rows, "2025-06-10").minutes).toBe(120);
    expect(dayLoad(rows, "2025-06-11").minutes).toBe(1440);
    expect(dayLoad(rows, "2025-06-12").minutes).toBe(120);
  });
});

describe("one day", () => {
  it("splits an event that crosses midnight at midnight", () => {
    const e = ev({ id: "a", date: "2025-06-10", time: "22:00", endDate: "2025-06-11", endTime: "06:00", minutes: 480 });
    const segs = daySegments(e);
    expect(segs.map((s) => [s.date, s.minutes])).toEqual([
      ["2025-06-10", 120], ["2025-06-11", 360],
    ]);
  });

  it("gives an all-day entry a marker on every day and no minutes on any", () => {
    const e = ev({ id: "a", date: "2025-06-09", endDate: "2025-06-11", allDay: true, minutes: 0, time: undefined, endTime: undefined });
    const segs = daySegments(e);
    expect(segs.map((s) => s.date)).toEqual(["2025-06-09", "2025-06-10", "2025-06-11"]);
    expect(segs.every((s) => s.minutes === 0)).toBe(true);
    expect(dayLoad([e], "2025-06-10")).toMatchObject({ minutes: 0, events: 1, allDay: 1, clear: false });
  });

  it("counts a declined invitation and a 'free' marker as no commitment at all", () => {
    const declined = ev({ id: "a", date: "2025-06-10", going: "no" });
    const free = ev({ id: "b", date: "2025-06-10", busy: false, time: "11:00", endTime: "12:00" });
    expect(isCommitment(declined)).toBe(false);
    expect(isCommitment(free)).toBe(false);
    expect(dayLoad([declined, free], "2025-06-10")).toMatchObject({ minutes: 0, events: 0, clear: true });
    expect(segmentsOn([declined, free], "2025-06-10", true)).toHaveLength(2);
  });

  it("reports the day's edges, its longest free stretch and its longest run", () => {
    const d = dayLoad([
      ev({ id: "a", date: "2025-06-10", time: "09:00", endTime: "09:30", minutes: 30 }),
      ev({ id: "b", date: "2025-06-10", time: "09:30", endTime: "10:00", minutes: 30 }),
      ev({ id: "c", date: "2025-06-10", time: "14:00", endTime: "15:00", minutes: 60 }),
    ], "2025-06-10");
    expect(d.firstStart).toBe("09:00");
    expect(d.lastEnd).toBe("15:00");
    expect(d.span).toBe(360);
    expect(d.longestGap).toBe(240);
    expect(d.backToBack).toBe(2);
    expect(d.minutes).toBe(120);
  });

  it("counts a double booking as booked twice but not as a longer day", () => {
    const d = dayLoad([
      ev({ id: "a", date: "2025-06-10", time: "09:00", endTime: "11:00", minutes: 120 }),
      ev({ id: "b", date: "2025-06-10", time: "10:00", endTime: "11:00", minutes: 60 }),
    ], "2025-06-10");
    expect(d.minutes).toBe(180); // three hours of meetings…
    expect(d.span).toBe(120);    // …inside a two-hour window
    expect(d.longestGap).toBe(0);
  });

  it("splits evening and early minutes at the hours it claims to", () => {
    const d = dayLoad([
      ev({ id: "a", date: "2025-06-10", time: "08:00", endTime: "09:30", minutes: 90 }),
      ev({ id: "b", date: "2025-06-10", time: "17:30", endTime: "19:00", minutes: 90 }),
    ], "2025-06-10");
    expect(d.early).toBe(60);   // 08:00–09:00
    expect(d.evening).toBe(60); // 18:00–19:00
  });

  it("measures time with other people, and the biggest room", () => {
    const d = dayLoad([
      ev({ id: "a", date: "2025-06-10", time: "09:00", endTime: "10:00", minutes: 60, people: 8 }),
      ev({ id: "b", date: "2025-06-10", time: "11:00", endTime: "12:00", minutes: 60, people: 1 }),
    ], "2025-06-10");
    expect(d.withOthers).toBe(60);
    expect(d.peakPeople).toBe(8);
  });

  it("calls a day with nothing on it clear, and knows that is not the same as unknown", () => {
    expect(dayLoad([], "2025-06-10").clear).toBe(true);
    const ctx = { events: [ev({ id: "a", date: "2025-06-10" })], coverage: { start: "2025-06-01", end: "2025-06-30" } };
    const minutes = SCHEDULE_METRICS.find((m) => m.k === "cal_minutes")!;
    expect(minutes.value({ ...ctx, date: "2025-06-11" })).toBe(0);
    expect(minutes.value({ ...ctx, date: "2025-05-11" })).toBeNull(); // before coverage
    expect(minutes.value({ events: [], date: "2025-06-11" })).toBeNull();
  });

  it("merges intervals without inventing or losing time", () => {
    expect(mergeIntervals([[0, 10], [5, 20], [30, 40]])).toEqual([[0, 20], [30, 40]]);
    expect(mergeIntervals([[10, 20], [0, 5]])).toEqual([[0, 5], [10, 20]]);
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe("one week", () => {
  const coverage: Coverage = { start: "2025-06-02", end: "2025-06-08" };
  const week = () => [
    ev({ id: "m1", date: "2025-06-02", time: "09:00", endTime: "10:00", minutes: 60, kind: "work", people: 3 }),
    ev({ id: "m2", date: "2025-06-03", time: "09:00", endTime: "12:00", minutes: 180, kind: "work", people: 3 }),
    ev({ id: "g1", date: "2025-06-05", time: "07:00", endTime: "08:00", minutes: 60, kind: "exercise" }),
    ev({ id: "d1", date: "2025-06-07", time: "19:00", endTime: "22:00", minutes: 180, kind: "social", people: 5 }),
  ];

  it("adds a week up without counting days it never saw", () => {
    const w = weekShape(week(), "2025-06-04", { coverage });
    expect(w.start).toBe("2025-06-02");
    expect(w.covered).toBe(7);
    expect(w.minutes).toBe(480);
    expect(w.busyDays).toBe(4);
    expect(w.clearDays).toBe(3);
    expect(w.weekend).toBe(180);
    expect(w.evening).toBe(180);
    expect(w.early).toBe(60);   // only the 7am gym session falls before nine
    expect(w.byKind.work).toBe(240);
    expect(w.perDay).toBe(69);
    expect(w.busiest!.date).toBe("2025-06-03");
    expect(w.quietest!.minutes).toBe(0);
  });

  it("leaves out the days before the calendar was connected", () => {
    const w = weekShape(week(), "2025-06-04", { coverage: { start: "2025-06-05", end: "2025-06-08" } });
    expect(w.covered).toBe(4);
    expect(w.minutes).toBe(240);
    expect(w.days.map((d) => d.date)).toEqual(["2025-06-05", "2025-06-06", "2025-06-07", "2025-06-08"]);
  });

  it("describes how lopsided a week was", () => {
    const even = weekShape(
      [0, 1, 2, 3, 4, 5, 6].map((i) => ev({ id: `e${i}`, date: shiftDay("2025-06-02", i), minutes: 60 })),
      "2025-06-04", { coverage }
    );
    expect(even.concentration).toBeCloseTo(0.43, 2);
    const lumpy = weekShape([ev({ id: "a", date: "2025-06-03", minutes: 60 })], "2025-06-04", { coverage });
    expect(lumpy.concentration).toBe(1);
    expect(weekShape([], "2025-06-04", { coverage }).concentration).toBeNull();
  });

  it("produces no weeks at all without coverage, and skips part-weeks", () => {
    expect(weeksIn(week(), undefined)).toEqual([]);
    const weeks = weeksIn(week(), { start: "2025-06-06", end: "2025-06-20" });
    // The first week is only covered from the Friday, so it is not a week.
    expect(weeks.map((w) => w.start)).toEqual(["2025-06-09", "2025-06-16"]);
  });
});

describe("comparing weeks", () => {
  const mk = (start: string, mins: number, clear: number) =>
    weekShape(
      [ev({ id: `x${start}`, date: shiftDay(start, 1), time: "09:00", endTime: hhmm(540 + mins), minutes: mins })],
      start, { coverage: { start, end: shiftDay(start, 6) } }
    ) && { ...weekShape([], start, { coverage: { start, end: shiftDay(start, 6) } }), minutes: mins, clearDays: clear, covered: 7 };

  it("puts the biggest proportional change first", () => {
    const now = { ...mk("2025-06-09", 600, 2), evening: 120, early: 0, weekend: 0, withOthers: 0, events: 10, longestRun: 3 };
    const then = { ...mk("2025-06-02", 300, 4), evening: 10, early: 0, weekend: 0, withOthers: 0, events: 8, longestRun: 3 };
    const deltas = compareWeeks(now as any, then as any);
    expect(deltas[0].key).toBe("evening");
    const minutes = deltas.find((d) => d.key === "minutes")!;
    expect(minutes.diff).toBe(300);
    expect(minutes.ratio).toBe(1);
  });

  it("scales a short week per covered day, but never invents half a clear day", () => {
    const now = { ...mk("2025-06-09", 600, 2), covered: 7, events: 10, evening: 0, early: 0, weekend: 0, withOthers: 0, longestRun: 1 };
    const then = { ...mk("2025-06-02", 300, 2), covered: 4, events: 4, evening: 0, early: 0, weekend: 0, withOthers: 0, longestRun: 1 };
    const deltas = compareWeeks(now as any, then as any);
    expect(deltas.find((d) => d.key === "minutes")!.then).toBe(525); // 300 × 7/4
    expect(deltas.find((d) => d.key === "clearDays")!.then).toBe(2); // unscaled
  });

  it("has no ratio to report when the earlier week was zero", () => {
    const now = { ...mk("2025-06-09", 600, 0), evening: 60, early: 0, weekend: 0, withOthers: 0, events: 1, longestRun: 1 };
    const then = { ...mk("2025-06-02", 0, 7), evening: 0, early: 0, weekend: 0, withOthers: 0, events: 0, longestRun: 0 };
    expect(compareWeeks(now as any, then as any).find((d) => d.key === "evening")!.ratio).toBeNull();
  });

  it("takes the median of each field rather than of whole weeks", () => {
    const weeks = [100, 200, 900].map((m, i) => ({
      ...weekShape([], shiftDay("2025-06-02", i * 7), { coverage: { start: "2025-06-02", end: "2025-06-30" } }),
      minutes: m, covered: 7, events: m / 100,
    }));
    const usual = usualWeek(weeks as any)!;
    expect(usual.minutes).toBe(200);   // not the mean, which would be 400
    expect(usual.perDay).toBe(29);
  });

  it("will not describe a usual week from fewer than three", () => {
    expect(usualWeek([])).toBeNull();
    expect(usualWeek([{} as any, {} as any])).toBeNull();
  });
});

describe("coverage", () => {
  it("widens rather than replaces, and repairs a backwards range", () => {
    expect(widenCoverage(undefined, { start: "2025-06-01", end: "2025-06-30" }))
      .toEqual({ start: "2025-06-01", end: "2025-06-30" });
    expect(widenCoverage({ start: "2025-06-01", end: "2025-06-30" }, { start: "2025-05-01", end: "2025-06-10" }))
      .toEqual({ start: "2025-05-01", end: "2025-06-30" });
    expect(sanitizeCoverage({ start: "2025-06-30", end: "2025-06-01" }))
      .toEqual({ start: "2025-06-01", end: "2025-06-30" });
    expect(sanitizeCoverage({ start: "junk", end: "2025-06-01" })).toBeUndefined();
    expect(sanitizeCoverage(null)).toBeUndefined();
  });
  it("knows which days it can speak for", () => {
    const c = { start: "2025-06-01", end: "2025-06-30" };
    expect(hasCoverage(c, "2025-06-15")).toBe(true);
    expect(hasCoverage(c, "2025-05-31")).toBe(false);
    expect(hasCoverage(undefined, "2025-06-15")).toBe(false);
  });
});

describe("metrics", () => {
  it("offers one number per day, all of them neutral", () => {
    expect(SCHEDULE_METRICS.every((m) => m.dir === "neutral")).toBe(true);
    expect(SCHEDULE_METRICS.every((m) => m.sec === "Schedule")).toBe(true);
    expect(new Set(SCHEDULE_METRIC_KEYS).size).toBe(SCHEDULE_METRIC_KEYS.length);
    expect(SCHEDULE_METRIC_KEYS.every((k) => k.startsWith("cal_"))).toBe(true);
    expect(isScheduleKey("cal_minutes")).toBe(true);
    expect(isScheduleKey("env_temp_max")).toBe(false);
  });

  it("answers null everywhere when there is no calendar, never zero", () => {
    for (const m of SCHEDULE_METRICS) {
      expect(m.value({ date: "2025-06-10" })).toBeNull();
    }
  });

  it("reads a real day the way the day reads", () => {
    const ctx = {
      events: [
        ev({ id: "a", date: "2025-06-10", time: "09:00", endTime: "10:00", minutes: 60, kind: "work", people: 4 }),
        ev({ id: "b", date: "2025-06-10", time: "19:00", endTime: "20:30", minutes: 90, kind: "social", people: 2 }),
      ],
      coverage: { start: "2025-06-01", end: "2025-06-30" },
      date: "2025-06-10",
    };
    const get = (k: string) => SCHEDULE_METRICS.find((m) => m.k === k)!.value(ctx);
    expect(get("cal_minutes")).toBe(150);
    expect(get("cal_events")).toBe(2);
    expect(get("cal_first")).toBe(540);
    expect(get("cal_last")).toBe(1230);
    expect(get("cal_evening")).toBe(90);
    expect(get("cal_gap")).toBe(540);
    expect(get("cal_people")).toBe(150);
    expect(get("cal_peak_people")).toBe(4);
    expect(get("cal_k_work")).toBe(60);
    expect(get("cal_k_social")).toBe(90);
  });
});

/* ---------- observations ----------

   Built from a synthetic year in which heavy days really are worse days, so
   the tests can check that the finding appears, says the right thing, and —
   the part that matters more — refuses to appear on thin or flat data. */

const YEAR_START = "2025-01-06"; // a Monday

function synthetic(opts: { days: number; related: boolean }) {
  const events: CalEvent[] = [];
  const entries: { date: string; answers: Record<string, number> }[] = [];
  for (let i = 0; i < opts.days; i += 1) {
    const date = shiftDay(YEAR_START, i);
    /* Every third day is heavy: four hours booked instead of nothing. */
    const heavy = i % 3 === 0;
    if (heavy) {
      events.push(ev({ id: `h${i}`, date, time: "09:00", endTime: "13:00", minutes: 240, kind: "work", people: 4 }));
    }
    entries.push({ date, answers: { pain: opts.related ? (heavy ? 7 : 3) : 5 } });
  }
  return { events, entries, coverage: { start: YEAR_START, end: shiftDay(YEAR_START, opts.days - 1) } };
}

describe("observations", () => {
  const outcome = { key: "pain", label: "Pain", dir: "sym" as const };

  it("says nothing at all below the day minimum", () => {
    const s = synthetic({ days: MIN_SCHEDULE_DAYS - 1, related: true });
    expect(scheduleObservations(s.entries, s.events, s.coverage, [], outcome)).toEqual([]);
  });

  it("says nothing when the days are all alike", () => {
    const s = synthetic({ days: 120, related: false });
    expect(scheduleObservations(s.entries, s.events, s.coverage, [], outcome)).toEqual([]);
  });

  it("finds the clear-day difference and counts both sides in the sentence", () => {
    const s = synthetic({ days: 120, related: true });
    const o = clearDayObservation(s.entries, s.events, s.coverage, outcome)!;
    expect(o.headline).toContain("4 points lower");
    expect(o.headline).toContain("nothing in the calendar");
    expect(o.detail).toMatch(/\d+ days with nothing booked and \d+ with something/);
    expect(o.dates.length).toBeGreaterThan(8);
    expect(o.scope).toBe("day");
  });

  it("finds the hardest days on one side of the median", () => {
    const s = synthetic({ days: 120, related: true });
    const o = hardDayObservation(s.entries, s.events, s.coverage, outcome, scheduleFactors()[0])!;
    expect(o.headline).toMatch(/^\d+ of your \d+ hardest days had (more than|no more than) /);
    expect(o.observed).toBe(120);
  });

  it("refuses a factor that never varied", () => {
    const s = synthetic({ days: 120, related: true });
    const flat = { key: "flat", label: "flat", get: () => 5, format: String };
    expect(hardDayObservation(s.entries, s.events, s.coverage, outcome, flat)).toBeNull();
    expect(bandObservation(s.entries, s.events, s.coverage, outcome, flat)).toBeNull();
  });

  it("counts only the days the calendar actually covers", () => {
    const s = synthetic({ days: 120, related: true });
    const half = { start: YEAR_START, end: shiftDay(YEAR_START, 39) };
    const o = clearDayObservation(s.entries, s.events, half, outcome)!;
    expect(o.observed).toBe(40);
  });

  it("compares busy weeks with quiet ones, and needs enough weeks to do it", () => {
    const s = synthetic({ days: 210, related: false });
    /* Make whole weeks differ rather than whole days. */
    const events: CalEvent[] = [];
    const entries: { date: string; answers: Record<string, number> }[] = [];
    for (let i = 0; i < 210; i += 1) {
      const date = shiftDay(YEAR_START, i);
      const heavyWeek = Math.floor(i / 7) % 2 === 0;
      if (heavyWeek) events.push(ev({ id: `w${i}`, date, time: "09:00", endTime: "15:00", minutes: 360 }));
      entries.push({ date, answers: { pain: heavyWeek ? 7 : 4 } });
    }
    const coverage = { start: YEAR_START, end: shiftDay(YEAR_START, 209) };
    const weeks = weeksIn(events, coverage);
    expect(weeks.length).toBe(30);
    const o = heavyWeekObservation(entries, weeks, outcome)!;
    expect(o.headline).toMatch(/^Your \d+ busiest weeks averaged 3 points higher pain than your \d+ quietest\.$/);
    expect(o.scope).toBe("week");
    expect(heavyWeekObservation(entries, weeks.slice(0, MIN_SCHEDULE_WEEKS - 1), outcome)).toBeNull();
    void s;
  });

  it("caps the list, so it cannot become a horoscope", () => {
    const s = synthetic({ days: 300, related: true });
    const weeks = weeksIn(s.events, s.coverage);
    expect(scheduleObservations(s.entries, s.events, s.coverage, weeks, outcome, 3).length).toBeLessThanOrEqual(3);
  });

  it("never says one thing caused another, anywhere in the vocabulary", () => {
    const s = synthetic({ days: 300, related: true });
    const weeks = weeksIn(s.events, s.coverage);
    const all = scheduleObservations(s.entries, s.events, s.coverage, weeks, outcome, 3);
    expect(all.length).toBeGreaterThan(0);
    expect(causalLanguageAudit(all)).toEqual([]);
    expect(causalLanguageAudit(SCHEDULE_COPY)).toEqual([]);
    const text = JSON.stringify([all, SCHEDULE_COPY]).toLowerCase();
    for (const word of ["because", "due to", "leads to", "makes you", "triggers", "result of"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("words and numbers people read", () => {
  it("writes minutes as a person would say them", () => {
    expect(hoursLabel(45)).toBe("45m");
    expect(hoursLabel(60)).toBe("1h");
    expect(hoursLabel(200)).toBe("3h 20m");
    expect(hoursLabel(null)).toBe("—");
    expect(hoursLabel(NaN)).toBe("—");
  });
  it("writes a clock time in twelves", () => {
    expect(prettyClock("09:15")).toBe("9:15 am");
    expect(prettyClock("00:05")).toBe("12:05 am");
    expect(prettyClock("13:00")).toBe("1:00 pm");
    expect(prettyClock("25:00")).toBe("");
    expect(prettyClock(undefined)).toBe("");
  });
  it("summarises a week in three facts rather than a score", () => {
    const w = weekShape([
      ev({ id: "a", date: "2025-06-03", time: "09:00", endTime: "12:00", minutes: 180 }),
    ], "2025-06-04", { coverage: { start: "2025-06-02", end: "2025-06-08" } });
    expect(weekLine(w)).toBe("3h booked · 6 clear days · busiest Tue");
    expect(weekLabel(w.start, w.end)).toContain("–");
  });
  it("says which way a difference went", () => {
    expect(deltaLine({ key: "minutes", label: "", now: 0, then: 0, diff: 120, ratio: 1, unit: "min" })).toBe("2h more");
    expect(deltaLine({ key: "clearDays", label: "", now: 0, then: 0, diff: -2, ratio: -1, unit: "days" })).toBe("2 fewer");
    expect(deltaLine({ key: "minutes", label: "", now: 0, then: 0, diff: 0, ratio: 0, unit: "min" })).toBe("the same");
  });
});
