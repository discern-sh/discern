/**
 * The improvement **catalog** — the project facts gathered once ({@link buildContext})
 * and the best-practice {@link CATEGORIES} evaluated against them.
 *
 * Each category groups related rules. Each rule is either deterministic (discern
 * decides it) or subjective (discern surfaces it for the agent to judge against the
 * cited material). A subjective rule is the improvement MEMBERSHIP of a canonical
 * criterion (`shared/criteria.ts`): the judgment prose and teach live in that one
 * vocabulary, and this catalog contributes the estate-review framing (title +
 * evidence). The catalog is data, not control flow: the runner in `improve.ts`
 * walks it. To add a best practice, add a rule here — a subjective one first adds
 * its criterion to the vocabulary.
 *
 * The bar for a deterministic rule: its verdict must be *certain* from the gathered
 * facts (no guessing). Anything that needs judgement is a subjective rule instead,
 * so improve never reports a confident pass/fail it can't actually stand behind.
 */

import { join } from "@std/path";
import { toCommandList } from "../../shared/config_schema.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import {
  isKnownJob,
  jobStage,
  type KnownJob,
} from "../../shared/capabilities.ts";
import {
  resolveInstructionSources,
  resolveSkillsDir,
} from "../../lib/paths.ts";
import { allInstructionFilePaths } from "../../lib/providers.ts";
import { normalizeMapDir } from "../../shared/map_path.ts";
import { SOURCE_PATHS } from "../../shared/paths_registry.ts";
import { criterionById } from "../../shared/criteria.ts";
import type {
  Category,
  DeterministicRule,
  ImprovementContext,
  ReviewEvidence,
  ReviewResult,
  SubjectiveRule,
} from "./types.ts";
import {
  improvementFindingData,
  inlineFindingRoutes,
} from "../logbook/surfaces.ts";
import {
  analyzeCheckpointObservations,
  type CheckpointVarianceSummary,
  frequentlyVariedCheckpoints,
} from "../logbook/checkpoint_economics.ts";
import { buildStreamFacts } from "../logbook/detectors.ts";
import { readLogbookStream } from "../logbook/read.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { estateReviews } from "./checkpoint_loop.ts";

// ── gathering the facts ─────────────────────────────────────────────────────

/** The setup skeleton seeds instructions.md with this phrase until the agent fills it;
 * its presence means the instructions are still a placeholder, not real prose. */
const INSTRUCTION_PLACEHOLDER_MARK = "setup fills this";

/** Substance threshold (non-whitespace chars) below which a instruction file reads as
 * a stub rather than real, project-specific instructions. */
const INSTRUCTION_SUBSTANCE_MIN = 400;

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
  /** Recursively count numbered ADR files, ignoring the template and treating an absent subtree as empty. */
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

/** Whether any agent file is present (the output of `discern refresh`).
 * Derived from the provider registry (every agent's `instructionFile.path`), so a new
 * agent's file counts without editing this probe. */
async function anyAgentFile(root: string): Promise<boolean> {
  for (const name of allInstructionFilePaths()) {
    if (await fileExists(join(root, name))) {
      return true;
    }
  }
  return false;
}

/**
 * Checkpoints clearing the shared frequently-varied bar, read from the full
 * local logbook stream — variances are rare, cross-effort evidence a bounded
 * recent tail would miss (the same full read the `checkpoints` verb's
 * observed-history section performs). Advisory by construction: a missing
 * repository, a disabled logbook, or any read trouble reads as no evidence.
 */
