/**
 * Derived universe, internal contract registry, and lexical check for discern's
 * operational agent copy.
 *
 * Membership comes from the same Skill and setup resolvers the product uses.
 * The registry supplies only classification and evidence bindings; it never
 * renders into an agent surface. Agent-facing Markdown remains the authority
 * for the instructions a coding agent follows.
 */

import { walk } from "@std/fs";
import { basename, dirname, join, relative, resolve } from "@std/path";
import type { DiscernConfig } from "../src/shared/config_schema.ts";
import {
  resolveEffectiveSkills,
  type SkillEntry,
  type SkillSource,
} from "../src/lib/skills.ts";
import { resolveSetupDir } from "../src/lib/paths.ts";
import {
  type AgentContractDocument,
  agentContractEvidenceIssues,
  type AgentContractIssue,
  agentContractStructureIssues,
  agentCopyMetadataIssues,
  type AgentProseEvidence,
  type AgentSequenceBinding,
  type AgentSurfaceContract,
  type AgentTargetBinding,
  missingAgentContractIssues,
} from "./agent_contract.ts";
import { blankFrontmatter, decodeValeReport } from "./prose_lib.ts";
import { withToolTempDir } from "./temp_dir.ts";
import { runVale } from "./vale_lib.ts";

export type OperationalAgentSurfaceKind = "skill" | "setup-brief";

/** One contract-bearing unit. Supporting Skill files join evidence and lint. */
export interface OperationalAgentSurface {
  readonly id: string;
  readonly kind: OperationalAgentSurfaceKind;
  readonly source: SkillSource | "setup";
  readonly sourceFile: string;
  readonly sourceFiles: readonly string[];
  readonly contract?: AgentSurfaceContract;
  readonly issues: readonly AgentContractIssue[];
}

/** One generated DiscernAgent Vale finding on an authored source. */
export interface AgentSurfaceLexicalIssue {
  readonly file: string;
  readonly line?: number;
  readonly col?: number;
  readonly check: string;
  readonly message: string;
}

/** Payloads copied into a project but not followed as instructions in place. */
export const NON_OPERATIONAL_AGENT_SEGMENTS = new Map([
  [
    "skeleton",
    "files copied into a project are output templates, not operational instructions followed in place",
  ],
]);

/** Build one exact prose binding. */
function evidence(text: string, file?: string): AgentProseEvidence {
  return file === undefined ? { text } : { text, file };
}

/** Bind one named target to the prose that carries it. */
function target(
  kind: AgentTargetBinding["kind"],
  value: string,
  text: string,
  file?: string,
): AgentTargetBinding {
  return { kind, value, evidence: evidence(text, file) };
}

/** Bind one ordered action to shipped prose. */
function act(text: string, file?: string): AgentSequenceBinding {
  return { kind: "act", evidence: evidence(text, file) };
}

/** Bind the terminal verification to shipped prose. */
function verify(text: string, file?: string): AgentSequenceBinding {
  return { kind: "verify", evidence: evidence(text, file) };
}

/**
 * Repository-only classification and prose bindings. Keys are satellites of
 * the derived universe, not a second membership authority: the coverage guard
 * rejects both a derived member without a row and a row without a live member.
 */
