/* The standing record — the things that are true, as opposed to the things
   that happened today.

   Every collection in this journal until now has been a diary: one row per
   day, or per meal, or per dose, ordered by when it happened. That shape is
   the right one for almost everything a person tracks, and it is the reason
   the charts, the streak, the flares and the pack all work.

   It is also the reason the pack could not answer a single one of the
   questions an appointment actually opens with:

     What have you got?              What are you allergic to?
     What have you had done?         What's weighing on you?
     Who's around?                   Where do you live?

   None of those is a day. They are facts with a start, sometimes an end, and
   a long middle in which nothing happens and nothing needs logging — a coeliac
   diagnosis in 2019, a penicillin reaction at nine years old, a father who
   died in March, a job on nights, a flat with damp in it, and a sister who is
   the only person who calls. A journal holding a hundred and twenty days of
   ratings that cannot say any of that is a very detailed answer to a question
   nobody asked first.

   So: one collection, `HealthFact[]`, and three domains that between them are
   a biopsychosocial history — **body**, **mind**, **life**. Sixteen kinds
   across the three, and five rules.

   **1. One shape, not sixteen.** A condition, an allergy, an operation, a
   stressor, a flatmate and a hobby are the same kind of object: a labelled
   fact with a period, a status and an optional note, differing only in which
   extra fields mean anything. Sixteen collections would be sixteen
   sanitisers, sixteen sync kinds and sixteen backup keys to express one idea.
   The `kind` field does it instead, exactly as `LabResult.kind` keeps an
   estimate from ever being counted as a measurement.

   The same decision is why a depression diagnosis is a `condition` alongside
   asthma, a psychiatric admission is a `procedure` alongside an appendectomy,
   and an antidepressant is in the routine alongside a moisturiser. Splitting
   "mental" facts into their own quarantined list is a clinical error before
   it is a discourtesy — the whole argument of a biopsychosocial history is
   that these are one record about one person.

   **2. Dates are partial on purpose.** Nobody remembers the day they were
   diagnosed. `since` and `until` accept `YYYY`, `YYYY-MM` or `YYYY-MM-DD` and
   are printed at whatever precision they were given. A date picker that
   demands a day manufactures a precision the person does not have and the
   clinician will not believe, and — worse — it is the reason half of these
   records never get written down at all.

   **3. "None" is an answer, and it is not the same as silence.** The
   load-bearing rule, and the reason `RecordState` exists. *No known drug
   allergies* is a clinical statement with a date on it. *We never asked* is
   not a statement about anything. An app that prints an empty allergy section
   for both has told a reader something false about one of them. So every kind
   can be explicitly marked as holding nothing, with the day that was said,
   and the pack prints the difference: stated-none is printed as a sentence,
   never-asked is omitted and *named as not asked*, and the screen offers the
   ones still outstanding.

   **4. A private fact is held, not shared.** The moment a journal accepts
   "significant life events" it is holding the most sensitive sentence
   anybody will ever type into it, and the default behaviour of every other
   collection here — goes in the pack, goes in the spreadsheet — would be the
   wrong one. `private` is a per-fact switch on every kind, on by default for
   a life event and off by default for everything else, and `shareable()` is
   the single gate every outbound path runs through. A backup still carries
   everything, because a backup is the journal rather than a copy made to hand
   to somebody.

   **5. Nothing here is graded, ranked or interpreted.** `severity` is copied
   from what the person was told and never inferred from a reaction word. An
   ADL level is where somebody says they are, not a score out of five.
   `impact` is three words rather than a slider, because "how supportive is
   your sister, one to ten" is a question nobody can answer honestly and every
   reader would over-read. The module sorts, counts and renders. It does not
   have a view. */

import type { ExportCell, ExportTable } from "../types/models";

/* ---------- the record ---------- */

/** Which of the sixteen the fact is. `FACT_KINDS` holds them in the order
    everything downstream prints in, which is the order a history is taken in:
    the body first because it is what somebody came about, then the mind, then
    the life the other two are happening inside. */
export type FactKind =
  /* --- body --- */
  | "condition" // a diagnosis, or something being managed without one
  | "allergy" // drug, food, environmental
  | "procedure" // surgery, hospitalisation, a significant medical event
  | "treatment" // a course of something: physio, CBT, radiotherapy, a trial
  | "family" // a relative's condition
  | "substance" // alcohol, tobacco, caffeine, anything else — current or past
  | "adl" // an everyday activity that needs an aid, an adaptation or a hand
  /* --- mind --- */
  | "stressor" // what is currently weighing, and how much
  | "coping" // what is reached for when it does
  | "event" // a significant life event: loss, upheaval, harm
  /* --- life --- */
  | "support" // who is actually around: people, groups, a faith, a service
  | "housing" // where and how somebody lives, and whether it is safe
  | "work" // work, study, and what either costs or gives
  | "culture" // background, belief and practice, where it touches health
  | "money" // money and anything legal that is running
  | "interest"; // what is done for its own sake

/** Which of the three a kind belongs to. The domains are the reason this is
    one collection rather than three: a psychiatric admission is a
    `procedure`, an antidepressant is in the routine, and a depression
    diagnosis is a `condition` — the same shapes, because separating "mental"
    facts into their own list is a clinical error as well as a discourtesy. */
export type FactDomain = "body" | "mind" | "life";

export const DOMAINS: FactDomain[] = ["body", "mind", "life"];

export const DOMAIN_META: Record<FactDomain, { label: string; blurb: string }> = {
  body: {
    label: "Body",
    blurb: "What you have, what you react to, what has been done, and what a day costs you.",
  },
  mind: {
    label: "Mind",
    blurb: "What is weighing on you, what helps when it does, and anything large that has happened.",
  },
  life: {
    label: "Life",
    blurb: "Where you live, who is around, what you do all day, and what you do for its own sake.",
  },
};

export const FACT_KINDS: FactKind[] = [
  "condition", "allergy", "procedure", "treatment", "family", "substance", "adl",
  "stressor", "coping", "event",
  "support", "housing", "work", "culture", "money", "interest",
];

export const KINDS_IN: Record<FactDomain, FactKind[]> = {
  body: ["condition", "allergy", "procedure", "treatment", "family", "substance", "adl"],
  mind: ["stressor", "coping", "event"],
  life: ["support", "housing", "work", "culture", "money", "interest"],
};

