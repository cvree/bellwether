/* Backups written under an older app name must keep opening, forever.

   This file exists because a rebrand very nearly broke exactly that. A
   find-and-replace pass over the repo rewrote the historical names inside
   BACKUP_APP_IDS to the new one, which compiles, type-checks, and passes every
   other test — while silently making every backup already sitting on a user's
   disk unopenable. The failure has no error path and no recovery: the file is
   simply refused as "not a Bellwether backup".

   So the guarantee is asserted against the real validator, with the literal
   strings spelled out. If the app is renamed again, ADD to this list. Do not
   edit what is here. */
import { describe, it, expect } from "vitest";
import { __internals as I } from "../src/App";

/** Every name this app has ever stamped into an export's `app` field. */
const HISTORICAL_NAMES = ["Family Health Journal", "Health Journal", "Bellwether"];

const backup = (app: string) => ({
  app,
  profile: { name: "test" },
  entries: [{ date: "2026-01-01" }],
});

describe("backup compatibility across renames", () => {
  for (const name of HISTORICAL_NAMES) {
    it(`opens a backup written as "${name}"`, () => {
      const v = I.validateBackup(backup(name));
      expect(v.ok, `a backup stamped "${name}" must still validate`).toBe(true);
      expect(v.summary.entries).toBe(1);
    });
  }

  it("still refuses a file that is not ours", () => {
    expect(I.validateBackup(backup("Some Other App")).ok).toBe(false);
    expect(I.validateBackup({ entries: [] }).ok).toBe(false);
  });
});

/* ---------- the calendar survives a round trip ----------

   The 1.21 collections were written into every backup and dropped on the way
   back in, and nobody noticed for two releases. This is the guard that stops
   the 1.38 ones going the same way — and `calendarCoverage` is the one that
   would fail loudest, because a restore that brought back three months of
   events with no record of which days had been read would report every one of
   them as a day with nothing booked. */
describe("a restored backup keeps the calendar it saved", () => {
  it("carries the events, the covered range and the cached categories", async () => {
    const db = {
      ...I.migrateDb({ ...I.genSampleData(), ack: true, onboarded: true }),
      calendar: [{
        id: "g_1_primary", date: "2025-06-10", time: "09:00", endDate: "2025-06-10",
        endTime: "10:00", minutes: 60, busy: true, going: "yes", people: 3,
        kind: "work", kindSource: "user", source: "google", calendarId: "primary",
      }],
      calendarCoverage: { start: "2025-05-01", end: "2025-06-30" },
      calendarKinds: { bikram: "exercise" },
    };
    db.profile.schedule = { enabled: true, source: "google", titles: false, weekStartsOn: 1 };

    const backup = await I.buildFullBackup(db);
    expect(backup.calendar).toHaveLength(1);
    expect(backup.calendarCoverage).toEqual({ start: "2025-05-01", end: "2025-06-30" });

    let restored: any = null;
    await I.restoreBackup(backup, (next: any) => { restored = typeof next === "function" ? next(db) : next; });
    expect(restored.calendar).toHaveLength(1);
    /* The hand correction is part of the record, not a cache. */
    expect(restored.calendar[0].kindSource).toBe("user");
    expect(restored.calendarCoverage).toEqual({ start: "2025-05-01", end: "2025-06-30" });
    expect(restored.calendarKinds).toEqual({ bikram: "exercise" });
    /* The consent travels inside the profile — it describes what this journal
       may hold, not what a device may fetch. */
    expect(restored.profile.schedule.enabled).toBe(true);
    expect(restored.profile.schedule.source).toBe("google");
  });

  it("does not let a backup put titles back into a journal that has switched them off", async () => {
    const db = I.migrateDb({ ...I.genSampleData(), ack: true, onboarded: true });
    const withTitles = {
      ...db,
      calendar: [{
        id: "g_2_primary", date: "2025-06-10", time: "09:00", endDate: "2025-06-10",
        endTime: "10:00", minutes: 60, busy: true, going: "yes", people: 0,
        kind: "health", kindSource: "rules", source: "google", title: "Therapy",
      }],
      calendarCoverage: { start: "2025-06-01", end: "2025-06-30" },
    };
    withTitles.profile = { ...withTitles.profile, schedule: { enabled: true, source: "google", titles: false } };
    const settled = I.migrateDb(withTitles);
    expect(settled.calendar[0].title).toBeUndefined();
    expect(settled.calendar[0].kind).toBe("health"); // the category still survives
    expect(JSON.stringify(settled.calendar)).not.toContain("Therapy");
  });
});

describe("switching titles off takes them out of both places they live", () => {
  /* `calendar` holds the titles; `calendarKinds` is the model's cache and it is
     keyed *by title*. Clearing only the first leaves a list of somebody's event
     titles in the journal after they asked for the titles to be gone — the
     promise failing quietly in the one place nobody would look. */
  it("clears the by-title category cache along with the titles", () => {
    const db = {
      ...I.migrateDb({ ...I.genSampleData(), ack: true, onboarded: true }),
      calendar: [{
        id: "g_3_primary", date: "2025-06-10", time: "09:00", endDate: "2025-06-10",
        endTime: "10:00", minutes: 60, busy: true, going: "yes", people: 0,
        kind: "exercise", kindSource: "ai", source: "google", title: "Bikram",
      }],
      calendarKinds: { bikram: "exercise" },
    };
    db.profile.schedule = { enabled: true, source: "google", titles: true };

    /* The same write the settings switch performs. */
    const off = I.migrateDb({
      ...db,
      profile: { ...db.profile, schedule: { ...db.profile.schedule, titles: false } },
      calendar: db.calendar.map(({ title, ...rest }: any) => rest),
      calendarKinds: {},
    });
    expect(off.calendar[0].title).toBeUndefined();
    expect(off.calendarKinds).toEqual({});
    expect(JSON.stringify(off)).not.toContain("Bikram");
    expect(JSON.stringify(off)).not.toContain("bikram");
    /* What the model worked out is kept — it is a category, not a word. */
    expect(off.calendar[0].kind).toBe("exercise");
  });
});