export const AGENT_SURFACE_CONTRACTS = new Map<string, AgentSurfaceContract>([
  [
    "skill:discern-agent-voice",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: false,
      recoverable: true,
      targets: [
        target(
          "stable",
          "the named agent-facing surface and its live workflow contract",
          "Targets (root, path, or stable identifier):",
        ),
      ],
      sequence: [act("## Choose the mode"), verify("## Acceptance criteria")],
      stop_conditions: [
        evidence(
          "If a correctness-critical runtime assumption, working root, authority boundary, or stop condition is unavailable, name the missing fact and stop the affected instruction.",
        ),
      ],
      recovery: [
        evidence(
          "If a correctness-critical runtime assumption, working root, authority boundary, or stop condition is unavailable, name the missing fact and stop the affected instruction.",
        ),
      ],
    },
  ],
  [
    "skill:discern-await-the-fleet",
    {
      effectful: false,
      cross_worktree: true,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target(
          "root",
          "the absolute path of this effort's worktree or the main checkout",
          "Pass that checkout's absolute path to every `discern_await` call.",
        ),
        target(
          "stable",
          "an exact stable worktree selector returned by discern_start",
          "Await an exact stable selector from `discern_start`",
        ),
      ],
      sequence: [
        act("## 1. Name the condition"),
        act("## 3. Spend one call, and hold it quietly"),
        verify("Then verify the dependency actually arrived in your tree"),
      ],
      stop_conditions: [
        evidence(
          "Report only when the condition holds, the watch is unnecessary, or a refusal/error needs action.",
        ),
      ],
      recovery: [
        evidence("Never resume `ok: false`; follow its recovery hint."),
      ],
      relay: {
        message: evidence(
          "I waited for <condition>. The observed state is <observed_state>. I <next_action>.",
        ),
        facts: ["condition", "observed_state", "next_action"],
      },
    },
  ],
  [
    "skill:discern-brand-voice",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: false,
      recoverable: true,
      targets: [
        target("stable", "the named public surface", "Surface:"),
        target(
          "stable",
          "the applicable public claims",
          "relevant claim slugs from `claims-and-evidence.md`",
        ),
      ],
      sequence: [act("## Declare the brief"), verify("## Acceptance criteria")],
      stop_conditions: [
        evidence(
          "If the brief, audience, destination, or evidence for a required claim is unavailable, request that exact source or remove the unsupported claim before drafting continues.",
        ),
      ],
      recovery: [
        evidence(
          "If the brief, audience, destination, or evidence for a required claim is unavailable, request that exact source or remove the unsupported claim before drafting continues.",
        ),
      ],
    },
  ],
  [
    "skill:discern-clear-the-decks",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target(
          "stable",
          "the cleanup scope named by the user",
          "Keep the worklist inside the cleanup scope named by the user and the current worktree.",
        ),
        target(
          "stable",
          "the evidence-backed candidate worklist",
          "recording each candidate with its evidence",
        ),
      ],
      sequence: [
        act("## 2. Enumerate with structure, and keep a worklist"),
        act("## 4. Cut small, keep it green"),
        verify("## Done when"),
      ],
      stop_conditions: [
        evidence("When unsure, leave it standing and record why."),
      ],
      recovery: [
        evidence(
          "If a focused check shows behavior changed, revert that atomic cut and keep the candidate in the worklist with its evidence.",
        ),
      ],
      relay: {
        message: evidence(
          "I removed <cuts> with <evidence>. <standard> holds the improved metric. I left <residual>. <proof>",
        ),
        facts: ["cuts", "evidence", "standard", "residual", "proof"],
      },
    },
  ],
  [
    "skill:discern-cure-a-bug",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target(
          "stable",
          "the generative defect predicate",
          "## 1. Name the class as a checkable predicate",
        ),
        target(
          "stable",
          "the declared search universe and enrollment source",
          "State a **scope contract** before writing the detector:",
        ),
      ],
      sequence: [
        act("## 1. Name the class as a checkable predicate"),
        act("## 2. Write the detector first — before fixing anything"),
        verify("## 6. Leave the detector in the gate, and report the residual"),
      ],
      stop_conditions: [
        evidence(
          "stop there when diagnosis is all that was asked",
        ),
      ],
      recovery: [
        evidence(
          "If fixing surfaces sub-cases the predicate didn't cover, return to step 1 and tighten it",
        ),
      ],
      relay: {
        message: evidence(
          "I guarded <predicate> across <universe>. The detector found <population> and rejects <future_sibling>. The remaining boundary is <residual>.",
        ),
        facts: [
          "predicate",
          "universe",
          "population",
          "future_sibling",
          "residual",
        ],
      },
    },
  ],
  [
    "skill:discern-delegate-work",
    {
      effectful: true,
      cross_worktree: true,
      authority_sensitive: true,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target(
          "root",
          "each absolute worktree path returned by discern_start",
          "“There” is the absolute path `discern_start` returns.",
        ),
        target(
          "stable",
          "each literal branch returned by discern_start",
          "The exact branch returned by `discern_start`",
        ),
        target(
          "stable",
          "each keyed brief and its declared file territory",
          "Give every brief a workstream key:",
        ),
      ],
      sequence: [
        act("## 1. Pin down exactly what you're delegating"),
        act("## 5. Hand it off"),
        verify("## 6. Offer to review the result adversarially"),
      ],
      stop_conditions: [
        evidence(
          "Wait for the user's confirmation before starting any session, worktree, or sub-agent.",
        ),
      ],
      recovery: [
        evidence(
          "B's brief names the `discern-await-the-fleet` skill for that wait",
        ),
      ],
      authority: {
        boundary: evidence(
          "Preparing or presenting briefs does not authorize you to dispatch them.",
        ),
        command: "discern_accept",
        recheck: evidence(
          "run `discern_accept` — a recorded grant lands the branch, and without one the verb refuses",
        ),
      },
      relay: {
        message: evidence(
          "I prepared <briefs> for <topology>. Dispatch authority is <dispatch_authority>. The returned branches are <branches>, and the landing rule is <landing_rule>.",
        ),
        facts: [
          "briefs",
          "topology",
          "dispatch_authority",
          "branches",
          "landing_rule",
        ],
      },
    },
  ],
  [
    "skill:discern-document-subsystem",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target(
          "path",
          "{{map_dir}}",
          "The configured documentation tree lives at `{{map_dir}}`.",
        ),
        target(
          "stable",
          "the target subtree's scope manifest",
          "Each subtree is documented against a **scope manifest**",
        ),
      ],
      sequence: [
        act("## 1. Confirm the prerequisites"),
        act("## 3. Document the subtree, following the brief"),
        verify("## Done when"),
      ],
      stop_conditions: [
        evidence(
          "have the project owner restore the `_internal/` scaffolding before documenting",
        ),
      ],
      recovery: [
        evidence(
          "have the project owner restore the `_internal/` scaffolding before documenting",
        ),
      ],
      relay: {
        message: evidence(
          "I documented <coverage>. I preserved <todos>, found <glossary_additions>, resolved or reported <overlaps>, and recorded <deprecations>.",
        ),
        facts: [
          "coverage",
          "todos",
          "glossary_additions",
          "overlaps",
          "deprecations",
        ],
      },
    },
  ],
  [
    "skill:discern-product-voice",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: false,
      recoverable: true,
      targets: [
        target(
          "stable",
          "the relevant live command or result contract",
          "read the relevant command, config, workflow, or result contract",
        ),
        target(
          "stable",
          "the canonical glossary and source registry",
          "read the canonical glossary",
        ),
      ],
      sequence: [act("## Sources of truth"), verify("## Review checklist")],
      stop_conditions: [
        evidence(
          "If the live behavior, authority boundary, or canonical term cannot be verified, name the missing source and stop the affected copy decision.",
        ),
      ],
      recovery: [
        evidence(
          "If the live behavior, authority boundary, or canonical term cannot be verified, name the missing source and stop the affected copy decision.",
        ),
      ],
    },
  ],
  [
    "skill:discern-place-a-checkpoint",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target("path", "discern.toml", "## 4. Wire it in `discern.toml`"),
        target(
          "stable",
          "the served question and its deterministic trigger",
          "Triggers are deterministic and closed.",
        ),
      ],
      sequence: [
        act("## 1. Does it belong here? The placement ladder"),
        act("## 4. Wire it in `discern.toml`"),
        verify("## Done when"),
      ],
      stop_conditions: [
        evidence(
          "A variance is never yours to authorize — recorded grants do not cover one.",
        ),
      ],
      recovery: [
        evidence(
          "Frequent variance points at the rule: tighten the trigger, rewrite the question, soften to advise, or delete the entry.",
        ),
      ],
      relay: {
        message: evidence(
          "Checkpoint <id> is wired: <trigger>, <mode>. It governs new efforts once the change lands on <trunk>. Review its economics later with <command>.",
        ),
        facts: ["id", "trigger", "mode", "trunk", "command"],
      },
    },
  ],
  [
    "skill:discern-set-the-standard",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target("path", "discern.toml", "## 3. Wire it in `discern.toml`"),
        target(
          "stable",
          "the named metric and current main measurement",
          "Measure the metric on `main` and set `limit` to exactly that.",
        ),
      ],
      sequence: [
        act("## 1. Choose a metric worth defending"),
        act("## 3. Wire it in `discern.toml`"),
        verify("## Done when"),
      ],
      stop_conditions: [evidence("**Never loosen the limit to pass.**")],
      recovery: [
        evidence(
          "Stop and report the breach to the owner: the measured value, the delta, and why the growth is intrinsic to the work.",
        ),
      ],
      relay: {
        message: evidence(
          "<standard> measured <value> with a <delta> change. <reason>. The next valid action is <next_action>.",
        ),
        facts: ["standard", "value", "delta", "reason", "next_action"],
      },
    },
  ],
  [
    "skill:discern-teach-the-project",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: true,
      recoverable: true,
      targets: [
        target(
          "stable",
          "the durable lesson and its smallest project-owned home",
          "Pick the **smallest surface that fully carries the lesson**",
        ),
        target(
          "path",
          "{{instruction_sources}}",
          "the project instruction source ({{instruction_sources}})",
        ),
      ],
      sequence: [
        act("## 1. Catch the lesson"),
        act("## 4. Author it to that surface's own bar"),
        verify("## 5. Compile, verify, and report"),
      ],
      stop_conditions: [
        evidence("their _no_ is information, not an obstacle"),
      ],
      recovery: [
        evidence(
          "check for an existing home first",
        ),
      ],
      relay: {
        message: evidence(
          "I taught the project <lesson> in <surface>. I verified it with <verification>.",
        ),
        facts: ["lesson", "surface", "verification"],
      },
    },
  ],
  [
    "skill:discern-write-adr",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: false,
      recoverable: true,
      targets: [
        target(
          "path",
          "{{map_dir}}_adr/",
          "The project's ADRs live in the configured documentation tree, at `{{map_dir}}_adr/`.",
        ),
        target(
          "stable",
          "the canonical ADR format",
          "The canonical format lives in `{{map_dir}}_adr/README.md`.",
        ),
      ],
      sequence: [
        act("## 1. Decide whether it's actually an ADR"),
        act("## 3. Draft from the template"),
        verify("## Done when"),
      ],
      stop_conditions: [evidence("If any fails, say so and stop")],
      recovery: [
        evidence(
          "whoever lands second moves to the next free number",
        ),
      ],
    },
  ],
  [
    "skill:discern-write-it-once",
    {
      effectful: true,
      cross_worktree: false,
      authority_sensitive: false,
      relay_bearing: false,
      recoverable: true,
      targets: [
        target(
          "stable",
          "the shared fact and its one authority",
          "## One authority per fact",
        ),
        target(
          "path",
          "{{map_dir}}80-development/canonical-sets.md",
          "Keep a page in the project's documentation tree — `{{map_dir}}80-development/canonical-sets.md`, created the first time you bind a fact",
        ),
      ],
      sequence: [
        act("## One authority per fact"),
        act("## Guards enroll the future member"),
        verify("## Done when"),
      ],
      stop_conditions: [
        evidence(
          "Centralize a fact only when its consumers express one decision and must change together.",
        ),
      ],
      recovery: [
        evidence(
          "A consumer that stays green and stale is unbound; return to step 3.",
          "bind-the-fact.md",
        ),
      ],
    },
  ],
  [
    "setup:instructions",
    {
      effectful: true,
      cross_worktree: true,
      authority_sensitive: true,
      // The authored brief carries canonical owner-moment ids. Their resolved
      // ready-to-send relays are enrolled and checked by setup_experience.ts;
      // duplicating one message here would create a second prose authority.
      relay_bearing: false,
      recoverable: true,
      targets: [
        target(
          "root",
          "the dedicated setup branch",
          "keep every change on the setup branch until the owner chooses to land it",
        ),
        target(
          "stable",
          "the numbered page returned by discern setup step",
          "Re-run `discern setup begin` for the preamble and first page, or `discern setup step <n>` for one numbered page.",
        ),
      ],
      sequence: [
        act("## Step 0 - Confirm consent, provenance, and install health"),
        act("## Step 9 - Reconcile, commit, prove, and hand off landing"),
        verify("## You are not done until all of these are true"),
      ],
      stop_conditions: [
        evidence(
          "Stop when the consent relay was incomplete, the provenance value is a placeholder, or doctor reports a failure.",
        ),
        evidence(
          "Stop before an unapproved install or resource effect, when command meaning is ambiguous, or when a reporter masks the original status.",
        ),
      ],
      recovery: [
        evidence(
          "If a condition is false, continue with the page or result recovery that owns it.",
        ),
      ],
      authority: {
        boundary: evidence(
          "A clean green Proof authorizes no landing by itself; the owner or a recorded grant decides whether the setup branch lands.",
        ),
        command: "discern setup accept",
        recheck: evidence(
          "Run the result's `discern setup accept` landing command only with applicable recorded or current owner authority",
        ),
      },
    },
  ],
]);

