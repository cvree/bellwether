/* The design system, held to its own word.
 *
 * The stylesheet opens by describing a system — one spacing scale, one radius
 * scale, a motion ladder, a palette read back out of theme.ts. Every rule in
 * this file exists because that description had drifted from what the file
 * actually did, and prose cannot notice when it stops being true.
 *
 * Source assertions, for the same reason tapTargets.test.ts gives: jsdom has no
 * layout engine and no cascade worth measuring, so a test that mounts the app
 * and reads a computed style learns nothing. What can be pinned honestly is the
 * CSS that produces the result, and the markup that opts into it. The
 * measurements quoted in the comments came from Playwright against the dev
 * server at 320-430px, in both themes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const css = read("src/styles/index.css");
const app = read("src/App.tsx");
const firstRun = read("src/components/FirstRun.tsx");
const appearance = read("src/components/AppearancePanel.tsx");

/** Every `transition:` / `animation:` value in the file, with its property. */
function motionDeclarations(): { prop: string; value: string }[] {
  const out: { prop: string; value: string }[] = [];
  const re = /\b(transition|animation)\s*:([^;{}]*);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ prop: m[1], value: m[2] });
  return out;
}

describe("the motion ladder", () => {
  /* The token block used to say "two durations, two curves. A third of either
     is usually a component asking for attention it hasn't earned." There were
     thirty-three, and the three commonest — 130ms, 260ms and 220ms — were
     painting 147, 99 and 76 elements on the dashboard alone. 220 and 260 are
     eighteen percent apart, which is under the point where anyone can tell two
     durations apart: they were never two speeds. */
  const RUNGS = ["press", "quick", "ease", "enter", "settle", "ambient"] as const;

  it("names every rung it moves at", () => {
    const ms: Record<string, number> = {};
    for (const r of RUNGS) {
      const m = new RegExp(`--fhj-${r}:\\s*(\\d+)ms`).exec(css);
      expect(m, `--fhj-${r} should be declared`).not.toBeNull();
      ms[r] = Number(m![1]);
    }
    // Ordered, and far enough apart that two rungs read as two speeds rather
    // than as one speed done twice. 1.35x is the floor; the ladder sits near
    // 1.5x and the ambient step is wider still.
    const order = RUNGS.map((r) => ms[r]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `${RUNGS[i]} must be slower than ${RUNGS[i - 1]}`).toBeGreaterThan(order[i - 1]);
      expect(order[i] / order[i - 1]).toBeGreaterThanOrEqual(1.35);
    }
  });

  it("leaves no unnamed duration in the band the rungs cover", () => {
    /* Above `ambient` the file keeps literals on purpose — those are the long
       atmosphere fades, where the exact number is a one-off rather than a rung.
       Inside the band, a bare number is drift: it is a speed nobody named and
       the next component cannot find. */
    const strays: string[] = [];
    for (const { prop, value } of motionDeclarations()) {
      const times = [...value.matchAll(/\b(\d+)ms\b/g)].map((m) => Number(m[1]));
      times.forEach((n, i) => {
        // An `animation` shorthand's second time is a delay, not a duration.
        if (prop === "animation" && i > 0) return;
        if (n >= 90 && n <= 460) strays.push(`${prop}: ${value.trim().slice(0, 60)} → ${n}ms`);
      });
    }
    expect(strays).toEqual([]);
  });

  it("keeps delays as literals, because a delay is rhythm and not speed", () => {
    /* Borrowing `--fhj-ambient` for the coach mark's 900ms wait made the
       stylesheet say "this moves at ambient speed" about something that does
       not move for 900ms and then moves at 520. Same number, wrong word. */
    const delayed = /animation:\s*fhjCoachIn\s+520ms\s+var\(--fhj-spring\)\s+both\s+900ms/;
    expect(css).toMatch(delayed);
    for (const m of css.matchAll(/(transition|animation)-delay:\s*([^;]+);/g)) {
      expect(m[2], "a delay should not be spelled as a duration rung").not.toMatch(
        /var\(--fhj-(press|quick|ease|enter|settle|ambient)\)/
      );
    }
  });
});

