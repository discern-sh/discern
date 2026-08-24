/**
 * The voice canon and Vale are one executable contract. Canonical bans render
 * into the generated voice skills; the authored Discern style is the gate's
 * mechanical enforcement. These fixtures run the real Vale binary, so a rule
 * that parses but cannot fire is no coverage at all.
 *
 * The contract is exact in both directions:
 *
 * - every banned-word and banned-move id has mechanical cases or a recorded
 *   semantic residual;
 * - every canonical phrase fires through Vale in plain and source-wrapped
 *   prose, while the same literal remains legal in a Markdown code span;
 * - every house rule declared at error severity has a bad and protected case.
 *
 * A new canon row or error rule therefore enrols itself by failing this test.
 */

import { basename, dirname, join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { BANNED_MOVES, BANNED_WORDS } from "../scripts/brand/voice.ts";
import { runVale } from "../scripts/vale_lib.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

interface ValeAlert {
  Check?: unknown;
  Severity?: unknown;
}

interface MechanicalCase {
  bad: string;
  check: `Discern.${string}`;
  protected?: string;
}

interface WordContract {
  /** Checks allowed to enforce every canonical `phrases` entry in this row. */
  checks?: readonly `Discern.${string}`[];
  /** Mechanical cases for bans that are not representable as phrase lists. */
  cases?: readonly MechanicalCase[];
  /** The part that still requires editorial judgment after the detector fires. */
  residual?: string;
}

type MoveContract =
  | {
    cases: readonly MechanicalCase[];
    residual?: string;
    deferred?: never;
  }
  | {
    deferred: string;
    cases?: never;
    residual?: never;
  };

type BannedWordId = (typeof BANNED_WORDS)[number]["id"];
type BannedMoveId = (typeof BANNED_MOVES)[number]["id"];

const WORD_CONTRACTS = {
  "padding": { checks: ["Discern.Filler", "Discern.Padding"] },
  "hype-adjectives": { checks: ["Discern.Hype"] },
  "hype-verbs": { checks: ["Discern.Hype"] },
  "vendor-speak": { checks: ["Discern.VendorSpeak"] },
  "emotion-announcements": { checks: ["Discern.Announcement"] },
  "throat-clearing": { checks: ["Discern.ThroatClearing"] },
  "posture": { checks: ["Discern.Jargon"] },
  "the-shape-of": { checks: ["Discern.Jargon"] },
  "load-bearing": { checks: ["Discern.Jargon"] },
  "unnecessary-enumeration": { checks: ["Discern.Seasoning"] },
  "drama-adverbs": { checks: ["Discern.MaturedSeasoning"] },
  "sincerity-vouching": { checks: ["Discern.MaturedSeasoning"] },
  "rides-along": { checks: ["Discern.MaturedSeasoning"] },
  "hedging": { checks: ["Discern.Hedging"] },
  "passive-fault-dodging": {
    cases: [{
      bad: "An error was encountered while reading the config.",
      check: "Discern.FaultDodging",
    }],
    residual:
      "The detector covers stock passive fault reports; attribution in novel wording remains an editorial judgment.",
  },
  "exclamation-points": {
    cases: [{
      bad: "The Gate passed!",
      check: "Discern.Exclamation",
    }],
  },
  "emoji-in-prose": {
    cases: [{
      bad: "The Gate passed 🚀.",
      check: "Discern.Emoji",
    }],
    residual:
      "The detector covers Unicode emoji ranges and common symbol emoji; exhaustive grapheme classification stays outside Vale.",
  },
} as const satisfies Record<BannedWordId, WordContract>;

const MOVE_CONTRACTS = {
  "contrast-frames": {
    cases: [
      {
        bad: "This is not speed, but evidence.",
        check: "Discern.ContrastFrame",
      },
      {
        bad: "Use a fact, not a slogan.",
        check: "Discern.ContrastReversal",
      },
    ],
    residual:
      "The warning finds the stock syntax; whether a distinction does real work remains editorial.",
  },
  "aphoristic-antithesis": {
    deferred:
      "Cadence and mirrored meaning cannot be separated from legitimate short factual sentences by a stable regex.",
  },
  "self-narration": {
    cases: [{
      bad: "The crux is the recorded state.",
      check: "Discern.SelfNarration",
    }],
    residual:
      "Named importance openers are mechanical; a colon-pivot requires syntactic and rhetorical judgment.",
  },
  "attitude-fragments": {
    deferred:
      "The distinction from approved factual fragments depends on meaning, not punctuation.",
  },
  "echo-intensifiers": {
    deferred:
      "Detecting a meaningful echo across sentence boundaries needs discourse context that Vale does not expose.",
  },
  "trailing-modifier-fragments": {
    cases: [{
      bad: "The command reports the result, by design.",
      check: "Discern.TrailingModifier",
    }],
  },
  "em-dash-splices": {
    cases: [{
      bad:
        "The command checks state — the result is stable — the branch remains clean.",
      check: "Discern.EmDashChain",
    }],
    residual:
      "A chain is mechanical; a single em dash may be a valid parenthetical and needs editorial judgment.",
  },
  "typographic-applause": {
    deferred:
      "Markdown emphasis also carries legitimate scannability and semantic emphasis, so intent cannot be inferred from markup alone.",
  },
  "counting-the-set": {
    cases: [{
      bad: "Two things remain.",
      check: "Discern.Numeration",
    }],
    residual:
      "The warning finds prose that introduces a set; numbers that are themselves facts remain legal.",
  },
} as const satisfies Record<BannedMoveId, MoveContract>;

const ERROR_RULE_FIXTURES = {
  Announcement: "We're excited to announce the release.",
  Exclamation: "The Gate passed!",
  FaultDodging: "An error was encountered during setup.",
  Filler: "Obviously, the command works.",
  Hedging: "You may want to consider using the command.",
  Hype: "This is a powerful workflow.",
  Jargon: "The branch has the right posture.",
  MaturedSeasoning: "The Gate quietly records the result.",
  Emoji: "The Gate passed 🚀.",
  RecapHeading: "# Summary\n\nThe page ends here.",
  RhetoricalSuspense: "The catch? The config must exist.",
  SceneSetting: "In a world where agents work, projects change.",
  SelfNarration: "The crux is the recorded state.",
  ThroatClearing: "Please note that the file is tracked.",
  TrailingModifier: "The command reports the result, every time.",
  VendorSpeak: "The workflow leverages the cache.",
} as const satisfies Record<string, string>;

/** Every regex pattern written in a list or scalar by an authored rule. */
async function stylePatterns(
  files: readonly string[],
): Promise<{ file: string; pattern: string }[]> {
  const patterns: { file: string; pattern: string }[] = [];
  for (const rel of files) {
    const file = basename(rel);
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    let inList = false;
    let inSwap = false;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*$/, "").trimEnd();
      if (line.trim() === "") continue;
      const keyMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyMatch) {
        const [, key, value] = keyMatch;
        inList = key === "tokens" || key === "raw";
        inSwap = key === "swap";
        if (key === "token" && value) {
          patterns.push({ file, pattern: unquote(value) });
        }
        continue;
      }
      const item = line.match(/^\s+-\s+(.*)$/);
      if (inList && item) {
        patterns.push({ file, pattern: unquote(item[1] ?? "") });
        continue;
      }
      const swapKey = line.match(/^\s+([^:]+):\s+.+$/);
      if (inSwap && swapKey) {
        patterns.push({
          file,
          pattern: unquote((swapKey[1] ?? "").trim()),
        });
      }
    }
  }
  return patterns;
}

