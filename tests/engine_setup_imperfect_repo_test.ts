/**
 * Setup on IMPERFECT repos — the realistic first-contact states the funnel must
 * hold up on rather than soft-degrade: a `master` (or otherwise non-`main`) repo,
 * a brand-new repo whose default branch is still unborn, a directory with no git
 * at all, a machine with no git identity, an abandoned half-finished setup, and a
 * verbatim-copied placeholder flag. Each test fails on the old behavior (the
 * silent `main` assumption, the poisoned re-begin, the false isolation promise,
 * the discarded stderr, the scaffolded literal placeholder).
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  convergeSetupBranchForAcceptance,
  git,
  gitInit,
  gitOut,
  mapPool,
  parsedCommitTrailers,
  proveSetupBranchForAcceptance,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { isValidMapDir } from "../src/shared/map_path.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { readSetupMachineryCommitEvidence } from "../src/shared/setup_machinery_evidence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";

/** A fresh git work tree with one commit — on the given branch, not `main`. */
async function repoOnBranch(dir: string, branch: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
  await git(dir, "branch", "-M", branch);
}

/** A brand-new `git init` whose default branch is still UNBORN (no commits),
 * with identity configured so setup's own commits can succeed. */
async function unbornRepo(dir: string, branch: string): Promise<void> {
  await git(dir, "init", "-q", "-b", branch);
  await git(dir, "config", "user.email", "engine-test@example.com");
  await git(dir, "config", "user.name", "Engine Test");
  await git(dir, "config", "commit.gpgsign", "false");
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
}

// ── A6: the integration branch is detected and stamped ────────────────────────

Deno.test("begin on a master repo stamps [repository].trunk = master and land works", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The scaffolded config carries the repo's REAL default branch — without it
    // the gate's behind-main merge check self-skips forever ('main' is missing)
    // and `setup accept` dead-ends.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'trunk = "master"');

    // Landing works end to end: setup lives on discern-setup, lands onto master.
    await proveSetupBranchForAcceptance(dir);
    const land = await runAgent(dir, ["setup", "accept"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "master");

    // The merge check is armed against the stamped branch: status reports it as
    // the integration branch (and it exists locally, so nothing self-skips).
    const status = JSON.parse(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertEquals(status.data.git.trunk, "master");
  });
});

Deno.test("begin prefers the remote's declared default (origin/HEAD) over the current branch", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "feature-work");
    await git(dir, "remote", "add", "origin", dir);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    );
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'trunk = "trunk"');
  });
});

Deno.test("begin stamps the checked-out branch even when init.defaultBranch disagrees", async () => {
  // Vendor git builds bake `init.defaultBranch = main` into an unmaskable config
  // (Apple's git does), so the checked-out branch — the repo's ground truth —
  // must outrank it, or every macOS `master` repo would be stamped `main`.
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    await git(dir, "config", "init.defaultBranch", "trunk");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'trunk = "master"');
  });
});

Deno.test("begin falls back to init.defaultBranch on a detached HEAD", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    await git(dir, "checkout", "-q", "--detach");
    await git(dir, "config", "init.defaultBranch", "trunk");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'trunk = "trunk"');
  });
});

Deno.test("begin on an unborn-main repo stamps main, and land serves the creation step that then works", async () => {
  await withTempDir(async (dir) => {
    await unbornRepo(dir, "main");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'trunk = "main"');

    // `main` is still unborn (every commit landed on discern-setup): land refuses
    // with the exact creation-then-land step, not a dead end — and the same
    // message rides the JSON surface an agent reads.
    const refused = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const res = JSON.parse(refused.stdout);
    assertEquals(res.error, "no_target");
    assertStringIncludes(
      res.message,
      "git branch main && discern setup accept",
    );

    // Converge the fixture policy before creating the trunk baseline. The marker
    // commit made by the Proof helper then remains ahead of that baseline.
    await convergeSetupBranchForAcceptance(dir);
    // Following the served step lands the setup and arms the merge check.
    await git(dir, "branch", "main");
    await proveSetupBranchForAcceptance(dir);
    const land = await runAgent(dir, ["setup", "accept"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(
      await exists(join(dir, "discern.toml")),
      "discern landed on main",
    );
  });
});

// ── B8: non-git directories are honest and git-init-first ─────────────────────

Deno.test("verify in a non-git directory serves git-init-first and promises no isolation it can't deliver", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    const d = res.data;
    assertEquals(d.findings.git.repo, false);

    // The served next action is to CREATE the repository, then re-run the
    // preflight — never straight to begin.
    assertStringIncludes(d.next_action, "git init");
    const conflict = d.conflicts.find(
      (c: { kind: string }) => c.kind === "not_a_repo",
    );
    assert(conflict !== undefined, JSON.stringify(d.conflicts));
    assertStringIncludes(conflict.detail, "git init");
    assert(
      !conflict.detail.includes("Consider"),
      "git init is the path, not a soft suggestion",
    );

    // The consent message conditions its promises on the git state: no
    // unconditional isolated-branch story, and the git-init consent point rides
    // the fenced message.
    assert(
      !d.instructions.includes("so nothing touches your main branch"),
      "the served message must not promise branch isolation without git",
    );
    assertStringIncludes(d.instructions, "OK to initialize git here?");

    // Parity (ADR 0086): a flag-less fresh `begin` re-serves the identical
    // conditioned message.
    const begin = await runAgent(dir, ["setup", "begin"]);
    assertEquals(begin.code, 1, begin.output);
    assertStringIncludes(begin.stdout, d.instructions);
  });
});