export const DOMAIN_OF: Record<FactKind, FactDomain> = (() => {
  const out = {} as Record<FactKind, FactDomain>;
  for (const d of DOMAINS) for (const k of KINDS_IN[d]) out[k] = d;
  return out;
})();

/** Where a fact sits now. Not every value is offered for every kind — see
    `STATUSES_FOR` — but they share one field because they answer one
    question, and a reader should not have to learn sixteen vocabularies. */
export type FactStatus =
  | "active" // ongoing, current, still true
  | "remission" // a condition that is quiet rather than gone
  | "resolved" // over: cured, healed, grown out of, discharged
  | "former" // a substance no longer used; the ex-smoker's status
  | "never" // asked and answered in the negative, for one named thing
  | "suspected"; // raised but not confirmed — said as such, never upgraded here

export type AllergySeverity = "mild" | "moderate" | "severe" | "anaphylaxis";

export type AllergyType = "drug" | "food" | "environmental" | "other";

/** How much of an everyday activity is the person's own. Deliberately the
    plain words rather than a 0–4 scale: a number invites an average, and the
    average of "showering" and "stairs" is not a fact about anybody. */
export type AdlLevel =
  | "independent" // no difficulty
  | "difficulty" // manages, but it costs something
  | "aid" // manages with a device or an adaptation
  | "assistance" // needs another person some of the time
  | "unable";

/** Which way a thing pulls on somebody. See `IMPACT_LABEL` for why this is
    three words and not a slider. */
export type FactImpact = "supports" | "mixed" | "strains";

/** One thing that is true. Every field but `id`, `kind`, `label` and the two
    stamps is optional, because a half-known fact written down beats a
    complete one nobody could be bothered to finish. */
export interface HealthFact {
  id: string;
  kind: FactKind;
  /** What it is, in their own words: "Coeliac disease", "Penicillin",
      "Appendectomy", "Stairs". */
  label: string;
  /** Anything else worth saying. Printed under the line. */
  note?: string;

  /* --- when --- */
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, at whatever precision was given. */
  since?: string;
  /** When it stopped being true. Same three precisions. */
  until?: string;
  status?: FactStatus;

  /* --- allergy --- */
  allergyType?: AllergyType;
  /** What happens: "hives", "throat closes", "vomiting". A description, and
      never the input to a severity the app works out for itself. */
  reaction?: string;
  severity?: AllergySeverity;

  /* --- substance, and anything else with a "how much" --- */
  /** In the person's own units: "14 units a week", "10 a day", "30 hours a
      week", "£400 short a month". Free text because every one of those is a
      different unit and a picker for all of them would serve nobody. */
  amount?: string;
  /** Whether there has been treatment or support for it. A fact a clinician
      asks for directly, and one the person may well want on the page. */
  treated?: boolean;

  /* --- family, support --- */
  /** "Mother", "Maternal grandfather", "Best friend", "My running club".
      Free text: the relations that matter are not a closed list. */
  relation?: string;

  /* --- the life and mind kinds --- */
  /** Whether this holds somebody up, weighs on them, or does both. */
  impact?: FactImpact;

  /* --- procedure --- */
  /** Hospital, clinic, or whoever did it. */
  place?: string;

  /* --- adl --- */
  level?: AdlLevel;
  /** The aid or adaptation in use: "grab rail", "shower stool", "stick". */
  aid?: string;

  /** Lifted to the top of the record and of the pack. For the two or three
      things a person wants a stranger to read first. */
  pinned?: boolean;

  /** Held in the journal, kept off anything printed, exported or shown to a
      model — a fact that is theirs to have without being theirs to hand over.

      This exists because the moment a journal accepts "significant life
      events" it is holding the most sensitive sentence anybody will ever type
      into it, and the default behaviour of every other collection in this app
      — goes in the pack, goes in the spreadsheet — would be the wrong one. A
      pack is a document that gets left on a desk.

      It is a per-fact switch on every kind rather than a rule about a kind,
      because which facts are private is not something an app gets to decide.
      What the app does decide is the *default*, and `newFact` starts a life
      event private and everything else not — the least harmful error in each
      direction, and both are one tap to change. */
  private?: boolean;

  createdAt: string;
  updatedAt: string;
}

/** What has been *asked* — which is a different collection from what has been
    *answered*. See rule 3 in the header. */
export interface RecordState {
  /** Kinds explicitly marked as holding nothing. A kind is only in here while
      it is genuinely empty; adding a fact takes it out again, because "no
      allergies" and one allergy cannot both be true. */
  none?: FactKind[];
  /** When each of those was said, keyed by kind (`YYYY-MM-DD`). A statement
      of absence is only worth printing beside the day it was made. */
  statedAt?: Partial<Record<FactKind, string>>;
  /** The last time somebody went through the whole record and confirmed it.
      What lets the pack say "reviewed in March" rather than implying that a
      list assembled two years ago is current. */
  reviewedAt?: string;
}

/* ---------- vocabulary ----------

   All of it here rather than in the component, because the pack, the export,
   the search index and the screen all have to call the same thing by the same
   name, and three of those four have no component to read it from. */

export interface FactKindMeta {
  kind: FactKind;
  /** The section heading. */
  label: string;
  /** One of them. */
  one: string;
  /** What belongs here, in the words somebody would use to decide. */
  blurb: string;
  /** The button that adds one. */
  add: string;
  /** Printed when the person has said there is nothing. A sentence a
      clinician can read as a statement, because that is what it is. */
  noneLine: string;
  /** The prompt on the empty section, before either has happened. */
  ask: string;
}

