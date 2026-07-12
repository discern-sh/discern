/**
 * The improvement **catalog** — the project facts gathered once ({@link buildContext})
 * and the best-practice {@link CATEGORIES} evaluated against them.
 *
 * Each category groups related rules. Each rule is either deterministic (discern
 * decides it) or subjective (discern surfaces it for the agent to judge against the
 * cited material). The catalog is data, not control flow: the runner in `improve.ts`
 * walks it. To add a best practice, add a rule here — nothing else changes.
 *
 * The bar for a deterministic rule: its verdict must be *certain* from the gathered
 * facts (no guessing). Anything that needs judgement is a subjective rule instead,
 * so improve never reports a confident pass/fail it can't actually stand behind.
 */

import { join } from "@std/path";
import { toCommandList } from "../../shared/config_schema.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { resolveGuidanceSources, resolveSkillsDir } from "../../lib/paths.ts";
import { allGuidanceFilePaths } from "../../lib/providers.ts";
import { normalizeMapDir } from "../../shared/map_path.ts";
import { SOURCE_PATHS } from "../../shared/paths_registry.ts";
import type {
  Category,
  DeterministicRule,
  ImprovementContext,
  SubjectiveRule,
} from "./types.ts";

// ── gathering the facts ─────────────────────────────────────────────────────

/** The setup skeleton seeds guidance.md with this phrase until the agent fills it;
 * its presence means the guidance is still a placeholder, not real prose. */
const GUIDANCE_PLACEHOLDER_MARK = "setup fills this";

/** Substance threshold (non-whitespace chars) below which a guidance file reads as
 * a stub rather than real, project-specific guidance. */
const GUIDANCE_SUBSTANCE_MIN = 400;

/** Whether a path exists (any type). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether a regular file exists at `path`. */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Count real ADRs under the configured map root's `_adr`, recursing into
 * subdirectories so retired
 * ADRs relocated under `_superseded/` still count: files named `NNNN-*.md`,
 * excluding the `0000-template` seed. Zero when the directory is absent. */
export async function countAdrs(
  root: string,
  mapDir = SOURCE_PATHS.map.defaultPath,
): Promise<number> {
  let count = 0;
  async function scan(dir: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory) {
          await scan(join(dir, entry.name));
        } else if (
          entry.isFile && /^\d{4}-.*\.md$/.test(entry.name) &&
          !entry.name.startsWith("0000-")
        ) {
          count++;
        }
      }
    } catch {
      // directory absent — contributes zero
    }
  }
  await scan(join(root, normalizeMapDir(mapDir), "_adr"));
  return count;
}

/** Count authored skill directories under `[skills].dir` (each a dir, conventionally
 * holding a SKILL.md). Zero when the directory is absent. */
async function countAuthoredSkills(
  root: string,
  config: DiscernConfig,
): Promise<number> {
  const { abs } = resolveSkillsDir(root, config);
  let count = 0;
  try {
    for await (const entry of Deno.readDir(abs)) {
      if (entry.isDirectory) {
        count++;
      }
    }
  } catch {
    // no skills directory — zero authored skills
  }
  return count;
}

/** Whether any compiled agent file is present (the output of `discern refresh`).
 * Derived from the provider registry (every agent's `guidanceFile.path`), so a new
 * agent's file counts without editing this probe. */
async function anyAgentFile(root: string): Promise<boolean> {
  for (const name of allGuidanceFilePaths()) {
    if (await fileExists(join(root, name))) {
      return true;
    }
  }
  return false;
}

/**
 * Gather the project facts the improvement rules read — ONE pass of config access and
 * filesystem probing, so each rule stays a pure, synchronous function of the
 * returned context.
 */
