/* The week screen, through the actual UI.

   The module tests pin the arithmetic; these pin that the screen honours it.
   The ones that matter most are negative:

   · With titles off, no title reaches the DOM — not in the day list, not in a
     label, not in an aria attribute.
   · Nothing reaches a model until the switch for that specific payload is on,
     and the screen says what each switch would send before it is flicked.
   · A day the calendar never covered is drawn as unknown, not as empty. */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import ScheduleScreen from "../src/components/ScheduleScreen";
import {
  DEFAULT_SCHEDULE_CONSENT, shiftDay, weekStart,
  type CalEvent, type ScheduleConsent,
} from "../src/lib/schedule";

beforeEach(() => cleanup());
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({
    matches: q.includes("reduce"), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  } as any));
  window.scrollTo = vi.fn();
});

const TODAY = "2025-06-12"; // a Thursday
const MONDAY = weekStart(TODAY);

const ev = (over: Partial<CalEvent> & { id: string; date: string }): CalEvent => ({
  endDate: over.date, minutes: 60, busy: true, going: "unknown", people: 0,
  kind: "other", kindSource: "rules", source: "google", time: "09:00", endTime: "10:00",
  ...over,
});

const connected = (over: Partial<ScheduleConsent> = {}): ScheduleConsent => ({
  ...DEFAULT_SCHEDULE_CONSENT, enabled: true, source: "google", ...over,
});

const week: CalEvent[] = [
  ev({ id: "a", date: MONDAY, time: "09:00", endTime: "12:00", minutes: 180, kind: "work", people: 4, title: "Sprint planning" }),
  ev({ id: "b", date: shiftDay(MONDAY, 1), time: "07:00", endTime: "08:00", minutes: 60, kind: "exercise", title: "Gym" }),
  ev({ id: "c", date: shiftDay(MONDAY, 3), time: "19:00", endTime: "22:00", minutes: 180, kind: "social", people: 5, title: "Dinner with Sam" }),
  ev({ id: "d", date: shiftDay(MONDAY, 2), allDay: true, minutes: 0, time: undefined, endTime: undefined, kind: "rest", title: "Bank holiday" }),
];
const coverage = { start: shiftDay(MONDAY, -60), end: shiftDay(MONDAY, 6) };

const mount = (props: Partial<React.ComponentProps<typeof ScheduleScreen>> = {}) =>
  render(
    <ScheduleScreen
      consent={connected()} events={week} coverage={coverage} entries={[]} today={TODAY}
      {...props}
    />
  );

