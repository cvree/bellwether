/* About you — the standing record.

   The design problem this screen has, and nothing else in the app has, is that
   the honest version of it is sixteen sections long. A biopsychosocial history
   really does ask about conditions, allergies, operations, treatments, family,
   substances, daily activities, stressors, coping, life events, people,
   housing, work, background, money and enjoyment. Drawn as sixteen empty
   sections it is a form, and nobody fills in a form. Drawn as one long scroll
   of optional fields it is worse: it looks like homework somebody is failing.

   So three decisions.

   **The unit is a domain, not a section.** Body, Mind, Life — three cards,
   each saying how much of it has been answered. "Four of seven" is a sentence
   somebody can act on. "Twelve of sixteen sections incomplete" is a scolding.

   **Every section can be finished without typing.** The commonest true answer
   to most of these is nothing, and *nothing* is a real answer that this app
   stores with the date it was given (see rule 3 in `lib/record`). So every
   empty section carries its question in plain words and two buttons, and one
   of them is **Nothing to add**. A section answered that way is done, is
   printed as a statement in the pack, and stops being asked about.

   **And there is a way through it that isn't this screen.** *Run through
   what's left* takes the unanswered kinds one at a time — the question, a deck
   of taps, Nothing to add, Skip — which is the same shape as first run and
   turns twelve outstanding sections into about ninety seconds.

   One thing the screen refuses: it never grades a record. There is no ring
   filling up, no percentage and no green tick on the third card, because a
   person with nothing to say about their family history has a complete record,
   not an 81% one. */

import React, { useMemo, useState } from "react";
import {
  COMMON, DOMAINS, DOMAIN_META, DOMAIN_OF, FACT_KINDS, IMPACT_KINDS,
  IMPACT_LABEL, IMPACT_ORDER, KINDS_IN, KIND_META, LEVEL_LABEL, LEVEL_ORDER,
  PRIVATE_BY_DEFAULT, RELATIONS, SEVERITY_LABEL, SEVERITY_ORDER,
  STATUSES_FOR, STATUS_LABEL, ALLERGY_TYPE_LABEL,
  alertFacts, factDetail, factLine, factsOfKind, formatPartial, isNone,
  isPartialDate, newFact, recordSummary, sortFacts, unanswered,
  type FactDomain, type FactKind, type HealthFact, type RecordState,
} from "../lib/record";

type Props = {
  facts: HealthFact[];
  state?: RecordState;
  today: string;
  viewer?: boolean;
  /** Add or replace one fact. */
  onSave: (fact: HealthFact) => void;
  onDelete: (id: string) => void;
  /** Mark a kind as holding nothing, or take that back. */
  onStateNone: (kind: FactKind) => void;
  onClearNone: (kind: FactKind) => void;
  /** Confirm the whole record is still current. */
  onReviewed?: () => void;
  onFeedback?: (kind: string) => void;
};

const fmtDay = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
};

/* ---------- the way in ---------- */

