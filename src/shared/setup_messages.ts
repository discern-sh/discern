/**
 * Setup's **ready-to-relay human messages** — the pre-composed, first-person "message
 * to your human" blocks discern serves at each human touchpoint of the staged
 * handshake, so a courier agent that only relays discern's words still delivers a
 * complete, warm, accurate first experience.
 *
 * The genre is deliberate (ADR 0086): discern ships the *script* — the message itself —
 * and asks the agent only to relay it, rather than *stage directions* (instructions
 * ABOUT the message, like "open warmly and explain what discern is"). A terse agent
 * compresses stage directions into a checklist while following every command faithfully;
 * composing warmth from instructions is the transformation that degrades under
 * final-answer compression, so the message is authored here, not delegated. The relay
 * licence is adaptive, not verbatim-or-else: reword into your own voice, but keep every
 * point — with one carve-out, that quoted text is relayed word for word (cold runs
 * show the licence otherwise licenses trimming the model question's second sentence).
 * Structure is load-bearing too: courier agents keep opening sentences and short list
 * items and prune inter-list prose and middle bullets, so every must-survive fact gets
 * its own list item (or the headline), one thought apiece.
 *
 * Each builder returns ONE plain prose string carried verbatim in every result
 * representation (including the structured `instructions` field and the
 * `awaiting_consent` refusal). It is
 * never decomposed into structured fields — ADR 0078's two-lane finding is that
 * field-ized behavioral instructions get summarized and weakened; only prose is
 * followed. The novice-calibrated vocabulary ("isolated working copies (git
 * worktrees)", "quality checks — your formatter, linter, and tests") lives ONLY inside
 * these relay blocks; agent-facing text keeps discern's precise terms.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import type { SetupAssurance } from "./setup_assurance.ts";
import type { SetupCompletionInventory } from "./setup_inventory.ts";
import { SOURCE_PATHS } from "./paths_registry.ts";
import { type DiscernConfig, parseConfigOrThrow } from "./config_schema.ts";
import type { ProviderTrustData } from "./provider_trust.ts";
import { runGit } from "./subprocess.ts";
import { lstatIfExists, pathExists, readTextIfExists } from "./fs_presence.ts";
import {
  DEFAULT_WORKTREE_ROOT_SUFFIX,
  SETUP_BRANCH,
} from "./git_conventions.ts";
import { type CommandRef, discernCommand, flag } from "./command_reference.ts";
import {
  assertSetupHumanSurfaceConsumption,
  renderSetupOwnerMoment,
  SETUP_REVERSIBILITY,
  type SetupHumanDecisionMoment,
  type SetupHumanMoment,
  setupHumanMomentsForSurface,
  type SetupHumanSurface,
} from "./setup_experience.ts";
import {
  recommendSetupProjectName,
  type SetupProjectNameEvidence,
  type SetupProjectNameRecommendation,
} from "./setup_guidance.ts";

/** The conventional home of a project's own documentation, probed so the consent
 * message can reassure that discern never touches it — the map is a separate,
 * agent-maintained artifact with its own home (ADR 0100, ADR 0131). */
const HUMAN_DOCS_REL = "docs/";

/** The agent set the consent conversation puts to the human: which coding tools
 * `begin` will wire, each as its display label plus the registry name `--agents`
 * accepts, and whether the set was detected as installed or fell back to the
 * defaults. Declared here — the bottom layer — and produced by the feature
 * layer's installation detection (`src/lib/detect_agents.ts`), mirroring how
 * {@link CompletionLanding} keeps this module from importing upward. */
export type ConsentAgentEvidence =
  | "no-evidence"
  | "detected-on-this-machine"
  | "explicit-repository-selection"
  | "committed-repository-selection";

/** One registry projection setup may relay without recreating vendor facts. */
export interface ConsentProviderFacts {
  readonly label: string;
  readonly name: string;
  readonly instructionFile: string;
  readonly writtenFiles: readonly string[];
  readonly generatedSkillsDir?: string | undefined;
  readonly trust: ProviderTrustData;
  readonly disclosures: readonly string[];
}

