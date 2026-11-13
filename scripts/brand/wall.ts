/**
 * What a homepage wall card may cite (ADR 0431). The deck is authored in
 * `site/wall/deck.ts`, a module the homepage's browser bundle loads, so it
 * holds ids and words only. `wallCitables` reads those ids against the
 * registries they name: every entry a card may cite, with the feature nodes
 * that entry rests on. `tests/site_wall_deck_test.ts` holds each card's links
 * live with it, and `scripts/brand/docs/wall.ts` renders the page that shows
 * them.
 */

import type { CardSource } from "../../site/wall/types.ts";
import {
  allAgentBenefitEntries,
  allHumanBenefitEntries,
} from "../feature_registry.ts";
import { CLAIMS } from "./claims.ts";
import { consequencesFor } from "./consequences.ts";
import type { Claim } from "./model.ts";

/** One registry entry a wall card may cite. */
export interface WallCitable {
  /** The entry's title in its own registry. */
  readonly title: string;
  /** The feature-canon node ids the entry rests on, each once, in registry order. */
  readonly restsOn: readonly string[];
}

/** What a card may cite, by source: each registry's live entries by id. */
export type WallCitables = Readonly<
  Record<CardSource, ReadonlyMap<string, WallCitable>>
>;

/** `ids` with each kept once, at its first place. */
function once(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

/**
 * Every entry a card may cite, with the feature nodes it rests on. A benefit
 * rests on the nodes it draws on, and an agent benefit also on the nodes that
 * support it. A consequence rests on the nodes of the human benefits under
 * it, and only a consequence written for the person is citable, because the
 * wall speaks to the person. A claim rests on the nodes of every benefit that
 * carries it.
 */
export function wallCitables(): WallCitables {
  const human = allHumanBenefitEntries().map(({ entry }) => ({
    id: entry.id,
    title: entry.title,
    restsOn: once(entry.drawsOn),
    claims: entry.claims ?? [],
  }));
  const agent = allAgentBenefitEntries().map(({ entry }) => ({
    id: entry.id,
    title: entry.title,
    restsOn: once([...entry.drawsOn, ...(entry.supportedBy ?? [])]),
    claims: entry.claims ?? [],
  }));
  const humanNodes = new Map(human.map((entry) => [entry.id, entry.restsOn]));
  return {
    "human-benefit": new Map(human.map((entry) => [entry.id, entry])),
    "agent-benefit": new Map(agent.map((entry) => [entry.id, entry])),
    consequence: new Map(
      consequencesFor("person").map((entry) => [entry.id, {
        title: entry.headline,
        restsOn: once(
          entry.restsOn.flatMap((id) => humanNodes.get(id) ?? []),
        ),
      }]),
    ),
    claim: new Map(
      Object.entries<Claim>(CLAIMS).map(([slug, claim]) => [slug, {
        title: claim.title,
        restsOn: once(
          [...human, ...agent]
            .filter((entry) => entry.claims.some((carried) => carried === slug))
            .flatMap((entry) => entry.restsOn),
        ),
      }]),
    ),
  };
}
