/* The week around the week.

   The design problem this screen has to solve is not "show a calendar". People
   already have a calendar, and a second one inside a health journal would be a
   worse version of an app they already keep open. What they do not have is the
   *shape* of a week — the thing you can only see once seven days are drawn at
   the same scale and the weeks behind them are drawn at the same scale as that.

   So the whole screen is one figure and three questions under it:

   · **The week bar.** Seven columns, height by booked minutes, stacked by
     category. One glance says front-loaded, evenly spread, or gone in three
     days. Tap a column and the day's own commitments unfold beneath it.
   · **Against last week, and against your usual week.** Two comparisons, never
     merged into a score. A number with no baseline is a number nobody can use.
   · **Beside how you felt.** The observations, in the app's own careful voice
     — counts of the person's own days, with the sample printed alongside, and
     nothing at all until there is enough.

   And one rule that is visual rather than editorial: **a day the calendar does
   not cover is drawn differently from a day with nothing in it.** They are
   different facts and the eye has to be able to tell them apart, or the first
   week after connecting reads as a fortnight of doing nothing. */

import React, { useMemo, useState } from "react";
import {
  DEFAULT_SCHEDULE_CONSENT, EVENT_KINDS, KIND_DEMAND, KIND_LABEL, SCHEDULE_COPY,
  compareWeeks, dayLoad, deltaLine, hoursLabel, hasCoverage, isCommitment,
  prettyClock, scheduleObservations, segmentsOn, shiftDay, usualWeek, weekDates,
  weekLabel, weekShape, weekStart, weeksIn, weekdayOf,
  type CalEvent, type Coverage, type EventKind, type ScheduleConsent, type WeekShape,
} from "../lib/schedule";
import { MIN_READING_WEEKS, localWeekSentence, type ScheduleReading } from "../lib/scheduleAi";
import { CLIENT_ID_STEPS, GOOGLE_NOTE, looksLikeClientId, type CalendarRef } from "../lib/googleCalendar";

export type Props = {
  consent: ScheduleConsent;
  events: CalEvent[];
  coverage?: Coverage;
  entries: { date: string; answers?: Record<string, unknown> }[];
  today: string;
  /** The journal's key metric, which the observations are about. */
  keyField?: { k: string; label: string; dir?: "sym" | "pos" | "neutral" };
  calendars?: CalendarRef[];
  viewer?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Set when this build (or this device) has a Google client id at all. */
  canGoogle?: boolean;
  /** Set when an AI connection exists, which is what the reading needs. */
  aiReady?: boolean;
  reading?: ScheduleReading;
  readingBusy?: boolean;
  readingError?: string | null;
  onConnectGoogle?: () => void;
  onSaveClientId?: (id: string) => void;
  onImportFile?: (file: File) => void;
  onPatchConsent?: (patch: Partial<ScheduleConsent>) => void;
  onRefresh?: () => void;
  onForget?: () => void;
  onCorrectKind?: (id: string, kind: EventKind) => void;
  onRunReading?: () => void;
  onHighlight?: (dates: string[], label: string) => void;
  onFeedback?: (kind: string) => void;
};