export interface ConsentAgentSet {
  /** The set `begin` will wire, in registry order. */
  wired: ReadonlyArray<ConsentProviderFacts>;
  /** Why this exact set is being proposed. Detection is installation evidence only. */
  evidence: ConsentAgentEvidence;
}

/** The repo facts a consent message is grounded in — the exact sibling worktree
 * path that will be created (ADR 0052), whether the project has a `docs/` folder of
 * its own (so the message reassures it stays untouched — the map is discern's own
 * separate tree, never pointed at human docs; ADR 0100, ADR 0131), whether
 * the directory is a git work tree at all (so no surface promises the isolated
 * `discern-setup` branch, the undo story, or worktrees where git can't deliver
 * them — the non-git plan is `git init` first), and the agent set `begin` will
 * wire (a consent point of its own, with `--agents` as the mechanism). */
export interface ConsentContext {
  worktreePath: string;
  worktreeEnvFiles: readonly string[];
  inheritedEnvNames: readonly string[];
  docsExists: boolean;
  gitRepo: boolean;
  agents: ConsentAgentSet;
  projectName?: SetupProjectNameRecommendation | undefined;
}

/**
 * Derive a project's {@link ConsentContext} from its setup directory — the single home
 * for this computation, shared by `verify` (which previews it) and `begin` (which
 * re-serves it in the `awaiting_consent` refusal), so the two can never drift. The
 * worktree location is the default sibling discern computes on a fresh install:
 * `<repo>.worktrees` beside the checkout (no config exists yet to relocate it).
 * The agent set arrives from the caller (installation detection lives in the
 * feature layer, which this bottom module never imports).
 */
export async function deriveConsentContext(
  destDir: string,
  agents: ConsentAgentSet,
  config: DiscernConfig = parseConfigOrThrow(""),
): Promise<ConsentContext & { projectName: SetupProjectNameRecommendation }> {
  const docsExists = await pathExists(join(destDir, HUMAN_DOCS_REL));
  const configuredRoot = config.worktree.root.trim();
  const worktreePath = configuredRoot === ""
    ? join(
      dirname(destDir),
      `${basename(destDir)}${DEFAULT_WORKTREE_ROOT_SUFFIX}`,
    )
    : isAbsolute(configuredRoot)
    ? resolve(configuredRoot)
    : resolve(destDir, configuredRoot);
  const gitRepo =
    (await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: destDir }))
      .success;
  const projectName = await deriveProjectNameRecommendation(destDir);
  return {
    worktreePath,
    worktreeEnvFiles: [...config.worktree.env_files],
    inheritedEnvNames: [...config.worktree.inherit_env],
    docsExists,
    gitRepo,
    agents,
    projectName,
  };
}

/** Gather bounded project-owned identity evidence without following external links. */
async function deriveProjectNameRecommendation(
  destDir: string,
): Promise<SetupProjectNameRecommendation> {
  const candidates: SetupProjectNameEvidence[] = [];
  for (const readme of ["README.md", "README", "readme.md"]) {
    const text = await readProjectMetadataFile(destDir, readme);
    const title = text?.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
    if (title !== undefined && title !== "") {
      candidates.push({
        source: "readme-title",
        value: title,
        location: readme,
      });
      break;
    }
  }
  for (const metadataFile of ["package.json", "deno.json"]) {
    const text = await readProjectMetadataFile(destDir, metadataFile);
    if (text === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ) {
        const name = (parsed as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim() !== "") {
          candidates.push({
            source: metadataFile === "package.json"
              ? "package-name"
              : "project-metadata",
            value: name,
            location: metadataFile,
          });
        }
      }
    } catch {
      // discern-best-effort: setup-project-metadata-decode-fallback
      // Invalid project metadata is reported by its own toolchain; it is not identity evidence.
    }
  }
  candidates.push({
    source: "directory-fallback",
    value: basename(destDir),
    location: ".",
  });
  return recommendSetupProjectName(candidates);
}