describe("before anything is connected", () => {
  it("says what it would keep, and that titles are not part of it", () => {
    render(<ScheduleScreen consent={DEFAULT_SCHEDULE_CONSENT} events={[]} entries={[]} today={TODAY} />);
    expect(screen.getByText(/Not the titles/i)).toBeTruthy();
    expect(screen.getByText(/Titles are not stored/i)).toBeTruthy();
  });

  it("offers the file route, which needs no account, alongside Google", () => {
    render(<ScheduleScreen consent={DEFAULT_SCHEDULE_CONSENT} events={[]} entries={[]} today={TODAY} />);
    expect(screen.getByRole("button", { name: "A calendar file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Google Calendar" })).toBeTruthy();
  });

  it("leads with the file route when this build has no Google client id", () => {
    render(<ScheduleScreen consent={DEFAULT_SCHEDULE_CONSENT} events={[]} entries={[]} today={TODAY} canGoogle={false} />);
    expect(screen.getByRole("button", { name: /Choose a calendar file/i })).toBeTruthy();
  });

  it("explains how to make a client id rather than dead-ending", () => {
    render(<ScheduleScreen consent={DEFAULT_SCHEDULE_CONSENT} events={[]} entries={[]} today={TODAY} canGoogle={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Google Calendar/i }));
    expect(screen.getByText(/Google Cloud console/i)).toBeTruthy();
    // …and will not try to connect with a paste of the wrong thing.
    const field = screen.getByLabelText(/Google client ID/i);
    fireEvent.change(field, { target: { value: "GOCSPX-not-a-client-id" } });
    expect((screen.getByRole("button", { name: /Save and connect/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "123-abc.apps.googleusercontent.com" } });
    expect((screen.getByRole("button", { name: /Save and connect/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hands the chosen file straight to the caller", () => {
    const onImportFile = vi.fn();
    const { container } = render(
      <ScheduleScreen consent={DEFAULT_SCHEDULE_CONSENT} events={[]} entries={[]} today={TODAY}
        canGoogle={false} onImportFile={onImportFile} />
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["BEGIN:VCALENDAR"], "work.ics", { type: "text/calendar" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(onImportFile).toHaveBeenCalledWith(file);
  });
});

describe("the week", () => {
  it("draws seven days and says what the week held", () => {
    mount();
    const bar = screen.getByRole("group", { name: /Booked time each day/i });
    expect(within(bar).getAllByRole("button")).toHaveLength(7);
    expect(screen.getByText(/7h booked across 4 days/i)).toBeTruthy();
  });

  it("tells a day it has no calendar for apart from a day with nothing in it", () => {
    // Coverage starts on the Wednesday, so Monday and Tuesday are unknown —
    // even though there are events on them.
    mount({ coverage: { start: shiftDay(MONDAY, 2), end: shiftDay(MONDAY, 6) } });
    const bar = screen.getByRole("group", { name: /Booked time each day/i });
    expect(within(bar).getByRole("button", { name: /Mon: no calendar for this day/i })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /Fri: nothing booked/i })).toBeTruthy();
    // The bank holiday books no minutes and is still not a clear day.
    expect(within(bar).getByRole("button", { name: /Wed: all day, nothing timed/i })).toBeTruthy();
  });

  it("names the categories the week was made of, with the time beside each", () => {
    mount();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("Exercise")).toBeTruthy();
    expect(screen.getByText("Social")).toBeTruthy();
  });

  it("opens a day and lists what was on it", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Mon: 3h/i }));
    expect(screen.getByText(/3h booked/)).toBeTruthy();
    expect(screen.getByText(/9:00 am · 3h/)).toBeTruthy();
    expect(screen.getByText(/4 people/)).toBeTruthy();
  });
});