/** Render a repo-relative path when the source belongs to this checkout. */
function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.startsWith("..") ? path : rel;
}

/** Every operational Markdown file below one source directory. */
export async function operationalInstructionFiles(
  sourceDir: string,
): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(sourceDir, { exts: [".md"], includeDirs: false })
  ) {
    const segments = relative(sourceDir, entry.path).split(/[\\/]/);
    if (
      segments.some((segment) => NON_OPERATIONAL_AGENT_SEGMENTS.has(segment))
    ) {
      continue;
    }
    files.push(entry.path);
  }
  return files.sort();
}

/** Read the enrolled files as evidence-bearing documents. */
async function contractDocuments(
  sourceDir: string,
  files: readonly string[],
): Promise<AgentContractDocument[]> {
  return await Promise.all(files.map(async (file) => ({
    relativePath: relative(sourceDir, file),
    absolutePath: file,
    text: await Deno.readTextFile(file),
  })));
}

/** Join one derived surface to its internal contract and evidence checks. */
function surfaceContract(
  id: string,
  primaryRelativePath: string,
  documents: readonly AgentContractDocument[],
): Pick<OperationalAgentSurface, "contract" | "issues"> {
  const contract = AGENT_SURFACE_CONTRACTS.get(id);
  if (contract === undefined) {
    return { issues: missingAgentContractIssues() };
  }
  return {
    contract,
    issues: [
      ...agentContractStructureIssues(contract),
      ...agentContractEvidenceIssues(
        contract,
        primaryRelativePath,
        documents,
      ),
    ],
  };
}