/** Read one in-project metadata file without following a symlink outside it. */
async function readProjectMetadataFile(
  destDir: string,
  relativePath: string,
): Promise<string | undefined> {
  const path = join(destDir, relativePath);
  const stat = await lstatIfExists(path);
  if (stat === undefined || !stat.isFile || stat.isSymlink) return undefined;
  return await readTextIfExists(path);
}

/**
 * The exact `begin` command a fresh, non-declarative setup runs AFTER the consent
 * conversation — always carrying `--confirmed` (the attestation). The single source
 * for this string, shared by {@link consentMessage}, `verify`'s `next_action`, and
 * `begin`'s `awaiting_consent` refusal, so the three never drift. It never carries
 * a `--map` flag: the map's home is a default, and a placeholder here would push
 * agents to pass one.
 */
const CONFIRMED_BEGIN_WORDS = "setup begin";
const CONFIRMED_BEGIN_MODEL_FLAG = "model";
const CONFIRMED_BEGIN_MODEL = "unreported";
const CONFIRMED_BEGIN_ATTESTATION_FLAG = "confirmed";

/** Render the consent-attested continuation as a plain shell command. */
export function confirmedBeginCommand(projectName?: string): string {
  const name = projectName === undefined
    ? ""
    : ` --name ${shellQuote(projectName)}`;
  return `discern ${CONFIRMED_BEGIN_WORDS}${name} --${CONFIRMED_BEGIN_MODEL_FLAG} ${CONFIRMED_BEGIN_MODEL} --${CONFIRMED_BEGIN_ATTESTATION_FLAG}`;
}

/** The same continuation as a surface-aware reference for result hints. */
export function confirmedBeginCommandReference(
  projectName?: string,
): CommandRef {
  return discernCommand(
    CONFIRMED_BEGIN_WORDS,
    ...(projectName === undefined ? [] : [flag("name", projectName)]),
    flag(CONFIRMED_BEGIN_MODEL_FLAG, CONFIRMED_BEGIN_MODEL),
    flag(CONFIRMED_BEGIN_ATTESTATION_FLAG),
  );
}

/** Quote one confirmed project-name value for the displayed shell command. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * The opening phrase of the human OFF-RAMP — the one-line handoff an
 * agent-addressed setup surface prints for a human who ran it by hand. The
 * audience guard (`tests/engine_setup_handoff_test.ts`) matches this phrase on
 * every surface `SETUP_HUMAN_AUDIENCES` classifies, so keep renders on
 * {@link humanOffRampLines} rather than re-wording it locally.
 */
export const OFF_RAMP_PROMPT = "Reading this as a human?";

/**
 * The off-ramp parenthetical, pre-wrapped so every surface prints identical
 * lines (a banner may indent them). `discern setup` is the right paste at any
 * phase: the welcome routes fresh installs to the funnel and abandoned ones to
 * the resume, so the line never goes stale mid-setup.
 */
export function humanOffRampLines(): readonly string[] {
  return [
    `(${OFF_RAMP_PROMPT} Paste "Run \`discern setup\`" into your`,
    "coding agent — it takes it from here. Everything below is addressed",
    "to that agent.)",
  ];
}

/** A labelled rule that fences the relayable message off from the agent-facing framing
 * and command around it, so a courier agent can see exactly what to paste. */
function fence(label: string): string {
  const dashes = "─".repeat(Math.max(4, 68 - label.length));
  return `─── ${label} ${dashes}`;
}