// ── C9 residual: verify previews from the resolved root ───────────────────────

Deno.test("verify from a repo subdirectory previews the ROOT's sibling worktree path", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const sub = join(dir, "packages", "app");
    await Deno.mkdir(sub, { recursive: true });

    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"], { cwd: sub })).stdout,
    ).data;
    // The preview must describe the tree `begin` will operate on — the repo
    // top-level and ITS sibling — not `<subdir>.worktrees` inside the repo.
    // (realPath: git reports the /private-canonicalized form of the temp dir.)
    assertEquals(
      d.findings.worktree_path,
      `${await Deno.realPath(dir)}.worktrees`,
    );
  });
});

// ── C11: the welcome shows where it's needed most ──────────────────────────────

Deno.test("bare `discern` in a non-git directory shows the welcome (leading with git init), not raw CLI help", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    const r = await runAgent(dir, []);
    assertEquals(r.code, 0, r.output);
    // The curated first contact, dual-addressed — not the operator help.
    assertTerminalTextIncludes(r.stdout, "FOR HUMANS");
    assertTerminalTextIncludes(r.stdout, "FOR CODING AGENTS");
    assert(
      !r.stdout.includes("Usage:"),
      `raw CLI help must not be the no-git first contact:\n${r.stdout}`,
    );
    // …and it leads with the git-init step (there is no isolation without git).
    assertTerminalTextIncludes(r.stdout, "git init");
    // The welcome writes nothing, in a stray dir least of all.
    assert(!(await exists(join(dir, "discern.toml"))));
  });
});

Deno.test("the fresh welcome carries the git-init note only in a non-git directory", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    // Non-git: the note rides both surfaces.
    const nonGit = await runAgent(dir, ["setup"]);
    assertTerminalTextIncludes(nonGit.stdout, "isn't a git repository yet");
    const nonGitJson = JSON.parse(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    ).data;
    assertStringIncludes(nonGitJson.human_framing, "git init");

    // With git: no note on either surface.
    await gitInit(dir);
    const withGit = await runAgent(dir, ["setup"]);
    assert(!withGit.stdout.includes("isn't a git repository yet"));
    const withGitJson = JSON.parse(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    ).data;
    assert(!withGitJson.human_framing.includes("git init"));
  });
});

// ── C10: a copied placeholder can't scaffold ───────────────────────────────────

Deno.test("isValidMapDir rejects the placeholder class, not one instance", () => {
  // Any angle-bracketed value is an unsubstituted placeholder — the guard is on
  // the shape, so every current and future served example is covered.
  for (
    const placeholder of [
      "<their-docs-path>",
      "<chosen-docs-dir>",
      "docs/<subdir>",
      "<docs>",
    ]
  ) {
    assert(
      !isValidMapDir(placeholder),
      `placeholder must be invalid: ${placeholder}`,
    );
  }
  assert(isValidMapDir("docs/"));
});

Deno.test("begin rejects a verbatim --map placeholder instead of scaffolding a literal tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--map",
      "<their-docs-path>",
    ]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.error, "invalid_arguments");
    assertStringIncludes(res.message, "placeholder");
    assertStringIncludes(res.message, "--map notes/map/");
    // Nothing was written — no literal `<their-docs-path>/` tree, no config.
    assert(!(await exists(join(dir, "<their-docs-path>"))));
    assert(!(await exists(join(dir, "discern.toml"))));
  });
});

// ── B9: commit failures explain themselves ─────────────────────────────────────