export async function buildContext(
  root: string,
  config: DiscernConfig,
): Promise<ImprovementContext> {
  const sources = await resolveGuidanceSources(root, config);
  let guidanceText = "";
  for (const src of sources) {
    try {
      guidanceText += await Deno.readTextFile(src);
      guidanceText += "\n";
    } catch {
      // a source that vanished between glob and read contributes nothing
    }
  }
  const guidanceChars = guidanceText.replace(/\s+/g, "").length;

  const gotchasDoc = config.project.gotchas_doc.trim();
  const gotchasAbs = gotchasDoc === ""
    ? ""
    : gotchasDoc.startsWith("/")
    ? gotchasDoc
    : join(root, gotchasDoc);

  const mapDir = normalizeMapDir(config.map.dir);
  return {
    root,
    config,
    guidancePresent: sources.length > 0,
    guidanceText,
    guidanceChars,
    guidancePlaceholder: guidanceText.includes(GUIDANCE_PLACEHOLDER_MARK),
    gotchasDocSet: gotchasDoc !== "",
    gotchasDocExists: gotchasAbs !== "" && (await fileExists(gotchasAbs)),
    mapDir,
    mapTree: (await pathExists(join(root, mapDir))) &&
      (await fileExists(join(root, mapDir, "README.md"))),
    adrCount: await countAdrs(root, mapDir),
    agentFilePresent: await anyAgentFile(root),
    authoredSkills: await countAuthoredSkills(root, config),
  };
}

// ── small helpers the rules share ───────────────────────────────────────────

/** Whether a capability is wired (a non-empty command after no-op filtering). */
function capWired(
  ctx: ImprovementContext,
  name: keyof DiscernConfig["capabilities"],
): boolean {
  return toCommandList(ctx.config.capabilities[name]).length > 0;
}

/** Whether any wired `[checks.<name>]` runs in the given stage. */
function checkInStage(ctx: ImprovementContext, stage: string): boolean {
  return Object.values(ctx.config.checks).some(
    (c) => c.stage === stage && toCommandList(c.run).length > 0,
  );
}

/** A short, single-line excerpt of `text` (collapsed whitespace), capped to `max`. */
function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

// ── the categories ──────────────────────────────────────────────────────────

/** Quality gate — is `discern done` actually checking anything? Core. */
const GATE: Category = {
  name: "gate",
  title: "Quality gate",
  rules: [
    {
      kind: "deterministic",
      id: "gate.test",
      title: "Automated tests wired into the gate",
      weight: 3,
      fix:
        'discern config set-capability test "<your test command>" (e.g. "npm test")',
      teach:
        "A gate that runs no tests can't catch regressions — the single highest-" +
        "leverage capability to wire. Add your suite as [capabilities].test (or a " +
        "test-stage [checks.<name>]) so `discern done` runs it before work is called done.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        capWired(ctx, "test") || checkInStage(ctx, "test")
          ? { status: "pass", detail: "a test-stage command is wired" }
          : {
            status: "fail",
            detail: "no test capability or test-stage check is configured",
          },
    },
    {
      kind: "deterministic",
      id: "gate.static-analysis",
      title: "Static analysis wired (lint or type-check)",
      weight: 2,
      fix:
        'discern config set-capability lint "<linter>" and/or typecheck "<type checker>"',
      teach:
        "Static analysis catches a whole class of defects before tests run. Wire a " +
        "linter ([capabilities].lint) and/or a type checker ([capabilities].typecheck) " +
        "so the check stage has teeth.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        capWired(ctx, "lint") || capWired(ctx, "typecheck") ||
          checkInStage(ctx, "check")
          ? { status: "pass", detail: "a check-stage command is wired" }
          : {
            status: "fail",
            detail: "no lint, typecheck, or check-stage command is configured",
          },
    },
    {
      kind: "deterministic",
      id: "gate.format",
      title: "Formatter wired (the fix stage)",
      weight: 1,
      fix:
        'discern config set-capability format "<formatter>" (e.g. "prettier --write .")',
      teach:
        "A formatter in the fix stage keeps diffs about substance, not whitespace, " +
        "and runs first so later stages see canonical code. Wire [capabilities].format.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        capWired(ctx, "format") || checkInStage(ctx, "fix")
          ? { status: "pass", detail: "a fix-stage command is wired" }
          : { status: "fail", detail: "no formatter is configured" },
    },
    {
      kind: "subjective",
      id: "gate.fast-feedback",
      title: "The gate stays fast enough to run every time",
      ask:
        "Given the test command below, and that `discern done` runs it on every " +
        "acceptance and whenever a change is called done — does the gate stay fast " +
        "as the suite grows, and is the runner using the parallelism it offers? " +
        "Parallel execution depends on isolated tests: each owning its own temp dir, " +
        "environment, ports, and fixtures, mutating no process-global state another " +
        "test could observe. A slow or order-flaky gate trains people to skip it or " +
        "rerun until green.",
      teach:
        "Isolated, order-independent tests are the precondition for parallel " +
        "execution and a trustworthy green. Give each test its own temp dir / env / " +
        "fixtures, avoid shared global state, then enable your runner's parallel mode.",
      against: (ctx): { source: string; excerpt: string } | undefined => {
        const cmd = toCommandList(ctx.config.capabilities.test).join(" && ");
        return cmd.trim().length > 0
          ? { source: "the configured test command", excerpt: cmd }
          : undefined;
      },
    },
    {
      kind: "subjective",
      id: "gate.test-depth",
      title: "Tests protect behaviour, boundaries, and failure paths",
      ask:
        "Inspect representative tests behind the configured command. Do they protect " +
        "observable behaviour at important boundaries — including failure paths and " +
        "edge cases — or mostly mirror implementation details and prove that happy-path " +
        "code runs? Would a plausible regression fail for a useful reason?",
      teach:
        "A strong suite buys confidence, not just test count. Prefer externally visible " +
        "outcomes, boundary conditions, and past failure modes; keep assertions specific " +
        "enough that a red test explains the broken promise without coupling every test " +
        "to internal structure.",
      against: (ctx): { source: string; excerpt: string } | undefined => {
        const cmd = toCommandList(ctx.config.capabilities.test).join(" && ");
        return cmd.trim().length > 0
          ? {
            source: "the test suite behind the configured command",
            excerpt: cmd,
          }
          : undefined;
      },
    },
  ],
};

