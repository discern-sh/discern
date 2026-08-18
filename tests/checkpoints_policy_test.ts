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
  loadGoverningPolicy,
  resolveCheckpoints,
} from "../src/engine/checkpoints/policy.ts";
import {
  checkpointDefinitionHash,
  computeSubject,
} from "../src/engine/checkpoints/subject.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { BuiltInCheckpointSeed } from "../src/shared/checkpoints.ts";
import { criterionById } from "../src/shared/criteria.ts";

/** A minimal governing config with one authored checkpoint. */
function configText(criterion: string): string {
  return [
    "[scopes.docs]",
    'paths = ["docs/**"]',
    "",
    "[checkpoints.docs-review]",
    'scope = "docs"',
    `criterion = "${criterion}"`,
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
    // The branch rewrites the criterion AND adds a new checkpoint — commits it.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      configText("A weaker judgment.") +
        '\n[checkpoints.extra]\npaths = ["src/**"]\ncriterion = "Extra."\n',
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "edit policy", "--no-gpg-sign");

    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.advisories, []);
    assertEquals(policy.checkpoints.map((c) => c.id), ["docs-review"]);
    assertEquals(policy.checkpoints[0]?.criterion, "The governed judgment.");
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
    assertEquals(drifted.checkpoints[0]?.criterion, "The governed judgment.");

    // …until the update lands the trunk into the branch: THEN policy advances.
    await git(dir, "merge", "-q", "--no-edit", "main");
    const updated = await loadGoverningPolicy(dir, LIVE);
    assertEquals(updated.policyCommit, trunkTip);
    assertEquals(updated.checkpoints[0]?.criterion, "A future judgment.");
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
    assertEquals(policy.advisories, []);
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
    assertEquals(policy.advisories.length, 1);
    assertStringIncludes(policy.advisories[0] ?? "", "merge-base");
  });
});

Deno.test("an unloadable governing config fails open with an advisory", async () => {
  await withTempDir(async (dir) => {
    // Valid TOML, invalid schema: an authored checkpoint with no criterion.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[checkpoints.bare]\npaths = ["src/**"]\n',
    );
    await gitInit(dir);
    const policy = await loadGoverningPolicy(dir, LIVE);
    assert(policy.policyCommit !== undefined);
    assertEquals(policy.checkpoints, []);
    assertEquals(policy.advisories.length, 1);
    assertStringIncludes(policy.advisories[0] ?? "", "does not load");
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
      'criterion = "Judged."',
      "",
      "[checkpoints.code-review]",
      'paths = ["src/**", "${map.dir}extra/**"]',
      'unless_changed = ["docs", "CHANGELOG.md"]',
      "min_changed_files = 2",
      "deletion_dominant = true",
      'when = "scripts/probe.sh"',
      'mode = "advise"',
      'criterion = "Also judged."',
      'teach = "A lesson."',
      "",
    ].join("\n"),
  );
  const { checkpoints, advisories } = resolveCheckpoints(config);
  assertEquals(advisories, []);
  assertEquals(checkpoints.length, 2);
  const docs = checkpoints[0];
  assertEquals(docs?.selector, { scope: "docs", globs: ["guide/", "*.md"] });
  assertEquals(docs?.mode, "stop"); // the default
  const code = checkpoints[1];
  assertEquals(code?.selector, { globs: ["src/**", "guide/extra/**"] });
  // "docs" named a scope, so it expanded; the literal path stayed a glob.
  assertEquals(code?.unlessChanged, ["guide/", "*.md", "CHANGELOG.md"]);
  assertEquals(code?.minChangedFiles, 2);
  assertEquals(code?.deletionDominant, true);
  assertEquals(code?.similarNewFile, false);
  assertEquals(code?.when, "scripts/probe.sh");
  assertEquals(code?.mode, "advise");
  assertEquals(code?.teach, "A lesson.");
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
      'criterion = "Judged."',
      "",
    ].join("\n"),
  );
  // Simulate historical entries the current loader would refuse.
  config.checkpoints["no-criterion"] = { paths: ["src/**"] };
  config.checkpoints["ghost-scope"] = {
    scope: "ghost",
    criterion: "Judged.",
  };
  config.checkpoints["both-selectors"] = {
    scope: "docs",
    paths: ["docs/**"],
    criterion: "Judged.",
  };
  const { checkpoints, advisories } = resolveCheckpoints(config);
  assertEquals(checkpoints.map((c) => c.id), ["ok"]);
  assertEquals(advisories.length, 3);
  for (const advisory of advisories) {
    assertStringIncludes(advisory, "does not govern");
  }
});

