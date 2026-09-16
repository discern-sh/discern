/**
 * The governing policy (`src/engine/checkpoints/policy.ts`): the trunk
 * governs through the merge-base — a branch editing its own checkpoint
 * config changes nothing for itself; the policy identity moves only with the
 * merge-base; an unrelated merge-base move leaves definitions (and therefore
 * subjects) untouched; and resolution fails open, entry by entry, with an
 * advisory naming what could not govern.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  CHECKPOINT_SEED_TRIGGER_BINDINGS,
  firableCheckpointIds,
  loadGoverningPolicy,
  resolveCheckpoints,
  structurallyDormant,
} from "../src/engine/checkpoints/policy.ts";
import {
  checkpointDefinitionHash,
  computeSubject,
} from "../src/engine/checkpoints/subject.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { BuiltInCheckpointSeed } from "../src/shared/checkpoints.ts";
import { questionById } from "../src/shared/questions.ts";
import {
  CHECKPOINT_QUESTION_FILE_FAILURES,
  type CheckpointQuestionFileFailure,
} from "../src/shared/checkpoint_question_files.ts";

/** A minimal governing config with one authored checkpoint. */
function configText(question: string): string {
  return [
    "[scopes.docs]",
    'paths = ["docs/**"]',
    "",
    "[checkpoints.docs-review]",
    'scope = "docs"',
    `question = "${question}"`,
    "",
  ].join("\n");
}

/** Scaffold a repo whose baseline commit carries `discern.toml`. */
async function repoWithConfig(dir: string, text: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "discern.toml"), text);
  await Deno.writeTextFile(join(dir, "docs", "page.md"), "page\n").catch(
    async () => {
      await Deno.mkdir(join(dir, "docs"), { recursive: true });
      await Deno.writeTextFile(join(dir, "docs", "page.md"), "page\n");
    },
  );
  await gitInit(dir);
}

const LIVE = parseConfigOrThrow("");

Deno.test("a branch editing its own checkpoint config is not governed by the edit", async () => {
  await withTempDir(async (dir) => {
    await repoWithConfig(dir, configText("The governed judgment."));
    await git(dir, "checkout", "-q", "-b", "agent/probe");
    // The branch rewrites the question AND adds a new checkpoint — commits it.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      configText("A weaker judgment.") +
        '\n[checkpoints.extra]\npaths = ["src/**"]\nquestion = "Extra."\n',
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "edit policy", "--no-gpg-sign");

    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.drops, []);
    assertEquals(policy.checkpoints.map((c) => c.id), ["docs-review"]);
    assertEquals(policy.checkpoints[0]?.question, "The governed judgment.");
  });
});

Deno.test("explicit policy references resolve to one immutable commit before checkpoint input is built", async () => {
  await withTempDir(async (dir) => {
    await repoWithConfig(dir, configText("The referenced judgment."));
    const commit = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "update-ref", "refs/discern/ci-policy-base", commit);
    await git(dir, "tag", "-a", "release-policy", "-m", "policy");
    for (
      const ref of [
        commit,
        commit.slice(0, 12),
        "main",
        "refs/discern/ci-policy-base",
        "release-policy",
      ]
    ) {
      const policy = await loadGoverningPolicy(dir, LIVE, ref);
      assertEquals(policy.policyCommit, commit, ref);
      assertEquals(policy.drops, [], ref);
      assertEquals(
        policy.checkpoints[0]?.question,
        "The referenced judgment.",
        ref,
      );
    }
    await git(dir, "tag", "main");
    const tree = await gitOut(dir, "rev-parse", "HEAD^{tree}");
    for (const ref of ["missing-policy", "main", tree]) {
      const policy = await loadGoverningPolicy(dir, LIVE, ref);
      assertEquals(policy.policyCommit, undefined, ref);
      assertEquals(policy.checkpoints, [], ref);
      assertEquals(policy.drops[0]?.reason, "governing_config_unreadable", ref);
    }
  });
});

