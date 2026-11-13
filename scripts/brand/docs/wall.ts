/**
 * Render the homepage-wall page: every card of `site/wall/deck.ts` beside the
 * entry it expresses and the feature nodes it draws on (ADR 0431). The page
 * compiles into `project/map/_internal/brand/homepage-wall.md` through the
 * brand registry.
 */
import {
  WALL_ABSENT,
  WALL_DECK,
  WALL_LEAD,
  WALL_LENSES,
} from "../../../site/wall/deck.ts";
import {
  type CardSource,
  CLUSTER_IDS,
  type ClusterId,
  type WallCard,
} from "../../../site/wall/types.ts";
import {
  allFeatureNodes,
  HUMAN_BENEFIT_CANON,
} from "../../feature_registry.ts";
import { canonLink } from "../readiness.ts";
import { type WallCitable, type WallCitables, wallCitables } from "../wall.ts";

/** How the page names each source's registry. */
const SOURCE_LABELS: Readonly<Record<CardSource, string>> = {
  "human-benefit": "Human benefit",
  "agent-benefit": "Agent benefit",
  consequence: "Consequence",
  claim: "Claim",
};

/** The entry a card cites, or throw: the deck test holds every citation live. */
function citedEntry(citables: WallCitables, card: WallCard): WallCitable {
  const entry = citables[card.source].get(card.cites);
  if (entry === undefined) {
    throw new Error(
      `wall card ${card.id} cites an unknown ${card.source}: ${card.cites}`,
    );
  }
  return entry;
}

/** A link from the page to the entry a card cites, in that entry's own canon. */
function citationLink(card: WallCard, entry: WallCitable): string {
  switch (card.source) {
    case "human-benefit":
      return canonLink("../feature-canon-human-benefits.md", entry.title);
    case "agent-benefit":
      return canonLink("../feature-canon-agent-benefits.md", entry.title);
    case "consequence":
      return canonLink("consequence-canon.md", entry.title);
    case "claim":
      return `{{claim:${card.cites}}}`;
  }
}

/** The words that head a card's entry on the page. */
function cardName(card: WallCard): string {
  switch (card.kind) {
    case "benefit":
      return card.title;
    case "statement":
      return card.text;
    case "numeral":
      return `${card.numeral} ${card.title}`;
  }
}

/** A feature node as the page names it: its title, then its id. */
function featureName(titles: ReadonlyMap<string, string>, id: string): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`a wall card draws on an unknown feature node: ${id}`);
  }
  return `${title} (\`${id}\`)`;
}

/** Render one card as its heading and labelled scan lines. */
function renderCard(
  card: WallCard,
  citables: WallCitables,
  features: ReadonlyMap<string, string>,
): string[] {
  const lines = [
    `#### ${cardName(card)}`,
    "",
    `- **Card:** \`${card.id}\` · ${card.kind}`,
  ];
  if (card.kind !== "statement") lines.push(`- **Line:** ${card.line}`);
  if (card.more !== undefined) lines.push(`- **Opened:** ${card.more}`);
  if (card.href !== undefined) lines.push(`- **Link:** \`${card.href}\``);
  lines.push(
    `- **Expresses:** ${SOURCE_LABELS[card.source]} · ${
      citationLink(card, citedEntry(citables, card))
    }`,
    `- **Draws on:** ${
      card.drawsOn.map((id) => featureName(features, id)).join(" · ")
    }`,
    "",
  );
  return lines;
}

/** A cluster's title in the Human Benefit Canon, which owns the wall's clusters. */
function clusterTitle(id: ClusterId): string {
  const cluster = HUMAN_BENEFIT_CANON.find((candidate) => candidate.id === id);
  if (cluster === undefined) {
    throw new Error(`the wall names an unknown benefit cluster: ${id}`);
  }
  return cluster.title;
}

/** `count` with its noun, singular for one. */
function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Render the homepage-wall page: the frame, the lenses, the lead, every card
 * under its cluster with the entry it expresses and the features it draws on,
 * the feature-to-card index, and the benefits without a card. The brand
 * registry stamps the banner and resolves citation tokens.
 */