/** Read one effective Skill as a registry-classified operational surface. */
export async function operationalSkillSurface(
  skill: SkillEntry,
): Promise<OperationalAgentSurface> {
  const sourceFile = join(skill.srcAbs, "SKILL.md");
  const sourceFiles = await operationalInstructionFiles(skill.srcAbs);
  const contract = surfaceContract(
    `skill:${skill.name}`,
    "SKILL.md",
    await contractDocuments(skill.srcAbs, sourceFiles),
  );
  return {
    id: `skill:${skill.name}`,
    kind: "skill",
    source: skill.source,
    sourceFile,
    sourceFiles,
    ...contract,
  };
}

/** Resolve every setup brief from the live template directory. */
export async function operationalSetupSurfaces(
  setupDir: string,
): Promise<OperationalAgentSurface[]> {
  const files = await operationalInstructionFiles(setupDir);
  return await Promise.all(files.map(async (sourceFile) => {
    const rel = relative(setupDir, sourceFile);
    const id = `setup:${rel.replace(/\.md$/, "")}`;
    const contract = surfaceContract(
      id,
      rel,
      await contractDocuments(setupDir, [sourceFile]),
    );
    return {
      id,
      kind: "setup-brief",
      source: "setup",
      sourceFile,
      sourceFiles: [sourceFile],
      ...contract,
    };
  }));
}