describe("what titles do and do not reach the screen", () => {
  it("shows no title anywhere at all when titles are off", () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Mon: 3h/i }));
    expect(container.innerHTML).not.toContain("Sprint planning");
    expect(container.innerHTML).not.toContain("Dinner with Sam");
    // The category worked out at the boundary is still there, which is the
    // whole point of classifying before the words are dropped.
    expect(screen.getAllByText("Work").length).toBeGreaterThan(0);
  });

  it("shows them when the person has switched them on", () => {
    mount({ consent: connected({ titles: true }) });
    fireEvent.click(screen.getByRole("button", { name: /Mon: 3h/i }));
    expect(screen.getByText("Sprint planning")).toBeTruthy();
  });

  it("lets a category be corrected, permanently", () => {
    const onCorrectKind = vi.fn();
    mount({ consent: connected({ titles: true }), onCorrectKind });
    fireEvent.click(screen.getByRole("button", { name: /Mon: 3h/i }));
    fireEvent.click(screen.getByText("Sprint planning"));
    expect(screen.getByText(/this sticks, and a re-sync won't undo it/i)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Focused time" }));
    expect(onCorrectKind).toHaveBeenCalledWith("a", "focus");
  });

  it("offers no corrections at all in the read-only viewer", () => {
    mount({ consent: connected({ titles: true }), viewer: true });
    fireEvent.click(screen.getByRole("button", { name: /Mon: 3h/i }));
    fireEvent.click(screen.getByText("Sprint planning"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("nothing leaves without a switch being flicked", () => {
  it("says exactly what the weekly reading would send, before allowing it", () => {
    mount({ aiReady: true });
    expect(screen.getByText(/No event titles, no dates, no names/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Read my last/i })).toBeNull();
  });

  it("does not offer the reading at all without an AI connection", () => {
    const { container } = mount({ aiReady: false });
    expect(container.innerHTML).not.toContain("Read the weeks");
  });

  it("will not run on too few weeks even once it is allowed", () => {
    mount({
      aiReady: true, consent: connected({ aiWeeks: true }),
      coverage: { start: MONDAY, end: shiftDay(MONDAY, 6) }, // one week
    });
    expect(screen.getByText(/more full weeks of/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Read my last/i })).toBeNull();
  });

  it("runs once there are enough, and says how many it is reading", () => {
    const onRunReading = vi.fn();
    mount({ aiReady: true, consent: connected({ aiWeeks: true }), onRunReading });
    fireEvent.click(screen.getByRole("button", { name: /Read my last \d+ weeks/i }));
    expect(onRunReading).toHaveBeenCalled();
  });

  it("keeps the title-sorting switch unavailable while titles are not kept", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /How this is connected/i }));
    const row = screen.getByText(/Let a model sort unrecognised titles/i).closest("label")!;
    expect((within(row).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("the connection panel", () => {
  it("says what is connected and how much of it is stored", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /How this is connected/i }));
    expect(screen.getByText(/Google Calendar, read-only/i)).toBeTruthy();
    expect(screen.getByText(/4 entries stored/i)).toBeTruthy();
  });

  it("warns that turning titles off erases the ones already kept", () => {
    mount({ consent: connected({ titles: true }) });
    fireEvent.click(screen.getByRole("button", { name: /How this is connected/i }));
    expect(screen.getByText(/erases the titles already stored/i)).toBeTruthy();
  });

  it("offers a disconnect that deletes, and says so in the button", () => {
    const onForget = vi.fn();
    mount({ onForget });
    fireEvent.click(screen.getByRole("button", { name: /How this is connected/i }));
    fireEvent.click(screen.getByRole("button", { name: /Disconnect and delete every entry/i }));
    expect(onForget).toHaveBeenCalled();
  });
});

describe("observations", () => {
  /* A synthetic stretch where heavy days really are worse days, long enough to
     clear the module's own minimum. */
  const long = () => {
    const events: CalEvent[] = [];
    const entries: { date: string; answers: Record<string, number> }[] = [];
    for (let i = 0; i < 120; i += 1) {
      const date = shiftDay(shiftDay(MONDAY, 6), -i);
      const heavy = i % 3 === 0;
      if (heavy) events.push(ev({ id: `h${i}`, date, time: "09:00", endTime: "13:00", minutes: 240, kind: "work" }));
      entries.push({ date, answers: { pain: heavy ? 7 : 3 } });
    }
    return { events, entries, coverage: { start: shiftDay(shiftDay(MONDAY, 6), -119), end: shiftDay(MONDAY, 6) } };
  };

  it("shows nothing beside how you felt without a metric to be about", () => {
    const { container } = mount();
    expect(container.innerHTML).not.toContain("Beside how you felt");
  });

  it("counts the person's own days, and never says one thing caused another", () => {
    const { events, entries, coverage: cov } = long();
    const { container } = mount({
      events, entries, coverage: cov,
      keyField: { k: "pain", label: "Pain", dir: "sym" },
    });
    expect(screen.getByText("Beside how you felt")).toBeTruthy();
    const text = container.textContent || "";
    for (const word of ["caused", "because", "due to", "leads to", "triggers"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    expect(screen.getByText(/moving together is not proof|Something else may explain both/i)).toBeTruthy();
  });

  it("lights the days up elsewhere when one is tapped", () => {
    const onHighlight = vi.fn();
    const { events, entries, coverage: cov } = long();
    mount({ events, entries, coverage: cov, keyField: { k: "pain", label: "Pain", dir: "sym" }, onHighlight });
    fireEvent.click(screen.getAllByText(/Light up \d+ days/)[0].closest("button")!);
    expect(onHighlight).toHaveBeenCalled();
    expect(onHighlight.mock.calls[0][0].length).toBeGreaterThan(0);
  });
});