/** Remove balanced scalar quotes from one authored YAML pattern. */
function unquote(s: string): string {
  const text = s.trim();
  return (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"'))
    ? text.slice(1, -1)
    : text;
}

/** Alerts Vale returned for one fixture path, tolerant of `/tmp` symlinks. */
function fixtureAlerts(
  result: Record<string, unknown>,
  suffix: string,
): ValeAlert[] {
  const entry = Object.entries(result).find(([path]) => path.endsWith(suffix));
  return Array.isArray(entry?.[1]) ? entry[1] as ValeAlert[] : [];
}

/** Whether a fixture produced one named Vale check. */
function hasCheck(alerts: readonly ValeAlert[], check: string): boolean {
  return alerts.some((alert) => alert.Check === check);
}

/** Write one public-shaped Markdown fixture with a stable heading. */
async function writeFixture(
  root: string,
  rel: string,
  body: string,
): Promise<void> {
  const path = join(root, rel);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(
    path,
    body.startsWith("#") ? `${body}\n` : `# Voice fixture\n\n${body}\n`,
  );
}

/** Run the tracked Vale binary over a fixture tree and decode its JSON. */
async function lintFixtures(root: string): Promise<Record<string, unknown>> {
  const run = await runVale(REPO_ROOT, [
    "--output=JSON",
    "--minAlertLevel=suggestion",
    root,
  ]);
  return JSON.parse(
    new TextDecoder().decode(run.stdout),
  ) as Record<string, unknown>;
}

/** Put a counter-example in the Markdown code-span escape Vale respects. */
function protectedLiteral(text: string): string {
  return `The literal \`${text}\` appears in source.`;
}

Deno.test("every canonical banned phrase fires through Vale", async () => {
  await withTempDir(async (dir) => {
    const expectedIds = BANNED_WORDS.map((entry) => entry.id).sort();
    assertEquals(Object.keys(WORD_CONTRACTS).sort(), expectedIds);

    const expected: {
      rel: string;
      checks: readonly string[];
      protectedRel: string;
      wrappedRel?: string;
    }[] = [];
    for (const entry of BANNED_WORDS) {
      const contract: WordContract = WORD_CONTRACTS[entry.id];
      const phrases = "phrases" in entry ? entry.phrases : [];
      assert(
        phrases.length > 0 || (contract.cases?.length ?? 0) > 0,
        `${entry.id} needs phrases or a mechanical fixture`,
      );
      if (phrases.length > 0) {
        assert(
          (contract.checks?.length ?? 0) > 0,
          `${entry.id} declares phrases but no enforcing check`,
        );
      }
      for (const [index, phrase] of phrases.entries()) {
        const rel = `00-orientation/word-${entry.id}-${index}.md`;
        const protectedRel =
          `00-orientation/protected-word-${entry.id}-${index}.md`;
        await writeFixture(dir, rel, `${phrase} appears in this sentence.`);
        await writeFixture(dir, protectedRel, protectedLiteral(phrase));
        let wrappedRel: string | undefined;
        if (/\s/.test(phrase)) {
          wrappedRel = `00-orientation/wrapped-word-${entry.id}-${index}.md`;
          await writeFixture(
            dir,
            wrappedRel,
            `${phrase.replace(/\s+/, "\n")} appears in this sentence.`,
          );
        }
        expected.push({
          rel,
          checks: contract.checks ?? [],
          protectedRel,
          ...(wrappedRel === undefined ? {} : { wrappedRel }),
        });
      }
      for (const [index, fixture] of (contract.cases ?? []).entries()) {
        const rel = `00-orientation/word-case-${entry.id}-${index}.md`;
        const protectedRel =
          `00-orientation/protected-word-case-${entry.id}-${index}.md`;
        await writeFixture(dir, rel, fixture.bad);
        await writeFixture(
          dir,
          protectedRel,
          fixture.protected ?? protectedLiteral(fixture.bad),
        );
        expected.push({ rel, checks: [fixture.check], protectedRel });
      }
    }

    const output = await lintFixtures(dir);
    for (const fixture of expected) {
      assert(
        fixture.checks.some((check) =>
          hasCheck(fixtureAlerts(output, fixture.rel), check)
        ),
        `${fixture.rel} must fire one of ${fixture.checks.join(", ")}`,
      );
      assert(
        fixture.checks.every((check) =>
          !hasCheck(fixtureAlerts(output, fixture.protectedRel), check)
        ),
        `${fixture.protectedRel} must keep canonical literals legal in code spans`,
      );
      if (fixture.wrappedRel !== undefined) {
        assert(
          fixture.checks.some((check) =>
            hasCheck(fixtureAlerts(output, fixture.wrappedRel ?? ""), check)
          ),
          `${fixture.wrappedRel} must fire after a source-line wrap`,
        );
      }
    }
  });
});

Deno.test("every banned move is mechanical or has an explicit residual", async () => {
  await withTempDir(async (dir) => {
    const expectedIds = BANNED_MOVES.map((entry) => entry.id).sort();
    assertEquals(Object.keys(MOVE_CONTRACTS).sort(), expectedIds);

    const expected: { rel: string; protectedRel: string; check: string }[] = [];
    for (const move of BANNED_MOVES) {
      const contract: MoveContract = MOVE_CONTRACTS[move.id];
      if ("deferred" in contract) {
        assert(
          contract.deferred.length >= 40,
          `${move.id} needs a useful reason`,
        );
        continue;
      }
      assert(contract.cases.length > 0, `${move.id} needs a mechanical case`);
      for (const [index, value] of contract.cases.entries()) {
        const fixture: MechanicalCase = value;
        const rel = `00-orientation/move-${move.id}-${index}.md`;
        const protectedRel =
          `00-orientation/protected-move-${move.id}-${index}.md`;
        await writeFixture(dir, rel, fixture.bad);
        await writeFixture(
          dir,
          protectedRel,
          fixture.protected ?? protectedLiteral(fixture.bad),
        );
        expected.push({ rel, protectedRel, check: fixture.check });
      }
    }

    const output = await lintFixtures(dir);
    for (const fixture of expected) {
      assert(
        hasCheck(fixtureAlerts(output, fixture.rel), fixture.check),
        `${fixture.rel} must fire ${fixture.check}`,
      );
      assert(
        !hasCheck(fixtureAlerts(output, fixture.protectedRel), fixture.check),
        `${fixture.protectedRel} must protect the literal example`,
      );
    }
  });
});

Deno.test("every error-level house rule proves its block and code-span escape", async () => {
  const actual: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/voice_vale_parity_test.ts#error-level-rules",
    universe: "authored-text",
    narrow: {
      reason:
        "This severity contract governs every authored Discern Vale rule.",
      include: (rel) =>
        rel.startsWith(".vale/Discern/") && rel.endsWith(".yml"),
    },
  });
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/^level:\s*error\s*$/m.test(source)) {
      actual.push(basename(rel, ".yml"));
    }
  }
  assertEquals(
    actual.sort(),
    Object.keys(ERROR_RULE_FIXTURES).sort(),
    "add a proving fixture whenever an authored house rule becomes an error",
  );

  await withTempDir(async (dir) => {
    for (const [rule, bad] of Object.entries(ERROR_RULE_FIXTURES)) {
      await writeFixture(dir, `00-orientation/error-${rule}.md`, bad);
      await writeFixture(
        dir,
        `00-orientation/protected-error-${rule}.md`,
        protectedLiteral(bad),
      );
    }
    const output = await lintFixtures(dir);
    for (const rule of Object.keys(ERROR_RULE_FIXTURES)) {
      const check = `Discern.${rule}`;
      const badAlerts = fixtureAlerts(
        output,
        `00-orientation/error-${rule}.md`,
      );
      assertEquals(
        badAlerts.find((alert) => alert.Check === check)?.Severity,
        "error",
        `${rule} must fire at its declared severity`,
      );
      assert(
        !hasCheck(
          fixtureAlerts(
            output,
            `00-orientation/protected-error-${rule}.md`,
          ),
          check,
        ),
        `${rule} must permit a code-spanned counter-example`,
      );
    }
  });
});

Deno.test("every Discern pattern survives a source-line wrap", async () => {
  const files = await structuralGuardScope({
    guard: "tests/voice_vale_parity_test.ts#source-wrap-patterns",
    universe: "authored-text",
    narrow: {
      reason: "This pattern rule governs every authored Discern Vale rule.",
      include: (rel) =>
        rel.startsWith(".vale/Discern/") && rel.endsWith(".yml"),
    },
  });
  const offenders = (await stylePatterns(files)).filter((pattern) =>
    pattern.pattern.includes(" ")
  );
  assertEquals(
    offenders,
    [],
    "a literal space in a Vale pattern misses wrapped source — use \\s+",
  );
});