/** Project setup — the one-time foundations the rest of discern leans on. Core. */
const SETUP: Category = {
  name: "setup",
  title: "Project setup",
  rules: [
    {
      kind: "deterministic",
      id: "setup.bootstrapped",
      title: "Project set up",
      weight: 2,
      fix: "discern setup",
      teach:
        "Setup seeds the docs skeleton and prompts the agent to author your guidance " +
        "and design principles from the repo and your answers. Until it runs, the " +
        "project has only a bare gate. Run `discern setup`, then `discern setup done`.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        ctx.config.meta.bootstrapped
          ? { status: "pass", detail: "[meta].bootstrapped is set" }
          : {
            status: "fail",
            detail: "the one-time setup has not been run",
          },
    },
    {
      kind: "deterministic",
      id: "setup.gotchas-doc",
      title: "Failure-pointer (gotchas) doc set",
      weight: 1,
      fix:
        'discern config set project.gotchas_doc "docs/.../done-gate-gotchas.md" (and write it)',
      teach:
        "When a gate stage fails in a non-obvious way, discern points the agent at " +
        "[project].gotchas_doc. Keeping a living list of your stack's traps there turns " +
        "repeated head-scratching into a one-line pointer.",
      evaluate: (
        ctx,
      ): { status: "pass" | "partial" | "fail"; detail: string } => {
        const doc = ctx.config.project.gotchas_doc.trim();
        if (!ctx.gotchasDocSet) {
          return { status: "fail", detail: "no [project].gotchas_doc is set" };
        }
        // A set-but-dangling pointer is a partial (doctor owns the hard existence
        // failure — here it's a nudge to keep the doc real and current).
        return ctx.gotchasDocExists
          ? { status: "pass", detail: `points at ${doc}` }
          : {
            status: "partial",
            detail: `[project].gotchas_doc points at ${doc}, which is missing`,
          };
      },
    },
    {
      kind: "subjective",
      id: "setup.failure-memory",
      title: "The gotchas doc is an actionable failure playbook",
      ask:
        "Read the configured gotchas document. Does each entry capture a recurring, " +
        "non-obvious failure with the symptom, likely cause, and proven recovery — or " +
        "is it generic advice, stale history, or a list that still makes the next agent " +
        "rediscover the diagnosis?",
      teach:
        "Good failure memory shortens the next incident. Record only traps the code and " +
        "ordinary tool output do not make obvious; make each entry searchable from the " +
        "observed symptom and concrete enough to verify the fix, then remove it when " +
        "the underlying trap is eliminated.",
      against: (ctx): { source: string; excerpt: string } | undefined => {
        const doc = ctx.config.project.gotchas_doc.trim();
        return doc === "" ? undefined : {
          source: doc,
          excerpt: ctx.gotchasDocExists
            ? "configured failure-pointer document"
            : "configured path is currently missing",
        };
      },
    },
  ],
};