export const KIND_META: Record<FactKind, FactKindMeta> = {
  /* --- body --- */
  condition: {
    kind: "condition",
    label: "Conditions",
    one: "Condition",
    blurb: "Anything you've been diagnosed with, or are managing without one — physical or mental, they belong on the same list.",
    add: "Add a condition",
    noneLine: "No conditions reported.",
    ask: "Have you been diagnosed with anything, or are you managing something without a diagnosis?",
  },
  allergy: {
    kind: "allergy",
    label: "Allergies & reactions",
    one: "Allergy",
    blurb: "Medicines, foods and anything else you react to — and what happens.",
    add: "Add an allergy",
    noneLine: "No known allergies.",
    ask: "Do you react to any medicine, food or anything else?",
  },
  procedure: {
    kind: "procedure",
    label: "Operations & hospital stays",
    one: "Operation or stay",
    blurb: "Surgery, admissions of any kind, and anything else significant that was done.",
    add: "Add an operation or stay",
    noneLine: "No operations or hospital stays reported.",
    ask: "Have you had surgery, been admitted to hospital, or had anything significant done?",
  },
  treatment: {
    kind: "treatment",
    label: "Treatments & therapies",
    one: "Treatment",
    blurb: "Courses of something rather than a daily dose: physio, talking therapy, light therapy, a trial. What it was for, and whether it helped.",
    add: "Add a treatment",
    noneLine: "No past treatments or therapies reported.",
    ask: "Have you had a course of treatment or therapy — and did it help?",
  },
  family: {
    kind: "family",
    label: "Family history",
    one: "Family condition",
    blurb: "What runs in your family, and in whom. Mental illness and substance use count here as much as anything else does.",
    add: "Add a family condition",
    noneLine: "No family history reported.",
    ask: "Does anything run in your family?",
  },
  substance: {
    kind: "substance",
    label: "Alcohol, tobacco & other",
    one: "Substance",
    blurb: "What you use now or used to, how much, and whether you've had support with it.",
    add: "Add one",
    noneLine: "No alcohol, tobacco or other substance use reported.",
    ask: "Do you drink, smoke, vape, or use anything else — now or in the past?",
  },
  adl: {
    kind: "adl",
    label: "Everyday activities",
    one: "Activity",
    blurb: "The parts of an ordinary day that need an aid, an adaptation or a hand.",
    add: "Add an activity",
    noneLine: "No difficulty reported with everyday activities.",
    ask: "Is there anything in an ordinary day you need an aid, an adaptation or a hand with?",
  },

  /* --- mind --- */
  stressor: {
    kind: "stressor",
    label: "What's weighing on you",
    one: "Stressor",
    blurb: "The things currently taking up room — work, a person, money, caring for somebody, a wait for a result.",
    add: "Add a stressor",
    noneLine: "Nothing reported as a current stressor.",
    ask: "What's taking up room at the moment?",
  },
  coping: {
    kind: "coping",
    label: "What helps",
    one: "Coping strategy",
    blurb: "What you actually reach for when it's bad — including the things you'd rather not be reaching for. Both are worth knowing and neither is judged here.",
    add: "Add one",
    noneLine: "Nothing reported.",
    ask: "What do you reach for when things are hard?",
  },
  event: {
    kind: "event",
    label: "Significant life events",
    one: "Life event",
    blurb: "Anything large enough to still be part of the story: a bereavement, an upheaval, harm done to you, a loss. Say as much or as little as you want — a date and one word is a complete entry.",
    add: "Add an event",
    noneLine: "Nothing reported.",
    ask: "Has anything large happened that a clinician should know about?",
  },

  /* --- life --- */
  support: {
    kind: "support",
    label: "People & support",
    one: "Person or group",
    blurb: "Who is actually around — a partner, family, friends, a group, a faith, a service. And where a relationship costs more than it gives, which is a fact too.",
    add: "Add someone",
    noneLine: "No support network reported.",
    ask: "Who's around for you — and is anyone a strain rather than a support?",
  },
  housing: {
    kind: "housing",
    label: "Where you live",
    one: "Living situation",
    blurb: "Housing, who you live with, and anything about the place itself that touches your health — damp, stairs, heat, noise, safety.",
    add: "Add a detail",
    noneLine: "Nothing reported about the living situation.",
    ask: "Where and how do you live, and does any of it affect your health?",
  },
  work: {
    kind: "work",
    label: "Work & study",
    one: "Work or study",
    blurb: "What you do all day, how much of it there is, and what it costs or gives you. Including not working, and why.",
    add: "Add work or study",
    noneLine: "Nothing reported about work or study.",
    ask: "What do you do all day, and how is it going?",
  },
  culture: {
    kind: "culture",
    label: "Background & belief",
    one: "Background or belief",
    blurb: "Anything about your background, faith or practice that shapes what you eat, what you'll take, how you rest, or who you turn to.",
    add: "Add one",
    noneLine: "Nothing reported.",
    ask: "Is there anything about your background or beliefs that affects your care?",
  },
  money: {
    kind: "money",
    label: "Money & legal",
    one: "Money or legal matter",
    blurb: "Money, insurance, benefits, and anything legal that is running. These reach health faster than almost anything else on this screen and are almost never written down.",
    add: "Add one",
    noneLine: "Nothing reported.",
    ask: "Is anything running with money, cover or the law?",
  },
  interest: {
    kind: "interest",
    label: "What you enjoy",
    one: "Interest",
    blurb: "What you do for its own sake. The section that is here because losing these is often the first sign, and getting them back is what better actually looks like.",
    add: "Add one",
    noneLine: "Nothing reported.",
    ask: "What do you do for enjoyment?",
  },
};

/** Which statuses each kind offers, first one being the default. A condition
    is not "former" and a substance is not "in remission"; offering every word
    everywhere would be the module declining to know what it is modelling. */
export const STATUSES_FOR: Record<FactKind, FactStatus[]> = {
  condition: ["active", "remission", "resolved", "suspected"],
  allergy: ["active", "resolved", "suspected"],
  procedure: ["resolved", "active"],
  treatment: ["resolved", "active"],
  family: ["active", "resolved"],
  substance: ["active", "former", "never"],
  adl: ["active", "resolved"],
  stressor: ["active", "resolved"],
  coping: ["active", "former"],
  event: ["resolved", "active"],
  support: ["active", "former"],
  housing: ["active", "former"],
  work: ["active", "former"],
  culture: ["active", "former"],
  money: ["active", "resolved"],
  interest: ["active", "former"],
};

export const STATUS_LABEL: Record<FactStatus, string> = {
  active: "Ongoing",
  remission: "In remission",
  resolved: "Resolved",
  former: "Stopped",
  never: "Never",
  suspected: "Suspected",
};

export const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
  anaphylaxis: "Anaphylaxis",
};

export const SEVERITY_ORDER: AllergySeverity[] = ["mild", "moderate", "severe", "anaphylaxis"];

export const ALLERGY_TYPE_LABEL: Record<AllergyType, string> = {
  drug: "Medicine",
  food: "Food",
  environmental: "Environmental",
  other: "Other",
};

