/**
 * The non-gamified practice, held at its contract. Stats, Patterns findings,
 * investigations, checkpoint economics, and the detector roster publish
 * through one result schema, and no key in that schema names a score, rank,
 * grade, badge, point, level, or reward. Streak lengths stay plain counts
 * of consecutive events, reported as observations beside every other count;
 * the boundary forbids awarding them, not counting them.
 *
 * The schema is the chokepoint: a feedback loop that wanted to grade a
 * worker would have to publish the grade, and the only publication path is
 * this contract.
 *
 * Guards: boundary:non-gamified-practice
 */

import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { PatternsDataSchema } from "../src/shared/patterns_vocabulary.ts";
import { schemaKeys } from "./schema_keys.ts";

/** Words that turn an observation into an award. */
const GAMIFYING_WORDS = new Set([
  "score",
  "scores",
  "rank",
  "ranks",
  "ranking",
  "rankings",
  "grade",
  "grades",
  "badge",
  "badges",
  "point",
  "points",
  "level",
  "levels",
  "leaderboard",
  "achievement",
  "achievements",
  "reward",
  "rewards",
  "trophy",
  "trophies",
  "xp",
]);

/**
 * The gamifying words a snake_case key carries, if any. A "point" right
 * after "per" is a sampling point on a series, not an award.
 */
function gamifyingWords(key: string): string[] {
  const words = key.toLowerCase().split("_");
  return words.filter((word, index) =>
    GAMIFYING_WORDS.has(word) &&
    !(/^points?$/.test(word) && words[index - 1] === "per")
  );
}

Deno.test("no key in the Patterns result contract names a score, rank, grade, badge, point, level, or reward", () => {
  const keys = schemaKeys(PatternsDataSchema, "patterns");
  assert(keys.length > 100, `suspiciously small contract: ${keys.length} keys`);
  const offenders = keys
    .filter(({ key }) => gamifyingWords(key).length > 0)
    .map(({ key, path }) => `${path} (${gamifyingWords(key).join(", ")})`);
  assertEquals(
    offenders,
    [],
    `the practice contract awards something:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("control: the word test fires on an award and stays quiet on a plain count", () => {
  assertEquals(gamifyingWords("composite_score"), ["score"]);
  assertEquals(gamifyingWords("agent_rank"), ["rank"]);
  assertEquals(gamifyingWords("bonus_points"), ["points"]);
  assertEquals(gamifyingWords("longest_green_streak"), []);
  assertEquals(gamifyingWords("best_day"), []);
  assertEquals(gamifyingWords("series_days_per_point"), []);
  const planted = z.strictObject({
    stats: z.strictObject({ leaderboard: z.array(z.string()) }),
  });
  const keys = schemaKeys(planted, "planted");
  assertEquals(
    keys.filter(({ key }) => gamifyingWords(key).length > 0).map((k) => k.path),
    ["planted.stats.leaderboard"],
  );
});