export default function ScheduleScreen(props: Props) {
  const {
    consent = DEFAULT_SCHEDULE_CONSENT, events = [], coverage, entries = [], today,
    keyField, viewer = false, busy = false, error, reading,
  } = props;

  const startsOn = consent.weekStartsOn === 0 ? 0 : 1;
  const [anchor, setAnchor] = useState(() => weekStart(today, startsOn));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [against, setAgainst] = useState<"last" | "usual">("last");
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState<CalEvent | null>(null);

  const connected = consent.enabled && consent.source !== "off";

  const weeks = useMemo(
    () => weeksIn(events, coverage, { startsOn, until: today }),
    [events, coverage, startsOn, today]
  );
  const week = useMemo(
    () => weekShape(events, anchor, { startsOn, coverage }),
    [events, anchor, startsOn, coverage]
  );
  const previous = useMemo(
    () => weekShape(events, shiftDay(anchor, -7), { startsOn, coverage }),
    [events, anchor, startsOn, coverage]
  );
  const usual = useMemo(() => usualWeek(weeks), [weeks]);
  const observations = useMemo(
    () => (keyField
      ? scheduleObservations(entries, events, coverage, weeks,
        { key: keyField.k, label: keyField.label, dir: keyField.dir }, 3)
      : []),
    [entries, events, coverage, weeks, keyField]
  );

  if (!connected) return <Offer {...props} />;

  const baseline = against === "last" ? previous : usual;
  const deltas = baseline && baseline.covered ? compareWeeks(week, baseline) : [];
  const atLatest = anchor >= weekStart(today, startsOn);

  return (
    <div className="fhj-sch">
      <header className="fhj-exp-head">
        <h1 className="fhj-page-title">Your week</h1>
        <p className="fhj-exp-lede">{SCHEDULE_COPY.intro}</p>
      </header>

      {error && <div className="fhj-sch-error">{error}</div>}

      <div className="fhj-sch-weeknav">
        <button type="button" className="fhj-icon-btn" aria-label="Previous week"
          onClick={() => { setAnchor(shiftDay(anchor, -7)); setOpenDay(null); }}>‹</button>
        <div className="fhj-sch-weeknav-mid">
          <div className="fhj-sch-weeknav-label">
            {atLatest ? "This week" : weekLabel(week.start, week.end)}
          </div>
          {!atLatest && <div className="fhj-sch-weeknav-sub">{weekdayOf(week.start)} to {weekdayOf(week.end)}</div>}
        </div>
        <button type="button" className="fhj-icon-btn" aria-label="Next week" disabled={atLatest}
          onClick={() => { setAnchor(shiftDay(anchor, 7)); setOpenDay(null); }}>›</button>
      </div>

      <WeekBar
        week={week} events={events} coverage={coverage} startsOn={startsOn}
        openDay={openDay} today={today}
        onPick={(d) => setOpenDay(openDay === d ? null : d)}
      />

      {week.covered === 0 ? (
        <p className="fhj-sch-uncovered">{SCHEDULE_COPY.noCoverage}</p>
      ) : (
        <p className="fhj-sch-sentence">{localWeekSentence(week, usual)}</p>
      )}

      <KindStrip week={week} />

      {openDay && (
        <DayPanel
          date={openDay} events={events} titles={!!consent.titles} viewer={viewer}
          onClose={() => setOpenDay(null)} onEdit={setEditing}
        />
      )}

      {deltas.length > 0 && (
        <section className="fhj-section">
          <div className="fhj-section-title">
            <span>Against</span>
            <div className="fhj-segmented fhj-sch-against">
              {([["last", "last week"], ["usual", "your usual week"]] as const).map(([id, label]) => (
                <button key={id} type="button" className="fhj-segment" aria-pressed={against === id}
                  disabled={id === "usual" && !usual}
                  onClick={() => setAgainst(id)}>{label}</button>
              ))}
            </div>
          </div>
          <ul className="fhj-sch-deltas">
            {deltas.filter((d) => d.diff !== 0).slice(0, 5).map((d) => (
              <li key={d.key} className="fhj-sch-delta">
                <span className="fhj-sch-delta-label">{d.label}</span>
                <span className="fhj-sch-delta-val" data-up={d.diff > 0 ? "true" : "false"}>
                  {deltaLine(d)}
                </span>
              </li>
            ))}
            {deltas.every((d) => d.diff === 0) && (
              <li className="fhj-sch-delta"><span className="fhj-sch-delta-label">Nothing moved.</span></li>
            )}
          </ul>
          <p className="fhj-caption">
            {against === "last"
              ? "Compared per covered day, so a short week isn't counted as a quiet one."
              : `The middle of your ${weeks.length} recorded weeks, field by field.`}
          </p>
        </section>
      )}

      {observations.length > 0 && (
        <section className="fhj-section">
          <div className="fhj-section-title"><span>Beside how you felt</span></div>
          <div className="fhj-sch-obs">
            {observations.map((o) => (
              <button key={o.id} type="button" className="fhj-sch-ob"
                onClick={() => props.onHighlight?.(o.dates, o.headline)}>
                <div className="fhj-sch-ob-head">{o.headline}</div>
                <div className="fhj-sch-ob-detail">{o.detail}</div>
                <div className="fhj-sch-ob-go">
                  Light up {o.dates.length} {o.dates.length === 1 ? "day" : "days"} →
                </div>
              </button>
            ))}
          </div>
          <p className="fhj-caption">{SCHEDULE_COPY.notProof}</p>
        </section>
      )}

      <Reading
        weeks={weeks.length} reading={reading} aiReady={!!props.aiReady && !viewer}
        allowed={!!consent.aiWeeks} busy={!!props.readingBusy} error={props.readingError}
        onRun={props.onRunReading} onAllow={() => props.onPatchConsent?.({ aiWeeks: true })}
      />

      <div className="fhj-sch-foot">
        {!viewer && (
          <button type="button" className="fhj-btn fhj-btn-outline" disabled={busy} onClick={props.onRefresh}>
            {busy ? "Reading your calendar…" : "Refresh"}
          </button>
        )}
        <button type="button" className="fhj-linkish fhj-tap-floor" onClick={() => setSettings(true)}>
          How this is connected
        </button>
      </div>

      {settings && <SettingsSheet {...props} onClose={() => setSettings(false)} />}
      {editing && (
        <KindSheet
          event={editing} titles={!!consent.titles}
          onClose={() => setEditing(null)}
          onPick={(k) => { props.onCorrectKind?.(editing.id, k); props.onFeedback?.("save"); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ---------- the figure ---------- */

/** Seven columns at one scale.

    Two decisions carry this figure.

    **The scale is the busiest day of the week, or four hours, whichever is
    larger.** Without a floor, a week containing one forty-minute call draws
    that call full height and reads as a punishing week. The shape has to stay
    comparable with the person's own other weeks or it is decoration.

    **The columns are tinted by demand, not by category.** Ten hues stacked in a
    38px-wide column is a colour-matching puzzle rather than a figure — nobody
    reads it, they just see "busy". Three tones answer the question this figure
    is actually for: how much of the week was owed to somebody, and how much was
    the person's own. The ten categories get their own labelled row below, where
    there is room to name them. */
function WeekBar({
  week, events, coverage, startsOn, openDay, today, onPick,
}: {
  week: WeekShape; events: CalEvent[]; coverage?: Coverage; startsOn: 0 | 1;
  openDay: string | null; today: string; onPick: (date: string) => void;
}) {
  const dates = weekDates(week.start, startsOn);
  const peak = Math.max(240, ...week.days.map((d) => d.minutes));
  const DEMANDS = ["obligation", "neutral", "restorative"] as const;
  return (
    <div className="fhj-sch-bar" role="group" aria-label="Booked time each day this week">
      {dates.map((date) => {
        const covered = !coverage || hasCoverage(coverage, date);
        const load = covered ? dayLoad(events, date) : null;
        const pct = load ? Math.round((load.minutes / peak) * 100) : 0;
        const byDemand = (d: (typeof DEMANDS)[number]) =>
          load ? EVENT_KINDS.filter((k) => KIND_DEMAND[k] === d).reduce((a, k) => a + load.byKind[k], 0) : 0;
        return (
          <button
            key={date} type="button" className="fhj-sch-col"
            aria-pressed={openDay === date}
            data-covered={covered ? "true" : "false"}
            data-today={date === today ? "true" : "false"}
            disabled={!covered}
            onClick={() => onPick(date)}
            aria-label={
              /* Four states, not two. A day holding only a public holiday books
                 no minutes and is not clear either — announcing it as "0m" is
                 the screen reader being told a number where a fact belongs. */
              !covered ? `${weekdayOf(date)}: no calendar for this day`
                : load!.clear ? `${weekdayOf(date)}: nothing booked`
                  : load!.minutes === 0 ? `${weekdayOf(date)}: all day, nothing timed`
                    : `${weekdayOf(date)}: ${hoursLabel(load!.minutes)}`
            }
          >
            <span className="fhj-sch-col-track">
              <span className="fhj-sch-col-stack" style={{ height: `${Math.min(100, pct)}%` }}>
                {DEMANDS.map((d) => byDemand(d) > 0 && (
                  <span key={d} className="fhj-sch-seg" data-demand={d} style={{ flexGrow: byDemand(d) }} />
                ))}
              </span>
              {load && load.clear && covered && <span className="fhj-sch-col-clear" aria-hidden />}
              {!covered && <span className="fhj-sch-col-unknown" aria-hidden />}
            </span>
            <span className="fhj-sch-col-day">{weekdayOf(date).slice(0, 1)}</span>
            {load && load.allDay > 0 && <span className="fhj-sch-col-allday" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/** What the week was made of.

    One horizontal bar with the categories named under it. This is where ten
    hues are affordable, because each one has its own word beside it and
    nothing has to be matched back to a legend somewhere else on the screen.
    Categories under a twentieth of the week are folded into the last segment
    rather than drawn as slivers nobody can see or tap. */
function KindStrip({ week }: { week: WeekShape }) {
  if (!week.minutes) return null;
  const rows = EVENT_KINDS
    .map((k) => ({ k, mins: week.byKind[k] }))
    .filter((r) => r.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  if (!rows.length) return null;
  return (
    <section className="fhj-section">
      <div className="fhj-section-title"><span>What it was made of</span></div>
      <div className="fhj-sch-kindbar" role="img"
        aria-label={rows.map((r) => `${KIND_LABEL[r.k]} ${hoursLabel(r.mins)}`).join(", ")}>
        {rows.map((r) => (
          <span key={r.k} className="fhj-sch-kindbar-seg" data-kind={r.k} style={{ flexGrow: r.mins }} />
        ))}
      </div>
      <ul className="fhj-sch-legend">
        {rows.map((r) => (
          <li key={r.k} className="fhj-sch-legend-item">
            <span className="fhj-sch-event-dot" data-kind={r.k} aria-hidden />
            <span className="fhj-sch-legend-name">{KIND_LABEL[r.k]}</span>
            <span className="fhj-sch-legend-val">{hoursLabel(r.mins)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- one day ---------- */

function DayPanel({
  date, events, titles, viewer, onClose, onEdit,
}: {
  date: string; events: CalEvent[]; titles: boolean; viewer: boolean;
  onClose: () => void; onEdit: (e: CalEvent) => void;
}) {
  const segs = useMemo(() => segmentsOn(events, date, true), [events, date]);
  const load = useMemo(() => dayLoad(events, date), [events, date]);
  return (
    <section className="fhj-sch-day">
      <div className="fhj-sch-day-head">
        <div>
          <div className="fhj-eyebrow">{weekdayOf(date)}</div>
          <div className="fhj-sch-day-sum">
            {load.clear ? "Nothing booked" : `${hoursLabel(load.minutes)} booked`}
            {load.firstStart && ` · ${prettyClock(load.firstStart)}–${prettyClock(load.lastEnd)}`}
            {load.backToBack > 1 && ` · ${load.backToBack} in a row`}
          </div>
        </div>
        <button type="button" className="fhj-icon-btn" aria-label="Close" onClick={onClose}>×</button>
      </div>

      {segs.length === 0 ? (
        <p className="fhj-sch-day-empty">Nothing in the calendar for this day.</p>
      ) : (
        <ul className="fhj-sch-events">
          {segs.map((s, i) => {
            const e = s.event;
            const skipped = !isCommitment(e);
            return (
              <li key={`${e.id}_${i}`}>
                <button type="button" className="fhj-sch-event" data-skipped={skipped ? "true" : "false"}
                  disabled={viewer} onClick={() => !viewer && onEdit(e)}>
                  <span className="fhj-sch-event-dot" data-kind={e.kind} aria-hidden />
                  <span className="fhj-sch-event-main">
                    <span className="fhj-sch-event-name">
                      {titles && e.title ? e.title : KIND_LABEL[e.kind]}
                    </span>
                    <span className="fhj-sch-event-meta">
                      {e.allDay ? "All day" : `${prettyClock(e.time)} · ${hoursLabel(s.minutes)}`}
                      {e.people >= 2 && ` · ${e.people} people`}
                      {e.going === "no" && " · you declined"}
                      {!e.busy && e.going !== "no" && " · marked free"}
                      {e.repeating && " · repeats"}
                    </span>
                  </span>
                  {titles && e.title && (
                    <span className="fhj-sch-event-kind" data-source={e.kindSource}>
                      {KIND_LABEL[e.kind]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!viewer && segs.length > 0 && <p className="fhj-caption">{SCHEDULE_COPY.guessed}</p>}
    </section>
  );
}

/* ---------- correcting a category ---------- */

function KindSheet({
  event, titles, onClose, onPick,
}: { event: CalEvent; titles: boolean; onClose: () => void; onPick: (k: EventKind) => void }) {
  return (
    <div className="fhj-scrim" role="dialog" aria-modal="true" aria-label="Change category" onClick={onClose}>
      <div className="fhj-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="fhj-sheet-grab" aria-hidden />
        <div className="fhj-sheet-head">
          <h2 className="fhj-sheet-title">What was this?</h2>
          <p className="fhj-caption">
            {titles && event.title ? event.title : `${weekdayOf(event.date)}, ${prettyClock(event.time) || "all day"}`}
            {" — this sticks, and a re-sync won't undo it."}
          </p>
        </div>
        <div className="fhj-sheet-body">
          <div className="fhj-sch-kinds">
            {EVENT_KINDS.map((k) => (
              <button key={k} type="button" className="fhj-chip" aria-pressed={event.kind === k}
                onClick={() => onPick(k)}>
                <span className="fhj-sch-event-dot" data-kind={k} aria-hidden />
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="fhj-sheet-actions">
          <button type="button" className="fhj-btn fhj-btn-ghost fhj-btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- the model's reading ---------- */

function Reading({
  weeks, reading, aiReady, allowed, busy, error, onRun, onAllow,
}: {
  weeks: number; reading?: ScheduleReading; aiReady: boolean; allowed: boolean;
  busy: boolean; error?: string | null; onRun?: () => void; onAllow?: () => void;
}) {
  if (!aiReady && !reading) return null;
  const enough = weeks >= MIN_READING_WEEKS;

  return (
    <section className="fhj-section fhj-cat-ai">
      <div className="fhj-section-title"><span>Read the weeks</span></div>

      {!allowed ? (
        <div className="fhj-card fhj-sch-ai-offer">
          <p>
            The comparisons above are arithmetic you can check. A model can also read the
            shape of {weeks} weeks at once and say what it notices — front-loaded, easing off,
            unusual for you.
          </p>
          <p className="fhj-caption">
            What would be sent: the weekly numbers only. No event titles, no dates, no names —
            and your own rating for each week if you've picked one, so it can put the two side by side.
          </p>
          <button type="button" className="fhj-btn fhj-btn-outline" onClick={onAllow}>
            Allow this
          </button>
        </div>
      ) : !enough ? (
        <p className="fhj-caption">
          {MIN_READING_WEEKS - weeks} more full {MIN_READING_WEEKS - weeks === 1 ? "week" : "weeks"} of
          calendar and this can run. Comparing with fewer would be comparing with one week.
        </p>
      ) : (
        <>
          <button type="button" className="fhj-btn fhj-btn-outline" disabled={busy} onClick={onRun}>
            {busy ? "Reading…" : reading ? "Read again" : `Read my last ${weeks} weeks`}
          </button>
          {error && <p className="fhj-sch-error">{error}</p>}
        </>
      )}

      {reading && (
        <div className="fhj-card fhj-sch-reading">
          <p className="fhj-sch-reading-summary">{reading.summary}</p>
          {reading.observations.map((o) => (
            <div key={o.id} className="fhj-sch-reading-ob">
              <div className="fhj-sch-reading-head">{o.headline}</div>
              <div className="fhj-sch-reading-evidence">{o.evidence}</div>
              <div className="fhj-sch-reading-meta">
                Weeks {o.weekFrom}–{o.weekTo} · {o.strength}
              </div>
            </div>
          ))}
          {reading.note && <p className="fhj-caption">{reading.note}</p>}
          <p className="fhj-caption">
            Written by a model from {reading.weeks} weeks of numbers
            {reading.includedRating ? " and your own weekly ratings" : ""}. It can be wrong,
            and it never saw an event title.
          </p>
        </div>
      )}
    </section>
  );
}

/* ---------- the offer, before anything is connected ---------- */

function Offer(props: Props) {
  const { canGoogle, busy, error, viewer } = props;
  const [route, setRoute] = useState<"google" | "file">(canGoogle ? "google" : "file");
  const [clientId, setClientId] = useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="fhj-sch">
      <header className="fhj-exp-head">
        <h1 className="fhj-page-title">Your week</h1>
        <p className="fhj-exp-lede">{SCHEDULE_COPY.intro}</p>
      </header>

      <div className="fhj-card fhj-sch-promise">
        <div className="fhj-eyebrow">What this keeps</div>
        <ul className="fhj-sch-promise-list">
          <li>When things started, how long they ran, how many people were in them.</li>
          <li>The category each one worked out to — a guess you can correct.</li>
          <li><b>Not the titles</b>, unless you switch that on separately.</li>
        </ul>
        <p className="fhj-caption">{SCHEDULE_COPY.titlesOff}</p>
      </div>

      {error && <div className="fhj-sch-error">{error}</div>}

      <div className="fhj-segmented fhj-sch-routes">
        <button type="button" className="fhj-segment" aria-pressed={route === "google"}
          onClick={() => setRoute("google")}>Google Calendar</button>
        <button type="button" className="fhj-segment" aria-pressed={route === "file"}
          onClick={() => setRoute("file")}>A calendar file</button>
      </div>

      {route === "google" ? (
        <div className="fhj-card">
          <p>{GOOGLE_NOTE}</p>
          {canGoogle ? (
            <button type="button" className="fhj-btn fhj-btn-primary fhj-btn-block" disabled={busy || viewer}
              onClick={props.onConnectGoogle}>
              {busy ? "Waiting for Google…" : "Connect Google Calendar"}
            </button>
          ) : (
            <>
              <p className="fhj-caption">
                This copy of the app has no Google client id set up, so it has nothing to sign you in
                with. You can make one — it takes about three minutes and costs nothing — or use the
                file route, which needs no account at all.
              </p>
              <ol className="fhj-sch-steps">
                {CLIENT_ID_STEPS.map(([title, body], i) => (
                  <li key={i}>
                    <span className="fhj-sch-step-n">{i + 1}</span>
                    <span><b>{title}.</b> <span className="fhj-caption">{body}</span></span>
                  </li>
                ))}
              </ol>
              <input className="fhj-input" value={clientId} placeholder="…apps.googleusercontent.com"
                onChange={(e) => setClientId(e.target.value)} aria-label="Google client ID" />
              <button type="button" className="fhj-btn fhj-btn-primary fhj-btn-block"
                disabled={!looksLikeClientId(clientId)}
                onClick={() => props.onSaveClientId?.(clientId.trim())}>
                Save and connect
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="fhj-card">
          <p>
            Every calendar can export a <b>.ics</b> file — Google, Apple, Outlook, Fastmail, anything
            self-hosted. Open it here and it is read on this device. Nothing is uploaded, nothing is
            signed into, and it keeps working with no network at all.
          </p>
          <ol className="fhj-sch-steps">
            {[
              ["Open your calendar's settings", "In Google Calendar that's the gear, then Settings, then Import & export."],
              ["Export", "You'll get a .zip with one .ics file per calendar, or a single .ics."],
              ["Open the file here", "Unzip it first if you need to, then pick the .ics for the calendar you want."],
              ["Do it again whenever", "Re-importing the same file updates those days rather than duplicating them."],
            ].map(([title, body], i) => (
              <li key={i}>
                <span className="fhj-sch-step-n">{i + 1}</span>
                <span><b>{title}.</b> <span className="fhj-caption">{body}</span></span>
              </li>
            ))}
          </ol>
          <input ref={inputRef} type="file" accept=".ics,text/calendar" className="fhj-sch-file"
            aria-label="Choose a calendar file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImportFile?.(f);
              e.target.value = "";
            }} />
          <button type="button" className="fhj-btn fhj-btn-primary fhj-btn-block" disabled={busy || viewer}
            onClick={() => inputRef.current?.click()}>
            {busy ? "Reading the file…" : "Choose a calendar file"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- what is connected, and how to undo it ---------- */

function SettingsSheet(props: Props & { onClose: () => void }) {
  const { consent, calendars = [], coverage, events = [], onClose } = props;
  const chosen = consent.calendars || [];
  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
    props.onPatchConsent?.({ calendars: next });
  };
  return (
    <div className="fhj-scrim" role="dialog" aria-modal="true" aria-label="Calendar connection" onClick={onClose}>
      <div className="fhj-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="fhj-sheet-grab" aria-hidden />
        <div className="fhj-sheet-head">
          <h2 className="fhj-sheet-title">How this is connected</h2>
          <p className="fhj-caption">
            {consent.source === "google" ? "Google Calendar, read-only." : "A calendar file you opened."}
            {coverage && ` Days covered: ${coverage.start} to ${coverage.end}.`}
            {` ${events.length} ${events.length === 1 ? "entry" : "entries"} stored.`}
          </p>
        </div>

        <div className="fhj-sheet-body">
          {calendars.length > 0 && (
            <>
              <div className="fhj-eyebrow">Which calendars</div>
              {calendars.map((c) => (
                <label key={c.id} className="fhj-switch-row">
                  <span>
                    {c.label}
                    {c.readOnly && <span className="fhj-badge fhj-badge-neutral">shared</span>}
                  </span>
                  <input type="checkbox" className="fhj-switch"
                    checked={chosen.length ? chosen.includes(c.id) : !!c.primary}
                    onChange={() => toggle(c.id)} />
                </label>
              ))}
            </>
          )}

          <div className="fhj-eyebrow">What is stored</div>
          <label className="fhj-switch-row">
            <span>
              Keep event titles
              <span className="fhj-caption">
                Off by default. With it off, the category worked out as each event arrived is kept and
                the words are dropped. Switching it off later erases the titles already stored.
                {consent.titles && events.some((e) => !e.title)
                  ? " Entries already here have no titles to show — they were dropped as they arrived. Refresh to bring them in."
                  : ""}
              </span>
            </span>
            <input type="checkbox" className="fhj-switch" checked={!!consent.titles}
              onChange={(e) => props.onPatchConsent?.({ titles: e.target.checked })} />
          </label>

          <div className="fhj-eyebrow">What may leave this device</div>
          <label className="fhj-switch-row">
            <span>
              Let a model sort unrecognised titles
              <span className="fhj-caption">
                Sends a list of titles the built-in table couldn't place, with a duration and a head
                count each — no dates. Needs titles to be kept, and an AI connection in Settings.
              </span>
            </span>
            <input type="checkbox" className="fhj-switch" disabled={!consent.titles}
              checked={!!consent.aiKinds}
              onChange={(e) => props.onPatchConsent?.({ aiKinds: e.target.checked })} />
          </label>
          <label className="fhj-switch-row">
            <span>
              Let a model read the weekly numbers
              <span className="fhj-caption">
                Sends counts and minutes per week, and your own weekly rating if you've picked a metric.
                No titles, no dates.
              </span>
            </span>
            <input type="checkbox" className="fhj-switch" checked={!!consent.aiWeeks}
              onChange={(e) => props.onPatchConsent?.({ aiWeeks: e.target.checked })} />
          </label>

          <div className="fhj-eyebrow">Weeks start on</div>
          <div className="fhj-segmented">
            {([[1, "Monday"], [0, "Sunday"]] as const).map(([v, label]) => (
              <button key={label} type="button" className="fhj-segment"
                aria-pressed={(consent.weekStartsOn ?? 1) === v}
                onClick={() => props.onPatchConsent?.({ weekStartsOn: v })}>{label}</button>
            ))}
          </div>
        </div>

        <div className="fhj-sheet-actions">
          <button type="button" className="fhj-btn fhj-btn-secondary fhj-btn-block" onClick={onClose}>Done</button>
          <button type="button" className="fhj-btn fhj-btn-danger fhj-btn-block"
            onClick={() => { props.onForget?.(); onClose(); }}>
            Disconnect and delete every entry
          </button>
        </div>
      </div>
    </div>
  );
}
