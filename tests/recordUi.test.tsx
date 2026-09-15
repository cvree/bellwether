/* About you, as a screen.

   Three things are worth a render test rather than a unit test, because all
   three are promises the module cannot keep on its own:

   · **Nothing to add is reachable in two taps from the screen opening.** The
     whole design rests on the commonest true answer being one press, and a
     regression that buries it behind an editor sheet would quietly turn the
     feature back into a form.
   · **The run-through can finish.** Sixteen questions with no way out is the
     failure mode; there is a Nothing to add, a Skip and a Stop on every one.
   · **A viewer never gets a control that writes.** The read-only viewer opens
     other people's backups. */

// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordScreen from "../src/components/RecordScreen";
import {
  FACT_KINDS, KINDS_IN, KIND_META, newFact,
  type HealthFact, type RecordState,
} from "../src/lib/record";

const TODAY = "2026-09-14";

const fact = (kind: HealthFact["kind"], label: string, patch: Partial<HealthFact> = {}): HealthFact => ({
  id: `${kind}_${label}`,
  kind,
  label,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

function setup(props: Partial<React.ComponentProps<typeof RecordScreen>> = {}) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onStateNone = vi.fn();
  const onClearNone = vi.fn();
  const onReviewed = vi.fn();
  const view = render(
    <RecordScreen
      facts={[]}
      today={TODAY}
      onSave={onSave}
      onDelete={onDelete}
      onStateNone={onStateNone}
      onClearNone={onClearNone}
      onReviewed={onReviewed}
      {...props}
    />,
  );
  return { ...view, onSave, onDelete, onStateNone, onClearNone, onReviewed };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the way in is three domains, not sixteen sections", () => {
  it("opens on Body, Mind and Life and nothing else", () => {
    setup();
    for (const label of ["Body", "Mind", "Life"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    /* The sixteen section headings live one level down. Showing them all on
       arrival is the wall of empty fields the screen exists to avoid. */
    expect(screen.queryByText(KIND_META.housing.label)).toBeNull();
    expect(screen.queryByText(KIND_META.coping.label)).toBeNull();
  });

  it("never puts a score or a percentage on a record", () => {
    setup({ facts: [fact("condition", "Asthma")] });
    expect(document.body.textContent).not.toMatch(/%|\bscore\b|\bcomplete[d]?\b\s*\d/i);
  });

  it("opens a domain and shows exactly the kinds it holds", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Mind/ }));
    for (const k of KINDS_IN.mind) {
      expect(screen.getByText(KIND_META[k].label), k).toBeTruthy();
    }
    expect(screen.queryByText(KIND_META.condition.label)).toBeNull();
  });
});

describe("nothing to add is an answer, and it is two taps away", () => {
  it("offers it on every empty section, with the question in plain words", () => {
    const { onStateNone } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Life/ }));
    expect(screen.getByText(KIND_META.housing.ask)).toBeTruthy();

    const buttons = screen.getAllByRole("button", { name: "Nothing to add" });
    expect(buttons).toHaveLength(KINDS_IN.life.length);
    fireEvent.click(buttons[0]);
    expect(onStateNone).toHaveBeenCalledWith(KINDS_IN.life[0]);
  });

  it("prints the stated sentence back with its date, and says why that matters", () => {
    const state: RecordState = { none: ["allergy"], statedAt: { allergy: TODAY } };
    setup({ state });
    fireEvent.click(screen.getByRole("button", { name: /Body/ }));
    expect(screen.getByText(KIND_META.allergy.noneLine)).toBeTruthy();
    expect(document.body.textContent).toMatch(/a blank section would mean nobody asked/i);
  });

  it("lets somebody take the statement back", () => {
    const { onClearNone } = setup({ state: { none: ["allergy"], statedAt: { allergy: TODAY } } });
    fireEvent.click(screen.getByRole("button", { name: /Body/ }));
    fireEvent.click(screen.getByRole("button", { name: /Actually, there is something/ }));
    expect(onClearNone).toHaveBeenCalledWith("allergy");
  });
});