/**
 * The pre-`begin` consent block `verify` serves and a flag-less fresh `begin` re-serves.
 * ONE prose string: (a) a framing line to the agent carrying the adaptive relay licence;
 * (b) the message itself — first-person agent voice, kept short enough to survive a
 * single read — the itemized outcome and footprint (with a reassurance bullet when the project
 * has its own `docs/`: it stays untouched, the map lives separately — ADR 0131), the
 * roadmap with an honest time-and-tokens expectation and the safety frame, then the
 * numbered confirmations (the model question verbatim, the git-init consent when the
 * directory has no git (`gitRepo` false), the exact worktree location,
 * ready-to-begin); (c) the exact next command including `--confirmed`. The command
 * rides OUTSIDE the fenced message — it is the agent's to run, not the human's to
 * read. Every promise is conditioned on the git state: without git there is no
 * `discern-setup` branch or main-branch story to promise, so the plan leads with
 * `git init` and the next action is to initialize git and re-run the preflight.
 */
/** One item inside the verbatim-protected consent relay. */
export interface ConsentRelayItem {
  readonly key: string;
  readonly message: string;
}

/** Preserve registry order while collapsing shared provider paths. */
function uniqueStrings(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique;
}

/** Render an exact path/name set without hiding an intentionally empty choice. */
function inlineSet(values: readonly string[]): string {
  return values.length === 0
    ? "none"
    : values.map((value) => `\`${value}\``).join(", ");
}

/** Resolve one required human moment from a lifecycle surface. */
function humanMoment(
  surface: SetupHumanSurface,
  id: string,
): SetupHumanMoment {
  const moment = setupHumanMomentsForSurface(surface).find((candidate) =>
    candidate.id === id
  );
  if (moment === undefined) {
    throw new Error(`Missing setup human moment ${id} on ${surface}`);
  }
  return moment;
}

/** Resolve one required owner decision from a lifecycle surface. */
function humanDecision(
  surface: SetupHumanSurface,
  id: string,
): SetupHumanDecisionMoment {
  const moment = humanMoment(surface, id);
  if (moment.kind !== "decision") {
    throw new Error(`Setup human moment is not a decision: ${id}`);
  }
  return moment;
}

const MODEL_SELECTION = humanDecision("consent", "model-selection");
const PROJECT_NAME_CONFIRMATION = humanDecision(
  "consent",
  "project-name-confirmation",
);
const COMPLETION_HANDOFF = humanMoment("setup-done", "completion-handoff");
const LANDING_CHOICE = humanDecision("setup-done", "landing-choice");
const ACTIVATION_HANDOFF = humanMoment("activation", "activation-handoff");
assertSetupHumanSurfaceConsumption("consent", [
  MODEL_SELECTION.id,
  PROJECT_NAME_CONFIRMATION.id,
]);
assertSetupHumanSurfaceConsumption("setup-done", [
  COMPLETION_HANDOFF.id,
  LANDING_CHOICE.id,
]);
assertSetupHumanSurfaceConsumption("activation", [ACTIVATION_HANDOFF.id]);