async function variedCheckpointEvidence(
  root: string,
  config: DiscernConfig,
): Promise<CheckpointVarianceSummary[]> {
  if (!config.project.logbook) {
    return [];
  }
  try {
    const commonGitDir = await resolveCommonGitDir(root);
    if (commonGitDir === undefined) {
      return [];
    }
    const stream = await readLogbookStream(commonGitDir);
    return frequentlyVariedCheckpoints(
      analyzeCheckpointObservations(
        buildStreamFacts(stream.events, config.repository.trunk),
      ),
    );
  } catch {
    return [];
  }
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
  const historicalFindings = config.meta.bootstrapped
    ? improvementFindingData(
      (await inlineFindingRoutes(root, config)).improvement,
    )
    : [];
  const variedCheckpoints = config.meta.bootstrapped
    ? await variedCheckpointEvidence(root, config)
    : [];
  const sources = await resolveInstructionSources(root, config);
  let instructionText = "";
  for (const src of sources) {
    try {
      instructionText += await Deno.readTextFile(src);
      instructionText += "\n";
    } catch {
      // a source that vanished between glob and read contributes nothing
    }
  }
  const instructionChars = instructionText.replace(/\s+/g, "").length;

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
    instructionPresent: sources.length > 0,
    instructionText,
    instructionChars,
    instructionPlaceholder: instructionText.includes(
      INSTRUCTION_PLACEHOLDER_MARK,
    ),
    gotchasDocSet: gotchasDoc !== "",
    gotchasDocExists: gotchasAbs !== "" && (await fileExists(gotchasAbs)),
    mapDir,
    mapTree: (await pathExists(join(root, mapDir))) &&
      (await fileExists(join(root, mapDir, "README.md"))),
    adrCount: await countAdrs(root, mapDir),
    agentFilePresent: await anyAgentFile(root),
    authoredSkills: await countAuthoredSkills(root, config),
    historicalFindings,
    variedCheckpoints,
  };
}

// ── small helpers the rules share ───────────────────────────────────────────

/** Whether a known job is wired (a non-empty command after no-op filtering). */
function knownJobWired(
  ctx: ImprovementContext,
  name: KnownJob,
): boolean {
  return toCommandList(ctx.config.jobs[name]).length > 0;
}

/** Whether any wired custom job runs in the given stage. */
function customJobInStage(ctx: ImprovementContext, stage: string): boolean {
  return Object.entries(ctx.config.jobs).some(
    ([name, job]) =>
      !isKnownJob(name) && typeof job === "object" && job !== null &&
      !Array.isArray(job) && "stage" in job && job.stage === stage &&
      toCommandList(job).length > 0,
  );
}

/** A short, single-line excerpt of `text` (collapsed whitespace), capped to `max`. */
function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/**
 * One subjective rule — the improvement MEMBERSHIP of a canonical criterion
 * (`shared/criteria.ts`). The criterion carries the judgment prose (`ask`) and
 * `teach`; the membership adds what estate-wide review needs: a display title
 * and the project evidence to judge `against`. A membership naming an unknown
 * criterion fails at module load, so the catalog can never ship a dangling
 * reference (the parity guard in `tests/criteria_registry_test.ts` reports the
 * same defect with its remedy).
 */
function subjective(
  id: string,
  membership: {
    title: string;
    against: (ctx: ImprovementContext) => ReviewEvidence | undefined;
  },
): SubjectiveRule {
  const criterion = criterionById(id);
  if (criterion === undefined) {
    throw new Error(
      `improvement rule '${id}' references no canonical criterion`,
    );
  }
  return {
    kind: "subjective",
    id,
    title: membership.title,
    ask: criterion.criterion,
    teach: criterion.teach,
    against: membership.against,
  };
}