Deno.test("a checkpoint with no selector governs the whole diff and defaults hold", () => {
  const config = parseConfigOrThrow(
    '[checkpoints.everywhere]\ncriterion = "Judged."\n',
  );
  const { checkpoints } = resolveCheckpoints(config);
  assertEquals(checkpoints[0], {
    id: "everywhere",
    mode: "stop",
    criterion: "Judged.",
    unlessChanged: [],
    deletionDominant: false,
    similarNewFile: false,
  });
});

// ── built-in seed merging ───────────────────────────────────────────────────

/** Synthetic seeds (real criterion ids) exercising every seed-provided field,
 * so the merge contract is provable independently of the shipped set. */
const SEEDS: Readonly<Record<string, BuiltInCheckpointSeed>> = {
  "scoped-seed": {
    criterion: "skills.executable",
    scope: "docs",
    min_changed_files: 3,
    unless_changed: ["CHANGELOG.md"],
  },
  "pathed-seed": {
    criterion: "setup.failure-memory",
    mode: "advise",
    paths: ["${map.dir}**"],
    deletion_dominant: true,
  },
};

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

Deno.test("a bare reference enables a built-in with the seed's trigger, mode, and canonical criterion", () => {
  const config = seedConfig({ "scoped-seed": {}, "pathed-seed": {} });
  const { checkpoints, advisories } = resolveCheckpoints(config, SEEDS);
  assertEquals(advisories, []);
  const scoped = checkpoints.find((c) => c.id === "scoped-seed");
  assertEquals(scoped?.selector, { scope: "docs", globs: ["docs/**"] });
  assertEquals(scoped?.minChangedFiles, 3);
  assertEquals(scoped?.unlessChanged, ["CHANGELOG.md"]);
  assertEquals(scoped?.mode, "stop"); // the default, seed named none
  assertEquals(
    scoped?.criterion,
    criterionById("skills.executable")?.criterion,
  );
  assertEquals(scoped?.teach, criterionById("skills.executable")?.teach);
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
    resolved?.criterion,
    criterionById("skills.executable")?.criterion,
  );
  assertEquals(resolved?.selector, { scope: "docs", globs: ["docs/**"] });
});

Deno.test("an entry overriding the criterion serves its own prose", () => {
  const config = seedConfig({
    "scoped-seed": { criterion: "My own judgment." },
  });
  const { checkpoints } = resolveCheckpoints(config, SEEDS);
  assertEquals(checkpoints[0]?.criterion, "My own judgment.");
});

Deno.test("the selector is one slot: an entry's paths replace a seed's scope, and vice versa", () => {
  const config = seedConfig({
    "scoped-seed": { paths: ["src/**"] },
    "pathed-seed": { scope: "docs" },
  });
  const { checkpoints, advisories } = resolveCheckpoints(config, SEEDS);
  assertEquals(advisories, []);
  const pathsOverScope = checkpoints.find((c) => c.id === "scoped-seed");
  assertEquals(pathsOverScope?.selector, { globs: ["src/**"] });
  const scopeOverPaths = checkpoints.find((c) => c.id === "pathed-seed");
  assertEquals(scopeOverPaths?.selector, { scope: "docs", globs: ["docs/**"] });
});

Deno.test("a seed whose scope the project does not define fails open with an advisory", () => {
  const config = parseConfigOrThrow("");
  Object.assign(config.checkpoints, { "scoped-seed": {} });
  const { checkpoints, advisories } = resolveCheckpoints(config, SEEDS);
  assertEquals(checkpoints, []);
  assertEquals(advisories.length, 1);
  assertStringIncludes(advisories[0] ?? "", "unknown scope 'docs'");
});