export const LEVEL_LABEL: Record<AdlLevel, string> = {
  independent: "No difficulty",
  difficulty: "Harder than it was",
  aid: "With an aid or adaptation",
  assistance: "With someone's help",
  unable: "Can't manage it",
};

export const LEVEL_ORDER: AdlLevel[] = [
  "independent", "difficulty", "aid", "assistance", "unable",
];

/** Which way a thing pulls. One field, seven kinds, and deliberately three
    words rather than a number — "how supportive is your sister, 1 to 10" is a
    question nobody can answer honestly and every reader would over-read.
    `mixed` is the commonest true answer for most of them and is offered
    first-class rather than as a shrug. */
export const IMPACT_LABEL: Record<FactImpact, string> = {
  supports: "Helps",
  mixed: "Both",
  strains: "Costs",
};

export const IMPACT_ORDER: FactImpact[] = ["supports", "mixed", "strains"];

/** Which kinds offer it. A condition does not pull either way; a job, a
    flatmate and a hobby very much do. */
export const IMPACT_KINDS: FactKind[] = [
  "stressor", "coping", "support", "housing", "work", "culture", "money", "interest",
];

/* ---------- catalogs ----------

   Not a medical ontology and not trying to be. These are the things people
   actually reach for first, offered as one-tap chips so the common case is a
   tap rather than eleven characters typed on a phone with one hand. Every one
   of them is still an ordinary editable fact once added, and the field never
   refuses a word that isn't here. */

export const COMMON: Record<FactKind, string[]> = {
  condition: [
    "Asthma", "Eczema", "Hay fever", "Migraine", "IBS", "Coeliac disease",
    "Crohn's disease", "Ulcerative colitis", "Type 1 diabetes", "Type 2 diabetes",
    "High blood pressure", "High cholesterol", "Underactive thyroid",
    "Overactive thyroid", "PCOS", "Endometriosis", "Psoriasis", "Rheumatoid arthritis",
    "Osteoarthritis", "Fibromyalgia", "ME/CFS", "Long COVID", "POTS", "Anaemia",
    "Depression", "Anxiety", "PTSD", "Bipolar disorder", "OCD", "ADHD", "Autism",
    "Eating disorder", "Sleep apnoea", "Acid reflux", "Epilepsy",
  ],
  allergy: [
    "Penicillin", "Aspirin", "Ibuprofen", "Codeine", "Latex", "Peanuts",
    "Tree nuts", "Shellfish", "Fish", "Eggs", "Milk", "Soya", "Wheat", "Sesame",
    "Pollen", "Dust mites", "Cats", "Dogs", "Bee or wasp stings", "Nickel",
  ],
  procedure: [
    "Appendectomy", "Tonsillectomy", "Gallbladder removal", "Caesarean section",
    "Hernia repair", "Knee surgery", "Hip replacement", "Wisdom teeth out",
    "Endoscopy", "Colonoscopy", "Biopsy", "Fracture", "Concussion",
    "Hospital admission", "Psychiatric admission", "A&E visit",
  ],
  treatment: [
    "Physiotherapy", "CBT", "Counselling", "EMDR", "Occupational therapy",
    "Speech therapy", "Light therapy", "Steroid course", "Antibiotic course",
    "Chemotherapy", "Radiotherapy", "Immunotherapy", "Elimination diet",
    "Pulmonary rehab", "Cardiac rehab", "Pain management programme",
  ],
  family: [
    "Heart disease", "Stroke", "Type 2 diabetes", "High blood pressure",
    "Breast cancer", "Bowel cancer", "Prostate cancer", "Coeliac disease",
    "Thyroid disease", "Asthma", "Eczema", "Autoimmune disease",
    "Depression", "Anxiety", "Bipolar disorder", "Addiction", "Dementia",
  ],
  substance: [
    "Alcohol", "Cigarettes", "Vaping", "Caffeine", "Cannabis",
    "Nicotine pouches", "Prescription painkillers", "Other",
  ],
  adl: [
    "Stairs", "Walking outside", "Standing for long", "Showering or bathing",
    "Dressing", "Cooking", "Shopping", "Housework", "Driving", "Working",
    "Lifting or carrying", "Getting out of bed", "Writing or typing",
    "Managing medicines", "Managing money", "Sleeping through",
  ],

  stressor: [
    "Work", "Money", "A relationship", "Family", "Caring for someone",
    "Health worries", "Waiting for a result", "A move", "Bereavement",
    "Study or exams", "A legal matter", "Housing", "Loneliness", "The news",
  ],
  coping: [
    "Walking", "Exercise", "Talking to someone", "Sleep", "Music",
    "Being outside", "Reading", "Breathing or meditation", "Writing it down",
    "Time alone", "Cooking", "A pet", "Faith or prayer", "Therapy",
    "Alcohol", "Smoking", "Scrolling", "Eating", "Shutting down", "Working more",
  ],
  event: [
    "Bereavement", "Serious illness", "An accident", "A separation",
    "Losing a job", "Moving country", "A birth", "Harm done to me",
    "Violence", "A period of homelessness", "Time in care", "A diagnosis",
  ],

  support: [
    "Partner", "Mother", "Father", "Sibling", "Child", "Close friend",
    "Friends", "Neighbour", "Colleagues", "A support group", "Faith community",
    "Therapist", "GP", "Care worker", "Online community", "Nobody right now",
  ],
  housing: [
    "Own home", "Renting", "With family", "Shared house", "Supported housing",
    "Temporary accommodation", "No settled place", "Damp or mould", "Cold",
    "Stairs to get in", "Noise", "Feels unsafe", "Far from everything",
    "Adapted for me",
  ],
  work: [
    "Full time", "Part time", "Self-employed", "Shift work", "Night shifts",
    "Studying", "Not working — health", "Not working — looking",
    "Retired", "Carer at home", "Long hours", "Physically demanding",
    "On sick leave", "Phased return", "Adjustments in place",
  ],
  culture: [
    "Vegetarian", "Vegan", "Halal", "Kosher", "Fasting", "No alcohol",
    "No pork", "Prayer times", "Religious observance day",
    "Prefer a clinician of my gender", "Interpreter needed",
    "Family involved in decisions", "Traditional remedies",
  ],
  money: [
    "Tight month to month", "Struggling", "Debt", "On benefits",
    "Applying for benefits", "No insurance", "Insurance dispute",
    "Prescription costs", "Can't afford to travel to appointments",
    "A legal case running", "Custody matter", "Immigration matter",
  ],
  interest: [
    "Walking", "Running", "Cycling", "Swimming", "Gardening", "Cooking",
    "Reading", "Music", "Playing an instrument", "Drawing or painting",
    "Photography", "Gaming", "Crafts", "Sport", "Volunteering",
    "Seeing friends", "Travel", "Films", "Writing",
  ],
};