/** Agent guidance — the author-once → compile-everywhere instruction pipeline. */
const GUIDANCE: Category = {
  name: "guidance",
  title: "Agent guidance",
  rules: [
    {
      kind: "deterministic",
      id: "guidance.source",
      title: "Substantive guidance source",
      weight: 3,
      fix:
        "write project-specific prose into guidance.md, then `discern refresh`",
      teach:
        "Built-in guidance teaches discern; YOUR guidance teaches your project — " +
        "the conventions, boundaries, and gotchas an agent can't infer from the code. " +
        "A thin or missing guidance.md is a thin agent. Aim for real, specific prose.",
      evaluate: (
        ctx,
      ): { status: "pass" | "partial" | "fail"; detail: string } => {
        if (!ctx.guidancePresent || ctx.guidanceChars === 0) {
          return {
            status: "fail",
            detail: "no [guidance].sources file resolves on disk",
          };
        }
        if (
          ctx.guidancePlaceholder || ctx.guidanceChars < GUIDANCE_SUBSTANCE_MIN
        ) {
          return {
            status: "partial",
            detail: ctx.guidancePlaceholder
              ? "guidance still carries the bootstrap placeholder marker"
              : `guidance is thin (${ctx.guidanceChars} non-whitespace chars)`,
          };
        }
        return {
          status: "pass",
          detail: `${ctx.guidanceChars} chars of guidance prose`,
        };
      },
    },
    {
      kind: "deterministic",
      id: "guidance.compiled",
      title: "Agent files compiled",
      weight: 1,
      fix: "discern refresh",
      teach:
        "The per-provider agent files (one per configured agent) are compiled from the " +
        "built-in guidance plus your sources. If none exist, agents are flying blind. " +
        "Run `discern refresh` to (re)compile them.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        ctx.agentFilePresent
          ? { status: "pass", detail: "a compiled agent file is present" }
          : {
            status: "fail",
            detail: "no compiled agent file found",
          },
    },
    {
      kind: "subjective",
      id: "guidance.project-specific",
      title: "Guidance captures what the code can't say",
      ask:
        "Reading the guidance below, does it teach project-specific knowledge an agent " +
        "could NOT infer from the code itself — the testing philosophy, the architectural " +
        "boundaries that must hold, the non-obvious gotchas, the 'we tried X, it failed' " +
        "lessons? Or is it generic filler that restates what the code already shows?",
      teach:
        "Strong guidance is specific and load-bearing: it changes what an agent does. " +
        "If a line would be true of any project in the language, cut it. If a real " +
        "constraint isn't written down, add it. Edit your guidance source and run `discern refresh`.",
      against: (ctx): { source: string; excerpt: string } | undefined =>
        ctx.guidanceChars === 0 ? undefined : {
          source: ctx.config.guidance.sources.join(", "),
          excerpt: excerpt(ctx.guidanceText, 600),
        },
    },
  ],
};