Deno.test("instruction-economy resolves instruction sources from the governing config", async () => {
  await withTempDir(async (dir) => {
    await repoWithConfig(
      dir,
      [
        "[instructions]",
        'sources = ["governing/*.md", "governing/team/**/*.md"]',
        "",
        "[checkpoints.instruction-economy]",
        "",
      ].join("\n"),
    );
    await git(dir, "checkout", "-q", "-b", "agent/probe");
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[instructions]",
        'sources = ["branch-only/**"]',
        "",
        "[checkpoints.instruction-economy]",
        "",
      ].join("\n"),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "retarget sources", "--no-gpg-sign");

    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.drops, []);
    assertEquals(policy.checkpoints[0]?.selector?.globs, [
      "governing/*.md",
      "governing/team/**/*.md",
    ]);
  });
});

Deno.test("the policy identity is the merge-base and stays put until it moves", async () => {
  await withTempDir(async (dir) => {
    await repoWithConfig(dir, configText("The governed judgment."));
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "checkout", "-q", "-b", "agent/probe");

    const before = await loadGoverningPolicy(dir, LIVE);
    assertEquals(before.policyCommit, base);

    // Branch commits do not move it.
    await Deno.writeTextFile(join(dir, "docs", "page.md"), "page v2\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "branch work", "--no-gpg-sign");
    assertEquals((await loadGoverningPolicy(dir, LIVE)).policyCommit, base);

    // Trunk commits do not move it either (the LIVE tip never governs)…
    await git(dir, "checkout", "-q", "main");
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      configText("A future judgment."),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "trunk moves", "--no-gpg-sign");
    const trunkTip = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "checkout", "-q", "agent/probe");
    const drifted = await loadGoverningPolicy(dir, LIVE);
    assertEquals(drifted.policyCommit, base);
    assertEquals(drifted.checkpoints[0]?.question, "The governed judgment.");

    // …until the update lands the trunk into the branch: THEN policy advances.
    await git(dir, "merge", "-q", "--no-edit", "main");
    const updated = await loadGoverningPolicy(dir, LIVE);
    assertEquals(updated.policyCommit, trunkTip);
    assertEquals(updated.checkpoints[0]?.question, "A future judgment.");
  });
});

Deno.test("an unrelated merge-base move changes neither definition nor subject", async () => {
  await withTempDir(async (dir) => {
    await repoWithConfig(dir, configText("The governed judgment."));
    await git(dir, "checkout", "-q", "-b", "agent/probe");
    await Deno.writeTextFile(join(dir, "docs", "page.md"), "page v2\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "branch work", "--no-gpg-sign");

    const before = await loadGoverningPolicy(dir, LIVE);
    assert(before.policyCommit !== undefined);
    const defBefore = before.checkpoints[0];
    assert(defBefore !== undefined);
    const hashBefore = await checkpointDefinitionHash(defBefore);
    const subjectBefore = await computeSubject(
      dir,
      hashBefore,
      ["docs/page.md"],
      before.policyCommit,
    );
    assert("subject" in subjectBefore);

    // The trunk advances with an unrelated file; the branch takes the update.
    await git(dir, "checkout", "-q", "main");
    await Deno.writeTextFile(join(dir, "unrelated.txt"), "x\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "unrelated", "--no-gpg-sign");
    await git(dir, "checkout", "-q", "agent/probe");
    await git(dir, "merge", "-q", "--no-edit", "main");

    const after = await loadGoverningPolicy(dir, LIVE);
    assert(after.policyCommit !== undefined);
    assertNotEquals(after.policyCommit, before.policyCommit);
    const defAfter = after.checkpoints[0];
    assert(defAfter !== undefined);
    const hashAfter = await checkpointDefinitionHash(defAfter);
    assertEquals(hashAfter, hashBefore);
    const subjectAfter = await computeSubject(
      dir,
      hashAfter,
      ["docs/page.md"],
      after.policyCommit,
    );
    assert("subject" in subjectAfter);
    assertEquals(
      subjectAfter.subject.fingerprint,
      subjectBefore.subject.fingerprint,
    );
  });
});

Deno.test("no config at the merge-base means no checkpoints and no noise", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.policyCommit, await gitOut(dir, "rev-parse", "HEAD"));
    assertEquals(policy.checkpoints, []);
    assertEquals(policy.drops, []);
  });
});