/** A git repo with one commit but NO configured identity — the commit was made
 * with one-shot `-c` overrides. `user.useConfigOnly` makes the missing identity
 * fail deterministically (without it, git may auto-detect user@hostname on some
 * machines and silently record a guessed author instead). */
async function repoWithoutIdentity(dir: string): Promise<void> {
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.useConfigOnly", "true");
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await git(dir, "add", "-A");
  await git(
    dir,
    "-c",
    "user.name=Engine Test",
    "-c",
    "user.email=engine-test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "scaffold",
  );
}

Deno.test("verify names a missing git identity with the exact commands, and begin's failed machinery commit surfaces stderr", async () => {
  await withTempDir(async (dir) => {
    await repoWithoutIdentity(dir);

    // The preflight names the gap BEFORE the agent burns a session hitting it.
    const v = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertEquals(v.findings.git.identity, false);
    const conflict = v.conflicts.find(
      (c: { kind: string }) => c.kind === "missing_git_identity",
    );
    assert(conflict !== undefined, JSON.stringify(v.conflicts));
    assertStringIncludes(conflict.detail, 'git config user.name "Your Name"');
    assertStringIncludes(
      conflict.detail,
      'git config user.email "you@example.com"',
    );

    // If the agent proceeds anyway, the machinery auto-commit fails — and the
    // cause is surfaced (git's stderr line), not collapsed into a silent skip.
    const begin = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(begin.code, 0, begin.output);
    const d = JSON.parse(begin.stdout).data;
    assertEquals(d.machinery_committed, false);
    assert(
      typeof d.machinery_commit_error === "string" &&
        d.machinery_commit_error.length > 0,
      `expected the git stderr cause: ${JSON.stringify(d)}`,
    );
  });
});

Deno.test("a failed completion-marker commit explains itself instead of misattributing the cause", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.useConfigOnly", "true");
    await git(dir, "add", "-A");
    await git(
      dir,
      "-c",
      "user.name=Engine Test",
      "-c",
      "user.email=engine-test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "scaffold",
    );

    // --force skips the completion proof; the marker is written, and its
    // auto-commit fails on the missing identity. The old output misattributed
    // this as "could not prove that was the only discern.toml change".
    const human = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.stdout, "Git said:");
    assert(
      !human.stdout.includes("could not prove"),
      `a failed commit must not be misattributed:\n${human.stdout}`,
    );

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertEquals(res.data.marker_committed, false);
    assert(
      typeof res.data.marker_commit_error === "string" &&
        res.data.marker_commit_error.length > 0,
      `expected the git stderr cause: ${JSON.stringify(res.data)}`,
    );
  });
});

// ── B7: an abandoned setup resumes instead of compounding ─────────────────────

Deno.test("an abandoned setup routes first contact to the resume, and re-begin resumes instead of re-scaffolding", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const first = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(first.code, 0, first.output);

    // Abandon mid-setup: switch back to main. The config lives only in commits
    // on discern-setup; the agent files are gitignored and survive.
    await git(dir, "checkout", "-q", "main");
    assert(!(await exists(join(dir, "discern.toml"))), "config is branch-only");

    // The welcome routes to the resume, not the FRESH funnel.
    const w = JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout)
      .data;
    assertEquals(w.phase, "in_progress");
    assertStringIncludes(w.next_action, "discern setup begin --confirmed");
    assertStringIncludes(w.agent_instructions, "without replaying completed");
    const human = (await runAgent(dir, ["setup"])).stdout;
    assertStringIncludes(human, "IN PROGRESS");
    assertStringIncludes(human, "discern setup begin --confirmed");
    assert(
      !human.includes("This project isn't set up yet"),
      `the fresh welcome must not show over an abandoned setup:\n${human}`,
    );

    // verify routes the same way.
    const v = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertEquals(v.phase, "in_progress");
    assertStringIncludes(v.next_action, "discern setup begin --confirmed");

    // A re-begin from main RESUMES: the existing branch is checked out, the
    // materialized install is recognized (nothing re-scaffolded), and nothing of
    // discern's own compiled output is imported into the instruction source.
    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(re.code, 0, re.output);
    const reData = JSON.parse(re.stdout).data;
    assertEquals(reData.written, [], "a resume must not re-scaffold");
    const instructions = await Deno.readTextFile(
      join(dir, SOURCE_PATHS.instructions.defaultPath),
    );
    assert(
      !instructions.includes("Imported from"),
      `discern's own compiled output was imported into instructions:\n${instructions}`,
    );
  });
});