/** The configured check/test commands whose output can become diagnostics. */
function diagnosticJobExcerpt(
  ctx: ImprovementContext,
): { source: string; excerpt: string } | undefined {
  const commands: string[] = [];
  for (const [name, job] of Object.entries(ctx.config.jobs)) {
    const stage = jobStage(name) ??
      (typeof job === "object" && job !== null && !Array.isArray(job) &&
          "stage" in job
        ? job.stage
        : undefined);
    if ((stage !== "check" && stage !== "test") || name === "smoke") {
      continue;
    }
    for (const command of toCommandList(job)) {
      commands.push(`${name}: ${command}`);
    }
  }
  return commands.length === 0 ? undefined : {
    source: "the configured check and test jobs",
    excerpt: excerpt(commands.join(" | "), 600),
  };
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
        'discern config set-job test "<your test command>" (e.g. "npm test")',
      teach:
        "A gate that runs no tests can't catch regressions — the single highest-" +
        "valuable job to wire. Add your suite as [jobs].test (or a custom test-stage " +
        "job) so `discern done` runs it before work is called done.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        knownJobWired(ctx, "test") || customJobInStage(ctx, "test")
          ? { status: "pass", detail: "a test-stage command is wired" }
          : {
            status: "fail",
            detail: "no test or custom test-stage job is configured",
          },
    },
    {
      kind: "deterministic",
      id: "gate.static-analysis",
      title: "Static analysis wired (lint or type-check)",
      weight: 2,
      fix:
        'discern config set-job lint "<linter>" and/or typecheck "<type checker>"',
      teach:
        "Static analysis catches a whole class of defects before tests run. Wire a " +
        "linter ([jobs].lint) and/or a type checker ([jobs].typecheck) " +
        "so the check stage has teeth.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        knownJobWired(ctx, "lint") || knownJobWired(ctx, "typecheck") ||
          customJobInStage(ctx, "check")
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
        'discern config set-job format "<formatter>" (e.g. "prettier --write .")',
      teach:
        "A formatter in the fix stage keeps diffs about substance, not whitespace, " +
        "and runs first so later stages see canonical code. Wire [jobs].format.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        knownJobWired(ctx, "format") || customJobInStage(ctx, "fix")
          ? { status: "pass", detail: "a fix-stage command is wired" }
          : { status: "fail", detail: "no formatter is configured" },
    },
    subjective("gate.fast-feedback", {
      title: "The gate stays fast enough to run every time",
      against: (ctx): ReviewEvidence | undefined => {
        const cmd = toCommandList(ctx.config.jobs.test).join(" && ");
        return cmd.trim().length > 0
          ? { source: "the configured test command", excerpt: cmd }
          : undefined;
      },
    }),
    subjective("gate.test-depth", {
      title: "Tests protect behaviour, boundaries, and failure paths",
      against: (ctx): ReviewEvidence | undefined => {
        const cmd = toCommandList(ctx.config.jobs.test).join(" && ");
        return cmd.trim().length > 0
          ? {
            source: "the test suite behind the configured command",
            excerpt: cmd,
          }
          : undefined;
      },
    }),
    subjective("gate.structured-diagnostics", {
      title: "Structured output reaches diagnostics",
      against: diagnosticJobExcerpt,
    }),
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
        "Setup seeds the docs skeleton and prompts the agent to author your instructions " +
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
    subjective("setup.failure-memory", {
      title: "The gotchas doc is an actionable failure playbook",
      against: (ctx): ReviewEvidence | undefined => {
        const doc = ctx.config.project.gotchas_doc.trim();
        return doc === "" ? undefined : {
          source: doc,
          excerpt: ctx.gotchasDocExists
            ? "configured failure-pointer document"
            : "configured path is currently missing",
        };
      },
    }),
  ],
};

/** Agent instructions — the author-once → compile-everywhere instruction pipeline. */
const INSTRUCTIONS: Category = {
  name: "instructions",
  title: "Agent instructions",
  rules: [
    {
      kind: "deterministic",
      id: "instructions.source",
      title: "Substantive instruction source",
      weight: 3,
      fix:
        "write project-specific prose into instructions.md, then `discern refresh`",
      teach:
        "Built-in instructions teaches discern; YOUR instructions teaches your project — " +
        "the conventions, boundaries, and gotchas an agent can't infer from the code. " +
        "A thin or missing instructions.md is a thin agent. Aim for real, specific prose.",
      evaluate: (
        ctx,
      ): { status: "pass" | "partial" | "fail"; detail: string } => {
        if (!ctx.instructionPresent || ctx.instructionChars === 0) {
          return {
            status: "fail",
            detail: "no [instructions].sources file resolves on disk",
          };
        }
        if (
          ctx.instructionPlaceholder ||
          ctx.instructionChars < INSTRUCTION_SUBSTANCE_MIN
        ) {
          return {
            status: "partial",
            detail: ctx.instructionPlaceholder
              ? "instructions still carries the bootstrap placeholder marker"
              : `instructions are thin (${ctx.instructionChars} non-whitespace chars)`,
          };
        }
        return {
          status: "pass",
          detail: `${ctx.instructionChars} chars of instructions prose`,
        };
      },
    },
    {
      kind: "deterministic",
      id: "instructions.compiled",
      title: "Agent files compiled",
      weight: 1,
      fix: "discern refresh",
      teach:
        "The per-provider agent files (one per configured agent) are compiled from the " +
        "built-in instructions plus your sources. If none exist, agents are flying blind. " +
        "Run `discern refresh` to (re)compile them.",
      evaluate: (ctx): { status: "pass" | "fail"; detail: string } =>
        ctx.agentFilePresent
          ? { status: "pass", detail: "an agent file is present" }
          : {
            status: "fail",
            detail: "no agent file found",
          },
    },
    subjective("instructions.project-specific", {
      title: "Instructions capture what the code can't say",
      against: (ctx): ReviewEvidence | undefined =>
        ctx.instructionChars === 0 ? undefined : {
          source: ctx.config.instructions.sources.join(", "),
          excerpt: excerpt(ctx.instructionText, 600),
        },
    }),
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
    subjective("map.current", {
      title: "The map still matches the code",
      against: (ctx): ReviewEvidence | undefined =>
        ctx.mapTree
          ? {
            source: ctx.mapDir,
            excerpt: "browse with `discern map --list`",
          }
          : undefined,
    }),
    subjective("map.navigation", {
      title: "The map is navigable from overview to detail",
      against: (ctx): ReviewEvidence | undefined =>
        ctx.mapTree
          ? {
            source: `${ctx.mapDir}README.md and subtree README files`,
            excerpt: "follow the links as a first-time reader",
          }
          : undefined,
    }),
  ],
};

