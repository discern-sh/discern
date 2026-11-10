/**
 * The wall's deck holds together: every card cites a live registry entry, its
 * copy stays inside the wall's length limits, each benefit card draws a glyph
 * authored for it, every link leads to a manual page, no human benefit goes
 * missing without a reason, and a number that counts a changing inventory
 * equals that inventory.
 */
import { assert, assertEquals } from "@std/assert";
import { CLAIMS } from "../scripts/brand/claims.ts";
import { consequencesFor } from "../scripts/brand/consequences.ts";
import {
  allAgentBenefitEntries,
  allHumanBenefitEntries,
} from "../scripts/feature_registry.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { cardGlyph, cardHeading } from "../site/wall/Card.tsx";
import { WALL_ABSENT, WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { GLYPHS } from "../site/wall/glyphs.ts";
import {
  type CardSource,
  CLUSTER_IDS,
  type WallCard,
} from "../site/wall/types.ts";
import {
  AGENT_NAMES,
  agentLabelForNative,
} from "../src/shared/agent_catalogue.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The most words a card's line may run to. */
const LINE_WORD_LIMIT = 16;

/** The most words a statement card may run to. */
const STATEMENT_WORD_LIMIT = 9;

/** The fewest and most words a card title may have. */
const TITLE_WORDS = { min: 2, max: 4 } as const;

/** The cluster each human benefit belongs to, by benefit id. */
const HUMAN_BENEFIT_CLUSTERS: ReadonlyMap<string, string> = new Map(
  allHumanBenefitEntries().map(({ cluster, entry }) => [entry.id, cluster.id]),
);

/**
 * What a card may cite, by source: the ids its registry holds today. A
 * statement cites a consequence written for the person, because the wall
 * speaks to the person.
 */
const CITABLE: Readonly<Record<CardSource, ReadonlySet<string>>> = {
  "human-benefit": new Set(HUMAN_BENEFIT_CLUSTERS.keys()),
  "agent-benefit": new Set(
    allAgentBenefitEntries().map(({ entry }) => entry.id),
  ),
  consequence: new Set(consequencesFor("person").map((entry) => entry.id)),
  claim: new Set(Object.keys(CLAIMS)),
};

/**
 * The inventory each numeral card counts. A numeral card states a number as
 * fact, so a new one names here what it counts, and the test below holds the
 * card to that count.
 */
const NUMERAL_COUNTS: Readonly<Record<string, () => Promise<number>>> = {
  // A project's discern settings live in one root file, as its claim says.
  "numeral-one-config-file": () => Promise.resolve(1),
  "numeral-limits-on-itself": async () =>
    Object.keys((await loadConfig(REPO_ROOT)).standards).length,
  "numeral-supported-coding-agents": () => Promise.resolve(AGENT_NAMES.length),
};

/** How many words a text has, counted between spaces. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word !== "").length;
}

/** How many sentences a text ends: its full stops, question and exclamation marks. */
function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/** Whether a text is exactly one sentence, closed by its own punctuation. */
function isOneSentence(text: string): boolean {
  return sentenceCount(text) === 1 && /[.!?]$/.test(text);
}

/** Everything a card says, front and opened. */
function cardTexts(card: WallCard): string[] {
  const front = card.kind === "statement"
    ? [card.text]
    : [card.title, card.line];
  return card.more === undefined ? front : [...front, card.more];
}

/** What is wrong with a card title, if anything. */
function titleFaults(title: string): string[] {
  const faults: string[] = [];
  const words = wordCount(title);
  if (words < TITLE_WORDS.min || words > TITLE_WORDS.max) {
    faults.push(
      `title "${title}" has ${words} words; a title has ${TITLE_WORDS.min} to ${TITLE_WORDS.max}`,
    );
  }
  if (!/^[A-Z0-9]/.test(title) || /[.!?:;,]$/.test(title)) {
    faults.push(
      `title "${title}" is not in sentence case with no closing punctuation`,
    );
  }
  return faults;
}

/** What is wrong with a card's copy, measured against the wall's limits. */
function copyFaults(card: WallCard): string[] {
  const faults: string[] = [];
  if (card.kind === "statement") {
    if (
      !isOneSentence(card.text) || wordCount(card.text) > STATEMENT_WORD_LIMIT
    ) {
      faults.push(
        `statement "${card.text}" must be one sentence of ${STATEMENT_WORD_LIMIT} words or fewer`,
      );
    }
  } else {
    faults.push(...titleFaults(card.title));
    if (!isOneSentence(card.line) || wordCount(card.line) > LINE_WORD_LIMIT) {
      faults.push(
        `line "${card.line}" must be one sentence of ${LINE_WORD_LIMIT} words or fewer`,
      );
    }
  }
  if (card.more !== undefined) {
    const sentences = sentenceCount(card.more);
    if (sentences < 1 || sentences > 2 || !/[.!?]$/.test(card.more)) {
      faults.push(`the opened paragraph must be one or two sentences`);
    }
  }
  if (cardTexts(card).some((text) => /\bDiscern\b/.test(text))) {
    faults.push("the product name is always written discern, in lower case");
  }
  return faults.map((fault) => `${card.id}: ${fault}`);
}

Deno.test("card ids are unique, and no registry entry is told twice", () => {
  const ids = WALL_DECK.map((card) => card.id);
  assertEquals(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
    "two cards share an id",
  );
  assertEquals(
    ids.filter((id) => !KEBAB_CASE.test(id)),
    [],
    "a card id is not kebab-case",
  );
  const cited = WALL_DECK.map((card) => `${card.source}: ${card.cites}`);
  assertEquals(
    cited.filter((entry, index) => cited.indexOf(entry) !== index),
    [],
    "two cards express the same registry entry; keep the better one",
  );
});

Deno.test("every card cites a live entry in its source registry", () => {
  assertEquals(
    WALL_DECK.filter((card) => !CITABLE[card.source].has(card.cites)).map((
      card,
    ) => `${card.id} cites ${card.source} "${card.cites}"`),
    [],
    "a card cites an entry its registry does not hold",
  );

  // A human benefit keeps its registry identity on the wall: the card carries
  // the benefit's id and sits in the benefit's own cluster.
  const moved: string[] = [];
  for (const card of WALL_DECK) {
    if (card.source !== "human-benefit") continue;
    if (card.id !== card.cites) {
      moved.push(`${card.id} must use its benefit's id, ${card.cites}`);
    }
    const cluster = HUMAN_BENEFIT_CLUSTERS.get(card.cites);
    if (cluster !== card.cluster) {
      moved.push(`${card.id} belongs to the cluster ${cluster}`);
    }
  }
  assertEquals(moved, []);
});

Deno.test("every human benefit is on the wall or listed absent with a reason", () => {
  const shown = new Set(
    WALL_DECK.filter((card) => card.source === "human-benefit").map((card) =>
      card.cites
    ),
  );
  const faults: string[] = [];
  for (const id of HUMAN_BENEFIT_CLUSTERS.keys()) {
    const absent = Object.hasOwn(WALL_ABSENT, id);
    if (shown.has(id) === absent) {
      faults.push(
        absent
          ? `${id} is both a card and listed absent`
          : `${id} is neither a card nor listed in WALL_ABSENT with a reason`,
      );
    }
  }
  for (const [id, reason] of Object.entries(WALL_ABSENT)) {
    if (!HUMAN_BENEFIT_CLUSTERS.has(id)) {
      faults.push(`WALL_ABSENT names ${id}, which is not a human benefit`);
    }
    if (reason.trim() === "") faults.push(`WALL_ABSENT gives ${id} no reason`);
  }
  assertEquals(faults, []);
});

Deno.test("card copy stays inside the wall's length limits", () => {
  assertEquals(WALL_DECK.flatMap(copyFaults), []);
});

Deno.test("control: the copy limits refuse what the wall's rules rule out", () => {
  const sound: WallCard = {
    kind: "benefit",
    id: "control",
    cluster: "build-further",
    source: "claim",
    cites: "control",
    title: "A sound title",
    line: "One plain sentence that says what the reader gets.",
    more: "A first sentence. And a second.",
  };
  assertEquals(copyFaults(sound), []);
  const refused: readonly WallCard[] = [
    { ...sound, title: "Short" },
    { ...sound, title: "A title of five words" },
    { ...sound, title: "A closed title." },
    { ...sound, line: "One sentence. Then another." },
    { ...sound, line: "A line with no closing mark" },
    { ...sound, line: `${"word ".repeat(LINE_WORD_LIMIT)}more.` },
    { ...sound, more: "One. Two. Three." },
    { ...sound, more: "Discern at the start of a sentence." },
    {
      kind: "statement",
      id: "control",
      cluster: "build-further",
      source: "claim",
      cites: "control",
      text: `${"word ".repeat(STATEMENT_WORD_LIMIT)}more.`,
    },
  ];
  for (const card of refused) {
    assertEquals(copyFaults(card).length, 1, JSON.stringify(card));
  }
});

Deno.test("every benefit card draws a glyph authored for it", () => {
  const glyphs = WALL_DECK.flatMap((card) => {
    const glyph = cardGlyph(card);
    return glyph === undefined ? [] : [{ card: card.id, glyph }];
  });
  assert(glyphs.length > 0, "the wall has benefit cards");
  assertEquals(
    glyphs.filter(({ glyph }) => !Object.hasOwn(GLYPHS, glyph)).map((
      { card, glyph },
    ) => `${card} has no authored glyph "${glyph}" in site/wall/glyphs.ts`),
    [],
    "a benefit card would draw the seeded fallback glyph",
  );
  const keys = glyphs.map(({ glyph }) => glyph);
  assertEquals(
    keys.filter((key, index) => keys.indexOf(key) !== index),
    [],
    "two cards draw the same glyph",
  );
});

Deno.test("every card link leads to a manual page", async () => {
  const site = await loadDocsSite();
  const manual = new Set(
    [site.landing, ...site.pages].map((page) => page.route),
  );
  assert(manual.size > 1, "the manual publishes pages");
  assertEquals(
    WALL_DECK.filter((card) =>
      card.href !== undefined && !manual.has(card.href)
    ).map((card) => `${card.id} links to ${card.href}`),
    [],
    "a card links to a path the manual does not publish",
  );
});

Deno.test("a numeral card states the count of its inventory", async () => {
  const numerals = WALL_DECK.filter((card) => card.kind === "numeral");
  assertEquals(
    numerals.map((card) => card.id).toSorted(),
    Object.keys(NUMERAL_COUNTS).toSorted(),
    "every numeral card names what it counts in NUMERAL_COUNTS, and nothing else is listed there",
  );
  for (const card of numerals) {
    const count = await NUMERAL_COUNTS[card.id]?.();
    assertEquals(
      card.numeral,
      String(count),
      `${card.id} shows ${card.numeral}, and its inventory now counts ${count}; update the card in site/wall/deck.ts`,
    );
  }

  const agents = numerals.find((card) =>
    card.id === "numeral-supported-coding-agents"
  );
  assertEquals(
    AGENT_NAMES.map(agentLabelForNative).filter((label) =>
      agents?.line.includes(label) !== true
    ),
    [],
    "the supported-agents card names every agent it counts",
  );
});

Deno.test("every cluster is reachable through a lens, and every lens shows cards", () => {
  const ids = WALL_LENSES.map((lens) => lens.id);
  assertEquals(new Set(ids).size, ids.length, "lens ids are unique");
  assertEquals(ids.filter((id) => !KEBAB_CASE.test(id)), []);
  assertEquals(
    CLUSTER_IDS.filter((cluster) =>
      !WALL_LENSES.some((lens) => lens.clusters.includes(cluster))
    ),
    [],
    "a cluster in no lens recedes under every lens",
  );
  assertEquals(
    WALL_LENSES.filter((lens) =>
      !WALL_DECK.some((card) => lens.clusters.includes(card.cluster))
    ).map((lens) => lens.id),
    [],
    "a lens selects no card",
  );
});

Deno.test("the wall mixes its clusters and spaces out its statement and numeral cards", () => {
  // Any stretch as long as the cluster list draws on at least half of the
  // clusters, so no part of the wall belongs to one family of outcomes.
  const span = CLUSTER_IDS.length;
  const narrow: string[] = [];
  for (let start = 0; start + span <= WALL_DECK.length; start++) {
    const stretch = WALL_DECK.slice(start, start + span);
    const clusters = new Set(stretch.map((card) => card.cluster));
    if (clusters.size < span / 2) {
      narrow.push(
        `the ${span} cards from "${
          stretch.map(cardHeading)[0]
        }" draw on only ${clusters.size} clusters`,
      );
    }
  }
  assertEquals(narrow, []);

  // Cards without a glyph break up the benefit cards: no two of them touch,
  // and the wall never runs longer than twice their average spacing without one.
  const breaks = WALL_DECK.flatMap((card, index) =>
    card.kind === "benefit" ? [] : [index]
  );
  assert(breaks.length > 1, "the wall has statement and numeral cards");
  const longest = 2 * WALL_DECK.length / breaks.length;
  const edges = [-1, ...breaks, WALL_DECK.length];
  const gaps = edges.slice(1).map((index, at) => index - (edges[at] ?? index));
  assertEquals(
    gaps.filter((gap) => gap > longest),
    [],
    `a stretch of the wall runs past ${longest} cards without a statement or numeral card`,
  );
  assertEquals(
    breaks.filter((index) => breaks.includes(index + 1)).map((index) =>
      WALL_DECK[index]?.id
    ),
    [],
    "a statement or numeral card touches the next one",
  );
});