Deno.test("re-begin never imports a surviving agent file that matches discern's own render", async () => {
  // The harder abandonment: the setup branch was DELETED, so the install really
  // is fresh again — but the gitignored agent file survived on disk.
  // The ownership guard must recognize it as discern's own output and skip the
  // "Imported from" migration (it is not the user's authoring), and say so.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const first = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(first.code, 0, first.output);
    const survivorPath = join(dir, "CLAUDE.md");
    const survivor = await Deno.readTextFile(survivorPath);
    assertStringIncludes(
      survivor,
      "`00-orientation` — Orientation",
      "setup must return with instructions compiled from the map skeleton it laid",
    );

    // Add an unrelated future region after the compiled survivor: own-render
    // recognition must tolerate any generated region-list revision, without a
    // name-based exception for today's skeleton.
    const futureRegion = join(
      dir,
      SOURCE_PATHS.map.defaultPath,
      "91-unrelated-surface",
    );
    await Deno.mkdir(futureRegion, { recursive: true });
    await Deno.writeTextFile(
      join(futureRegion, "README.md"),
      "# Unrelated surface\n\nA future map region.\n",
    );
    await git(dir, "checkout", "-q", "main");
    await git(dir, "branch", "-D", "discern-setup");
    assert(await exists(survivorPath), "the compiled file survives");

    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(re.code, 0, re.output);
    const instructions = await Deno.readTextFile(
      join(dir, SOURCE_PATHS.instructions.defaultPath),
    );
    assert(
      !instructions.includes("Imported from"),
      `discern's own compiled output was imported into instructions:\n${instructions}`,
    );
    // …and the skip is reported, not silent.
    assertHasHint(
      JSON.parse(re.stdout),
      HINTS["setup-instructions-own-render-skipped"],
      {
        paths: ["CLAUDE.md"],
        instructionRel: SOURCE_PATHS.instructions.defaultPath,
      },
    );
  });
});

// ── Re-entry convergence: a resumed/forced begin reaches a clean run's end state ──
//
// The class behind B46/B47/B48: a `begin` step whose correctness depended on state that
// only the FIRST run had (the freshly-written ScaffoldOutcome, the branch setup started on,
// the freshInstall flag). When a first attempt fails early and the user simply re-runs, the
// second run must re-derive that state from what is persisted (the committed config, the real
// repo branches, the on-disk wiring) and converge to EXACTLY the install a clean first run
// produces — machinery committed, the right `[repository].trunk`, only the configured
// agents' seeds. A member that diverges (wiring left uncommitted, `main` stamped on a master
// repo, DEFAULT_AGENTS scaffolded over a differently-configured project) fails here. Each
// case injects one documented early-failure, re-runs `begin`, and asserts convergence on the
// dimension it governs; the shared harness proves the retried run is not merely non-erroring
// but END-STATE-EQUAL to a clean run.

/** The end-state invariants a clean `begin` establishes, that a re-run must also reach. */
interface ReentryConvergence {
  /** discern's harness wiring is committed on the setup branch (nothing uncommitted). */
  machineryCommitted: boolean;
  /** The stamped `[repository].trunk`. */
  mainBranch: string;
  /** The agents whose per-agent seed files were laid (sorted). */
  scaffoldedAgents: string[];
}

/** Whether discern.toml is committed (tracked, no uncommitted change) in `dir`. */
async function configIsCommitted(dir: string): Promise<boolean> {
  const tracked = await gitOut(dir, "ls-files", "--", "discern.toml");
  if (tracked.trim() === "") {
    return false; // never committed
  }
  const dirty = await gitOut(
    dir,
    "status",
    "--porcelain",
    "--",
    "discern.toml",
  );
  return dirty.trim() === "";
}

/** The registry slice the probe derivation reads — structural, so the adversarial
 * fixtures below can pose as future providers without touching the real registry. */
interface ProbeSource {
  readonly name: string;
  readonly hooks?: { readonly settingsFile: string };
}

/**
 * The per-provider "this agent was scaffolded" probe files, DERIVED from the
 * PROVIDERS registry: each native provider's hooks/settings seed is its observable
 * scaffold signal. Deriving (rather than hand-listing) is what keeps the re-entry
 * convergence tests total over the provider set — a sixth native provider enrols
 * the moment it joins the catalogue. A provider the probe cannot observe (no
 * per-agent file) or cannot distinguish (a file shared with another provider)
 * throws, forcing a conscious probe decision instead of a silently blind spot.
 */