/** The project map — the agent-maintained documentation tree and ADR discipline. */
const MAP: Category = {
  name: "map",
  title: "Project map",
  rules: [
    {
      kind: "deterministic",
      id: "map.tree",
      title: "Project map present",
      weight: 2,
      fix: "discern setup (seeds the configured map skeleton), then fill it in",
      teach:
        "The project map is its agent-maintained documentation tree (with a README at its root), where the project's " +
        "shape lives for future-you and the agents grounding work in it. `discern map` " +
        "browses it; `discern setup` seeds the skeleton.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        ctx.mapTree
          ? {
            status: "pass",
            detail: `${ctx.mapDir} with a README.md exists`,
          }
          : {
            status: "fail",
            detail: `no ${ctx.mapDir} tree with a README.md`,
          },
    },
    {
      kind: "deterministic",
      id: "map.adrs",
      title: "Architecture decisions recorded",
      weight: 1,
      fix:
        "record significant decisions under the configured map root's _adr/ directory (the discern-write-adr skill helps)",
      teach:
        "ADRs capture WHY a hard-to-reverse or surprising decision was made, so it " +
        "isn't silently re-litigated later. A project with none is losing that memory. " +
        "Record the next notable decision under the configured map root's _adr/ directory.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        ctx.adrCount > 0
          ? { status: "pass", detail: `${ctx.adrCount} ADR(s) recorded` }
          : {
            status: "fail",
            detail: `no ADRs under ${ctx.mapDir}_adr/`,
          },
    },
    {
      kind: "subjective",
      id: "map.current",
      title: "The map still matches the code",
      ask:
        "Pick a subsystem that changed recently. Does its documentation page still " +
        "describe how the code actually behaves now — present tense, no drift — or does " +
        "it describe a previous design? A stale doc is a bug.",
      teach:
        "Docs are only worth trusting if they track the code. When a change alters " +
        "documented behaviour, update the page in the same change. The discern-document-subsystem " +
        "skill refreshes a subtree; `discern map --list` shows the tree.",
      against: (ctx): { source: string; excerpt: string } | undefined =>
        ctx.mapTree
          ? {
            source: ctx.mapDir,
            excerpt: "browse with `discern map --list`",
          }
          : undefined,
    },
    {
      kind: "subjective",
      id: "map.navigation",
      title: "The map is navigable from overview to detail",
      ask:
        "Starting at the configured map root's README.md, can a new contributor find the system overview, " +
        "the relevant subsystem, and its detailed pages without already knowing their " +
        "filenames? Do subtree READMEs explain scope and link their leaves, or is the " +
        "tree merely a collection of documents?",
      teach:
        "Good documentation has a map as well as accurate pages. Keep the root index " +
        "small and oriented around reader journeys, give each subsystem an overview, " +
        "and link detail from the nearest useful context so discoverability does not " +
        "depend on repository archaeology.",
      against: (ctx): { source: string; excerpt: string } | undefined =>
        ctx.mapTree
          ? {
            source: `${ctx.mapDir}README.md and subtree README files`,
            excerpt: "follow the links as a first-time reader",
          }
          : undefined,
    },
  ],
};

/** Worktree workflow — isolated git worktrees and their per-worktree resources. */
const WORKTREES: Category = {
  name: "worktrees",
  title: "Worktree workflow",
  rules: [
    {
      kind: "subjective",
      id: "worktrees.resources",
      title: "External resources declared per-worktree",
      ask:
        "Does this project need per-worktree external resources to develop in isolation " +
        "— a database, an emulator, a container, a queue, a dev-server vhost? If so, are " +
        "they all declared under [worktree.resources.<name>] so each worktree gets its own?",
      teach: "Anything two concurrent worktrees would fight over belongs in " +
        "[worktree.resources.<name>] with a create/destroy pair, so discern " +
        "provisions and reclaims it per worktree. If the project needs none, this is a " +
        "clean pass — but verify nothing shared was missed.",
      against: (ctx): { source: string; excerpt: string } | undefined => {
        const names = Object.keys(ctx.config.worktree.resources);
        return {
          source: "[worktree.resources]",
          excerpt: names.length === 0
            ? "no resources declared yet"
            : `declared: ${names.join(", ")}`,
        };
      },
    },
  ],
};

/** Quality standards — never-loosen metric floors. */
const STANDARDS: Category = {
  name: "standards",
  title: "Quality standards",
  rules: [
    {
      kind: "deterministic",
      id: "standards.any",
      title: "At least one quality standard",
      weight: 2,
      fix:
        'discern config set-standard coverage --limit <n> --run "<command emitting the metric>"',
      teach:
        "A standard locks in a metric you only ever want to improve (coverage, bundle " +
        "size, an error count) so a branch can never loosen it. Even one — line coverage " +
        "is the usual first — turns a good number into a floor.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        Object.keys(ctx.config.standards).length > 0
          ? {
            status: "pass",
            detail: `${
              Object.keys(ctx.config.standards).length
            } standard(s) defined`,
          }
          : { status: "fail", detail: "no [standards.<name>] defined" },
    },
    {
      kind: "subjective",
      id: "standards.opportunity",
      title: "No unprotected metric worth holding",
      ask:
        "Is there a measurable quality signal in this project you only ever want to " +
        "improve — test coverage, bundle/binary size, type-error count, a performance " +
        "budget, lint-warning count — that is NOT yet protected by a standard?",
      teach: "Find the number you'd be unhappy to see regress, emit it as " +
        "`DISCERN_METRIC <name> <value>` from a command, and add a [standards.<name>] " +
        "with that floor/ceiling. Every `discern done` run then verifies the limit " +
        "against the trunk and measures the metric alongside the tests.",
      against: (ctx): { source: string; excerpt: string } | undefined => {
        const names = Object.keys(ctx.config.standards);
        return {
          source: "[standards]",
          excerpt: names.length === 0
            ? "no standards defined yet"
            : `protected by standards: ${names.join(", ")}`,
        };
      },
    },
    {
      kind: "subjective",
      id: "standards.normalize",
      title: "No raw count held over a growing tree",
      ask:
        "Do any ceiling standards count items over a tree that grows over time — lint " +
        "alerts, TODOs, type errors, doc nits? A raw count rises with the project, so it " +
        "fails on growth, not regressions, and the only way to pass is to loosen it. Hold " +
        "a rate instead: add `per` to divide by a built-in extent (files|lines|words|bytes).",
      teach:
        "A count is safe to hold only when it doesn't scale with project size (a true " +
        "budget, like shipped bytes). If it grows as you add code or docs, normalize it: " +
        '`per = { words = "${map.dir}**" }` holds docs alerts-per-word, so growth alone never ' +
        "breaches the ceiling — only a real quality regression does.",
      against: (ctx): { source: string; excerpt: string } | undefined => {
        const raw = Object.entries(ctx.config.standards)
          .filter(([, r]) => r.direction === "down" && r.per === undefined)
          .map(([name]) => name);
        return {
          source: "[standards]",
          excerpt: raw.length === 0
            ? "no un-normalized ceiling counts"
            : `raw ceiling counts (candidates for \`per\`): ${raw.join(", ")}`,
        };
      },
    },
  ],
};