Deno.test("an unresolvable merge-base fails open with an advisory", async () => {
  await withTempDir(async (dir) => {
    // A repository whose trunk name does not exist.
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "solo");
    await git(dir, "branch", "-q", "-D", "main");
    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.policyCommit, undefined);
    assertEquals(policy.checkpoints, []);
    assertEquals(policy.drops.length, 1);
    assertStringIncludes(policy.drops[0]?.account ?? "", "merge-base");
  });
});

Deno.test("a historical checkpoint without a question source drops by id", async () => {
  await withTempDir(async (dir) => {
    // Valid TOML, invalid schema: an authored checkpoint with no question.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[checkpoints.bare]\npaths = ["src/**"]\n',
    );
    await gitInit(dir);
    const policy = await loadGoverningPolicy(dir, LIVE);
    assert(policy.policyCommit !== undefined);
    assertEquals(policy.checkpoints, []);
    assertEquals(policy.drops.length, 1);
    assertEquals(policy.drops[0]?.checkpoint, "bare");
    assertEquals(policy.drops[0]?.reason, "checkpoint_missing_question");
    assertEquals(policy.drops[0]?.policy_commit, policy.policyCommit);
    assertStringIncludes(policy.drops[0]?.account ?? "", "does not govern");
  });
});

// ── pure resolution ─────────────────────────────────────────────────────────

Deno.test("resolveCheckpoints expands scope selectors, references, and unless_changed scope names", () => {
  const config = parseConfigOrThrow(
    [
      "[map]",
      'dir = "guide/"',
      "",
      "[scopes.docs]",
      'paths = ["${map.dir}", "*.md"]',
      "",
      "[checkpoints.docs-review]",
      'scope = "docs"',
      'question = "Judged."',
      "",
      "[checkpoints.code-review]",
      'paths = ["src/**", "${map.dir}extra/**"]',
      'unless_changed = ["docs", "CHANGELOG.md"]',
      "min_changed_files = 2",
      "deletion_dominant = true",
      'when = "scripts/probe.sh"',
      'mode = "advise"',
      'question = "Also judged."',
      'teach = "A lesson."',
      'reference = "project/map/review.md#details"',
      "",
    ].join("\n"),
  );
  const { checkpoints, drops } = resolveCheckpoints(config);
  assertEquals(drops, []);
  assertEquals(checkpoints.length, 2);
  const docs = checkpoints[0];
  assertEquals(docs?.selector, { scope: "docs", globs: ["guide/", "*.md"] });
  assertEquals(docs?.mode, "stop"); // the default
  const code = checkpoints[1];
  assertEquals(code?.selector, { globs: ["src/**", "guide/extra/**"] });
  // "docs" named a scope, so it expanded; the literal path stayed a glob.
  assertEquals(code?.unlessChanged, ["guide/", "*.md", "CHANGELOG.md"]);
  assertEquals(code?.includeGenerated, false);
  assertEquals(code?.excludePaths, []);
  assertEquals(code?.minChangedFiles, 2);
  assertEquals(code?.deletionDominant, true);
  assertEquals(code?.similarNewFile, false);
  assertEquals(code?.when, "scripts/probe.sh");
  assertEquals(code?.mode, "advise");
  assertEquals(code?.teach, "A lesson.");
  assertEquals(code?.reference, "project/map/review.md#details");
});