function scaffoldProbes(
  providers: readonly ProbeSource[] = AGENT_NAMES.map((n) => PROVIDERS[n]),
): Record<string, string> {
  const probes: Record<string, string> = {};
  const owners = new Map<string, string>();
  for (const provider of providers) {
    const file = provider.hooks?.settingsFile;
    if (file === undefined) {
      throw new Error(
        `provider ${provider.name} declares no hooks settings file, so the convergence probe cannot observe its scaffold — give it an observable per-agent seed or record a named exception here`,
      );
    }
    const owner = owners.get(file);
    if (owner !== undefined) {
      throw new Error(
        `providers ${owner} and ${provider.name} share ${file} — file presence cannot tell their scaffolds apart`,
      );
    }
    owners.set(file, provider.name);
    probes[provider.name] = file;
  }
  return probes;
}

Deno.test("the scaffold probes cover every native provider with a distinct file", () => {
  const probes = scaffoldProbes();
  assertEquals(Object.keys(probes).sort(), [...AGENT_NAMES].sort());
});

Deno.test("the probe derivation rejects a future provider it cannot observe", () => {
  // The adversarial future sibling: fresh name, no case-table entry — the
  // derivation must refuse to leave it invisibly outside the probe set.
  assertThrows(
    () =>
      scaffoldProbes([...AGENT_NAMES.map((n) => PROVIDERS[n]), {
        name: "futuretool",
      }]),
    Error,
    "futuretool",
  );
});

Deno.test("the probe derivation rejects two providers sharing one settings file", () => {
  assertThrows(
    () =>
      scaffoldProbes([
        { name: "futuretool", hooks: { settingsFile: "shared/settings.json" } },
        { name: "othertool", hooks: { settingsFile: "shared/settings.json" } },
      ]),
    Error,
    "shared/settings.json",
  );
});

/** Read the convergence invariants from an install on the setup branch. */
async function readConvergence(dir: string): Promise<ReentryConvergence> {
  const toml = await Deno.readTextFile(join(dir, "discern.toml"));
  const cfg = parseConfigOrThrow(toml);
  const scaffoldedAgents: string[] = [];
  for (const [agent, rel] of Object.entries(scaffoldProbes())) {
    if (await exists(join(dir, rel))) {
      scaffoldedAgents.push(agent);
    }
  }
  scaffoldedAgents.sort();
  return {
    machineryCommitted: await configIsCommitted(dir),
    mainBranch: cfg.repository.trunk,
    scaffoldedAgents,
  };
}

Deno.test("re-entry (B46): a machinery-commit failure on the first begin is retried and committed on re-run", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    // First begin: a rejecting pre-commit hook makes the machinery auto-commit FAIL, so
    // discern's wiring lands on the discern-setup branch uncommitted (the B46 setup).
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await Deno.writeTextFile(hook, "#!/bin/sh\nexit 1\n");
    await Deno.chmod(hook, 0o755);
    const first = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(first.code, 0, first.output);
    assertEquals(
      JSON.parse(first.stdout).data.machinery_committed,
      false,
      "precondition: the first commit must have failed",
    );
    assertEquals(
      await configIsCommitted(dir),
      false,
      "precondition: the wiring is uncommitted after the failed first run",
    );
    const retryEvidence = await readSetupMachineryCommitEvidence(dir);
    assertEquals(
      retryEvidence.status,
      "found",
      "the failed first attempt must retain its exact staged evidence",
    );
    assert(retryEvidence.status === "found");

    // The user fixes the environment (removes the failing hook) and simply RE-RUNS begin.
    await Deno.remove(hook);
    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(re.code, 0, re.output);

    // Convergence: the re-run reports the wiring committed, and it truly is — the resume
    // re-attempted the commit it skipped before, rather than leaving it uncommitted forever.
    const data = JSON.parse(re.stdout).data;
    assertEquals(data.branch, "discern-setup");
    assertEquals(
      data.machinery_committed,
      true,
      `re-run must retry the machinery commit; got ${JSON.stringify(data)}`,
    );
    const conv = await readConvergence(dir);
    assertEquals(
      conv.machineryCommitted,
      true,
      "discern's wiring must be committed after the retry",
    );
    // The committed set is discern's machinery only — the authored seeds stay for the agent.
    const committed =
      (await gitOut(dir, "show", "--name-only", "--format=", "HEAD"))
        .split("\n").map((s) => s.trim()).filter(Boolean).sort();
    assertEquals(committed, [
      ".claude/settings.json",
      ".gitattributes",
      ".gitignore",
      ".mcp.json",
      "discern.toml",
    ]);
    assertEquals(await parsedCommitTrailers(dir), DISCERN_MACHINE.trailer);
    assertEquals(
      await gitOut(dir, "rev-parse", "HEAD^{tree}"),
      retryEvidence.evidence.indexTree,
      "the successful commit object must carry the recorded tree",
    );
    assertEquals(
      (await readSetupMachineryCommitEvidence(dir)).status,
      "missing",
      "a successful retry must clear its spent evidence",
    );
  });
});