/** Resolve the complete current corpus from materializer/setup authorities. */
export async function operationalAgentSurfaces(
  root: string,
  config: DiscernConfig,
): Promise<OperationalAgentSurface[]> {
  const skills = await resolveEffectiveSkills(root, config);
  const surfaces = await Promise.all(skills.map(operationalSkillSurface));
  surfaces.push(...await operationalSetupSurfaces(await resolveSetupDir()));
  return surfaces.sort((a, b) => a.id.localeCompare(b.id));
}

/** Flatten contract failures with authored source locations and accepted forms. */
export function operationalContractFailures(
  root: string,
  surfaces: readonly OperationalAgentSurface[],
): string[] {
  return surfaces.flatMap((surface) =>
    surface.issues.map((entry) => {
      const source = entry.file ?? surface.sourceFile;
      return `${displayPath(root, source)}:${entry.line}: ${entry.message}`;
    })
  );
}

/** The registry is an exhaustive satellite of the derived surface universe. */
export function operationalRegistryCoverageFailures(
  surfaces: readonly OperationalAgentSurface[],
): string[] {
  const live = new Set(surfaces.map((surface) => surface.id));
  return [...AGENT_SURFACE_CONTRACTS.keys()]
    .filter((id) => !live.has(id))
    .map((id) =>
      `scripts/agent_surface_contracts.ts:1: internal contract registry entry '${id}' has no derived operational surface; accepted form: remove the stale row or restore the surface through its owning Skill/setup registry`
    );
}