/** The load-bearing consent facts, each in its own list item. */
export function consentRelayItems(
  ctx: ConsentContext,
): readonly ConsentRelayItem[] {
  const instructionFiles = uniqueStrings(
    ctx.agents.wired.map((agent) => agent.instructionFile),
  );
  const skillsDirs = uniqueStrings(
    ctx.agents.wired.flatMap((agent) =>
      agent.generatedSkillsDir === undefined ? [] : [agent.generatedSkillsDir]
    ),
  );
  const integrationFiles = uniqueStrings(
    ctx.agents.wired.flatMap((agent) =>
      agent.writtenFiles.filter((path) =>
        path !== agent.instructionFile && path !== agent.generatedSkillsDir
      )
    ),
  );
  const plan = ctx.gitRepo
    ? "Plan: I will study the repository, preserve its workflows, prove its final quality check and separate task workspaces, write the maintained project guide and agent instructions, then bring the finished branch back for your landing decision."
    : "Plan: after approval, I will initialize Git and repeat this read-only preflight. Then I will study the repository, preserve its workflows, prove its checks and separate task workspaces, write the maintained project guide and agent instructions, and bring the finished branch back for your landing decision.";
  const reversibility = ctx.gitRepo
    ? `Reversibility: ${SETUP_REVERSIBILITY.beforeLanding} ${SETUP_REVERSIBILITY.uninstall} No API key or outside service is involved.`
    : `Reversibility: After Git exists, ${
      SETUP_REVERSIBILITY.beforeLanding.replace(
        "Before landing",
        "before landing",
      )
    } ${SETUP_REVERSIBILITY.uninstall} No API key or outside service is involved.`;
  return [
    {
      key: "lasting-outcome",
      message:
        "Lasting outcome: future sessions inherit the project's final quality check (Gate), separate task workspaces, maintained project guide, and shared agent instructions.",
    },
    {
      key: "footprint",
      message:
        `Footprint: discern writes the root \`discern.toml\`; the authored map at \`${SOURCE_PATHS.map.defaultPath}\`, instructions at \`${SOURCE_PATHS.instructions.defaultPath}\`, and TODO ledger at \`${SOURCE_PATHS.todo.defaultPath}\`; managed blocks in \`.gitignore\` and \`.gitattributes\`; agent files ${
          inlineSet(instructionFiles)
        }; and selected-provider integration files ${
          inlineSet(integrationFiles)
        }. Generated, Git-ignored provider skill directories are ${
          inlineSet(skillsDirs)
        }.`,
    },
    {
      key: "repository-boundary",
      message:
        "Repository boundary: one Git repository has one root `discern.toml` and one discern installation. A monorepo uses that root install with scopes and custom jobs; an independent nested Git repository is a separate project and may have its own install.",
    },
    ...ctx.agents.wired.flatMap((agent) =>
      agent.disclosures.map((disclosure, index) => ({
        key: `provider-${agent.name}-${index + 1}`,
        message: `${agent.label}: ${disclosure}`,
      }))
    ),
    ...(ctx.docsExists
      ? [{
        key: "existing-docs",
        message:
          "Existing documentation: this project already has `docs/`; it remains owner material and discern does not adopt or overwrite it. The map is a separate tree.",
      }]
      : []),
    { key: "plan", message: plan },
    { key: "reversibility", message: reversibility },
  ];
}

/** Numbered consent questions. The relay frame requires these word for word. */
export function consentConfirmations(
  ctx: ConsentContext,
): readonly ConsentRelayItem[] {
  const agentLabels = ctx.agents.wired.length === 0
    ? "no coding tools"
    : ctx.agents.wired.map((agent) => agent.label).join(", ");
  const projectName = ctx.projectName ?? recommendSetupProjectName([{
    source: "directory-fallback",
    value: "this project",
    location: ".",
  }]);
  const nameEvidence = projectName.evidence.map((item) =>
    `\`${item.location}\` (${item.source})`
  ).join(", ");
  const projectNameOwnerMessage = renderSetupOwnerMoment(
    PROJECT_NAME_CONFIRMATION,
    "novice",
  )?.message;
  if (projectNameOwnerMessage === undefined) {
    throw new Error("Project-name confirmation must always be applicable.");
  }
  return [
    {
      key: "model",
      message: MODEL_SELECTION.relay.message,
    },
    {
      key: "project-name",
      message: projectNameOwnerMessage.replace(
        "<name>",
        `“${projectName.proposed}”`,
      ).replace("<evidence>", nameEvidence),
    },
    ...(ctx.gitRepo ? [] : [{
      key: "git-init",
      message:
        "This folder is not under version control, and the isolated branch and undo path require it. May I run `git init` here, then repeat the preflight before setup begins?",
    }]),
    {
      key: "agents",
      message: (() => {
        switch (ctx.agents.evidence) {
          case "detected-on-this-machine":
            return `I found ${agentLabels} installed on this machine. That evidence says what is installed, not which tool or model is running this setup. I recommend committing that detected set for this repository. Keep it, or name a different set; this decides which coding tools receive discern integration files.`;
          case "no-evidence":
            return `I found no installed coding-tool evidence, so the proposed default set is ${agentLabels}. Keep it, name the tools you use, or choose none; this decides which tools receive discern integration files.`;
          case "explicit-repository-selection":
            return `This setup request explicitly selected ${agentLabels} for the repository. That explicit choice wins over machine detection and will be committed if you continue. Keep it, or name a different set.`;
          case "committed-repository-selection":
            return `This repository already commits ${agentLabels} in \`[project].agents\`. That repository selection, including an explicit empty list, wins over machine detection. Keep it, or name a different set.`;
        }
      })(),
    },
    {
      key: "worktree-path",
      message:
        `Isolated working copies resolve to ${ctx.worktreePath}. Their environment-file order is ${
          inlineSet(ctx.worktreeEnvFiles)
        }; inherited variable names are ${
          inlineSet(ctx.inheritedEnvNames)
        }. Keep these resolved defaults, or provide another worktree root or environment policy.`,
    },
    {
      key: "cost",
      message:
        "Setup usually takes 20–40 minutes and a meaningful number of tokens to study the repository, prove commands, and write inherited project context. Continue with that investment, or defer without changing the project?",
    },
    {
      key: "ready",
      message:
        "Ready for me to begin the isolated setup branch and write the stated footprint? This authorizes setup authoring there; it does not authorize landing or a later cost- or data-bearing resource.",
    },
  ];
}