Deno.test("resolveCheckpoints drops what cannot govern, one advisory each", () => {
  // The lenient path: these shapes cannot exist in a config the live loader
  // accepts, but the GOVERNING copy is history — resolution must not wedge.
  const config = parseConfigOrThrow(
    [
      "[scopes.docs]",
      'paths = ["docs/**"]',
      "",
      "[checkpoints.ok]",
      'question = "Judged."',
      "",
    ].join("\n"),
  );
  // Simulate historical entries the current loader would refuse.
  config.checkpoints["no-question"] = { paths: ["src/**"] };
  config.checkpoints["ghost-scope"] = {
    scope: "ghost",
    question: "Judged.",
  };
  config.checkpoints["both-selectors"] = {
    scope: "docs",
    paths: ["docs/**"],
    question: "Judged.",
  };
  config.checkpoints["both-sources"] = {
    question: "Inline.",
    question_file: "policy/question.md",
  };
  const { checkpoints, drops } = resolveCheckpoints(config);
  assertEquals(checkpoints.map((c) => c.id), ["ok"]);
  assertEquals(drops.length, 4);
  assertEquals(
    drops.find((drop) => drop.checkpoint === "both-sources")?.reason,
    "checkpoint_question_source_conflict",
  );
  for (const drop of drops) {
    assertStringIncludes(drop.account, "does not govern");
  }
});

Deno.test("every question-file read failure maps to durable entry evidence", () => {
  const expected = {
    missing: "checkpoint_question_file_missing",
    not_regular_blob: "checkpoint_question_file_not_regular",
    not_tracked: "checkpoint_question_file_not_regular",
    oversized: "checkpoint_question_file_oversized",
    invalid_utf8: "checkpoint_question_file_invalid_utf8",
    unreadable: "checkpoint_question_file_unreadable",
  } as const satisfies Record<CheckpointQuestionFileFailure, string>;
  const config = parseConfigOrThrow(
    '[checkpoints.review]\nquestion_file = "policy/review.md"\n',
  );
  for (const reason of CHECKPOINT_QUESTION_FILE_FAILURES) {
    const resolved = resolveCheckpoints(
      config,
      {},
      new Map([[
        "policy/review.md",
        { ok: false as const, path: "policy/review.md", reason },
      ]]),
    );
    assertEquals(resolved.checkpoints, [], reason);
    assertEquals(resolved.drops[0]?.reason, expected[reason], reason);
    assertStringIncludes(resolved.drops[0]?.account ?? "", "does not govern");
  }
});

Deno.test("a checkpoint with no selector governs the whole diff and defaults hold", () => {
  const config = parseConfigOrThrow(
    '[checkpoints.everywhere]\nquestion = "Judged."\n',
  );
  const { checkpoints } = resolveCheckpoints(config);
  assertEquals(checkpoints[0], {
    id: "everywhere",
    mode: "stop",
    question: "Judged.",
    includeGenerated: false,
    excludePaths: [],
    unlessChanged: [],
    kinds: [],
    addsMatching: [],
    removesMatching: [],
    newDirectory: false,
    deletionDominant: false,
    similarNewFile: false,
  });
});

// ── built-in seed merging ───────────────────────────────────────────────────

/** Synthetic seeds (real question ids) exercising every seed-provided field,
 * so the merge contract is provable independently of the shipped set. */
const SEEDS: Readonly<Record<string, BuiltInCheckpointSeed>> = {
  "scoped-seed": {
    question: "skills.executable",
    scope: "docs",
    min_changed_files: 3,
    unless_changed: ["CHANGELOG.md"],
  },
  "pathed-seed": {
    question: "setup.failure-memory",
    mode: "advise",
    paths: ["${map.dir}**"],
    deletion_dominant: true,
  },
};

type CompleteTriggerSeed =
  & Required<
    Omit<
      BuiltInCheckpointSeed,
      "selectorFrom" | "mapReview" | "scope" | "paths"
    >
  >
  & { paths: readonly string[]; scope?: never };

const COMPLETE_TRIGGER_SEED = {
  question: "skills.executable",
  mode: "advise",
  paths: ["seed/**"],
  include_generated: true,
  exclude_paths: ["seed/excluded/**"],
  unless_changed: ["seed/counterpart/**"],
  kinds: ["deleted"],
  adds_matching: ["seed added"],
  removes_matching: ["seed removed"],
  new_directory: true,
  binary: true,
  min_changed_files: 3,
  min_changed_lines: 30,
  deletion_dominant: true,
  similar_new_file: true,
  min_commits: 4,
  when: "seed-probe",
} as const satisfies CompleteTriggerSeed;

