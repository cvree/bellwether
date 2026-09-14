/* The standing record.

   The assertions that matter here are almost all negative, and they cluster on
   the two rules that are easy to get wrong in a way nobody notices until it is
   on paper in front of a clinician:

   · **Silence is not a negative.** A kind nobody has been asked about must
     never print, export or count as "none", and a kind explicitly stated empty
     must always print *as a statement, with its date*.
   · **A private fact leaves by no door but a backup.** Not the pack, not the
     export, not an alert, not a heading, not a count. */

import { describe, expect, it } from "vitest";
import {
  COMMON, DOMAINS, DOMAIN_OF, FACT_KINDS, IMPACT_KINDS, KINDS_IN, KIND_META,
  PRIVATE_BY_DEFAULT, STATUSES_FOR,
  afterAdd, alertFacts, buildRecordTable, clearNone, dateFloor, datePrecision,
  factDetail, factLine, factText, factsOfKind, formatPartial, heldBack,
  isAnswered, isCurrent, isNone, isPartialDate, newFact, nextToAsk,
  packRecordSection, recordLine, recordSummary, sanitizeFact, sanitizeFacts,
  sanitizeRecordState, shareable, sortFacts, stateNone, unanswered, whenLabel,
  yearsSince,
  type FactKind, type HealthFact, type RecordState,
} from "../src/lib/record";

const TODAY = "2026-09-14";