describe("a rung's fill and the ink on it travel together", () => {
  /* `.fhj-pulse-rung.is-picked` and `.fhj-fr-rung.is-picked` hardcoded
     `color: #121419` over a fill taken from the severity ramp. The ramp inverts
     between themes — bright on the dark ground, dark on paper — so light theme
     put near-black on #33795A through #B54039 and measured 3.30-3.53:1, under
     AA, on the Daily Pulse. Dark measured 7.13-10.02:1, which is why it lived
     this long. With `readableInk` choosing, light reads 5.22-5.59:1 and dark is
     unchanged to two decimal places. */
  const PICKED = [".fhj-pulse-rung.is-picked", ".fhj-fr-rung.is-picked", ".fhj-scale-rung.is-filled"];

  function block(selector: string): string {
    const i = css.indexOf(`\n${selector} {`);
    if (i < 0) return "";
    const start = css.indexOf("{", i);
    return css.slice(start + 1, css.indexOf("}", start));
  }

  for (const sel of PICKED) {
    it(`${sel} takes its label colour from the fill`, () => {
      const b = block(sel);
      expect(b, `${sel} should exist`).not.toBe("");
      expect(b).toMatch(/color:\s*var\(--fhj-on-rung/);
      // No literal may sit in the `color` slot: that is the whole bug.
      expect(b).not.toMatch(/color:\s*#[0-9a-fA-F]{3,8}\s*;/);
    });
  }

  it("every place that sets --fhj-rung also says what goes on top of it", () => {
    for (const [name, src] of [["App.tsx", app], ["FirstRun.tsx", firstRun]] as const) {
      const fills = (src.match(/"--fhj-rung"/g) || []).length;
      const inks = (src.match(/"--fhj-on-rung"/g) || []).length;
      // App.tsx hands both over through `rungInk`, which is one mention of each.
      expect(inks, `${name} sets --fhj-rung ${fills}x but --fhj-on-rung ${inks}x`).toBe(fills);
    }
    expect(app).toMatch(/const rungInk = \(fill\) => \(\{[^}]*readableInk\(fill\)/);
  });
});

describe("one segmented control, not two", () => {
  /* `.fhj-seg` lived only in the Appearance panel: its own padding, its own
     radius, no border, and a solid accent fill for the selected option where
     every other segmented control in the app raises a bordered card. Two
     shapes doing one job, and the loud one sat on the screen whose entire
     purpose is choosing how the app should look. */
  it("has no second implementation left in the stylesheet", () => {
    expect(css).not.toMatch(/^\.fhj-seg\s*\{/m);
    expect(css).not.toMatch(/^\.fhj-seg\s*>\s*button\s*\{/m);
  });

  it("puts Appearance on the same control as the rest of the app", () => {
    expect(appearance).not.toContain('className="fhj-seg"');
    expect((appearance.match(/className="fhj-segmented"/g) || []).length).toBe(2);
    expect(appearance).toContain('"fhj-segment" + (active ? " is-active" : "")');
  });

  it("refuses to let one segment be two lines tall", () => {
    /* "12 months" broke after "12" and made the Insights range picker 61px
       against the 52px of the control below it on any phone 390px or narrower.
       The label is "1 year" now, and the rule is the guard for the next one. */
    const i = css.indexOf("\n.fhj-segment {");
    expect(css.slice(i, css.indexOf("}", i))).toContain("white-space: nowrap");
    expect(app).toContain('{ value: "365", label: "1 year", prose: "last 12 months", days: 365 },');
  });
});

describe("the scales that already exist are the ones that get used", () => {
  it("writes a pill radius as the token, not as 999px", () => {
    /* 24 of these. The token was right there. */
    const literals = [...css.matchAll(/border-[a-z-]*radius:\s*([^;]+);/g)]
      .filter((m) => /\b999px\b/.test(m[1]))
      .map((m) => m[0]);
    expect(literals).toEqual([]);
  });

  it("keeps the palette in theme.ts, not in the stylesheet", () => {
    /* A hex in a `color:` or `background:` is a colour that cannot follow the
       theme. Masks (#000 as a luminance stop), print rules and `var()`
       fallbacks are all legitimate; a bare paint value is not. */
    const strays: string[] = [];
    const print = css.indexOf("@media print");
    for (const m of css.matchAll(/(^|\n)\s*(color|background|background-color):\s*(#[0-9a-fA-F]{3,8})\s*(!important)?;/g)) {
      if (print >= 0 && m.index! > print) continue; // print is a fixed medium
      strays.push(m[0].trim());
    }
    expect(strays).toEqual([]);
  });
});