export function renderHomepageWallDoc(): string {
  const citables = wallCitables();
  const nodes = allFeatureNodes().map(({ node }) => node);
  const features = new Map(nodes.map((node) => [node.id, node.title]));
  const clusters = CLUSTER_IDS.filter((cluster) =>
    WALL_DECK.some((card) => card.cluster === cluster)
  );
  const ofKind = (kind: WallCard["kind"]): number =>
    WALL_DECK.filter((card) => card.kind === kind).length;
  const drawn = new Set(WALL_DECK.flatMap((card) => [...card.drawsOn]));
  const lines: string[] = [
    "# Homepage wall",
    "",
    "_The homepage wall as it is published: every card's words beside the entry it expresses and the product features it draws on. The cards are authored in [`site/wall/deck.ts`](../../../../site/wall/deck.ts), which the homepage loads in the browser. This page is where to review them against the [Human Benefit Canon](../feature-canon-human-benefits.md), the [Agent Benefit Canon](../feature-canon-agent-benefits.md), the {{doc:consequence-canon}}, and the {{doc:claims-and-evidence}} ledger. The [feature canon](../feature-canon.md) owns the features. [The wall's deck, cards, and glyphs](../../90-site/wall-deck-cards-and-glyphs.md) explains how the page shows a card._",
    "",
    `${counted(WALL_DECK.length, "card", "cards")} · ${
      ofKind("benefit")
    } benefit · ${ofKind("statement")} statement · ${
      ofKind("numeral")
    } numeral · ${
      counted(WALL_LENSES.length, "lens", "lenses")
    } · ${drawn.size} of ${nodes.length} feature nodes drawn on.`,
    "",
    "## How to use this page",
    "",
    "- Read a card against the entry it expresses. A card says in a visitor's words what that entry establishes, and the entry's own canon bounds how far the card may go.",
    "- Check the features before changing one. A card draws on the feature nodes its words depend on, chosen from the nodes its entry rests on. Removing or reshaping a node means rewriting or removing each card listed beside it under [Features on the wall](#features-on-the-wall).",
    "- Change a card in `site/wall/deck.ts`, then regenerate this page. The deck test refuses a card that draws on a missing node, or on a node its entry does not rest on.",
    "",
    "## Lenses",
    "",
    "A lens gathers the cards of its clusters and sets the rest aside. Chips appear in this order.",
    "",
    "| Lens | Clusters | Cards |",
    "| --- | --- | --- |",
  ];
  for (const lens of WALL_LENSES) {
    lines.push(
      `| ${lens.label} | ${lens.clusters.map(clusterTitle).join(" · ")} | ${
        WALL_DECK.filter((card) => lens.clusters.includes(card.cluster)).length
      } |`,
    );
  }
  lines.push(
    "",
    "## The lead",
    "",
    "The wall opens on these cards, in this order. Every other card follows in a fixed scattered order.",
    "",
  );
  WALL_LEAD.forEach((id, index) => {
    const card = WALL_DECK.find((candidate) => candidate.id === id);
    if (card === undefined) {
      throw new Error(`the wall's lead names an unknown card: ${id}`);
    }
    lines.push(`${index + 1}. ${cardName(card)}`);
  });
  lines.push(
    "",
    "## Cards",
    "",
    "Cards appear under their cluster, in the order the wall shows them.",
    "",
  );
  for (const cluster of clusters) {
    const cards = WALL_DECK.filter((card) => card.cluster === cluster);
    const lens = WALL_LENSES.filter((candidate) =>
      candidate.clusters.includes(cluster)
    ).map((candidate) => candidate.label);
    lines.push(
      `### ${clusterTitle(cluster)}`,
      "",
      `${counted(cards.length, "card", "cards")} · ${
        lens.length === 1 ? "lens" : "lenses"
      }: ${lens.join(" · ")}.`,
      "",
    );
    for (const card of cards) {
      lines.push(...renderCard(card, citables, features));
    }
  }
  lines.push(
    "## Features on the wall",
    "",
    "Each feature node a card draws on, in the feature canon's order, with the cards that depend on it. A node no card draws on has no row: the wall owes the feature canon no coverage.",
    "",
    "| Feature | Cards |",
    "| --- | --- |",
  );
  for (const node of nodes) {
    const cards = WALL_DECK.filter((card) => card.drawsOn.includes(node.id));
    if (cards.length === 0) continue;
    lines.push(
      `| ${featureName(features, node.id)} | ${
        cards.map(cardName).join(" · ")
      } |`,
    );
  }
  lines.push("", "## Benefits without a card", "");
  const absent = Object.entries(WALL_ABSENT);
  if (absent.length === 0) {
    lines.push("- None: every human benefit has a card.");
  } else {
    const human = citables["human-benefit"];
    for (const [id, reason] of absent) {
      lines.push(`- ${human.get(id)?.title ?? id} (\`${id}\`): ${reason}`);
    }
  }
  lines.push(
    "",
    "## Coverage and traceability",
    "",
    "Every card cites a live entry of its source's registry and draws on at least one live feature node that the entry rests on. Every human benefit has a card or a recorded reason for its absence, and the wall's clusters are the Human Benefit Canon's clusters. The guard (`tests/site_wall_deck_test.ts`) holds all of it, together with the copy limits, the links, and the counts a numeral card states.",
    "",
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