Deno.test("every seed trigger field falls back and accepts a project override", () => {
  const expectedSeed: Record<string, unknown> = {
    includeGenerated: true,
    excludePaths: ["seed/excluded/**"],
    unlessChanged: ["seed/counterpart/**"],
    kinds: ["deleted"],
    addsMatching: ["seed added"],
    removesMatching: ["seed removed"],
    newDirectory: true,
    binary: true,
    minChangedFiles: 3,
    minChangedLines: 30,
    deletionDominant: true,
    similarNewFile: true,
    minCommits: 4,
    when: "seed-probe",
  };
  const overrides = {
    include_generated: false,
    exclude_paths: ["override/excluded/**"],
    unless_changed: ["override/counterpart/**"],
    kinds: ["added"],
    adds_matching: ["override added"],
    removes_matching: ["override removed"],
    new_directory: false,
    binary: false,
    min_changed_files: 7,
    min_changed_lines: 70,
    deletion_dominant: false,
    similar_new_file: false,
    min_commits: 8,
    when: "override-probe",
  };
  const expectedOverride: Record<string, unknown> = {
    includeGenerated: false,
    excludePaths: ["override/excluded/**"],
    unlessChanged: ["override/counterpart/**"],
    kinds: ["added"],
    addsMatching: ["override added"],
    removesMatching: ["override removed"],
    newDirectory: false,
    binary: false,
    minChangedFiles: 7,
    minChangedLines: 70,
    deletionDominant: false,
    similarNewFile: false,
    minCommits: 8,
    when: "override-probe",
  };
  for (
    const [entry, expected] of [
      [{}, expectedSeed],
      [overrides, expectedOverride],
    ] as const
  ) {
    const config = seedConfig({ "complete-seed": entry });
    const definition = resolveCheckpoints(config, {
      "complete-seed": COMPLETE_TRIGGER_SEED,
    }).checkpoints[0];
    assert(definition !== undefined);
    for (
      const resolvedField of Object.values(CHECKPOINT_SEED_TRIGGER_BINDINGS)
    ) {
      assertEquals(
        definition[resolvedField],
        expected[resolvedField],
        resolvedField,
      );
    }
  }
});

/** A config carrying the map/scope fixtures plus the given checkpoint entries.
 * Entries are injected post-parse: the LIVE loader's completeness rule knows
 * only the SHIPPED built-in ids, while the resolver's seed injection exists so
 * merging is provable with synthetic ids — the same lenient path a governing
 * (historical) config takes. */
function seedConfig(
  entries: Record<string, Record<string, unknown>>,
): ReturnType<typeof parseConfigOrThrow> {
  const config = parseConfigOrThrow(
    ["[map]", 'dir = "guide/"', "", "[scopes.docs]", 'paths = ["docs/**"]', ""]
      .join("\n"),
  );
  Object.assign(config.checkpoints, entries);
  return config;
}

Deno.test("a bare reference enables a built-in with the seed's trigger, mode, and canonical question", () => {
  const config = seedConfig({ "scoped-seed": {}, "pathed-seed": {} });
  const { checkpoints, drops } = resolveCheckpoints(config, SEEDS);
  assertEquals(drops, []);
  const scoped = checkpoints.find((c) => c.id === "scoped-seed");
  assertEquals(scoped?.selector, { scope: "docs", globs: ["docs/**"] });
  assertEquals(scoped?.minChangedFiles, 3);
  assertEquals(scoped?.unlessChanged, ["CHANGELOG.md"]);
  assertEquals(scoped?.mode, "stop"); // the default, seed named none
  assertEquals(
    scoped?.question,
    questionById("skills.executable")?.question,
  );
  assertEquals(scoped?.teach, questionById("skills.executable")?.teach);
  const pathed = checkpoints.find((c) => c.id === "pathed-seed");
  assertEquals(pathed?.selector, { globs: ["guide/**"] }); // reference expanded
  assertEquals(pathed?.mode, "advise");
  assertEquals(pathed?.deletionDominant, true);
});