/** Render the complete itemized consent relay and its attested continuation. */
export function consentMessage(ctx: ConsentContext): string {
  const projectName = ctx.projectName?.proposed ?? "this project";
  const command = confirmedBeginCommand(projectName);
  const relayItems = consentRelayItems(ctx);
  const confirmations = consentConfirmations(ctx);
  return [
    `Relay the fenced message below as one natural conversation. Keep each fact and numbered decision complete, and preserve quoted owner actions exactly because they form the consent record. Immediately afterwards, follow this authority: ${MODEL_SELECTION.authority} Use the exact identifier when known or \`unreported\`; never copy the placeholder. Then wait for the answers.`,
    "",
    fence("message to your human"),
    "",
    "I propose a one-time discern setup for this project. Here is what it will change for later work:",
    "",
    ...relayItems.map((item) => `- ${item.message}`),
    "",
    "I need your answer on these points before anything is written:",
    "",
    ...confirmations.map((item, index) => `${index + 1}. ${item.message}`),
    "",
    fence("end of message"),
    "",
    "If the owner chooses a different model, stop in this session. Do not run `begin`. The owner uses the coding tool's model selector, opens a fresh session in this project, and pastes `Run discern setup`; the fresh session starts again at the welcome and preflight.",
    "",
    ctx.gitRepo
      ? "Only if the owner chooses to continue in this session and every other answer is settled, run the command below. Replace `unreported` with the exact self-declared provider/model identifier when known; otherwise keep `unreported`. Provenance is advisory and does not verify capability:"
      : "Only if the owner chooses to continue in this session and every other answer is settled, initialize git, re-run `discern setup verify`, and then run the command below. Replace `unreported` with the exact self-declared provider/model identifier when known; otherwise keep `unreported`. Provenance is advisory and does not verify capability:",
    "",
    `    ${command}`,
    "",
    `If the owner corrected the project name, replace the value of \`--name\` with that confirmed answer. It is the single name authority for every later setup step. If the owner changed the coding-tool set, pass the exact set to wire: \`--agents ${
      ctx.agents.wired.length === 0
        ? "''"
        : ctx.agents.wired.map((agent) => agent.name).join(",")
    }\` (edit that list).`,
  ].join("\n");
}

/** The minimal landing shape {@link completionMessage} reads — structurally satisfied
 * by `setup_accept.ts`'s `LandingSummary`, declared here so this bottom-layer module never
 * imports up into `commands`. */
export interface CompletionLanding {
  inRepo: boolean;
  branch: string;
  target: string;
  onTarget: boolean;
  /** True only on the dedicated `discern-setup` branch — the ONE branch
   * `discern setup accept` lands; any other branch is steered to a manual merge. */
  onSetupBranch: boolean;
}

