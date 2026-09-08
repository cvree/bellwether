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
const theme = read("src/lib/theme.ts");

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

describe("muted is the placeholder colour, not a fourth shade of text", () => {
  /* The ink ramp is ink > sub > subtle > muted, and light's `muted` carries a
     comment saying it was solved to clear 3:1 on `faint` — the placeholder
     bar. It does not clear the 4.5:1 body text needs on any surface in either
     theme: measured 3.17-4.32:1 across card, faint and page. Thirteen rules
     and four call sites were using it for content anyway — the unit beside a
     dose, the day initials over the week strip, the labels saying which photo
     is which side of the comparison slider.

     What may keep it is what it was tuned for: ghost text in an empty field,
     an `is-unset` value, the strike on a done step, and `.fhj-tune-of`, which
     is 24px and so is held to the 3:1 large-text bar it already clears. */
  const ALLOWED = /::placeholder|is-empty|is-unset|is-done|fhj-tune-of/;

  it("colours nothing readable in the stylesheet", () => {
    const lines = css.split("\n");
    const strays: string[] = [];
    lines.forEach((line, i) => {
      if (!/(^|\s)color:\s*var\(--fhj-muted/.test(line)) return;
      let sel = "?";
      for (let j = i; j >= 0 && j > i - 40; j--) {
        const t = lines[j];
        if (t.includes("{") && !t.trim().startsWith("/*") && !t.trim().startsWith("*") && !t.split("{")[0].includes("@")) {
          sel = t.split("{")[0].trim();
          break;
        }
      }
      if (!ALLOWED.test(sel)) strays.push(`${sel} (line ${i + 1})`);
    });
    expect(strays).toEqual([]);
  });

  it("colours nothing readable from the components either", () => {
    expect(app).not.toMatch(/color:\s*C\.muted/);
    expect(firstRun).not.toMatch(/color:\s*C\.muted/);
  });
});

describe("a token used outside its scope still follows the theme", () => {
  /* `--fhj-tint-text` and `--fhj-tint-soft` were set only inside the six
     `.fhj-cat-*` scopes, so every rule that used them elsewhere — the search
     screen's syntax examples and kind chips — fell through to the literal in
     the `var()` fallback. That literal is the dark palette, so on paper those
     examples were dark-theme blue on cream at 1.75:1. `--fhj-thumb` was never
     defined at all, which left the control for *choosing an accent* painting
     the dark theme's accent whatever you chose. */
  it("gives the category tint a root default", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("/* ---------- base"));
    for (const t of ["--fhj-mark", "--fhj-tint-soft", "--fhj-tint-text"]) {
      expect(root, `${t} should default at :root`).toContain(`${t}: var(--fhj-accent`);
    }
  });

  it("leaves no colour token undefined behind a literal fallback", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("/* ---------- base"));
    const painted = new Set<string>();
    for (const m of theme.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*["']/gm))
      painted.add("--fhj-" + m[1].replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
    for (const m of root.matchAll(/(--fhj-[a-z0-9-]+):/g)) painted.add(m[1]);

    const strays = new Set<string>();
    for (const m of css.matchAll(/var\((--fhj-[a-z0-9-]+),\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g)) {
      // A token React sets inline per element is legitimately absent here.
      if (m[1] === "--fhj-rung" || m[1] === "--fhj-on-rung" || m[1] === "--fhj-knob") continue;
      if (!painted.has(m[1])) strays.add(m[1]);
    }
    expect([...strays]).toEqual([]);
  });
});

describe("a class in the markup has a rule behind it", () => {
  /* `.fhj-skin-row` and `.fhj-skin-swatch` were class names with nothing
     behind them. The Fitzpatrick picker in Settings — six options, one of
     which has to look chosen — rendered as six lines of centred naked text
     with no card, no border and no selected state, and the swatch that was
     supposed to show each skin tone was a 0x0 span. `aria-pressed` and
     `data-on` were both set on the row and neither could be seen. */
  it("styles every fhj- class the components use", () => {
    /* Only what lands in a `className`. The same prefix is also used for
       element ids (`htmlFor`, `aria-describedby`) and for storage keys, and
       neither wants a rule. */
    const used = new Set<string>();
    for (const src of [app, firstRun, appearance])
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{["`]([^"`]*)["`])/g))
        for (const cls of (m[1] ?? m[2]).split(/\s+/))
          if (/^fhj-[a-z0-9-]+$/.test(cls)) used.add(cls);
    const missing = [...used].filter((c) => !css.includes(`.${c}`)).sort();
    expect(missing).toEqual([]);
  });

  it("draws the skin picker as a row you can see the state of", () => {
    const i = css.indexOf("\n.fhj-skin-row {");
    expect(i, ".fhj-skin-row should have a rule").toBeGreaterThan(-1);
    expect(css.slice(i, css.indexOf("}", i))).toContain("min-height: var(--fhj-tap)");
    expect(css).toContain(".fhj-skin-row[data-on]");
    // One tone per Fitzpatrick type, or a swatch is blank for somebody.
    for (const t of [1, 2, 3, 4, 5, 6])
      expect(css, `swatch for type ${t}`).toContain(`.fhj-skin-swatch[data-type="${t}"]`);
  });
});

describe("spacing is written in whole pixels", () => {
  /* A rem is 16px, so the file writes spacing as sixteenths — 0.375rem is 6px,
     0.8125rem is 13px — and a value that lands between two pixels is a soft
     edge in exchange for nothing. Fifteen declarations broke that, and eleven
     of them were in one component: the thumb navigation had been written in
     tenths of a rem, so the bar across the bottom of every screen was measured
     in a different unit from everything above it. */
  it("uses no spacing value that lands off the pixel grid", () => {
    const strays: string[] = [];
    const re = /(^|\n)([^\n{}]*?(?:padding|margin|gap)[a-z-]*:\s*[^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      for (const v of m[2].match(/[\d.]+rem/g) || []) {
        const px = parseFloat(v) * 16;
        // 1.5px is a legitimate optical nudge; anything else must be whole.
        if (Math.abs(px - Math.round(px)) > 1e-6 && px !== 1.5) strays.push(`${m[2].trim()} → ${v} = ${px}px`);
      }
    }
    expect(strays).toEqual([]);
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