export default function RecordScreen({
  facts, state, today, viewer = false,
  onSave, onDelete, onStateNone, onClearNone, onReviewed, onFeedback,
}: Props) {
  const [domain, setDomain] = useState<FactDomain | null>(null);
  const [editing, setEditing] = useState<HealthFact | null>(null);
  const [running, setRunning] = useState(false);

  const summary = useMemo(() => recordSummary(facts, state), [facts, state]);
  const alerts = useMemo(() => alertFacts(facts), [facts]);
  const left = useMemo(() => unanswered(facts, state), [facts, state]);

  const beginAdd = (kind: FactKind) => {
    onFeedback?.("select");
    setEditing(newFact(kind));
  };

  const save = (fact: HealthFact) => {
    onFeedback?.("save");
    onSave({ ...fact, updatedAt: new Date().toISOString() });
    setEditing(null);
  };

  if (running) {
    return (
      <RunThrough
        kinds={left}
        today={today}
        onAdd={(kind, labels) => labels.forEach((label) => onSave(newFact(kind, { label })))}
        onNone={onStateNone}
        onFeedback={onFeedback}
        onDone={() => { onFeedback?.("nav"); setRunning(false); }}
      />
    );
  }

  return (
    <div className="fhj-rec">
      {editing && (
        <FactEditor
          fact={editing}
          today={today}
          onChange={setEditing}
          onSave={save}
          onCancel={() => { onFeedback?.("nav"); setEditing(null); }}
        />
      )}

      {domain ? (
        <DomainView
          domain={domain}
          facts={facts}
          state={state}
          today={today}
          viewer={viewer}
          onBack={() => { onFeedback?.("nav"); setDomain(null); }}
          onAdd={beginAdd}
          onEdit={setEditing}
          onDelete={onDelete}
          onStateNone={onStateNone}
          onClearNone={onClearNone}
          onFeedback={onFeedback}
        />
      ) : (
        <>
          <header className="fhj-exp-head">
            <h1 className="fhj-page-title">About you</h1>
            <p className="fhj-exp-lede">
              The things that are true, as opposed to the things that happened today. Your journal
              can say the last three months in detail; this is what a stranger reading it would
              still need to know first.
            </p>
          </header>

          {alerts.length > 0 && (
            <section className="fhj-rec-alert" role="note">
              <div className="fhj-eyebrow">Read first</div>
              <ul>
                {alerts.map((f) => (
                  <li key={f.id}>
                    <strong>{factLine(f)}</strong>
                    {factDetail(f, today) ? <span> — {factDetail(f, today)}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="fhj-rec-alert-why">
                These are at the top of every appointment pack you print, in a box a reader can't
                skim past.
              </p>
            </section>
          )}

          {!viewer && left.length > 0 && (
            <button
              type="button"
              className="fhj-btn fhj-btn-primary fhj-btn-block fhj-pop"
              onClick={() => { onFeedback?.("select"); setRunning(true); }}
            >
              Run through what's left — {left.length} {left.length === 1 ? "question" : "questions"}
            </button>
          )}

          <div className="fhj-rec-domains">
            {summary.domains.map((d) => (
              <button
                key={d.domain}
                type="button"
                className="fhj-rec-domain"
                onClick={() => { onFeedback?.("nav"); setDomain(d.domain); }}
              >
                <div className="fhj-rec-domain-head">
                  <span className="fhj-rec-domain-name">{d.label}</span>
                  <span className="fhj-rec-domain-count">
                    {d.n > 0 ? `${d.n} ${d.n === 1 ? "thing" : "things"}` : "nothing yet"}
                  </span>
                </div>
                <p className="fhj-rec-domain-blurb">{DOMAIN_META[d.domain].blurb}</p>
                <div className="fhj-rec-domain-foot">
                  {d.missing.length === 0
                    ? "All answered"
                    : `${d.missing.length} not answered yet`}
                </div>
              </button>
            ))}
          </div>

          {summary.private > 0 && (
            <p className="fhj-rec-note">
              {summary.private} {summary.private === 1 ? "entry is" : "entries are"} marked
              private: held here, kept off every pack and export.
            </p>
          )}

          {!viewer && summary.total > 0 && onReviewed && (
            <div className="fhj-rec-review">
              <p className="fhj-rec-note">
                {state?.reviewedAt
                  ? `Last confirmed as current on ${fmtDay(state.reviewedAt)}.`
                  : "A record is only worth what it is current to."}
              </p>
              <button
                type="button"
                className="fhj-btn fhj-btn-outline"
                onClick={() => { onFeedback?.("save"); onReviewed(); }}
              >
                Still accurate today
              </button>
            </div>
          )}

          <p className="fhj-rec-foot">
            Nothing here is sent anywhere. It travels in your backups and your own sync, it prints
            at the top of an appointment pack, and anything you mark private does neither.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------- one domain ---------- */

function DomainView({
  domain, facts, state, today, viewer,
  onBack, onAdd, onEdit, onDelete, onStateNone, onClearNone, onFeedback,
}: {
  domain: FactDomain;
  facts: HealthFact[];
  state?: RecordState;
  today: string;
  viewer: boolean;
  onBack: () => void;
  onAdd: (kind: FactKind) => void;
  onEdit: (f: HealthFact) => void;
  onDelete: (id: string) => void;
  onStateNone: (kind: FactKind) => void;
  onClearNone: (kind: FactKind) => void;
  onFeedback?: (kind: string) => void;
}) {
  const meta = DOMAIN_META[domain];
  return (
    <>
      <button type="button" className="fhj-back" onClick={onBack}>← About you</button>
      <header className="fhj-exp-head">
        <h1 className="fhj-page-title">{meta.label}</h1>
        <p className="fhj-exp-lede">{meta.blurb}</p>
      </header>

      <div className="fhj-rec-sections">
        {KINDS_IN[domain].map((kind) => (
          <KindSection
            key={kind}
            kind={kind}
            facts={factsOfKind(facts, kind)}
            none={isNone(state, kind)}
            statedAt={state?.statedAt?.[kind]}
            today={today}
            viewer={viewer}
            onAdd={() => onAdd(kind)}
            onEdit={onEdit}
            onDelete={onDelete}
            onNone={() => { onFeedback?.("select"); onStateNone(kind); }}
            onClearNone={() => { onFeedback?.("nav"); onClearNone(kind); }}
          />
        ))}
      </div>
    </>
  );
}

function KindSection({
  kind, facts, none, statedAt, today, viewer,
  onAdd, onEdit, onDelete, onNone, onClearNone,
}: {
  kind: FactKind;
  facts: HealthFact[];
  none: boolean;
  statedAt?: string;
  today: string;
  viewer: boolean;
  onAdd: () => void;
  onEdit: (f: HealthFact) => void;
  onDelete: (id: string) => void;
  onNone: () => void;
  onClearNone: () => void;
}) {
  const meta = KIND_META[kind];
  const rows = sortFacts(facts);

  return (
    <section className="fhj-card fhj-rec-section">
      <div className="fhj-rec-section-head">
        <h2 className="fhj-rec-section-title">{meta.label}</h2>
        {!viewer && (
          <button type="button" className="fhj-rec-add" onClick={onAdd}>Add</button>
        )}
      </div>

      {rows.length > 0 ? (
        <ul className="fhj-rec-list">
          {rows.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="fhj-rec-row"
                onClick={() => !viewer && onEdit(f)}
                disabled={viewer}
              >
                <span className="fhj-rec-row-main">
                  <span className="fhj-rec-row-line">
                    {factLine(f)}
                    {f.pinned && <span className="fhj-rec-flag" title="Shown at the top of a pack">★</span>}
                    {f.private && <span className="fhj-rec-flag" title="Never printed or exported">private</span>}
                  </span>
                  {factDetail(f, today) && (
                    <span className="fhj-rec-row-detail">{factDetail(f, today)}</span>
                  )}
                  {f.note && <span className="fhj-rec-row-note">{f.note}</span>}
                </span>
              </button>
              {!viewer && (
                <button
                  type="button"
                  className="fhj-rec-del"
                  aria-label={`Remove ${factLine(f)}`}
                  onClick={() => onDelete(f.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : none ? (
        <div className="fhj-rec-none">
          <p className="fhj-rec-none-line">{meta.noneLine}</p>
          <p className="fhj-rec-none-meta">
            {statedAt ? `You said so on ${fmtDay(statedAt)}. ` : ""}
            This prints as a sentence in your pack, which is the part that matters — a blank
            section would mean nobody asked.
          </p>
          {!viewer && (
            <button type="button" className="fhj-rec-undo" onClick={onClearNone}>
              Actually, there is something
            </button>
          )}
        </div>
      ) : (
        <div className="fhj-rec-ask">
          <p className="fhj-rec-ask-q">{meta.ask}</p>
          <p className="fhj-rec-ask-blurb">{meta.blurb}</p>
          {!viewer && (
            <div className="fhj-rec-ask-actions">
              <button type="button" className="fhj-btn fhj-btn-outline" onClick={onAdd}>
                {meta.add}
              </button>
              <button type="button" className="fhj-btn fhj-btn-ghost" onClick={onNone}>
                Nothing to add
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- the run-through ----------

   One kind per screen, the question at the top, the common answers as taps,
   and the two ways out under them. Multi-select because the true answer to
   "what are you allergic to" is usually two things and making somebody open a
   sheet twice for that is the difference between a record and an abandoned
   one. Everything picked here lands as a plain labelled fact; the detail is
   added later, on the section, by whoever wants to. */

function RunThrough({
  kinds, today, onAdd, onNone, onDone, onFeedback,
}: {
  kinds: FactKind[];
  today: string;
  onAdd: (kind: FactKind, labels: string[]) => void;
  onNone: (kind: FactKind) => void;
  onDone: () => void;
  onFeedback?: (kind: string) => void;
}) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");

  const kind = kinds[i];
  if (!kind) {
    return (
      <div className="fhj-rec">
        <div className="fhj-empty">
          <div className="fhj-empty-title">That's the lot</div>
          <p>Every section has an answer in it now — including the ones you said had nothing.</p>
          <button type="button" className="fhj-btn fhj-btn-primary fhj-btn-block" onClick={onDone}>
            Back to About you
          </button>
        </div>
      </div>
    );
  }

  const meta = KIND_META[kind];
  const advance = () => { setPicked([]); setTyped(""); setI(i + 1); };

  const toggle = (label: string) => {
    onFeedback?.("tap");
    setPicked((p) => (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]));
  };

  const commit = () => {
    const all = [...picked];
    const extra = typed.trim();
    if (extra && !all.includes(extra)) all.push(extra);
    if (!all.length) return;
    onFeedback?.("save");
    onAdd(kind, all);
    advance();
  };

  const none = () => { onFeedback?.("select"); onNone(kind); advance(); };

  return (
    <div className="fhj-rec fhj-rec-run">
      <div className="fhj-rec-run-progress">
        {i + 1} of {kinds.length} · {DOMAIN_META[DOMAIN_OF[kind]].label}
      </div>

      <header className="fhj-exp-head">
        <h1 className="fhj-page-title">{meta.ask}</h1>
        <p className="fhj-exp-lede">{meta.blurb}</p>
      </header>

      <div className="fhj-chip-row fhj-rec-run-chips">
        {COMMON[kind].map((label) => (
          <button
            key={label}
            type="button"
            className={`fhj-chip${picked.includes(label) ? " is-active" : ""}`}
            aria-pressed={picked.includes(label)}
            onClick={() => toggle(label)}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        className="fhj-input"
        placeholder="Something else — type it here"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />

      {PRIVATE_BY_DEFAULT.includes(kind) && (
        <p className="fhj-rec-note">
          Anything added here starts private: held in your journal, kept off every pack and
          export until you say otherwise.
        </p>
      )}

      <div className="fhj-rec-run-actions">
        <button
          type="button"
          className="fhj-btn fhj-btn-primary fhj-btn-block"
          disabled={!picked.length && !typed.trim()}
          onClick={commit}
        >
          {picked.length + (typed.trim() ? 1 : 0) > 0
            ? `Add ${picked.length + (typed.trim() ? 1 : 0)} and continue`
            : "Add and continue"}
        </button>
        <div className="fhj-rec-run-outs">
          <button type="button" className="fhj-btn fhj-btn-outline" onClick={none}>
            Nothing to add
          </button>
          <button type="button" className="fhj-btn fhj-btn-ghost" onClick={advance}>
            Skip for now
          </button>
        </div>
        <p className="fhj-rec-note">
          <strong>Nothing to add</strong> is an answer and gets written down with today's date.
          <strong> Skip</strong> leaves the question open and asks again another time.
        </p>
      </div>

      <button type="button" className="fhj-btn fhj-btn-ghost fhj-btn-block" onClick={onDone}>
        Stop here
      </button>
    </div>
  );
}

/* ---------- the editor ----------

   Fields appear only for the kinds they mean anything on — the whole reason
   `HealthFact` is one shape with a lot of optional fields rather than sixteen
   interfaces. A date is a plain text box that takes a year, a year and month,
   or a full date, and echoes back how it read it: a picker demanding a day
   would be asking for a precision nobody has about the year they were
   diagnosed. */

function FactEditor({
  fact, today, onChange, onSave, onCancel,
}: {
  fact: HealthFact;
  today: string;
  onChange: (f: HealthFact) => void;
  onSave: (f: HealthFact) => void;
  onCancel: () => void;
}) {
  const meta = KIND_META[fact.kind];
  const set = (patch: Partial<HealthFact>) => onChange({ ...fact, ...patch });
  const statuses = STATUSES_FOR[fact.kind];
  const canSave = fact.label.trim().length > 0;

  return (
    <div className="fhj-scrim" role="dialog" aria-modal="true" aria-label={meta.one}>
      <div className="fhj-sheet fhj-rec-sheet">
        <div className="fhj-sheet-grab" aria-hidden />
        <div className="fhj-sheet-head">
          <h2 className="fhj-page-title" style={{ fontSize: 22 }}>{meta.one}</h2>
        </div>

        <div className="fhj-sheet-body">
          <label className="fhj-rec-field">
            <span className="fhj-label">What is it?</span>
            <input
              className="fhj-input"
              value={fact.label}
              onChange={(e) => set({ label: e.target.value })}
              autoFocus
            />
          </label>

          {!fact.label && (
            <div className="fhj-chip-row">
              {COMMON[fact.kind].slice(0, 12).map((c) => (
                <button key={c} type="button" className="fhj-chip" onClick={() => set({ label: c })}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {(fact.kind === "family" || fact.kind === "support") && (
            <label className="fhj-rec-field">
              <span className="fhj-label">Who?</span>
              <input
                className="fhj-input"
                value={fact.relation || ""}
                placeholder={fact.kind === "family" ? "Mother, brother…" : "Partner, best friend, my choir…"}
                onChange={(e) => set({ relation: e.target.value })}
              />
              {fact.kind === "family" && (
                <div className="fhj-chip-row">
                  {RELATIONS.map((r) => (
                    <button key={r} type="button" className="fhj-chip" onClick={() => set({ relation: r })}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </label>
          )}

          {fact.kind === "allergy" && (
            <>
              <Choice
                label="How bad is the reaction?"
                options={SEVERITY_ORDER.map((v) => [v, SEVERITY_LABEL[v]] as const)}
                value={fact.severity}
                onPick={(v) => set({ severity: v })}
              />
              <Choice
                label="What kind?"
                options={(["drug", "food", "environmental", "other"] as const)
                  .map((v) => [v, ALLERGY_TYPE_LABEL[v]] as const)}
                value={fact.allergyType}
                onPick={(v) => set({ allergyType: v })}
              />
              <label className="fhj-rec-field">
                <span className="fhj-label">What happens?</span>
                <input
                  className="fhj-input"
                  value={fact.reaction || ""}
                  placeholder="Hives, swelling, throat closes…"
                  onChange={(e) => set({ reaction: e.target.value })}
                />
              </label>
              {(fact.severity === "severe" || fact.severity === "anaphylaxis") && (
                <p className="fhj-rec-note fhj-rec-note-warn">
                  This will be printed in a bordered box at the top of every appointment pack,
                  above everything else.
                </p>
              )}
            </>
          )}

          {fact.kind === "adl" && (
            <Choice
              label="How is it?"
              options={LEVEL_ORDER.map((v) => [v, LEVEL_LABEL[v]] as const)}
              value={fact.level}
              onPick={(v) => set({ level: v })}
            />
          )}

          {fact.kind === "adl" && (
            <label className="fhj-rec-field">
              <span className="fhj-label">Anything that helps?</span>
              <input
                className="fhj-input"
                value={fact.aid || ""}
                placeholder="Grab rail, stick, shower stool…"
                onChange={(e) => set({ aid: e.target.value })}
              />
            </label>
          )}

          {(fact.kind === "substance" || fact.kind === "work" ||
            fact.kind === "housing" || fact.kind === "money") && (
            <label className="fhj-rec-field">
              <span className="fhj-label">How much?</span>
              <input
                className="fhj-input"
                value={fact.amount || ""}
                placeholder={
                  fact.kind === "substance" ? "14 units a week, 10 a day…"
                    : fact.kind === "work" ? "30 hours a week, four nights…"
                    : fact.kind === "housing" ? "Shared with three others…"
                    : "In your own words"
                }
                onChange={(e) => set({ amount: e.target.value })}
              />
            </label>
          )}

          {IMPACT_KINDS.includes(fact.kind) && (
            <Choice
              label="Does it help or does it cost you?"
              options={IMPACT_ORDER.map((v) => [v, IMPACT_LABEL[v]] as const)}
              value={fact.impact}
              onPick={(v) => set({ impact: v })}
            />
          )}

          {fact.kind === "procedure" && (
            <label className="fhj-rec-field">
              <span className="fhj-label">Where?</span>
              <input
                className="fhj-input"
                value={fact.place || ""}
                onChange={(e) => set({ place: e.target.value })}
              />
            </label>
          )}

          <Choice
            label="Where does it stand?"
            options={statuses.map((v) => [v, STATUS_LABEL[v]] as const)}
            value={fact.status}
            onPick={(v) => set({ status: v })}
          />

          <PartialDate
            label={fact.kind === "procedure" || fact.kind === "event" ? "When?" : "Since when?"}
            value={fact.since}
            onChange={(v) => set({ since: v })}
          />

          {fact.status !== "active" && fact.kind !== "procedure" && (
            <PartialDate label="Until when?" value={fact.until} onChange={(v) => set({ until: v })} />
          )}

          {fact.kind === "substance" && (
            <Toggle
              label="Have you had support or treatment for it?"
              on={!!fact.treated}
              onToggle={() => set({ treated: !fact.treated })}
            />
          )}

          <label className="fhj-rec-field">
            <span className="fhj-label">Anything else worth saying</span>
            <textarea
              className="fhj-input"
              rows={2}
              value={fact.note || ""}
              onChange={(e) => set({ note: e.target.value })}
            />
          </label>

          <Toggle
            label="Show at the top of every pack"
            hint="For the two or three things you want read before anything else."
            on={!!fact.pinned}
            onToggle={() => set({ pinned: !fact.pinned })}
          />

          <Toggle
            label="Keep this private"
            hint="Held here. Never printed in a pack, never in an export, never shown to a model. Your backups still carry it, because a backup is your journal."
            on={!!fact.private}
            onToggle={() => set({ private: !fact.private })}
          />
        </div>

        <div className="fhj-sheet-actions">
          <button type="button" className="fhj-btn fhj-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="fhj-btn fhj-btn-primary"
            disabled={!canSave}
            onClick={() => onSave(fact)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  label, options, value, onPick,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T | undefined;
  onPick: (v: T) => void;
}) {
  return (
    <div className="fhj-rec-field">
      <span className="fhj-label">{label}</span>
      <div className="fhj-chip-row">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            className={`fhj-chip${value === v ? " is-active" : ""}`}
            aria-pressed={value === v}
            onClick={() => onPick(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A year, a year and month, or a full date — and it says back which one it
    read, so nobody has to guess whether "2019" was understood. */
function PartialDate({
  label, value, onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const [text, setText] = useState(value || "");
  const ok = isPartialDate(text.trim());
  return (
    <label className="fhj-rec-field">
      <span className="fhj-label">{label}</span>
      <input
        className="fhj-input"
        inputMode="numeric"
        placeholder="2019 · 2019-03 · 2019-03-14"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          onChange(isPartialDate(v.trim()) ? v.trim() : undefined);
        }}
      />
      <span className="fhj-rec-note">
        {!text.trim()
          ? "A year on its own is a complete answer."
          : ok
            ? `Reads as ${formatPartial(text.trim())}.`
            : "Not a date yet — try 2019, 2019-03, or 2019-03-14."}
      </span>
    </label>
  );
}

function Toggle({
  label, hint, on, onToggle,
}: {
  label: string; hint?: string; on: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" className="fhj-rec-toggle" aria-pressed={on} onClick={onToggle}>
      <span className="fhj-rec-toggle-text">
        <span className="fhj-rec-toggle-label">{label}</span>
        {hint && <span className="fhj-rec-toggle-hint">{hint}</span>}
      </span>
      <span className="fhj-rec-toggle-box" data-on={on ? "1" : undefined} aria-hidden>
        {on ? "✓" : ""}
      </span>
    </button>
  );
}

/* Exported for the tests, which assert the section list matches the module's
   own kind list rather than a copy of it that can drift. */
export const __recordScreenKinds = { FACT_KINDS, DOMAINS, KINDS_IN };