/** The minimal reactivation shape — structurally satisfied by `reactivationHandoff()`'s
 * return (`src/lib/providers.ts`), declared here for the same layering reason. */
export interface CompletionReactivation {
  summary: string;
  per_agent: ReadonlyArray<{
    label: string;
    step: string;
    check: string;
    recovery: string;
    cli_fallback: string;
  }>;
}

/** The pieces `setup done` has already computed, from which the closing relay block is
 * composed — never recomputed here (single source of truth). */
export interface CompletionContext {
  assurance: SetupAssurance;
  inventory: SetupCompletionInventory;
  landing: CompletionLanding;
  reactivation?: CompletionReactivation | undefined;
  proofLine?: string | undefined;
  unproven: boolean;
}

/** Plain-word coverage line for the completion message: what runs and which
 * declared lifecycles do not apply. */
function coverageLine(a: SetupAssurance): string {
  const notApplicable = a.known_jobs.filter((job) =>
    job.not_applicable === true
  ).map((job) => `\`${job.name}\``);
  const applicability = notApplicable.length === 0
    ? ""
    : notApplicable.length === 1
    ? ` ${notApplicable[0]} does not apply.`
    : ` ${notApplicable.slice(0, -1).join(", ")}, and ${
      notApplicable.at(-1)
    } do not apply.`;
  switch (a.verdict) {
    case "full":
      return a.total === 0
        ? `No known quality protections apply to this project.${applicability}`
        : `Quality checks: ${a.enforced} of ${a.total} applicable protections are wired and running.${applicability}`;
    case "minimal":
      return `No quality checks are wired yet, so nothing is caught automatically. Wiring your tests is the highest-value thing to add next.${applicability}`;
    case "partial": {
      const notRunning = a.known_jobs
        .filter((c) => c.state !== "enforced" && c.not_applicable !== true)
        .map((c) => c.name);
      const tail = notRunning.length > 0
        ? ` Not running yet: ${notRunning.join(", ")}.`
        : "";
      return `Quality checks: ${a.enforced} of ${a.total} applicable protections are wired and running.${tail}${applicability}`;
    }
  }
}

/** Plain-word landing recommendation for the completion message, adapted to where the
 * finished work actually lives (mirrors the cases `setup_accept.ts` distinguishes). */
function landingLine(l: CompletionLanding): string {
  if (!l.inRepo) {
    return "This project isn't a git repository, so there's nothing to land — your setup is in place as it is.";
  }
  if (l.onTarget) {
    return `Your setup already lives on \`${l.target}\`, so there's nothing to land.`;
  }
  if (l.branch === "") {
    return `Your setup is on the \`${SETUP_BRANCH}\` branch, not yet on \`${l.target}\`. Proof verifies the branch and does not authorize landing. Check out \`${SETUP_BRANCH}\`, then choose to land it with \`discern setup accept\`, leave it for review, or decline it. I will wait; do not restart or activate before that choice.`;
  }
  if (!l.onSetupBranch) {
    // `setup accept` lands only the dedicated setup branch — recommending it for
    // the user's own branch would sweep that branch's commits onto the trunk.
    return `Your setup is on the \`${l.branch}\` branch, not yet on \`${l.target}\`. Proof verifies the branch and does not authorize landing. I recommend merging it through the project's usual Git workflow when the qualitative handoff matches the project. Choose to merge now, leave the branch for review, or decline it. I will wait; do not restart or activate before that choice.`;
  }
  return `${
    LANDING_CHOICE.relay.message.replace("<branch>", `\`${l.branch}\``).replace(
      "<trunk>",
      `\`${l.target}\``,
    )
  } To land now, run \`discern setup accept\`.`;
}