const fact = (patch: Partial<HealthFact> & { kind: FactKind; label: string }): HealthFact => ({
  id: `id_${patch.label}_${patch.kind}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

/* ---------- the taxonomy holds together ---------- */

describe("sixteen kinds across three domains, and every map covers them", () => {
  it("puts every kind in exactly one domain", () => {
    const seen = FACT_KINDS.map((k) => DOMAIN_OF[k]);
    expect(seen.every(Boolean)).toBe(true);
    expect(DOMAINS.flatMap((d) => KINDS_IN[d]).sort()).toEqual([...FACT_KINDS].sort());
  });

  it("gives every kind meta, statuses and a catalog", () => {
    for (const k of FACT_KINDS) {
      expect(KIND_META[k], k).toBeTruthy();
      expect(KIND_META[k].noneLine.length, k).toBeGreaterThan(0);
      /* The `ask` is the question the empty section prints. A kind without one
         is a section that shows a heading and nothing else, which is the exact
         "form nobody fills in" the screen is built to avoid. */
      expect(KIND_META[k].ask.endsWith("?"), k).toBe(true);
      expect(STATUSES_FOR[k].length, k).toBeGreaterThan(0);
      expect(COMMON[k].length, k).toBeGreaterThan(3);
    }
  });

  it("never offers a status a kind does not have", () => {
    /* A substance is not "in remission" and a condition is not "stopped". */
    expect(STATUSES_FOR.condition).not.toContain("former");
    expect(STATUSES_FOR.substance).not.toContain("remission");
    expect(STATUSES_FOR.substance).toContain("former");
  });

  it("offers impact only where a thing can pull either way", () => {
    expect(IMPACT_KINDS).not.toContain("condition");
    expect(IMPACT_KINDS).not.toContain("allergy");
    expect(IMPACT_KINDS).toContain("work");
    expect(IMPACT_KINDS).toContain("support");
  });
});

/* ---------- partial dates ---------- */

describe("a date is kept at the precision it was given", () => {
  it("accepts a year, a month and a day and refuses everything else", () => {
    expect(datePrecision("2019")).toBe("year");
    expect(datePrecision("2019-03")).toBe("month");
    expect(datePrecision("2019-03-14")).toBe("day");
    for (const bad of ["19", "2019-3", "2019-13", "2019-02-30", "March 2019", "", undefined]) {
      expect(datePrecision(bad as string), String(bad)).toBeNull();
    }
    expect(isPartialDate("2019")).toBe(true);
    expect(isPartialDate(2019)).toBe(false);
  });

  it("never pads a year into a day that did not happen", () => {
    /* The bug this guards: "2019" printing as "1 January 2019" on a document
       somebody reads as fact. The floor exists for ordering and is not the
       thing that gets printed. */
    expect(formatPartial("2019")).toBe("2019");
    expect(formatPartial("2019-03")).toBe("March 2019");
    expect(formatPartial("2019-03-14")).toBe("14 March 2019");
    expect(dateFloor("2019")).toBe("2019-01-01");
    expect(formatPartial(dateFloor("2019"))).not.toBe(formatPartial("2019"));
  });

  it("floors the years rather than rounding a guess up", () => {
    expect(yearsSince("2019", TODAY)).toBe(7);
    expect(yearsSince("2019-12", TODAY)).toBe(6);
    expect(yearsSince("2026-10", TODAY)).toBeNull(); // the future is not a duration
    expect(yearsSince(undefined, TODAY)).toBeNull();
  });
});

/* ---------- sanitising ---------- */

describe("a fact arriving from a file is repaired, not trusted", () => {
  it("drops a row that says nothing", () => {
    expect(sanitizeFact({ kind: "condition" })).toBeNull();
    expect(sanitizeFact({ label: "Asthma" })).toBeNull();
    expect(sanitizeFact({ kind: "nonsense", label: "Asthma" })).toBeNull();
    expect(sanitizeFact({ kind: "condition", label: "   " })).toBeNull();
  });

  it("drops a status the kind does not offer rather than translating it", () => {
    /* Guessing that a "former" condition meant "resolved" would be the module
       inventing a clinical statement out of a malformed field. */
    const f = sanitizeFact({ kind: "condition", label: "Asthma", status: "former" });
    expect(f!.status).toBeUndefined();
  });

  it("drops an end date that comes before the start", () => {
    const f = sanitizeFact({ kind: "condition", label: "X", since: "2020", until: "2015" });
    expect(f!.since).toBe("2020");
    expect(f!.until).toBeUndefined();
  });

  it("keeps per-kind fields off the kinds they mean nothing on", () => {
    const f = sanitizeFact({
      kind: "condition", label: "Asthma",
      severity: "anaphylaxis", reaction: "hives", relation: "Mother",
      level: "unable", aid: "stick", place: "Ward 4", impact: "strains",
    })!;
    expect(f.severity).toBeUndefined();
    expect(f.reaction).toBeUndefined();
    expect(f.relation).toBeUndefined();
    expect(f.level).toBeUndefined();
    expect(f.place).toBeUndefined();
    expect(f.impact).toBeUndefined();
  });

  it("de-duplicates by id and survives a non-array", () => {
    const rows = sanitizeFacts([
      { id: "a", kind: "condition", label: "One" },
      { id: "a", kind: "allergy", label: "Two" },
      null, "nope", { kind: "condition" },
    ]);
    expect(rows).toHaveLength(1);
    expect(sanitizeFacts(undefined)).toEqual([]);
    expect(sanitizeFacts({} as unknown)).toEqual([]);
  });

  it("starts a life event private and everything else not", () => {
    expect(PRIVATE_BY_DEFAULT).toEqual(["event"]);
    expect(newFact("event", { label: "X" }).private).toBe(true);
    expect(newFact("condition", { label: "X" }).private).toBeUndefined();
  });
});

/* ---------- rule 3: none is an answer ---------- */

describe("silence and a stated negative are different facts", () => {
  const allergy = fact({ kind: "allergy", label: "Penicillin" });

  it("counts a kind as unanswered until something is said either way", () => {
    expect(isAnswered([], undefined, "allergy")).toBe(false);
    expect(isAnswered([allergy], undefined, "allergy")).toBe(true);
    expect(isAnswered([], { none: ["allergy"] }, "allergy")).toBe(true);
  });

  it("writes the day the negative was stated", () => {
    const state = stateNone(undefined, "allergy", TODAY);
    expect(isNone(state, "allergy")).toBe(true);
    expect(state.statedAt?.allergy).toBe(TODAY);
  });

  it("refuses to state a negative about a kind that holds something", () => {
    /* The two claims contradict each other, and there is no version of the
       contradiction worth storing. */
    const state = stateNone(undefined, "allergy", TODAY, [allergy]);
    expect(isNone(state, "allergy")).toBe(false);
  });

  it("clears the negative, and its date, when one turns up", () => {
    const stated = stateNone(undefined, "allergy", TODAY);
    const after = afterAdd(stated, "allergy");
    expect(isNone(after, "allergy")).toBe(false);
    expect(after?.statedAt?.allergy).toBeUndefined();
    expect(clearNone(undefined, "allergy")).toBeUndefined();
  });

  it("repairs a file that claims both at once, and the facts win", () => {
    const state = sanitizeRecordState({ none: ["allergy", "condition"], statedAt: { allergy: TODAY } },
      [allergy]);
    expect(state?.none).toEqual(["condition"]);
    expect(state?.statedAt?.allergy).toBeUndefined();
  });

  it("refuses a stated-at that is not a real day", () => {
    const state = sanitizeRecordState({ none: ["allergy"], statedAt: { allergy: "2026" } }, []);
    expect(state?.none).toEqual(["allergy"]);
    expect(state?.statedAt).toBeUndefined();
  });

  it("asks for what is left, one kind at a time, in print order", () => {
    const left = unanswered([allergy], { none: ["condition"] });
    expect(left).not.toContain("allergy");
    expect(left).not.toContain("condition");
    expect(nextToAsk([allergy], { none: ["condition"] })).toBe(left[0]);
    expect(nextToAsk([], { none: FACT_KINDS })).toBeNull();
  });
});

/* ---------- rule 4: private stays ---------- */

describe("a private fact leaves by no door but a backup", () => {
  const facts = [
    fact({ kind: "condition", label: "Asthma" }),
    fact({ kind: "event", label: "Bereavement", private: true }),
    fact({ kind: "allergy", label: "Penicillin", severity: "anaphylaxis", private: true }),
  ];

  it("keeps it out of the shareable set and counts it separately", () => {
    expect(shareable(facts).map((f) => f.label)).toEqual(["Asthma"]);
    expect(heldBack(facts)).toBe(2);
    expect(recordSummary(facts, undefined).private).toBe(2);
  });

  it("keeps it out of the pack — including out of the alert band", () => {
    /* The severe allergy above is the hard case: it is exactly the fact the
       alert band exists for, and it is still not the pack's to print. */
    const section = packRecordSection(facts, undefined, TODAY);
    const printed = JSON.stringify(section);
    expect(printed).not.toContain("Bereavement");
    expect(printed).not.toContain("Penicillin");
    expect(section.alerts).toEqual([]);
    expect(section.held).toBe(2);
  });

  it("reads a kind holding only private facts as not asked about", () => {
    const section = packRecordSection(facts, undefined, TODAY);
    expect(section.missing.map((m) => m.kind)).toContain("allergy");
    expect(section.groups.map((g) => g.kind)).not.toContain("allergy");
  });

  it("keeps it out of the export", () => {
    const table = buildRecordTable(facts, undefined, TODAY);
    const flat = JSON.stringify(table.rows);
    expect(flat).toContain("Asthma");
    expect(flat).not.toContain("Bereavement");
    expect(flat).not.toContain("Penicillin");
  });
});

/* ---------- alerts ---------- */

describe("the alert band", () => {
  it("raises a severe allergy and anything pinned", () => {
    const rows = [
      fact({ kind: "allergy", label: "Penicillin", severity: "anaphylaxis" }),
      fact({ kind: "allergy", label: "Pollen", severity: "mild" }),
      fact({ kind: "condition", label: "Epilepsy", pinned: true }),
    ];
    expect(alertFacts(rows).map((f) => f.label)).toEqual(["Epilepsy", "Penicillin"]);
  });

  it("never infers severity from the words in a reaction", () => {
    /* The reaction is a description. Reading "throat closes" and promoting it
       to anaphylaxis would be the app making a clinical judgement. */
    const rows = [fact({ kind: "allergy", label: "Nuts", reaction: "anaphylaxis, throat closes" })];
    expect(alertFacts(rows)).toEqual([]);
  });

  it("drops an allergy that has been grown out of", () => {
    const rows = [fact({ kind: "allergy", label: "Milk", severity: "severe", status: "resolved" })];
    expect(alertFacts(rows)).toEqual([]);
  });
});

/* ---------- rendering ---------- */

describe("one renderer, so the screen and the pack never disagree", () => {
  it("names the relative on a family fact and the tie on a support one", () => {
    expect(factLine(fact({ kind: "family", label: "Bowel cancer", relation: "Mother" })))
      .toBe("Bowel cancer — Mother");
    expect(factLine(fact({ kind: "support", label: "Ama", relation: "Sister" })))
      .toBe("Ama (Sister)");
    /* No parenthetical when it would just say the word twice. */
    expect(factLine(fact({ kind: "support", label: "Sister", relation: "Sister" })))
      .toBe("Sister");
  });

  it("stays quiet about a status that is the obvious one", () => {
    const ongoing = fact({ kind: "condition", label: "Asthma", status: "active" });
    expect(factDetail(ongoing, TODAY)).toBe("");
    const quiet = fact({ kind: "condition", label: "Crohn's", status: "remission" });
    expect(factDetail(quiet, TODAY)).toContain("In remission");
  });

  it("says how long it has been, without inventing a day", () => {
    expect(whenLabel(fact({ kind: "condition", label: "X", since: "2019" }), TODAY))
      .toBe("since 2019 · 7 years");
    /* A procedure is a date, not a duration — "since 2015 · 11 years" reads as
       an ongoing appendectomy. */
    expect(whenLabel(fact({ kind: "procedure", label: "Appendectomy", since: "2015" }), TODAY))
      .toBe("2015");
    expect(whenLabel(fact({ kind: "substance", label: "Cigarettes", since: "2005", until: "2018" })))
      .toBe("2005 – 2018");
    expect(whenLabel(fact({ kind: "condition", label: "X" }), TODAY)).toBe("");
  });

  it("renders a whole fact as one line for the export and the index", () => {
    const f = fact({
      kind: "allergy", label: "Penicillin", severity: "severe",
      reaction: "hives", since: "2001",
    });
    expect(factText(f, TODAY)).toBe("Penicillin — Severe · hives · since 2001 · 25 years");
  });
});

/* ---------- sorting and counting ---------- */

describe("ordering is total, so two devices list a record identically", () => {
  it("puts pinned first, then current, then the more severe", () => {
    const rows = [
      fact({ kind: "allergy", label: "Pollen", severity: "mild" }),
      fact({ kind: "allergy", label: "Milk", severity: "severe", status: "resolved" }),
      fact({ kind: "allergy", label: "Nuts", severity: "moderate" }),
      fact({ kind: "allergy", label: "Latex", pinned: true }),
    ];
    expect(sortFacts(rows).map((f) => f.label)).toEqual(["Latex", "Nuts", "Pollen", "Milk"]);
    /* Pure: the input is not reordered under the caller. */
    expect(rows[0].label).toBe("Pollen");
  });

  it("knows what is still true", () => {
    expect(isCurrent(fact({ kind: "condition", label: "X" }))).toBe(true);
    expect(isCurrent(fact({ kind: "condition", label: "X", status: "resolved" }))).toBe(false);
    expect(isCurrent(fact({ kind: "condition", label: "X", until: "2020" }))).toBe(false);
    expect(isCurrent(fact({ kind: "substance", label: "X", status: "former" }))).toBe(false);
  });

  it("counts per domain, because sixteen sections is not a unit anyone acts on", () => {
    const rows = [fact({ kind: "condition", label: "Asthma" })];
    const s = recordSummary(rows, { none: ["allergy"] });
    const body = s.domains.find((d) => d.domain === "body")!;
    expect(body.n).toBe(1);
    expect(body.answered).toBe(2);
    expect(body.of).toBe(KINDS_IN.body.length);
    expect(s.complete).toBe(false);
    expect(recordSummary([], { none: FACT_KINDS }).complete).toBe(true);
  });

  it("never scolds in the one-line summary", () => {
    for (const line of [
      recordLine([], undefined),
      recordLine([fact({ kind: "condition", label: "Asthma" })], undefined),
      recordLine([], { none: FACT_KINDS }),
    ]) {
      expect(line).not.toMatch(/incomplete|missing|you (should|must|need)|%/i);
    }
  });
});

/* ---------- the pack ---------- */

describe("the pack prints what was said and omits what was not", () => {
  const facts = [
    fact({ kind: "condition", label: "Coeliac disease", since: "2019" }),
    fact({ kind: "allergy", label: "Penicillin", severity: "anaphylaxis", reaction: "throat closes" }),
  ];
  const state: RecordState = {
    none: ["substance", "family"],
    statedAt: { substance: TODAY, family: TODAY },
    reviewedAt: TODAY,
  };

  it("prints a stated negative as a sentence carrying its date", () => {
    const section = packRecordSection(facts, state, TODAY);
    const substance = section.groups.find((g) => g.kind === "substance")!;
    expect(substance.none).toBe(true);
    expect(substance.items).toEqual([]);
    expect(substance.noneLine).toBe(KIND_META.substance.noneLine);
    expect(substance.statedAt).toBe(TODAY);
  });

  it("omits a kind nobody was asked about, and names it as not asked", () => {
    const section = packRecordSection(facts, state, TODAY);
    expect(section.groups.map((g) => g.kind)).not.toContain("housing");
    expect(section.missing.map((m) => m.kind)).toContain("housing");
  });

  it("carries the domain on every group so the pack can head them", () => {
    const section = packRecordSection(facts, state, TODAY);
    for (const g of section.groups) expect(g.domain).toBe(DOMAIN_OF[g.kind]);
  });

  it("is empty — not a heading over nothing — when nothing has been said", () => {
    const section = packRecordSection([], undefined, TODAY);
    expect(section.empty).toBe(true);
    expect(section.groups).toEqual([]);
    expect(section.missing).toHaveLength(FACT_KINDS.length);
  });

  it("raises the severe allergy above everything", () => {
    const section = packRecordSection(facts, state, TODAY);
    expect(section.alerts[0].line).toBe("Penicillin");
    const allergyGroup = section.groups.find((g) => g.kind === "allergy")!;
    expect(allergyGroup.items[0].alert).toBe(true);
  });
});

/* ---------- the export ---------- */

describe("the spreadsheet keeps the distinction the module is built around", () => {
  it("writes a row for a stated negative, not just for the facts", () => {
    const table = buildRecordTable(
      [fact({ kind: "condition", label: "Asthma" })],
      { none: ["allergy"], statedAt: { allergy: TODAY } },
      TODAY,
    );
    const allergyRow = table.rows.find((r) => r[1] === "Allergy")!;
    expect(allergyRow[2]).toBe(KIND_META.allergy.noneLine);
    expect(allergyRow[3]).toBe("Stated");
    expect(allergyRow[4]).toBe(TODAY);
  });

  it("writes no row at all for a kind nobody was asked about", () => {
    const table = buildRecordTable([], undefined, TODAY);
    expect(table.rows).toEqual([]);
    expect(table.header[0]).toBe("Domain");
  });

  it("never prints a padded date", () => {
    const table = buildRecordTable([fact({ kind: "condition", label: "X", since: "2019" })], undefined, TODAY);
    /* Columns: domain, kind, what, status, since, until, detail, note, flag. */
    expect(table.header[4]).toBe("Since");
    expect(table.rows[0][4]).toBe("2019");
  });
});

/* ---------- the shape of the whole thing ---------- */

describe("nothing here grades anybody", () => {
  it("has no numeric score anywhere in the summary", () => {
    const s = recordSummary([fact({ kind: "adl", label: "Stairs", level: "unable" })], undefined);
    expect(Object.keys(s)).not.toContain("score");
    expect(JSON.stringify(s)).not.toMatch(/percent|score|grade/i);
  });

  it("keeps every catalog free of language that diagnoses on the person's behalf", () => {
    /* The catalogs are one-tap chips. A chip is a label somebody accepts about
       themselves, so it must read as a plain name, never as a verdict. */
    const all = FACT_KINDS.flatMap((k) => COMMON[k]);
    for (const label of all) {
      expect(label, label).not.toMatch(/\b(severe|chronic|abnormal|failure|poor|bad)\b/i);
    }
  });

  it("puts every fact through factsOfKind cleanly", () => {
    const rows = FACT_KINDS.map((k) => fact({ kind: k, label: `A ${k}` }));
    for (const k of FACT_KINDS) expect(factsOfKind(rows, k)).toHaveLength(1);
  });
});