/** Run setup behind a rejecting commit hook and capture the exact generated machinery left uncommitted. */
async function beginWithRejectedMachineryCommit(
  dir: string,
): Promise<{ hook: string; machinery: string[] }> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
  const hook = join(dir, ".git", "hooks", "pre-commit");
  await Deno.writeTextFile(hook, "#!/bin/sh\nexit 1\n");
  await Deno.chmod(hook, 0o755);
  const first = await runAgent(dir, [
    "setup",
    "begin",
    "--confirmed",
    "--json",
    "--agents",
    AGENT_NAMES.join(","),
  ]);
  assertEquals(first.code, 0, first.output);
  assertEquals(
    JSON.parse(first.stdout).data.machinery_committed,
    false,
    "precondition: the first machinery commit must fail",
  );
  const machinery = (await gitOut(dir, "diff", "--cached", "--name-only", "--"))
    .split("\n").filter(Boolean).sort();
  assert(
    machinery.length > 0,
    "the rejected commit must leave staged machinery",
  );
  const read = await readSetupMachineryCommitEvidence(dir);
  assertEquals(read.status, "found");
  assert(read.status === "found");
  assertEquals(
    read.evidence.entries.map((entry) => entry.path),
    machinery,
    "evidence must enumerate the exact staged machinery set",
  );
  assertEquals(read.evidence.branch, "discern-setup");
  assertEquals(
    read.evidence.head,
    await gitOut(dir, "rev-parse", "HEAD"),
  );
  assertEquals(
    read.evidence.indexTree,
    await gitOut(dir, "write-tree"),
    "evidence must bind the whole index, including the absence of other staged paths",
  );
  for (const entry of read.evidence.entries) {
    assertEquals(
      await gitOut(dir, "ls-files", "--stage", "--", entry.path),
      `${entry.mode} ${entry.oid} 0\t${entry.path}`,
      `evidence must retain the exact staged blob for ${entry.path}`,
    );
    assertEquals(
      await gitOut(
        dir,
        "hash-object",
        "--no-filters",
        "--",
        entry.path,
      ),
      entry.worktreeOid,
      `evidence must retain the raw worktree bytes for ${entry.path}`,
    );
  }
  return { hook, machinery };
}

/** Repeat setup through the JSON surface and return its effect-accounting data. */
async function retrySetup(dir: string): Promise<Record<string, unknown>> {
  const retried = await runAgent(dir, [
    "setup",
    "begin",
    "--confirmed",
    "--json",
    "--agents",
    AGENT_NAMES.join(","),
  ]);
  assertEquals(retried.code, 0, retried.output);
  return JSON.parse(retried.stdout).data;
}

/** Prove a changed retry authored no commit and claimed no prior setup provenance. */
async function assertRetryWasNotAttributed(
  dir: string,
  data: Record<string, unknown>,
  context: string,
  evidenceStatus: "found" | "invalid" | "missing" = "found",
): Promise<void> {
  assertEquals(
    data.machinery_committed,
    false,
    `${context}: a changed retry must skip the machinery commit`,
  );
  assertEquals(
    await gitOut(dir, "rev-list", "--count", "HEAD"),
    "1",
    `${context}: a changed retry must not author any commit`,
  );
  assertEquals(
    await parsedCommitTrailers(dir),
    "",
    `${context}: a changed retry must not receive ${DISCERN_MACHINE.trailer}`,
  );
  assertEquals(
    (await readSetupMachineryCommitEvidence(dir)).status,
    evidenceStatus,
    `${context}: a skipped retry must retain, not broaden, its original proof`,
  );
}