/**
 * The closing relay block `setup done` serves — ONE prose string mirroring
 * {@link consentMessage}'s shape: a framing line with the relay licence, then the
 * first-person message covering what the project now has (honest coverage), the
 * contained footprint (the root `discern.toml` plus the `discern/` folder — the
 * namespace story the consent message opened with, closed honestly), the
 * qualitative project context, mechanical inventory, and the next valid
 * phase, then closes with the exact Proof line. An unlanded result stops at the
 * landing choice; an integrated result sequences fresh-session activation before
 * optional improvement. Composed from the already-computed
 * {@link CompletionContext} pieces — never recomputed.
 */
export function completionMessage(ctx: CompletionContext): string {
  const { assurance, inventory, landing, reactivation, proofLine, unproven } =
    ctx;
  const readyForActivation = !landing.inRepo || landing.onTarget;
  const headline = unproven
    ? "discern setup was recorded without a gate Proof. Review the unproved setup before treating it as ready."
    : readyForActivation
    ? `discern setup is proved and available on \`${landing.target}\`.`
    : `discern setup is proved on \`${
      landing.branch || SETUP_BRANCH
    }\`, but \`${landing.target}\` does not contain it yet.`;
  const primary = inventory.project_context.primary_subsystem;
  const qualitativeLines = primary === null
    ? [
      "  • The starting area for future agents is unavailable. The maintained project guide is missing its concrete start, responsibility, or important-rule account; do not invent one.",
    ]
    : [
      `  • Later agents start in ${primary.title}: ${primary.start_here} The maintained project guide (Map) records it at \`${primary.page}\`.`,
      `  • That area's responsibility: ${primary.boundary}`,
      `  • One important rule setup found: ${primary.non_obvious_invariant}`,
    ];
  const inventoryLines = [
    ...qualitativeLines,
    `  • Decision rules future work inherits (${inventory.project_context.principles.count}): ${
      inlineInventory(inventory.project_context.principles.items)
    }.`,
    `  • Future sessions load their project instructions from: ${
      inlineInventory(inventory.project_context.instruction_sources)
    }.`,
    `  • Other maintained project-guide areas (${inventory.map_regions.count} total): ${
      inlineInventory(inventory.map_regions.items)
    }.`,
    `  • Still open (${inventory.ledger_items.count}): ${
      inlineInventory(inventory.ledger_items.items)
    }.`,
    `  • Checks active: ${
      inlineInventory(inventory.jobs.enforced)
    }; deferred housekeeping: ${
      inlineInventory(inventory.jobs.deferred)
    }; expected but absent: ${
      inlineInventory(inventory.jobs.absent)
    }; do not apply: ${inlineInventory(inventory.jobs.not_applicable)}.`,
  ];
  const activationLines = readyForActivation && reactivation !== undefined
    ? [
      `  • ${ACTIVATION_HANDOFF.why}`,
      ...(reactivation.per_agent.length === 0
        ? ["  • No configured provider needs a fresh-session activation step."]
        : reactivation.per_agent.map((agent) =>
          `  • For ${agent.label}: ${agent.step}`
        )),
      "  • Only after every applicable activation check succeeds, optionally run `discern improvement --json` for an owner review of ongoing work.",
    ]
    : [];
  return [
    "Relay the message below to your human — adapt the wording to your own voice if you like, but keep every point.",
    "",
    fence("message to your human"),
    "",
    headline,
    "",
    `  • ${coverageLine(assurance)}`,
    ...inventoryLines,
    `  • The installed footprint is \`discern.toml\`, the \`discern/\` folder, and the selected coding tools' integration files. ${SETUP_REVERSIBILITY.uninstall}`,
    `  • ${
      unproven
        ? "This unproven completion cannot use setup acceptance. Resolve the incomplete or red setup, commit the correction, then run `discern setup done` to replace it with a proven completion before landing or activation."
        : landingLine(landing)
    }`,
    ...activationLines,
    ...(proofLine === undefined ? [] : ["", proofLine]),
    "",
    fence("end of message"),
  ].join("\n");
}

/** Render one inventory list without asking the courier agent to recount it. */
function inlineInventory(items: readonly string[]): string {
  return items.length === 0
    ? "none"
    : items.map((item) => `\`${item}\``).join(", ");
}
