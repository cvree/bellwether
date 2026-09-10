/* The .ics parser — the account-free way in.

   The cases here are the ones that decide whether a real exported calendar
   arrives intact or arrives wrong in a way nobody notices: folded lines,
   the three shapes a timestamp can take, an all-day end that is exclusive,
   and above all recurrence, without which a working calendar imports as an
   almost empty one. */
import { describe, it, expect } from "vitest";
import {
  unfold, parseLine, unescapeText, parseMoment, parseDuration, parseRrule,
  expandRrule, parseIcs, hashId, zonedToInstant,
} from "../src/lib/ics";
import { dayLoad, weekShape } from "../src/lib/schedule";

const WINDOW = { start: "2025-06-01", end: "2025-06-30" };

const cal = (...body: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...body, "END:VCALENDAR"].join("\r\n");

const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];

describe("line handling", () => {
  it("unfolds continuation lines onto the property they belong to", () => {
    const lines = unfold("SUMMARY:Quarterly planning\r\n  with the wider team\r\nDTSTART:20250602");
    expect(lines[0]).toBe("SUMMARY:Quarterly planning with the wider team");
    expect(lines[1]).toBe("DTSTART:20250602");
  });

  it("handles a tab continuation and bare newlines too", () => {
    // The fold character is removed and nothing is put in its place — a fold
    // can land mid-word, so inserting a space would corrupt the title.
    expect(unfold("SUMMARY:One\n\ttwo")[0]).toBe("SUMMARY:Onetwo");
    expect(unfold("SUMMARY:One \n\ttwo")[0]).toBe("SUMMARY:One two");
  });

  it("splits parameters without being fooled by a quoted colon", () => {
    const p = parseLine('ATTENDEE;CN="Smith, John: Dr";PARTSTAT=ACCEPTED:mailto:j@x.com');
    expect(p!.name).toBe("ATTENDEE");
    expect(p!.params.CN).toBe("Smith, John: Dr");
    expect(p!.params.PARTSTAT).toBe("ACCEPTED");
    expect(p!.value).toBe("mailto:j@x.com");
  });

  it("returns null for a line with no value at all", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("NOCOLONHERE")).toBeNull();
  });

  it("unescapes the text escapes the format actually uses", () => {
    expect(unescapeText("Dinner\\, then\; drinks\\nwith Sam")).toBe("Dinner, then; drinks with Sam");
  });
});

describe("moments", () => {
  it("reads a DATE as an all-day local date", () => {
    const m = parseMoment("20250612", { VALUE: "DATE" })!;
    expect(m.allDay).toBe(true);
    expect(m.date).toBe("2025-06-12");
    expect(m.time).toBeUndefined();
  });

  it("reads a floating time as this device's wall clock", () => {
    const m = parseMoment("20250612T090000")!;
    expect(m.date).toBe("2025-06-12");
    expect(m.time).toBe("09:00");
  });

  it("converts a UTC instant into local", () => {
    const m = parseMoment("20250612T090000Z")!;
    const d = new Date(Date.UTC(2025, 5, 12, 9, 0, 0));
    expect(m.date).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  });

  it("resolves a named zone through Intl, both sides of a DST change", () => {
    // 09:00 New York in January is 14:00 UTC; in July it is 13:00 UTC.
    const winter = zonedToInstant(2025, 1, 15, 9, 0, 0, "America/New_York")!;
    const summer = zonedToInstant(2025, 7, 15, 9, 0, 0, "America/New_York")!;
    expect(winter.toISOString()).toBe("2025-01-15T14:00:00.000Z");
    expect(summer.toISOString()).toBe("2025-07-15T13:00:00.000Z");
  });

  it("falls back to floating time when the zone name is one Intl does not know", () => {
    const m = parseMoment("20250612T090000", { TZID: "GMT Standard Time" })!;
    expect(m.time).toBe("09:00"); // Outlook's own name, read as local rather than dropped
  });

  it("rejects a value that is not a timestamp at all", () => {
    expect(parseMoment("tomorrow")).toBeNull();
  });
});