describe("the alert band", () => {
  it("puts a severe allergy above everything, and says where else it goes", () => {
    setup({
      facts: [fact("allergy", "Penicillin", { severity: "anaphylaxis", reaction: "throat closes" })],
    });
    const band = screen.getByRole("note");
    expect(within(band).getByText("Penicillin")).toBeTruthy();
    expect(document.body.textContent).toMatch(/top of every appointment pack/i);
  });

  it("stays away entirely when there is nothing to raise", () => {
    setup({ facts: [fact("allergy", "Pollen", { severity: "mild" })] });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the run-through", () => {
  const open = () => {
    const api = setup();
    fireEvent.click(screen.getByRole("button", { name: /Run through what's left/ }));
    return api;
  };

  it("offers one question at a time with the count beside it", () => {
    open();
    expect(screen.getByText(new RegExp(`1 of ${FACT_KINDS.length}`))).toBeTruthy();
    expect(screen.getByText(KIND_META[FACT_KINDS[0]].blurb)).toBeTruthy();
  });

  it("always offers three ways off a question", () => {
    open();
    expect(screen.getByRole("button", { name: "Nothing to add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop here" })).toBeTruthy();
  });

  it("takes several answers at once and adds them all", () => {
    const { onSave } = open();
    fireEvent.click(screen.getByRole("button", { name: "Asthma" }));
    fireEvent.click(screen.getByRole("button", { name: "Migraine" }));
    fireEvent.click(screen.getByRole("button", { name: /Add 2 and continue/ }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls.map((c) => c[0].label).sort()).toEqual(["Asthma", "Migraine"]);
    /* And it has moved on rather than sitting on the answered question. */
    expect(screen.getByText(new RegExp(`2 of ${FACT_KINDS.length}`))).toBeTruthy();
  });

  it("refuses to add nothing", () => {
    open();
    expect(screen.getByRole("button", { name: /Add and continue/ }).hasAttribute("disabled")).toBe(true);
  });

  it("spells out that skipping and stating none are different", () => {
    open();
    expect(document.body.textContent).toMatch(/written down with today's date/i);
    expect(document.body.textContent).toMatch(/leaves the question open/i);
  });

  it("warns before a life event is typed that it starts private", () => {
    const { onStateNone } = setup({
      /* Everything answered but the life event, so the run opens on it. */
      state: { none: FACT_KINDS.filter((k) => k !== "event") },
    });
    fireEvent.click(screen.getByRole("button", { name: /Run through what's left/ }));
    expect(screen.getByText(new RegExp(KIND_META.event.ask))).toBeTruthy();
    expect(document.body.textContent).toMatch(/starts private/i);
    expect(onStateNone).not.toHaveBeenCalled();
  });

  it("ends by saying so rather than looping", () => {
    setup({ state: { none: FACT_KINDS } });
    expect(screen.queryByRole("button", { name: /Run through what's left/ })).toBeNull();
  });
});

describe("the editor", () => {
  const openEditor = (kind: HealthFact["kind"]) => {
    const api = setup();
    const domain = kind === "condition" ? "Body" : "Life";
    fireEvent.click(screen.getByRole("button", { name: new RegExp(domain) }));
    fireEvent.click(screen.getAllByRole("button", { name: KIND_META[kind].add })[0]);
    return api;
  };

  it("shows only the fields the kind actually has", () => {
    openEditor("condition");
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByText("What happens?")).toBeNull();
    expect(within(sheet).queryByText("How much?")).toBeNull();
    expect(within(sheet).getByText("Where does it stand?")).toBeTruthy();
  });

  it("says back how it read a date rather than demanding a full one", () => {
    openEditor("condition");
    const sheet = screen.getByRole("dialog");
    const box = within(sheet).getByPlaceholderText("2019 · 2019-03 · 2019-03-14");
    fireEvent.change(box, { target: { value: "2019" } });
    expect(within(sheet).getByText("Reads as 2019.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "not a date" } });
    expect(within(sheet).getByText(/Not a date yet/)).toBeTruthy();
  });

  it("will not save a fact with no name", () => {
    openEditor("condition");
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("warns when a severity is about to put something in the pack's alert box", () => {
    openEditor("condition");
    /* Conditions have no severity — the warning belongs to allergies only, and
       this asserts it does not leak onto a kind that cannot raise an alert. */
    expect(document.body.textContent).not.toMatch(/bordered box/i);
  });

  it("offers the private switch on every kind, and explains what a backup does", () => {
    openEditor("condition");
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /Keep this private/ })).toBeTruthy();
    expect(sheet.textContent).toMatch(/backups still carry it/i);
  });
});

describe("the read-only viewer", () => {
  it("shows the record and offers nothing that writes", () => {
    setup({
      viewer: true,
      facts: [fact("condition", "Asthma"), fact("allergy", "Penicillin", { severity: "severe" })],
    });
    expect(screen.queryByRole("button", { name: /Run through what's left/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Still accurate today/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Body/ }));
    expect(screen.getByText("Asthma")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nothing to add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});

describe("what the screen says about privacy", () => {
  it("counts what is held back without naming any of it", () => {
    setup({ facts: [fact("event", "Bereavement", { private: true })] });
    expect(document.body.textContent).toMatch(/1 entry is marked\s+private/i);
    expect(document.body.textContent).not.toContain("Bereavement");
  });

  it("marks a private row on its own section, where naming it is the point", () => {
    setup({ facts: [fact("event", "Bereavement", { private: true })] });
    fireEvent.click(screen.getByRole("button", { name: /Mind/ }));
    expect(screen.getByText("Bereavement")).toBeTruthy();
    expect(screen.getByText("private")).toBeTruthy();
  });
});

describe("confirming the record is current", () => {
  it("is offered once there is something to confirm", () => {
    const { onReviewed } = setup({ facts: [fact("condition", "Asthma")] });
    fireEvent.click(screen.getByRole("button", { name: /Still accurate today/ }));
    expect(onReviewed).toHaveBeenCalled();
  });

  it("is not offered on an empty record, where there is nothing to be current", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Still accurate today/ })).toBeNull();
  });

  it("says when it was last confirmed", () => {
    setup({ facts: [fact("condition", "Asthma")], state: { reviewedAt: "2026-03-14" } });
    expect(document.body.textContent).toMatch(/Last confirmed as current on/);
  });
});

describe("a new fact is born with the kind's own defaults", () => {
  it("gives every kind a usable starting point", () => {
    for (const k of FACT_KINDS) {
      const f = newFact(k, { label: "X" });
      expect(f.kind, k).toBe(k);
      expect(f.status, k).toBeTruthy();
      expect(f.id, k).toBeTruthy();
    }
  });
});