/** The relations offered as chips. Free text still wins. */
export const RELATIONS = [
  "Mother", "Father", "Sister", "Brother", "Daughter", "Son",
  "Grandmother", "Grandfather", "Aunt", "Uncle", "Cousin",
];

/* ---------- partial dates ----------

   `YYYY`, `YYYY-MM` and `YYYY-MM-DD`, kept at the precision they were given
   and never padded. Padding is the bug: "2019" silently becoming
   "2019-01-01" prints as the first of January, which is a day that did not
   happen, on a document somebody reads as fact. */

const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type DatePrecision = "year" | "month" | "day";

/** Whether a `YYYY-MM-DD` names a day that exists. The shape regex alone
    accepts 2019-02-30 and 2023-02-29, and a date that cannot have happened is
    not a lower-precision date — it is a typo, and letting it through would put
    "30 February 2019" on a document a clinician reads. */
function dayExists(v: string): boolean {
  const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

export function datePrecision(v: string | undefined): DatePrecision | null {
  if (!v) return null;
  if (DAY_RE.test(v)) return dayExists(v) ? "day" : null;
  if (MONTH_RE.test(v)) return "month";
  if (YEAR_RE.test(v)) return "year";
  return null;
}

export const isPartialDate = (v: unknown): v is string =>
  typeof v === "string" && datePrecision(v) !== null;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** How a partial date prints. A year stays a year. */
export function formatPartial(v: string | undefined): string {
  const p = datePrecision(v);
  if (!p || !v) return "";
  if (p === "year") return v;
  const mon = MONTHS[Number(v.slice(5, 7)) - 1] || "";
  if (p === "month") return `${mon} ${v.slice(0, 4)}`;
  return `${Number(v.slice(8, 10))} ${mon} ${v.slice(0, 4)}`;
}

/** The earliest instant a partial date could mean, as `YYYY-MM-DD`. Used only
    for ordering — never printed, for the reason in the header above. */
export function dateFloor(v: string | undefined): string {
  const p = datePrecision(v);
  if (!p || !v) return "";
  if (p === "year") return `${v}-01-01`;
  if (p === "month") return `${v}-01`;
  return v;
}

/** Whole years between a partial date and a day, or null when it cannot be
    known. Deliberately floor-of-years: "since 2019" on a 2026 day is six
    years if the month is unknown and we refuse to round it up to seven. */
export function yearsSince(v: string | undefined, today: string): number | null {
  const floor = dateFloor(v);
  if (!floor || !DAY_RE.test(today)) return null;
  const a = new Date(`${floor}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  let y = b.getFullYear() - a.getFullYear();
  const before =
    b.getMonth() < a.getMonth() ||
    (b.getMonth() === a.getMonth() && b.getDate() < a.getDate());
  if (before) y -= 1;
  return y < 0 ? null : y;
}

/* ---------- sanitising ----------

   Same contract as every other collection in this journal: facts arrive from
   local storage, a hand-editable backup and a sync pull, so they are repaired
   on every load rather than trusted on any of them. */

const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

const stamp = (v: unknown): string =>
  typeof v === "string" && v ? v : new Date().toISOString();

const uid = (): string =>
  `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const ALL_STATUS: FactStatus[] = [
  "active", "remission", "resolved", "former", "never", "suspected",
];

/** Repair one fact, or reject it. A fact with no kind or no label is not a
    half-broken fact, it is a row that says nothing — and a blank line in a
    list somebody hands a clinician is worse than a missing one. */
export function sanitizeFact(v: unknown): HealthFact | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const kind = oneOf(r.kind, FACT_KINDS);
  const label = str(r.label, 120);
  if (!kind || !label) return null;

  const out: HealthFact = {
    id: str(r.id, 64) || uid(),
    kind,
    label,
    createdAt: stamp(r.createdAt),
    updatedAt: stamp(r.updatedAt ?? r.createdAt),
  };

  const note = str(r.note, 1000);
  if (note) out.note = note;

  if (isPartialDate(r.since)) out.since = r.since;
  if (isPartialDate(r.until)) out.until = r.until;
  /* A period that runs backwards is a typo, not a fact. Dropping the end is
     the repair that loses least: the start is the half people get right. */
  if (out.since && out.until && dateFloor(out.until) < dateFloor(out.since)) {
    delete out.until;
  }

  const status = oneOf(r.status, ALL_STATUS);
  /* A status this kind does not offer is dropped rather than translated.
     Guessing that a "former" condition meant "resolved" would be the module
     inventing a clinical statement out of a malformed field. */
  if (status && STATUSES_FOR[kind].includes(status)) out.status = status;

  if (kind === "allergy") {
    const t = oneOf(r.allergyType, ["drug", "food", "environmental", "other"] as const);
    if (t) out.allergyType = t;
    const reaction = str(r.reaction, 200);
    if (reaction) out.reaction = reaction;
    const sev = oneOf(r.severity, SEVERITY_ORDER);
    if (sev) out.severity = sev;
  }

  if (kind === "substance" || kind === "work" || kind === "housing" || kind === "money") {
    const amount = str(r.amount, 120);
    if (amount) out.amount = amount;
  }
  if (kind === "substance" && r.treated === true) out.treated = true;

  if (kind === "family" || kind === "support") {
    const relation = str(r.relation, 80);
    if (relation) out.relation = relation;
  }

  if (IMPACT_KINDS.includes(kind)) {
    const impact = oneOf(r.impact, IMPACT_ORDER);
    if (impact) out.impact = impact;
  }

  if (kind === "procedure") {
    const place = str(r.place, 120);
    if (place) out.place = place;
  }

  if (kind === "adl") {
    const level = oneOf(r.level, LEVEL_ORDER);
    if (level) out.level = level;
    const aid = str(r.aid, 120);
    if (aid) out.aid = aid;
  }

  if (r.pinned === true) out.pinned = true;
  if (r.private === true) out.private = true;
  return out;
}

export function sanitizeFacts(v: unknown): HealthFact[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: HealthFact[] = [];
  for (const raw of v) {
    const f = sanitizeFact(raw);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/** Repair the asked/answered state, and enforce the one invariant it has:
    a kind cannot hold facts *and* be marked as holding nothing. The facts
    win, because somebody typed them. */
export function sanitizeRecordState(v: unknown, facts: HealthFact[] = []): RecordState | undefined {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: RecordState = {};

  const held = new Set(facts.map((f) => f.kind));
  const none = Array.isArray(r.none)
    ? FACT_KINDS.filter((k) => (r.none as unknown[]).includes(k) && !held.has(k))
    : [];
  if (none.length) out.none = none;

  if (r.statedAt && typeof r.statedAt === "object") {
    const src = r.statedAt as Record<string, unknown>;
    const at: Partial<Record<FactKind, string>> = {};
    for (const k of none) {
      const d = src[k];
      if (typeof d === "string" && DAY_RE.test(d)) at[k] = d;
    }
    if (Object.keys(at).length) out.statedAt = at;
  }

  if (typeof r.reviewedAt === "string" && DAY_RE.test(r.reviewedAt)) {
    out.reviewedAt = r.reviewedAt;
  }

  return out.none || out.statedAt || out.reviewedAt ? out : undefined;
}

/* ---------- writing ---------- */

/** Kinds that start life private. One entry, and the argument for it is in
    the doc comment on `HealthFact.private`. It is a default, not a rule: the
    editor shows the switch already on and one tap turns it off. */
export const PRIVATE_BY_DEFAULT: FactKind[] = ["event"];

/** A new, well-formed draft. Deliberately *not* run through `sanitizeFact`:
    a draft legitimately has an empty label until somebody types one, and the
    sanitiser — correctly — rejects a fact with no label. Putting the two
    together once meant a fresh editor opened with the word "Condition"
    already in the name box, which is the app answering its own question. The
    sanitiser's place is the storage boundary, not the constructor. */
export function newFact(kind: FactKind, patch: Partial<HealthFact> = {}): HealthFact {
  const now = new Date().toISOString();
  return {
    id: uid(),
    kind,
    label: "",
    status: STATUSES_FOR[kind][0],
    ...(PRIVATE_BY_DEFAULT.includes(kind) ? { private: true } : {}),
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

/** Mark a kind as holding nothing, on a given day. Refuses when the kind
    holds facts — the two statements contradict each other and the caller
    should not be able to write the contradiction down. */
export function stateNone(
  state: RecordState | undefined,
  kind: FactKind,
  today: string,
  facts: HealthFact[] = [],
): RecordState {
  if (facts.some((f) => f.kind === kind)) return state || {};
  const none = new Set(state?.none || []);
  none.add(kind);
  return {
    ...state,
    none: FACT_KINDS.filter((k) => none.has(k)),
    statedAt: { ...(state?.statedAt || {}), [kind]: today },
  };
}

/** Take that statement back — because one has turned up, or because it was a
    mis-tap. Clears the date with it: a date with no statement attached is a
    fact about nothing. */
export function clearNone(state: RecordState | undefined, kind: FactKind): RecordState | undefined {
  if (!state?.none?.includes(kind)) return state;
  const none = state.none.filter((k) => k !== kind);
  const statedAt = { ...(state.statedAt || {}) };
  delete statedAt[kind];
  const out: RecordState = { ...state };
  if (none.length) out.none = none; else delete out.none;
  if (Object.keys(statedAt).length) out.statedAt = statedAt; else delete out.statedAt;
  return out.none || out.statedAt || out.reviewedAt ? out : undefined;
}

/** Adding a fact to a kind that was marked empty has to clear the mark in the
    same write. Exported because every caller that adds a fact owes this, and
    a rule enforced in one component is a rule that lasts until the second
    component. */
export function afterAdd(state: RecordState | undefined, kind: FactKind): RecordState | undefined {
  return clearNone(state, kind);
}

/* ---------- reading ---------- */

export const isNone = (state: RecordState | undefined, kind: FactKind): boolean =>
  !!state?.none?.includes(kind);

/** Answered at all — either it holds something or somebody has said it holds
    nothing. The distinction the whole module exists to keep. */
export function isAnswered(
  facts: HealthFact[],
  state: RecordState | undefined,
  kind: FactKind,
): boolean {
  return facts.some((f) => f.kind === kind) || isNone(state, kind);
}

/** The kinds still outstanding, in print order. What the screen asks for and
    what the pack refuses to make a claim about. */
export function unanswered(facts: HealthFact[], state: RecordState | undefined): FactKind[] {
  return FACT_KINDS.filter((k) => !isAnswered(facts, state, k));
}

/** Still true today. `resolved`, `former` and `never` are not; an `until`
    date in the past is not, whatever the status says. */
export function isCurrent(f: HealthFact): boolean {
  if (f.status === "resolved" || f.status === "former" || f.status === "never") return false;
  return !f.until;
}

export const factsOfKind = (facts: HealthFact[], kind: FactKind): HealthFact[] =>
  facts.filter((f) => f.kind === kind);

/** Everything that may leave the device in a document — the pack, an export,
    anything shown to a model. The one gate, exported so no caller has to
    remember the field name, and so there is exactly one place to audit. */
export const shareable = (facts: HealthFact[]): HealthFact[] =>
  facts.filter((f) => !f.private);

/** How many are being held back, for the sentence the app shows *itself*
    beside a pack. Never printed on the pack: a document that announces two
    redactions has told the reader something about them. */
export const heldBack = (facts: HealthFact[]): number =>
  facts.filter((f) => f.private).length;

/** Within a kind: pinned first, then current before past, then the more
    severe allergy and the harder activity, then most recent start first, then
    label. Stable and total, so two devices list a record identically. */
export function sortFacts(facts: HealthFact[]): HealthFact[] {
  return [...facts].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const ca = isCurrent(a), cb = isCurrent(b);
    if (ca !== cb) return ca ? -1 : 1;
    const sa = a.severity ? SEVERITY_ORDER.indexOf(a.severity) : -1;
    const sb = b.severity ? SEVERITY_ORDER.indexOf(b.severity) : -1;
    if (sa !== sb) return sb - sa;
    const la = a.level ? LEVEL_ORDER.indexOf(a.level) : -1;
    const lb = b.level ? LEVEL_ORDER.indexOf(b.level) : -1;
    if (la !== lb) return lb - la;
    const da = dateFloor(a.since), db = dateFloor(b.since);
    if (da !== db) return da && db ? (da < db ? 1 : -1) : (da ? -1 : 1);
    return a.label.localeCompare(b.label);
  });
}

/** The two or three things a stranger should read first: anything pinned, and
    every allergy severe enough to change what somebody is handed. Never
    inferred from the reaction text — only from a severity the person set. */
export function alertFacts(facts: HealthFact[]): HealthFact[] {
  return sortFacts(
    facts.filter(
      (f) =>
        f.pinned ||
        (f.kind === "allergy" &&
          isCurrent(f) &&
          (f.severity === "severe" || f.severity === "anaphylaxis")),
    ),
  );
}

/* ---------- rendering ----------

   One renderer, used by the screen, the pack, the export and the search
   index. Four copies of this logic would be four chances for the pack and the
   screen to describe the same fact differently, which is the kind of
   discrepancy that makes somebody stop trusting a document. */

/** The period, in words. Empty when nothing is known, which is common and
    fine — a fact with no date is still a fact. */
export function whenLabel(f: HealthFact, today?: string): string {
  const since = formatPartial(f.since);
  const until = formatPartial(f.until);
  if (since && until) return `${since} – ${until}`;
  if (until) return `until ${until}`;
  if (!since) return "";
  if (f.kind === "procedure") return since;
  const years = today ? yearsSince(f.since, today) : null;
  if (years !== null && years >= 1) {
    return `since ${since} · ${years} ${years === 1 ? "year" : "years"}`;
  }
  return `since ${since}`;
}

/** The headline. What a list row shows, and what the pack prints in bold. */
export function factLine(f: HealthFact): string {
  if (f.kind === "family" && f.relation) return `${f.label} — ${f.relation}`;
  if (f.kind === "support" && f.relation && f.relation !== f.label) {
    return `${f.label} (${f.relation})`;
  }
  return f.label;
}

/** Everything else worth saying about it, joined. The order is the order it
    matters in when the reader is scanning rather than reading. */
export function factDetail(f: HealthFact, today?: string): string {
  const parts: string[] = [];

  if (f.kind === "allergy") {
    if (f.severity) parts.push(SEVERITY_LABEL[f.severity]);
    if (f.reaction) parts.push(f.reaction);
    if (f.allergyType) parts.push(ALLERGY_TYPE_LABEL[f.allergyType]);
  }

  if (f.kind === "adl") {
    if (f.level) parts.push(LEVEL_LABEL[f.level]);
    if (f.aid) parts.push(f.aid);
  }

  if (f.amount) parts.push(f.amount);
  if (f.kind === "substance" && f.treated) parts.push("had support with it");

  if (f.impact) parts.push(IMPACT_LABEL[f.impact]);

  if (f.kind === "procedure" && f.place) parts.push(f.place);

  /* The status is worth a word only when it is not the obvious one. "Ongoing"
     beside a condition with no end date says nothing; "In remission" says a
     great deal. */
  if (f.status && f.status !== STATUSES_FOR[f.kind][0]) {
    parts.push(STATUS_LABEL[f.status]);
  } else if (f.status === "active" && f.kind === "substance") {
    parts.push("Current");
  }

  const when = whenLabel(f, today);
  if (when) parts.push(when);

  return parts.join(" · ");
}

/** One fact as a single line of plain text — the form the export, the search
    index and a copied-out summary all want. */
export function factText(f: HealthFact, today?: string): string {
  const detail = factDetail(f, today);
  const line = factLine(f);
  return detail ? `${line} — ${detail}` : line;
}

/* ---------- counting ---------- */

export interface DomainSummary {
  domain: FactDomain;
  label: string;
  /** Facts held in this domain. */
  n: number;
  /** Kinds answered one way or the other, out of how many the domain has. */
  answered: number;
  of: number;
  /** Kinds nobody has said anything about yet, in print order. */
  missing: FactKind[];
}

export interface RecordSummary {
  /** Facts held, all kinds. */
  total: number;
  /** Still true today. */
  current: number;
  /** Held back from anything printed or exported. */
  private: number;
  /** Per kind: how many, and whether the kind has been answered at all. */
  byKind: Record<FactKind, { n: number; answered: boolean; none: boolean }>;
  /** Per domain, in print order. What the screen's three cards are drawn
      from, and the only unit a person can reasonably be asked to finish —
      "four of sixteen sections" is a to-do list nobody opens twice. */
  domains: DomainSummary[];
  /** Kinds nobody has said anything about yet, across all three. */
  missing: FactKind[];
  /** Severe allergies and pinned facts. */
  alerts: number;
  /** All sixteen answered one way or the other. */
  complete: boolean;
}

export function recordSummary(
  facts: HealthFact[],
  state: RecordState | undefined,
): RecordSummary {
  const byKind = {} as RecordSummary["byKind"];
  for (const k of FACT_KINDS) {
    const n = facts.filter((f) => f.kind === k).length;
    byKind[k] = { n, answered: n > 0 || isNone(state, k), none: isNone(state, k) };
  }
  const missing = FACT_KINDS.filter((k) => !byKind[k].answered);
  const domains: DomainSummary[] = DOMAINS.map((d) => {
    const kinds = KINDS_IN[d];
    return {
      domain: d,
      label: DOMAIN_META[d].label,
      n: facts.filter((f) => DOMAIN_OF[f.kind] === d).length,
      answered: kinds.filter((k) => byKind[k].answered).length,
      of: kinds.length,
      missing: kinds.filter((k) => !byKind[k].answered),
    };
  });
  return {
    total: facts.length,
    current: facts.filter(isCurrent).length,
    private: heldBack(facts),
    byKind,
    domains,
    missing,
    alerts: alertFacts(facts).length,
    complete: missing.length === 0,
  };
}

/** The one line the record is worth on a screen that is about something else.
    Says what is there, or what is missing, and never scolds about either —
    an unfinished record is the normal state of a record, not a failure. */
export function recordLine(facts: HealthFact[], state: RecordState | undefined): string {
  const s = recordSummary(facts, state);
  if (!s.total && !s.missing.length) return "Nothing to add, on all sixteen.";
  if (!s.total) return "Nothing here yet — the part an appointment opens with.";
  const noun = s.total === 1 ? "thing" : "things";
  if (!s.missing.length) return `${s.total} ${noun} on the record.`;
  const open = s.domains.filter((d) => d.missing.length);
  const names = open.map((d) => d.label.toLowerCase()).join(" and ");
  return `${s.total} ${noun} on the record · more to say about ${names}`;
}

/** The next thing worth asking about, or null when there is nothing left.
    One kind at a time, in print order, because a screen that opens with
    sixteen empty sections is a form and nobody fills in a form. */
export function nextToAsk(
  facts: HealthFact[],
  state: RecordState | undefined,
): FactKind | null {
  return unanswered(facts, state)[0] || null;
}

/* ---------- the pack ----------

   Printed first, before the arithmetic, because it is what the first ninety
   seconds of an appointment is spent establishing and because a reader who
   does not know what somebody has cannot read the rest of it.

   Rule 1 of the pack applies here exactly as it does to every average in it:
   nothing is invented. A kind with facts prints them. A kind stated empty
   prints one sentence and the day it was said. A kind nobody has been asked
   about is **omitted**, and `missing` names it — so the pack can say what it
   does not know rather than implying a negative it was never told. */

export interface PackFactGroup {
  kind: FactKind;
  domain: FactDomain;
  label: string;
  /** Rendered rows, in print order. Empty when `none` is true. */
  items: { line: string; detail: string; note?: string; alert?: boolean }[];
  /** True when this kind was explicitly stated empty. */
  none?: boolean;
  /** The sentence to print in that case. */
  noneLine?: string;
  /** The day it was said, for the sentence's date. */
  statedAt?: string;
}

export interface PackRecordSection {
  /** Severe allergies and pinned facts, printed above everything. */
  alerts: { line: string; detail: string }[];
  groups: PackFactGroup[];
  /** Kinds with nothing said either way, named rather than silently absent. */
  missing: { kind: FactKind; label: string }[];
  /** When the record was last confirmed as current. */
  reviewedAt?: string;
  /** How many facts this pack is not carrying because they are marked
      private. Shown in the app beside the pack, never on the paper. */
  held: number;
  /** True when there is nothing at all to print — no facts, nothing stated. */
  empty: boolean;
}

export function packRecordSection(
  all: HealthFact[],
  state: RecordState | undefined,
  today?: string,
): PackRecordSection {
  /* The single gate. Everything below this line works on the shareable set,
     so a private fact cannot reach a group, an alert, a count or a heading —
     including the heading, which is why `missing` is computed from it too: a
     kind holding only private facts reads as unanswered on the pack, which is
     the honest thing for a document that is not being shown them to say. */
  const facts = shareable(all);
  const groups: PackFactGroup[] = [];
  const missing: PackRecordSection["missing"] = [];
  const alertIds = new Set(alertFacts(facts).map((f) => f.id));

  for (const kind of FACT_KINDS) {
    const meta = KIND_META[kind];
    const items = sortFacts(factsOfKind(facts, kind));
    if (items.length) {
      groups.push({
        kind,
        domain: DOMAIN_OF[kind],
        label: meta.label,
        items: items.map((f) => ({
          line: factLine(f),
          detail: factDetail(f, today),
          note: f.note,
          alert: alertIds.has(f.id) || undefined,
        })),
      });
    } else if (isNone(state, kind)) {
      groups.push({
        kind,
        domain: DOMAIN_OF[kind],
        label: meta.label,
        items: [],
        none: true,
        noneLine: meta.noneLine,
        statedAt: state?.statedAt?.[kind],
      });
    } else {
      missing.push({ kind, label: meta.label });
    }
  }

  return {
    alerts: alertFacts(facts).map((f) => ({ line: factLine(f), detail: factDetail(f, today) })),
    groups,
    missing,
    reviewedAt: state?.reviewedAt,
    held: heldBack(all),
    empty: groups.length === 0,
  };
}

/* ---------- export ---------- */

const EXPORT_HEADER = [
  "Domain", "Kind", "What", "Status", "Since", "Until", "Detail", "Note", "Flagged",
];

const KIND_COL: Record<FactKind, string> = {
  condition: "Condition",
  allergy: "Allergy",
  procedure: "Operation / stay",
  treatment: "Treatment",
  family: "Family history",
  substance: "Substance",
  adl: "Everyday activity",
  stressor: "Stressor",
  coping: "What helps",
  event: "Life event",
  support: "Support",
  housing: "Housing",
  work: "Work / study",
  culture: "Background / belief",
  money: "Money / legal",
  interest: "Interest",
};

/** One row per fact, in print order, plus one row per kind stated empty — the
    statement is data and a spreadsheet that drops it loses the distinction
    the whole module is built around. */
export function buildRecordTable(
  all: HealthFact[],
  state: RecordState | undefined,
  today?: string,
): ExportTable {
  /* Same gate as the pack, for the same reason: a spreadsheet is a document
     that gets emailed. A backup is not an export and carries everything — the
     difference is that a backup is the journal, and this is a copy of part of
     it made to hand to somebody. */
  const facts = shareable(all);
  const rows: ExportCell[][] = [];
  for (const kind of FACT_KINDS) {
    const items = sortFacts(factsOfKind(facts, kind));
    if (items.length) {
      for (const f of items) {
        rows.push([
          DOMAIN_META[DOMAIN_OF[kind]].label,
          KIND_COL[kind],
          factLine(f),
          f.status ? STATUS_LABEL[f.status] : "",
          f.since ? formatPartial(f.since) : "",
          f.until ? formatPartial(f.until) : "",
          factDetail(f, today),
          f.note || "",
          f.pinned ? "yes" : "",
        ]);
      }
    } else if (isNone(state, kind)) {
      rows.push([
        DOMAIN_META[DOMAIN_OF[kind]].label,
        KIND_COL[kind],
        KIND_META[kind].noneLine,
        "Stated",
        state?.statedAt?.[kind] || "",
        "", "", "", "",
      ]);
    }
  }
  return { header: [...EXPORT_HEADER], rows };
}