describe("durations", () => {
  it("reads the forms iCalendar actually emits", () => {
    expect(parseDuration("PT45M")).toBe(45);
    expect(parseDuration("PT1H30M")).toBe(90);
    expect(parseDuration("P1DT2H")).toBe(1560);
    expect(parseDuration("P2W")).toBe(20160);
    expect(parseDuration("-PT15M")).toBe(-15);
  });
  it("returns null rather than zero for nonsense", () => {
    expect(parseDuration("half an hour")).toBeNull();
  });
});

describe("repeat rules", () => {
  const from = new Date(2025, 5, 1);
  const to = new Date(2025, 5, 30, 23, 59);

  it("expands a weekly rule on named days", () => {
    const rule = parseRrule("FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1")!;
    const days = expandRrule(new Date(2025, 5, 2, 9, 0), rule, from, to)
      .map((d) => `${d.getDate()}`);
    expect(days).toEqual(["2", "4", "9", "11", "16", "18", "23", "25", "30"]);
  });

  it("honours COUNT", () => {
    const rule = parseRrule("FREQ=DAILY;COUNT=3")!;
    expect(expandRrule(new Date(2025, 5, 2, 9, 0), rule, from, to)).toHaveLength(3);
  });

  it("honours UNTIL", () => {
    const rule = parseRrule("FREQ=DAILY;UNTIL=20250605T235959Z")!;
    const out = expandRrule(new Date(2025, 5, 2, 9, 0), rule, from, to);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out[out.length - 1].getDate()).toBeLessThanOrEqual(5);
  });

  it("honours INTERVAL on a fortnightly rule", () => {
    const rule = parseRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")!;
    const days = expandRrule(new Date(2025, 5, 3, 9, 0), rule, from, to).map((d) => d.getDate());
    expect(days).toEqual([3, 17]);
  });

  it("expands 'the first Monday of the month'", () => {
    const rule = parseRrule("FREQ=MONTHLY;BYDAY=1MO")!;
    const out = expandRrule(new Date(2025, 5, 2, 9, 0), rule, new Date(2025, 5, 1), new Date(2025, 8, 30));
    expect(out.map((d) => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual(["6-2", "7-7", "8-4", "9-1"]);
  });

  it("expands 'the last Friday of the month'", () => {
    const rule = parseRrule("FREQ=MONTHLY;BYDAY=-1FR")!;
    const out = expandRrule(new Date(2025, 5, 27, 9, 0), rule, new Date(2025, 5, 1), new Date(2025, 7, 31));
    expect(out.map((d) => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual(["6-27", "7-25", "8-29"]);
  });

  it("skips a monthly occurrence in a month that has no such date", () => {
    const rule = parseRrule("FREQ=MONTHLY")!;
    const out = expandRrule(new Date(2025, 0, 31, 9, 0), rule, new Date(2025, 0, 1), new Date(2025, 3, 30));
    // 31 Jan, no 31 Feb, no 31 Apr — March survives.
    expect(out.map((d) => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual(["1-31", "3-31"]);
  });

  it("emits only the first occurrence for a rule it cannot faithfully expand", () => {
    const rule = parseRrule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2")!;
    expect(rule.unsupported).toBe(true);
    const out = expandRrule(new Date(2025, 5, 9, 9, 0), rule, from, to);
    expect(out).toHaveLength(1);
  });

  it("reaches a window years after the series began without exhausting itself", () => {
    const rule = parseRrule("FREQ=DAILY")!;
    const out = expandRrule(new Date(2015, 0, 1, 9, 30), rule, from, to);
    expect(out).toHaveLength(30);
    expect(out[0].getHours()).toBe(9);
  });

  it("returns nothing rather than looping when the rule cannot be read", () => {
    expect(parseRrule("FREQ=FORTNIGHTLY")).toBeNull();
  });
});

describe("whole documents", () => {
  it("reads a plain timed event with its duration", () => {
    const text = cal(...vevent(
      "UID:a1@example.com",
      "SUMMARY:Physio appointment",
      "DTSTART:20250603T140000",
      "DTEND:20250603T145000"
    ));
    const r = parseIcs(text, { ...WINDOW, titles: true });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      date: "2025-06-03", time: "14:00", endTime: "14:50", minutes: 50,
      kind: "health", title: "Physio appointment", source: "ics",
    });
  });

  it("keeps no title at all unless titles are switched on", () => {
    const text = cal(...vevent("UID:a2", "SUMMARY:Board meeting", "DTSTART:20250603T140000", "DTEND:20250603T150000"));
    const r = parseIcs(text, WINDOW);
    expect(r.events[0].title).toBeUndefined();
    // …and the category worked out from the title survives anyway. That is the
    // whole point of classifying at the boundary.
    expect(r.events[0].kind).toBe("work");
  });

  it("treats an all-day DTEND as exclusive and stores no minutes for it", () => {
    const text = cal(...vevent(
      "UID:a3", "SUMMARY:Annual leave",
      "DTSTART;VALUE=DATE:20250609", "DTEND;VALUE=DATE:20250614"
    ));
    const r = parseIcs(text, { ...WINDOW, titles: true });
    expect(r.events[0]).toMatchObject({
      date: "2025-06-09", endDate: "2025-06-13", allDay: true, minutes: 0, kind: "rest",
    });
  });

  it("counts attendees without reading them, and adds the organiser", () => {
    const text = cal(...vevent(
      "UID:a4", "SUMMARY:Sprint planning", "DTSTART:20250603T100000", "DTEND:20250603T110000",
      "ORGANIZER;CN=Ana:mailto:ana@x.com",
      "ATTENDEE;CN=Bo:mailto:bo@x.com", "ATTENDEE;CN=Cy:mailto:cy@x.com"
    ));
    const r = parseIcs(text, WINDOW);
    expect(r.events[0].people).toBe(3);
    expect(JSON.stringify(r.events)).not.toContain("bo@x.com");
    expect(JSON.stringify(r.events)).not.toContain("Bo");
  });

  it("marks a transparent event as not busy", () => {
    const text = cal(...vevent("UID:a5", "DTSTART:20250603T100000", "DTEND:20250603T110000", "TRANSP:TRANSPARENT"));
    expect(parseIcs(text, WINDOW).events[0].busy).toBe(false);
  });

  it("drops a cancelled event and says so", () => {
    const text = cal(...vevent("UID:a6", "DTSTART:20250603T100000", "DTEND:20250603T110000", "STATUS:CANCELLED"));
    const r = parseIcs(text, WINDOW);
    expect(r.events).toHaveLength(0);
    expect(r.skipped).toEqual([{ reason: "cancelled", n: 1 }]);
  });

  it("does not mistake an alarm inside an event for another event", () => {
    const text = cal(...vevent(
      "UID:a7", "DTSTART:20250603T100000", "DTEND:20250603T110000",
      "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "END:VALARM"
    ));
    expect(parseIcs(text, WINDOW).events).toHaveLength(1);
  });

  it("reads past a VTIMEZONE block instead of into it", () => {
    const text = cal(
      "BEGIN:VTIMEZONE", "TZID:Europe/London",
      "BEGIN:DAYLIGHT", "DTSTART:19700329T010000", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "END:DAYLIGHT",
      "END:VTIMEZONE",
      ...vevent("UID:a8", "DTSTART;TZID=Europe/London:20250603T100000", "DTEND;TZID=Europe/London:20250603T110000")
    );
    const r = parseIcs(text, WINDOW);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].minutes).toBe(60);
  });

  it("expands a weekly standup into every instance in the window", () => {
    const text = cal(...vevent(
      "UID:a9", "SUMMARY:Team standup",
      "DTSTART:20250602T091500", "DTEND:20250602T093000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    ));
    const r = parseIcs(text, { ...WINDOW, titles: true });
    expect(r.events.length).toBe(21); // weekdays in June 2025
    expect(new Set(r.events.map((e) => e.minutes))).toEqual(new Set([15]));
    expect(new Set(r.events.map((e) => e.id)).size).toBe(21); // every instance distinct
    expect(r.events.every((e) => e.repeating)).toBe(true);
  });

  it("applies EXDATE so a cancelled instance never appears", () => {
    const text = cal(...vevent(
      "UID:b1", "SUMMARY:Standup",
      "DTSTART:20250602T091500", "DTEND:20250602T093000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20250609T091500"
    ));
    const dates = parseIcs(text, WINDOW).events.map((e) => e.date);
    expect(dates).toEqual(["2025-06-02", "2025-06-16", "2025-06-23", "2025-06-30"]);
  });

  it("does not double-book an instance that was individually moved", () => {
    const text = cal(
      ...vevent(
        "UID:b2", "SUMMARY:Standup",
        "DTSTART:20250602T091500", "DTEND:20250602T093000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO"
      ),
      ...vevent(
        "UID:b2", "SUMMARY:Standup (moved)",
        "RECURRENCE-ID:20250609T091500",
        "DTSTART:20250609T160000", "DTEND:20250609T161500"
      )
    );
    const onTheNinth = parseIcs(text, WINDOW).events.filter((e) => e.date === "2025-06-09");
    expect(onTheNinth).toHaveLength(1);
    expect(onTheNinth[0].time).toBe("16:00");
  });

  it("gives the same file the same ids every time, so a re-import updates", () => {
    const text = cal(...vevent("UID:b3", "DTSTART:20250603T100000", "DTEND:20250603T110000"));
    const a = parseIcs(text, WINDOW).events.map((e) => e.id);
    const b = parseIcs(text, WINDOW).events.map((e) => e.id);
    expect(a).toEqual(b);
    // …and a different calendar id makes them different rows, so two imported
    // calendars containing the same meeting do not silently collapse into one.
    const c = parseIcs(text, { ...WINDOW, calendarId: "work" }).events.map((e) => e.id);
    expect(c).not.toEqual(a);
  });

  it("picks up the calendar's own name when it has one", () => {
    const text = cal("X-WR-CALNAME:Work", ...vevent("UID:b4", "DTSTART:20250603T100000", "DTEND:20250603T110000"));
    expect(parseIcs(text, WINDOW).name).toBe("Work");
  });

  it("survives a truncated file without throwing", () => {
    expect(() => parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:2025", WINDOW)).not.toThrow();
    expect(parseIcs("", WINDOW).events).toEqual([]);
    expect(parseIcs("not a calendar at all", WINDOW).events).toEqual([]);
  });

  it("splits an overnight flight across the two days it actually covers", () => {
    const text = cal(...vevent(
      "UID:b5", "SUMMARY:Flight to Lisbon",
      "DTSTART:20250610T220000", "DTEND:20250611T060000"
    ));
    const events = parseIcs(text, { ...WINDOW, titles: true }).events;
    expect(dayLoad(events, "2025-06-10").minutes).toBe(120);
    expect(dayLoad(events, "2025-06-11").minutes).toBe(360);
  });

  it("turns a realistic week into a shape without any of it going missing", () => {
    const text = cal(
      ...vevent("UID:c1", "SUMMARY:Standup", "DTSTART:20250602T091500", "DTEND:20250602T093000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "ATTENDEE:mailto:a@x", "ATTENDEE:mailto:b@x"),
      ...vevent("UID:c2", "SUMMARY:Deep work", "DTSTART:20250603T100000", "DTEND:20250603T123000"),
      ...vevent("UID:c3", "SUMMARY:Dentist", "DTSTART:20250604T083000", "DTEND:20250604T091500"),
      ...vevent("UID:c4", "SUMMARY:Dinner with Sam", "DTSTART:20250606T190000", "DTEND:20250606T220000"),
      ...vevent("UID:c5", "SUMMARY:Bank holiday", "DTSTART;VALUE=DATE:20250607", "DTEND;VALUE=DATE:20250608")
    );
    const { events } = parseIcs(text, { ...WINDOW, titles: true });
    const w = weekShape(events, "2025-06-04", { coverage: WINDOW });
    expect(w.start).toBe("2025-06-02");
    expect(w.byKind.work).toBe(75);        // five standups
    expect(w.byKind.focus).toBe(150);
    expect(w.byKind.health).toBe(45);
    expect(w.byKind.social).toBe(180);
    expect(w.evening).toBe(180);           // the dinner, all of it after 6pm
    expect(w.early).toBe(30);              // the dentist, the half hour before 9
    expect(w.clearDays).toBe(1);           // Sunday; the bank holiday is not clear
    expect(w.busiest!.date).toBe("2025-06-06");
  });
});

describe("id hashing", () => {
  it("is stable and distinguishes near-identical inputs", () => {
    expect(hashId("a")).toBe(hashId("a"));
    expect(hashId("a")).not.toBe(hashId("b"));
    expect(hashId("uid|2025-06-02T09:15|")).not.toBe(hashId("uid|2025-06-09T09:15|"));
  });
});