/** Deduplicated Markdown corpus belonging to all enrolled surfaces. */
export function operationalAgentCorpusFiles(
  surfaces: readonly OperationalAgentSurface[],
): string[] {
  return [...new Set(surfaces.flatMap((surface) => surface.sourceFiles))]
    .sort();
}

/** Internal-schema diagnostics over the complete agent-facing corpus. */
export async function operationalMetadataFailures(
  root: string,
  files: readonly string[],
): Promise<string[]> {
  const rows = await Promise.all(
    files.map(async (file) =>
      agentCopyMetadataIssues(
        displayPath(root, file),
        await Deno.readTextFile(file),
      )
    ),
  );
  return rows.flat().map((entry) =>
    `${entry.file}:${entry.line}: ${entry.message}`
  );
}

/** Run the generated DiscernAgent Vale style over the non-Map agent corpus. */
export async function agentSurfaceLexicalIssues(
  repoRoot: string,
  files: readonly string[],
): Promise<AgentSurfaceLexicalIssue[]> {
  return await withToolTempDir("agent-surface-stage", async (stage) => {
    const stagedToSource = new Map<string, string>();
    for (const [index, file] of files.entries()) {
      const staged = join(
        stage,
        String(index).padStart(4, "0"),
        basename(file),
      );
      await Deno.mkdir(dirname(staged), { recursive: true });
      await Deno.writeTextFile(
        staged,
        blankFrontmatter(await Deno.readTextFile(file)),
      );
      stagedToSource.set(resolve(staged), file);
    }

    const run = await runVale(repoRoot, [
      "--minAlertLevel",
      "suggestion",
      "--output=JSON",
      stage,
    ]);
    const decoder = new TextDecoder();
    const stdout = decoder.decode(run.stdout);
    let parsed: ReturnType<typeof decodeValeReport>;
    try {
      parsed = decodeValeReport(
        stdout,
        "Vale output for the agent-copy corpus",
      );
    } catch (error) {
      const stderr = decoder.decode(run.stderr).trim();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${
          stderr === "" ? "" : `: ${stderr}`
        }`,
        { cause: error },
      );
    }

    const issues: AgentSurfaceLexicalIssue[] = [];
    for (const [stagedPath, alerts] of Object.entries(parsed)) {
      const source = stagedToSource.get(resolve(stagedPath));
      if (source === undefined) {
        throw new Error(
          `Vale reported an unenrolled staged path: ${stagedPath}`,
        );
      }
      for (const alert of alerts) {
        const check = alert.Check;
        if (typeof check !== "string" || !check.startsWith("DiscernAgent.")) {
          continue;
        }
        const row: AgentSurfaceLexicalIssue = {
          file: displayPath(repoRoot, source),
          check,
          message: typeof alert.Message === "string"
            ? alert.Message
            : "Agent-copy lexical rule failed.",
        };
        if (typeof alert.Line === "number") {
          Object.assign(row, { line: alert.Line });
        }
        const col = Array.isArray(alert.Span) ? alert.Span[0] : undefined;
        if (typeof col === "number") Object.assign(row, { col });
        issues.push(row);
      }
    }
    return issues.sort((a, b) =>
      a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) ||
      a.check.localeCompare(b.check)
    );
  });
}

/** Human-readable source-located lexical diagnostics. */
export function formatAgentLexicalIssues(
  issues: readonly AgentSurfaceLexicalIssue[],
): string[] {
  return issues.map((entry) =>
    `${entry.file}${entry.line === undefined ? "" : `:${entry.line}`}${
      entry.col === undefined ? "" : `:${entry.col}`
    }: ${entry.check}: ${entry.message}`
  );
}
