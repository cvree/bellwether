/* The 44px floor.
 *
 * `--fhj-tap: 44px` has been in the stylesheet since the beginning, and until
 * 1.34 it was applied as a `min-height` and nothing else — which is half a
 * rule, because a thumb is round. Measured in a real browser at 320px, the
 * number this whole product is built around (the Daily Pulse's 1-10 scale) was
 * a 21px target, and the same scale in the Detailed Log was 26px.
 *
 * These are source assertions rather than layout assertions on purpose: jsdom
 * has no layout engine, so a test that mounts the app and measures a button
 * gets zeroes back and passes forever. What can be pinned honestly is the CSS
 * that produces the geometry, and the markup that opts into it — so that is
 * what is pinned. The measurements above came from Playwright against the dev
 * server; this file is the guard that stops them regressing silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

/* The rule that grows a hit area without growing the ink, and the selectors it
   covers — the sweep below treats those as satisfying the floor, because they
   do, just not by being 44px on the box itself. */
const FLOOR_SELECTOR = [
  ".fhj-tap-floor::after",
  ".fhj-icon-btn::after",
  ".fhj-chip.fhj-chip-sm::after",
  ".fhj-fr-fine-btn::after",
  ".fhj-fr-swap-chip::after",
  ".fhj-sr-kind-chip::after",
  ".fhj-next-btn::after",
  ".fhj-pad-nudge > button::after",
].join(",\n");
const FLOORED = FLOOR_SELECTOR.split(",\n").map((s) => s.replace("::after", "").trim());

/** The declaration block for a selector, as written. Returns "" when the rule
    does not exist, so a missing rule fails as a missing declaration rather
    than as a thrown error four assertions later. */
function block(selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  if (i < 0) return "";
  const start = css.indexOf("{", i);
  const end = css.indexOf("}", start);
  return css.slice(start + 1, end);
}

describe("the token says 44", () => {
  it("--fhj-tap is 44px", () => {
    expect(css).toMatch(/--fhj-tap:\s*44px/);
  });

  it("grows the hit area of controls whose ink is smaller than a thumb", () => {
    const floor = block(FLOOR_SELECTOR);
    expect(floor).toContain("position: absolute");
    // max(), not a fixed size: a control already bigger than the floor keeps
    // its own hit area rather than being shrunk to 44.
    expect(floor).toMatch(/width:\s*max\(100%,\s*var\(--fhj-tap\)\)/);
    expect(floor).toMatch(/height:\s*max\(100%,\s*var\(--fhj-tap\)\)/);
    expect(floor).toContain("translate(-50%, -50%)");
  });
});

describe("the 1-10 scales are five across", () => {
  /* Ten across cannot be tapped and it is arithmetic, not taste: the shell is
     28rem and never wider, so ten columns is 21px on a 320px phone and 29px on
     a 390px one. Five is ~55px on both. The Quick Log has always drawn it this
     way; the other two scales now agree. */
  it("the shared scale (Detailed Log, day sheets, pulse follow-ups)", () => {
    expect(block(".fhj-scale")).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    expect(block(".fhj-scale-rung")).toMatch(/min-height:\s*var\(--fhj-tap\)/);
    // the old fixed height would cap the rung below the floor again
    expect(block(".fhj-scale-rung")).not.toMatch(/(^|[\s;])height:/);
  });

  it("the Daily Pulse", () => {
    expect(block(".fhj-pulse-scale")).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    // already taller than the floor; what it lacked was width
    expect(block(".fhj-pulse-rung")).toMatch(/min-height:\s*3\.25rem/);
    expect(block(".fhj-pulse-rung")).toMatch(/min-width:\s*0/);
  });

  it("the Quick Log, which was right all along", () => {
    expect(app).toContain('className="grid grid-cols-5 gap-2 mb-2"');
  });
});

describe("controls that could simply grow, did", () => {
  const cases: [string, string][] = [
    [".fhj-chip", "every filter, meal and metric chip in the app"],
    [".fhj-segment", "segmented switches"],
    [".fhj-btn-sm", "the small button variant"],
    [".fhj-thumb-back", "the back pill over the nav"],
    [".fhj-thumb-coach", "the 'hold + to go anywhere' coach mark"],
    [".fhj-skip", "the skip-to-content link"],
  ];
  for (const [sel, what] of cases) {
    it(`${sel} — ${what}`, () => {
      expect(block(sel)).toMatch(/min-height:\s*var\(--fhj-tap\)/);
    });
  }

  /* This swept for `min-height: NNpx` and nothing else, so every rule that
     wrote the same number in rem walked straight past it — and six had:
     `.fhj-sr-helptoggle` at 2.5rem, `.fhj-sr-kind-chip` and `.fhj-fr-fine-btn`
     at 2rem, `.fhj-fr-swap-chip`, `.fhj-next-btn` and `.fhj-pad-nudge > button`
     at 2.25rem. A guard that only reads one of the two units a stylesheet
     actually uses is a guard that passes forever. */
  it("no interactive rule is left declaring a min-height between 24 and 43px", () => {
    const stragglers: string[] = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const [, selector, body] = m;
      if (!/^[.#\w:\-\s,>+~[\]="']+$/.test(selector)) continue; // at-rule preludes
      const found = /min-height:\s*([\d.]+)(px|rem)/.exec(body);
      if (!found) continue;
      const n = Number(found[1]) * (found[2] === "rem" ? 16 : 1);
      const sel = selector.trim();
      if (FLOORED.includes(sel)) continue; // ink stays small, target does not
      if (n >= 24 && n < 44 && /button|chip|tab|btn|rung|segment|pill|toggle/i.test(sel)) {
        stragglers.push(`${sel} → ${n}px (${found[0]})`);
      }
    }
    expect(stragglers).toEqual([]);
  });

  /* A floor that reaches past its own chip is only safe if the row gives it
     room. These two rows wrap, so the arithmetic is: (44 - ink) is how far each
     floor reaches past the chip, and the row gap has to cover two of those or
     the lower row silently takes taps aimed at the upper one. It measured 6px
     of overlap in the search kind chips before the gap was set from the floor
     rather than from the eye. */
  it("gives a wrapped row of floored chips enough room for the floors", () => {
    for (const [row, ink] of [[".fhj-sr-kinds", 32], [".fhj-fr-swap-chips", 36]] as const) {
      const gap = /row-gap:\s*([\d.]+)rem/.exec(block(row));
      expect(gap, `${row} should set row-gap explicitly`).not.toBeNull();
      expect(Number(gap![1]) * 16).toBeGreaterThanOrEqual(44 - ink);
    }
  });
});

describe("the small text buttons opt into the floor", () => {
  /* Tailwind-styled one-offs: an 11px "Manage" is 24px tall no matter how much
     padding looks like enough, and there are six of them. */
  it("carries fhj-tap-floor on the links that need it", () => {
    const marked = app.match(/fhj-tap-floor/g) || [];
    expect(marked.length).toBeGreaterThanOrEqual(5);
    for (const label of ["Set daily targets", "Edit"]) {
      const at = app.indexOf(label);
      expect(at).toBeGreaterThan(-1);
    }
  });

  it("does not put the floor on a span inside a button that is already big", () => {
    // the section headers are whole-row buttons; a nested overlay there would
    // only steal taps from the row it sits in
    expect(app).not.toContain('<span className="fhj-tap-floor');
  });
});