Deno.test("re-entry attribution guard: every resumed machinery candidate must still match the failed staged attempt", async () => {
  let machinery: string[] = [];
  await withTempDir(async (dir) => {
    machinery = (await beginWithRejectedMachineryCommit(dir)).machinery;
  });

  // The case table comes from the actual staged setup output for every registered
  // provider. A future provider or machinery category is therefore enrolled without
  // adding its path here. Every candidate drives its own scaffold, so the
  // sweep fans out.
  await mapPool(machinery, 8, async (path) => {
    await withTempDir(async (dir) => {
      const failed = await beginWithRejectedMachineryCommit(dir);
      assert(
        failed.machinery.includes(path),
        `fresh setup no longer stages enrolled machinery candidate ${path}`,
      );
      const target = join(dir, path);
      await Deno.writeTextFile(
        target,
        `${await Deno.readTextFile(target)}\n`,
      );
      await Deno.remove(failed.hook);
      await assertRetryWasNotAttributed(
        dir,
        await retrySetup(dir),
        `unstaged byte mutation of ${path}`,
      );
    });
  });

  await withTempDir(async (dir) => {
    const failed = await beginWithRejectedMachineryCommit(dir);
    const target = failed.machinery[0];
    assert(target !== undefined);
    await Deno.writeTextFile(
      join(dir, target),
      `${await Deno.readTextFile(join(dir, target))}\n`,
    );
    await git(dir, "add", "--", target);
    await Deno.remove(failed.hook);
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      `staged byte mutation of ${target}`,
    );
  });

  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitattributes"), "* text eol=lf\n");
    const failed = await beginWithRejectedMachineryCommit(dir);
    const target = failed.machinery[0];
    assert(target !== undefined);
    const original = await Deno.readTextFile(join(dir, target));
    await Deno.writeTextFile(
      join(dir, target),
      original.replaceAll("\n", "\r\n"),
    );
    await Deno.remove(failed.hook);
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      `raw worktree byte mutation normalized by Git filters in ${target}`,
    );
  });

  await withTempDir(async (dir) => {
    const failed = await beginWithRejectedMachineryCommit(dir);
    const target = failed.machinery.find((path) => path !== "discern.toml");
    assert(target !== undefined);
    await Deno.remove(join(dir, target));
    await Deno.remove(failed.hook);
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      `worktree deletion of ${target}`,
    );
  });

  await withTempDir(async (dir) => {
    const failed = await beginWithRejectedMachineryCommit(dir);
    await Deno.writeTextFile(join(dir, "user-staged.txt"), "user bytes\n");
    await git(dir, "add", "--", "user-staged.txt");
    await Deno.remove(failed.hook);
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      "unrelated staged content",
    );
  });

  await withTempDir(async (dir) => {
    const failed = await beginWithRejectedMachineryCommit(dir);
    const userPath = "hook-staged-user.txt";
    await Deno.writeTextFile(
      failed.hook,
      `#!/bin/sh\nprintf 'hook staged user bytes\\n' > ${userPath}\ngit add -- ${userPath}\n`,
    );
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      "a successful pre-commit hook staging unrelated bytes",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain", "--", userPath),
      `A  ${userPath}`,
      "rollback must preserve the hook's staged user bytes",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, userPath)),
      "hook staged user bytes\n",
      "rollback must preserve the hook's worktree bytes",
    );
  });

  await withTempDir(async (dir) => {
    const failed = await beginWithRejectedMachineryCommit(dir);
    const evidence = await gitAdminStatePath(
      dir,
      "setupMachineryCommitEvidence",
    );
    assert(evidence !== undefined);
    await Deno.writeTextFile(evidence, "{not valid evidence}\n");
    await Deno.remove(failed.hook);
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      "malformed retry evidence",
      "invalid",
    );
  });

  await withTempDir(async (dir) => {
    const failed = await beginWithRejectedMachineryCommit(dir);
    const evidence = await gitAdminStatePath(
      dir,
      "setupMachineryCommitEvidence",
    );
    assert(evidence !== undefined);
    await Deno.remove(evidence);
    await Deno.remove(failed.hook);
    await assertRetryWasNotAttributed(
      dir,
      await retrySetup(dir),
      "missing retry evidence",
      "missing",
    );
  });
});

Deno.test("re-entry (B48): a --force re-scaffold lays the configured agents' seeds, not DEFAULT_AGENTS", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    // A fresh install configured for gemini ONLY — deliberately not DEFAULT_AGENTS
    // (claude_code + codex), so a re-scaffold that reverts to the defaults is visible.
    // --allow-dirty keeps it in place (no discern-setup branch) so the re-scaffold
    // dimension under test is the agent set, isolated from the branch/commit machinery.
    const fresh = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--allow-dirty",
      "--agents",
      "gemini",
    ]);
    assertEquals(fresh.code, 0, fresh.output);
    const golden = await readConvergence(dir);
    assertEquals(
      golden.scaffoldedAgents,
      ["gemini"],
      "precondition: the fresh install laid only gemini's seed",
    );

    // Re-run with --force and NO --agents. resolveSetupConfig would fall back to
    // DEFAULT_AGENTS; the cure re-derives the agent set from the persisted
    // [project].agents instead, so the re-scaffold converges on the configured set.
    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--force",
      "--allow-dirty",
      "--json",
    ]);
    assertEquals(re.code, 0, re.output);

    // Convergence: no claude_code / codex seed leaked in — only gemini's, exactly as
    // the clean run produced. On the pre-fix code claude_code + codex seeds appear here.
    const conv = await readConvergence(dir);
    assertEquals(
      conv.scaffoldedAgents,
      golden.scaffoldedAgents,
      `a --force re-scaffold must honour the configured agents, not DEFAULT_AGENTS; ` +
        `laid ${JSON.stringify(conv.scaffoldedAgents)}`,
    );
    assert(
      !(await exists(join(dir, ".claude", "settings.json"))),
      "no claude_code seed may be laid over a gemini-only project",
    );
    assert(
      !(await exists(join(dir, ".codex", "hooks.json"))),
      "no codex seed may be laid over a gemini-only project",
    );
    // The persisted config is unchanged — the re-scaffold reads it, never rewrites it.
    assertEquals(
      parseConfigOrThrow(await Deno.readTextFile(join(dir, "discern.toml")))
        .project.agents,
      ["gemini"],
    );
  });
});