Deno.test("entry fields override the seed's, field by field", () => {
  const config = seedConfig({
    "scoped-seed": { min_changed_files: 7, mode: "advise" },
  });
  const { checkpoints } = resolveCheckpoints(config, SEEDS);
  const resolved = checkpoints[0];
  assertEquals(resolved?.minChangedFiles, 7);
  assertEquals(resolved?.mode, "advise");
  // Untouched fields keep the seed's values — including the canonical prose.
  assertEquals(
    resolved?.question,
    questionById("skills.executable")?.question,
  );
  assertEquals(resolved?.selector, { scope: "docs", globs: ["docs/**"] });
});

Deno.test("an entry overriding the question serves its own prose", () => {
  const config = seedConfig({
    "scoped-seed": { question: "My own judgment." },
  });
  const { checkpoints } = resolveCheckpoints(config, SEEDS);
  assertEquals(checkpoints[0]?.question, "My own judgment.");
});

Deno.test("a built-in may override its question from one resolved repository file", () => {
  const config = seedConfig({
    "scoped-seed": {
      question_file: "policy/review.md",
      reference: "project/map/review.md#details",
    },
  });
  const { checkpoints, drops } = resolveCheckpoints(
    config,
    SEEDS,
    new Map([
      ["policy/review.md", {
        ok: true as const,
        path: "policy/review.md",
        question: "## File-backed judgment\n\nReview the whole boundary.",
      }],
    ]),
  );
  assertEquals(drops, []);
  assertEquals(checkpoints[0]?.questionFile, "policy/review.md");
  assertEquals(
    checkpoints[0]?.question,
    "## File-backed judgment\n\nReview the whole boundary.",
  );
  assertEquals(
    checkpoints[0]?.reference,
    "project/map/review.md#details",
  );
});

Deno.test("the selector is one slot: an entry's paths replace a seed's scope, and vice versa", () => {
  const config = seedConfig({
    "scoped-seed": { paths: ["src/**"] },
    "pathed-seed": { scope: "docs" },
  });
  const { checkpoints, drops } = resolveCheckpoints(config, SEEDS);
  assertEquals(drops, []);
  const pathsOverScope = checkpoints.find((c) => c.id === "scoped-seed");
  assertEquals(pathsOverScope?.selector, { globs: ["src/**"] });
  const scopeOverPaths = checkpoints.find((c) => c.id === "pathed-seed");
  assertEquals(scopeOverPaths?.selector, { scope: "docs", globs: ["docs/**"] });
});

Deno.test("a seed whose scope the project does not define fails open with an advisory", () => {
  const config = parseConfigOrThrow("");
  Object.assign(config.checkpoints, { "scoped-seed": {} });
  const { checkpoints, drops } = resolveCheckpoints(config, SEEDS);
  assertEquals(checkpoints, []);
  assertEquals(drops.length, 1);
  assertStringIncludes(drops[0]?.account ?? "", "unknown scope 'docs'");
});

Deno.test("firable ids exclude the dormant — a waiting checkpoint is not a dead one", () => {
  const config = parseConfigOrThrow(
    [
      "[checkpoints.whole-diff]",
      'question = "Whole-diff judgment."',
      "",
      "[checkpoints.scoped]",
      'paths = ["src/**"]',
      'question = "Scoped judgment."',
      "",
      // The shipped seed tracks ${project.gotchas_doc}; unset, the reference
      // expands to the match-nothing empty pattern — dormant, not dead.
      "[checkpoints.gotchas-playbook]",
      "",
    ].join("\n"),
  );
  assertEquals(firableCheckpointIds(config), ["scoped", "whole-diff"]);
  for (const def of resolveCheckpoints(config).checkpoints) {
    assertEquals(
      structurallyDormant(def),
      def.id === "gotchas-playbook",
      def.id,
    );
  }

  // Naming a doc arms the shipped entry: dormancy tracks the configuration.
  const armed = parseConfigOrThrow(
    [
      "[project]",
      'gotchas_doc = "notes/traps.md"',
      "",
      "[checkpoints.gotchas-playbook]",
      "",
    ].join("\n"),
  );
  assertEquals(firableCheckpointIds(armed), ["gotchas-playbook"]);
});