/** Skills — reusable task playbooks. A single subjective opportunity prompt. */
const SKILLS: Category = {
  name: "skills",
  title: "Skills",
  rules: [
    {
      kind: "subjective",
      id: "skills.opportunity",
      title: "Recurring tasks captured as skills",
      ask:
        "Is there a multi-step task that recurs in this project and would benefit from a " +
        "written playbook an agent can follow each time — a release dance, a data reset, a " +
        "subsystem-specific workflow? Authored skills under the skills dir capture exactly that.",
      teach:
        "When you find yourself (or an agent) re-deriving the same procedure, capture it " +
        "as a skill: a directory with a SKILL.md under [skills].dir. It then becomes " +
        "discoverable to every agent. Eject a built-in to customise it.",
      against: (ctx): { source: string; excerpt: string } | undefined => ({
        source: resolveSkillsDir(ctx.root, ctx.config).rel,
        excerpt: ctx.authoredSkills === 0
          ? "no authored skills yet (built-ins still apply)"
          : `${ctx.authoredSkills} authored skill(s)`,
      }),
    },
    {
      kind: "subjective",
      id: "skills.executable",
      title: "Skills are executable, verifiable playbooks",
      ask:
        "Inspect the authored skills. Does each say when to use it, what context or " +
        "preconditions it needs, the concrete sequence to follow, how to verify success, " +
        "and how to recover or clean up when the workflow can fail? Could a fresh agent " +
        "execute it without inventing the missing half?",
      teach:
        "A good skill packages judgement, not just reminders. Give it a sharp trigger, " +
        "progressively disclose only the needed references, make effects and stop " +
        "conditions explicit, and end with observable proof that the task succeeded.",
      against: (ctx): { source: string; excerpt: string } | undefined => ({
        source: resolveSkillsDir(ctx.root, ctx.config).rel,
        excerpt: ctx.authoredSkills === 0
          ? "no authored skills to inspect yet"
          : `${ctx.authoredSkills} authored skill(s) to sample`,
      }),
    },
  ],
};

/** The full improvement catalog, in display order. The runner ranks the
 * categories weakest-first. */
export const CATEGORIES: readonly Category[] = [
  GATE,
  SETUP,
  GUIDANCE,
  MAP,
  WORKTREES,
  STANDARDS,
  SKILLS,
];

/** The improvement category slugs, in catalog order — the SSOT for every human/agent-
 * facing list of `--category` values. The CLI help and the MCP tool's `category`
 * description interpolate this, so they cannot drift from the catalog. */
export const CATEGORY_NAMES: readonly string[] = CATEGORIES.map((c) => c.name);

/** Type guards used by the runner to split a category's rules by kind. */
export function isDeterministic(
  rule: { kind: string },
): rule is DeterministicRule {
  return rule.kind === "deterministic";
}

/** Whether a rule is subjective (surfaced for the agent). */
export function isSubjective(rule: { kind: string }): rule is SubjectiveRule {
  return rule.kind === "subjective";
}