// The B48 × ADR 0125 seam: the re-scaffold's persisted-agents read goes through
// resolveConfiguredAgents, so an explicit `[instructions] agents = []` (no agents, honored
// verbatim per ADR 0125) must survive the flags round-trip — never decaying to
// DEFAULT_AGENTS at any hop (loadConfig → effectiveFlags → resolveSetupConfig).
// The fixture uses the declarative answers document: Cliffy drops an empty option
// value (`--agents ""` parses as undefined), so the document and the persisted config
// are the surfaces that can express "no agents" — the flag cannot.
Deno.test("re-entry (B48): a --force re-scaffold honours an explicit [instructions] agents = [] — no seeds, never DEFAULT_AGENTS", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    // A fresh install deliberately configured for NO agents (ADR 0125's explicit
    // empty). --allow-dirty isolates the agent-set dimension, as in the sibling case.
    const answersPath = join(dir, "answers.json");
    await Deno.writeTextFile(
      answersPath,
      JSON.stringify({ version: "2", agents: [] }),
    );
    const fresh = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--allow-dirty",
      "--config",
      answersPath,
    ]);
    assertEquals(fresh.code, 0, fresh.output);
    const golden = await readConvergence(dir);
    assertEquals(
      golden.scaffoldedAgents,
      [],
      "precondition: an explicit-empty agent set lays no per-agent seed",
    );
    assertEquals(
      parseConfigOrThrow(await Deno.readTextFile(join(dir, "discern.toml")))
        .project.agents,
      [],
      "precondition: the config records the explicit empty list",
    );

    // Re-run with --force and NO --agents: the persisted explicit [] must be honored,
    // not treated as unset (which would decay to DEFAULT_AGENTS' seeds).
    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--force",
      "--allow-dirty",
      "--json",
    ]);
    assertEquals(re.code, 0, re.output);
    const conv = await readConvergence(dir);
    assertEquals(
      conv.scaffoldedAgents,
      [],
      `a --force re-scaffold over an explicit agents = [] must lay no agent seeds; ` +
        `laid ${JSON.stringify(conv.scaffoldedAgents)}`,
    );
  });
});

Deno.test("re-entry (B47): setup that starts on discern-setup stamps the real integration branch, not init.defaultBranch", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    // Simulate a vendored git baking init.defaultBranch=main (Apple's git ships this
    // unmaskable): the wrong stamp for a master repo once HEAD is discern-setup.
    await git(dir, "config", "init.defaultBranch", "main");

    // Model an interruption after the isolated branch effect but before scaffold
    // output. Setup's input validation is now a cheap precondition and cannot
    // create this partial state itself.
    await git(dir, "checkout", "-b", "discern-setup");
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "precondition: the interrupted branch has no setup output",
    );

    // Detection cannot read the integration branch from HEAD; it must recover
    // master from the actual branches rather than use init.defaultBranch.
    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--slug",
      "valid-slug",
      "--agents",
      "claude_code",
    ]);
    assertEquals(re.code, 0, re.output);

    // Convergence: the stamped integration branch is master, exactly what a clean
    // first run on this repository stamps.
    const conv = await readConvergence(dir);
    assertEquals(
      conv.mainBranch,
      "master",
      `a retry on discern-setup must stamp the real integration branch, not ` +
        `init.defaultBranch; stamped ${conv.mainBranch}`,
    );

    // End to end: landing uses the recovered branch.
    await proveSetupBranchForAcceptance(dir);
    const land = await runAgent(dir, ["setup", "accept"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "master");
  });
});