/** Worktree workflow — isolated git worktrees and their per-worktree resources. */
const WORKTREES: Category = {
  name: "worktrees",
  title: "Worktree workflow",
  rules: [
    subjective("worktrees.resources", {
      title: "External resources declared per-worktree",
      against: (ctx): ReviewEvidence | undefined => {
        const names = Object.keys(ctx.config.worktree.resources);
        return {
          source: "[worktree.resources]",
          excerpt: names.length === 0
            ? "no resources declared yet"
            : `declared: ${names.join(", ")}`,
        };
      },
    }),
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
    subjective("standards.opportunity", {
      title: "No unprotected metric worth holding",
      against: (ctx): ReviewEvidence | undefined => {
        const names = Object.keys(ctx.config.standards);
        return {
          source: "[standards]",
          excerpt: names.length === 0
            ? "no standards defined yet"
            : `protected by standards: ${names.join(", ")}`,
        };
      },
    }),
    subjective("standards.normalize", {
      title: "No raw count held over a growing tree",
      against: (ctx): ReviewEvidence | undefined => {
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
    }),
  ],
};

/** The criterion ids the catalog's subjective rules already review — the
 * improvement membership's id set, derived at call time so a new subjective
 * rule auto-enrols. The estate audit skips these: their catalog review
 * carries the boundary mark instead, so each criterion renders once. */
function improvementCriterionIds(): ReadonlySet<string> {
  return new Set(
    CATEGORIES.flatMap((category) =>
      category.rules.filter(isSubjective).map((rule) => rule.id)
    ),
  );
}

/** Boundary checkpoints — the flow guard beside this estate audit. The static
 * review teaches placement (the ladder and the conversion rule); the dynamic
 * rows are the configured checkpoints' criteria, audited estate-wide. */
const CHECKPOINTS: Category = {
  name: "checkpoints",
  title: "Boundary checkpoints",
  rules: [
    subjective("checkpoints.opportunity", {
      title: "Rules sit on the right rung of the placement ladder",
      against: (ctx): ReviewEvidence | undefined => {
        const ids = Object.keys(ctx.config.checkpoints);
        return {
          source: "[checkpoints]",
          excerpt: ids.length === 0
            ? "no checkpoints configured yet"
            : `configured: ${ids.join(", ")}`,
        };
      },
    }),
  ],
  dynamicReviews: (ctx): ReviewResult[] =>
    estateReviews(ctx.config, improvementCriterionIds()),
};

/** Skills — reusable task playbooks. A single subjective opportunity prompt. */
const SKILLS: Category = {
  name: "skills",
  title: "Skills",
  rules: [
    subjective("skills.opportunity", {
      title: "Recurring tasks captured as skills",
      against: (ctx): ReviewEvidence | undefined => ({
        source: resolveSkillsDir(ctx.root, ctx.config).rel,
        excerpt: ctx.authoredSkills === 0
          ? "no authored skills yet (built-ins still apply)"
          : `${ctx.authoredSkills} authored skill(s)`,
      }),
    }),
    subjective("skills.executable", {
      title: "Skills are executable, verifiable playbooks",
      against: (ctx): ReviewEvidence | undefined => ({
        source: resolveSkillsDir(ctx.root, ctx.config).rel,
        excerpt: ctx.authoredSkills === 0
          ? "no authored skills to inspect yet"
          : `${ctx.authoredSkills} authored skill(s) to sample`,
      }),
    }),
  ],
};

/** The full improvement catalog, in display order. The runner ranks the
 * categories weakest-first. */
export const CATEGORIES: readonly Category[] = [
  GATE,
  SETUP,
  INSTRUCTIONS,
  MAP,
  WORKTREES,
  STANDARDS,
  CHECKPOINTS,
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
