/**
 * The engine's **result & plan vocabulary** — the single source of truth for what
 * every `discern` verb returns. A verb computes a pure {@link DiscernResult}; its
 * human text, its `--json`, and (the MCP server's) tool result are all renderings
 * of that one object, never re-derived in parallel (ADR 0027, ADR 0028).
 *
 * This module is the base layer — pure data and pure functions, zero internal
 * imports — so both halves of the binary (the `src/engine/**` engine and the
 * `src/commands/**` installer) depend on it without a cycle. The two sink
 * *adapters* that bridge to a concrete writer live with the writer they adapt:
 * `outSink` in `src/engine/output.ts`, `loggerSink` in `src/lib/log.ts`.
 *
 * Three concentric rings:
 *  1. the **plan vocabulary** — `EnginePlan`/`PlanStep`/`StepResult`: what a verb
 *     plans to do and how each step turned out (generalized from the installer's
 *     `fs_plan` pattern across the engine seam);
 *  2. the **diagnostic** — a normalized failure ({@link Diagnostic}): the
 *     structured "why" an agent reads to fix without re-running and scraping;
 *  3. the **envelope** — {@link DiscernResult}: the uniform `{ok, verb, …}` shell
 *     every verb returns, carrying a plan and/or steps, diagnostics, and a
 *     verb-specific `data` payload.
 */

// ── ring 1: the plan vocabulary ─────────────────────────────────────────────

/**
 * Whether a planned step will act when the plan is applied:
 *  - `run`  — the step will be performed (a job spawn, a git mutation, a destroy).
 *  - `skip` — the step is part of the plan but will NOT act (a configured-but-
 *             unchanged scope gate, a gc-opted-out resource). Listed for honesty.
 *  - `gate` — a read-only precondition that can BLOCK the plan but mutates nothing
 *             (the merge check). Rendered as "check".
 *
 * A const tuple so `result_schemas.ts` derives its Zod enum from it (rather than
 * hand-mirroring), keeping the wire vocabulary tied to this one source.
 */
export const STEP_DISPOSITIONS = ["run", "skip", "gate"] as const;
/** One planned-step disposition ({@link STEP_DISPOSITIONS}). */
export type StepDisposition = (typeof STEP_DISPOSITIONS)[number];

/**
 * The engine's operation vocabulary — what a step DOES (never a filesystem write).
 * Deliberately coarse: the renderer groups by it and `--json` reports it. A const
 * tuple so `result_schemas.ts` derives its Zod enum from it — a new kind extends the
 * union AND the wire schema from one edit, never a hand-kept mirror that can lag.
 */
export const STEP_KINDS = [
  "job", // run a declared gate job
  "scope-gate", // run a scope's self-contained gate
  "merge-check", // assert the branch contains the integration branch
  "standards-limits-check", // assert no [standards] limit loosened vs the trunk
  "tracked-artifacts-check", // assert discern-owned ignored artifacts are untracked
  "guidance-check", // assert the agent files match their sources
  "skills-check", // assert the materialized skills match the effective set
  "resource-create", // create a per-worktree external resource
  "resource-destroy", // destroy / reclaim a per-worktree external resource
  "git", // a git mutation (branch, remove, checkout, fast-forward, sweep)
  "setup-step", // a [worktree.setup].steps command (one-shot, at creation)
  "repository-ensure", // a [repository].ensure command (shared checkout convergence)
  "checkout-clean-check", // report tracked drift left by checkout convergence
  "setup-ensure", // a [worktree.setup].ensure command (convergent, every pass)
  "env", // record port / inherit env / resource handles
  "refresh", // recompile agent guidance + skills
  "tidy", // canonically format a discern-convention source file
  "standard", // measure a metric and compare it to its limit
] as const;
/** One engine operation kind ({@link STEP_KINDS}). */
export type StepKind = (typeof STEP_KINDS)[number];

/**
 * Who a step's command belongs to — the two-way split `discern doctor`'s execution
 * model marks every step with: `"project"` is a command from the project's own config
 * (a declared job, a scope or standard command, a resource `create`/`destroy`, a
 * `[worktree.setup]` step), `"discern"` is a built-in operation discern performs
 * itself (a precondition check, a git mutation, an env/refresh step). A const tuple so
 * `result_schemas.ts` derives its Zod enum from it rather than hand-mirroring.
 */
export const ACTORS = ["project", "discern"] as const;
/** One step actor ({@link ACTORS}). */
export type Actor = (typeof ACTORS)[number];

/**
 * One step in an engine plan — the unit the shared renderer prints and the generic
 * `--json` serializes. Pure data: it carries no closures, so a plan is inspectable
 * and serializable before anything runs.
 */
export interface PlanStep {
  kind: StepKind;
  /** Stable label (a job/resource/scope/standard name, or a git verb). */
  label: string;
  disposition: StepDisposition;
  /** Human one-liner: what the step does, or why it is skipped. */
  note?: string | undefined;
  /** Optional display grouping (a gate stage, "resources", "git", …). */
  group?: string | undefined;
}

/**
 * A complete, renderable engine plan: a titled, optionally-prefaced step list. The
 * common projection every verb's typed plan reduces to for presentation.
 */
export interface EnginePlan {
  /** Imperative heading (e.g. "Acceptance plan", "Gate plan"). */
  title: string;
  /** Context lines shown above the steps (e.g. branch / from / into). */
  details: string[];
  steps: PlanStep[];
}

/** A step's outcome after execution, for the generic results serialization. A const
 * tuple so `result_schemas.ts` derives its Zod enum from it (not a hand mirror). */
export const STEP_OUTCOMES = ["ok", "failed", "skipped", "cancelled"] as const;
/** One executed-step outcome ({@link STEP_OUTCOMES}). */
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

/** One executed step: the planned step plus how it turned out. */
export interface StepResult {
  step: PlanStep;
  outcome: StepOutcome;
  /** Whole-second wall-clock duration when measured (jobs / standards). */
  durationS?: number | undefined;
  /** Best-effort path to a full output artifact for job steps that ran. */
  outputPath?: string | undefined;
  /** Count of output lines for job steps that ran. */
  outputLines?: number | undefined;
  /** Count of output lines that look like compiler/linter diagnostics. */
  errorLikeLines?: number | undefined;
}

/**
 * The gate's **failed-stage vocabulary** — every label `done`/`prepare`/`test`
 * can record as the stage that failed (the value carried in `GateData.failed_stage`
 * and the key the failed-stage remedy is looked up by). A CLOSED set: typing every
 * hop to it, deriving the Zod `failed_stage` enum (`result_schemas.ts`) from it, and
 * building the hint registry's total `GATE_FAILURE_REMEDIES` record from it makes a
 * new label a COMPILE error until every consumer handles it — it can never fall
 * through to a generic "a stage failed".
 *
 * The members, by origin:
 *  - `fix` / `build` / `check` / `test` — one declared-job stage group failed
 *    (`prepare` runs `check` alone; `discern test` runs `test` alone);
 *  - `check/test` — `done` fuses the read-only checks and the tests into ONE group,
 *    so their combined failure reports this label rather than `check` or `test`;
 *  - `scope_gates` — a changed scope's self-contained gate failed;
 *  - `tree_drift` — a gate stage left uncommitted changes on committed-clean
 *    tracked files (ADR 0047, extended to every stage by ADR 0148);
 *  - `generated_drift` — a declared generator changed one of its committed
 *    artifacts when re-run, meaning the committed regeneration is stale or the
 *    command does not produce the same bytes from the same tree (ADR 0247);
 *  - `tracked_artifacts` — a discern-owned generated/local artifact is tracked by Git;
 *  - `guidance` / `skills` — an agent file / materialized skills dir is stale
 *    (the currency checks, ADR 0034);
 *  - `skill_frontmatter` — an effective skill's SKILL.md frontmatter fails the
 *    consumer contract (valid YAML with a non-empty `name`/`description`
 *    identity), so an agent runtime would reject or misread it;
 *  - `adr_numbers` — two ADR records in the map's `_adr/` tree claim the same
 *    number. The files differ, so a merge lands the duplicate cleanly; the
 *    gate is the surface that refuses it;
 *  - `adr_index` — the maintained ADR index (the marker-delimited record
 *    lists in the map's ADR README) does not match the record files on
 *    disk, or cannot be derived from them. Only a README carrying the
 *    markers is checked — the index is opt-in by construction;
 *  - `map_integrity` — the map or a guidance source carries a reference a
 *    reader would follow and fail: a dead link or anchor, a metadata block the
 *    lenient reader would swallow, a fenced `discern` example the current CLI
 *    rejects, a published page linking into the internal trees, or a citation
 *    of a skill outside the effective set;
 *  - `merge` — the branch is behind the integration branch (the fail-fast
 *    precondition, ADR 0050);
 *  - `standards` — a `[standards]` limit failed verification against the trunk:
 *    loosened or deleted on this branch, or the trunk's config was fetched but
 *    does not parse (the fail-fast never-loosen precondition).
 *  - `write_access` — a real write probe for Discern-owned state was denied
 *    before the slow gate work began.
 *
 * Defined in this base vocabulary module (not the engine) because `result_schemas.ts`
 * — a `shared/` module that must NOT import the engine — derives the `failed_stage`
 * enum from it; placing it in the gate would invert that layer (and cycle with
 * `plan.ts`, which already imports `GateData` from `result_schemas.ts`).
 */
export const FAILED_STAGES = [
  "fix",
  "build",
  "check",
  "test",
  "check/test",
  "scope_gates",
  "tree_drift",
  "generated_drift",
  "tracked_artifacts",
  "guidance",
  "skills",
  "skill_frontmatter",
  "adr_numbers",
  "adr_index",
  "map_integrity",
  "merge",
  "standards",
  "write_access",
] as const;

/** One failed-stage label ({@link FAILED_STAGES}). */
export type FailedStage = (typeof FAILED_STAGES)[number];

// ── ring 2: the normalized diagnostic ───────────────────────────────────────

/**
 * A normalized failure from one gate command — the structured "why" behind a
 * failed step. discern's pitch is stack-neutral *commands*; the diagnostic extends
 * that to stack-neutral *results*, so an agent loops act→read-error→fix instead of
 * act→re-run→scrape-stderr→guess.
 *
 * Layered by how much discern knows about the tool (ADR 0028):
 *  - **Tier 0 (always, stack-neutral):** `tool`, `severity`, `message`,
 *    `reproduce_cmd` (the command's own string — free), and `output` (the captured
 *    combined stdout+stderr, terminal-normalized and capped) plus `output_path`
 *    when the full normalized capture was offloaded. No per-tool parsing; works
 *    everywhere.
 *  - **Tier 1 (opt-in):** when a job declares a diagnostics `format`,
 *    discern parses `output` into `file`/`line`/`col`/`rule`/`message`.
 *  - **Tier 2 (derived):** `fix_available` — a fixer is wired that may resolve a
 *    non-fix job failure.
 */

/** A diagnostic's severity. A const tuple so `result_schemas.ts` derives its Zod
 * enum from it (not a hand mirror), keeping the wire vocabulary tied to this source. */
export const DIAGNOSTIC_SEVERITIES = ["error", "warning"] as const;
/** One diagnostic severity ({@link DIAGNOSTIC_SEVERITIES}). */
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export interface Diagnostic {
  /** The job label that produced this failure (e.g. "lint", "scope:web"). */
  tool: string;
  /** Tier-0 failures are always "error"; Tier-1 parsing may surface "warning". */
  severity: DiagnosticSeverity;
  /** One-line summary (Tier 0: "<tool> failed (exit N)"; Tier 1: the parsed message). */
  message: string;
  /** The exact command to reproduce this failure — the job's own command string. */
  reproduce_cmd: string;
  /** Captured combined stdout+stderr from the failing command (Tier 0), normalized and capped. */
  output?: string | undefined;
  /** True when `output` was truncated to the capture cap (head + tail kept). */
  truncated?: boolean | undefined;
  /** Absolute path to the full normalized capture when `output` was truncated. */
  output_path?: string | undefined;
  /** Tier 1: the source file the diagnostic points at. */
  file?: string | undefined;
  /** Tier 1: 1-based line number. */
  line?: number | undefined;
  /** Tier 1: 1-based column. */
  col?: number | undefined;
  /** Tier 1: the tool's rule/code identifier (an eslint rule, a `TSxxxx` code). */
  rule?: string | undefined;
  /** Tier 2: present when a wired fixer may auto-resolve this non-fix job failure. */
  fix_available?: boolean | undefined;
}

// ── ring 3: the universal envelope ──────────────────────────────────────────

/**
 * Every machine-stable error slug a live result may emit. Runtime schemas derive
 * their closed enum from this tuple; public artifacts publish it as advisory
 * vocabulary while keeping the envelope's `error` field forward-compatible.
 */
export const ERROR_SLUGS = [
  "active_worktrees",
  "ambiguous",
  "apply_failed",
  "awaiting_consent",
  "below_min_score",
  "brief_unparseable",
  "checkout_failed",
  "config_template_unavailable",
  "confirmation_required",
  "conflict",
  "desk_already_active",
  "detached_head",
  "diagrams_misaligned",
  "dirty_worktree",
  "edit_error",
  "gate_failed",
  "gitignore_template_unavailable",
  "identity_error",
  "incomplete",
  "internal_error",
  "invalid_arguments",
  "invalid_config",
  "invalid_config_file",
  "invalid_migrated_config",
  "invalid_preset",
  "invalid_settings_file",
  "invalid_toml",
  "invalid_value",
  "no_docs",
  "no_map",
  "no_project",
  "no_repository",
  "no_such_step",
  "no_target",
  "not_found",
  "not_initialized",
  "not_main_checkout",
  "not_on_trunk",
  "not_set_up",
  "not_setup_branch",
  "partial_acceptance",
  "partial_materialization",
  "partial_refresh",
  "pin_failed",
  "precondition_failed",
  "provisioned_resources",
  "read_error",
  "renamed_command",
  "renamed_config_key",
  "schema_version_too_new",
  "setup_plan_failed",
  "skills_eject_failed",
  "tables_malformed",
  "templates_not_found",
  "tidy_parse_failed",
  "tidy_write_failed",
  "uncommitted_changes",
  "unchanged_tree_rerun",
  "unknown_category",
  "unknown_command",
  "unknown_key",
  "unknown_preset",
  "unknown_standard",
  "write_access",
] as const;

/** One known live error slug ({@link ERROR_SLUGS}). */
export type ErrorSlug = (typeof ERROR_SLUGS)[number];

/**
 * The uniform result every `discern` verb returns. An agent can rely on `ok`,
 * `verb`, `error`, and `diagnostics` being present on EVERY verb; the structural
 * `plan`/`steps` carry the verbs that have steps (finish, worktree, standards,
 * accept), and `data` carries each verb's own payload (doctor's checks, schema migration data
 * schema versions, init's written-files list).
 *
 * `result_serialization.ts` renders it to `--json`; the human path renders the same fields
 * (so the two can never disagree on WHAT happened) and may add verb-specific advice.
 *
 * Generic over its `data` payload (`TData`, default `unknown`): a verb core narrows
 * it to its own schema-backed type (`DiscernResult<StatusData>`, `<GateData>`, …) so
 * a core that builds the wrong `data` shape is a COMPILE error and a consumer reads
 * `result.data` already typed — no `as` cast back from `unknown`. The dataless verbs
 * and the generic renderers keep the `unknown` default; serialization and the
 * other sinks accept any specialization (every `DiscernResult<T>` widens to
 * `DiscernResult<unknown>`).
 */
export interface DiscernResult<TData = unknown> {
  /** Did the verb succeed? The one field every consumer can rely on. */
  ok: boolean;
  /** The verb that produced this result ("done", "accept", "doctor", …). */
  verb: string;
  /**
   * True when this is a preview (`--dry-run`): nothing was applied. The ONE
   * uniform "is this a preview?" signal across every verb — the engine plan rides
   * in `plan`, an installer's fs-plan in `data`, but `dry_run` marks both.
   */
  dry_run?: boolean | undefined;
  /** Dry-run / preview: the plan that WOULD run (mutually exclusive with `steps`). */
  plan?: EnginePlan | undefined;
  /** Apply: the steps that ran and how each turned out. */
  steps?: StepResult[] | undefined;
  /** Normalized failures — the structured "why" for an agent's act→fix loop. */
  diagnostics?: Diagnostic[] | undefined;
  /** Verb-specific payload that doesn't fit steps (checks, schema versions, file lists). */
  data?: TData | undefined;
  /**
   * Agent-facing "what next" advice (ADR 0030): the next-step nudges a human run
   * prints (check the standards, start the dev server, update the docs; on a failed
   * gate, where the gotchas are documented), promoted into the envelope so a quiet
   * `--json` run loses none of it. Purely advisory — NOT errors (those are `error`
   * / `diagnostics`).
   */
  hints?: string[] | undefined;
  /** A machine-stable error slug when the verb refused/aborted (e.g. "dirty_worktree"). */
  error?: ErrorSlug | undefined;
  /** A human sentence accompanying `error`. */
  message?: string | undefined;
}

// ── captured-output capping (the Tier-0 diagnostic budget) ──────────────────

/**
 * Chars retained in a failed command's captured `output` — large enough for a
 * tool's error block + summary, bounded so it never floods an agent's context.
 */
export const CAPTURE_CAP = 16_000;

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

export interface CappedText {
  text: string;
  truncated: boolean;
  /** The full normalized text before capping. Equal to `text` when untruncated. */
  fullText: string;
}

function collapseCarriageReturns(s: string): string {
  return s.replaceAll("\r\n", "\n").split("\n")
    .map((line) => {
      const lastReturn = line.lastIndexOf("\r");
      return lastReturn === -1 ? line : line.slice(lastReturn + 1);
    })
    .join("\n");
}

function stripTerminalEscapes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) !== 0x1b) {
      out += s.charAt(i);
      continue;
    }
    const kind = s.charAt(i + 1);
    if (kind === "[") {
      i += 2;
      while (i < s.length) {
        const code = s.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) {
          break;
        }
        i += 1;
      }
      continue;
    }
    if (kind === "]") {
      i += 2;
      while (i < s.length) {
        const code = s.charCodeAt(i);
        if (code === 0x07) {
          break;
        }
        if (code === 0x1b && s.charAt(i + 1) === "\\") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    const nextCode = s.charCodeAt(i + 1);
    if (
      (nextCode >= 0x40 && nextCode <= 0x5a) ||
      (nextCode >= 0x5c && nextCode <= 0x5f)
    ) {
      i += 1;
    }
  }
  return out;
}

/**
 * Normalize captured terminal output without learning anything about the tool that
 * produced it: keep the visible end state of carriage-return rewrites, remove
 * terminal escape controls, and drop non-text C0 controls while preserving newlines
 * and tabs.
 */
export function normalizeCapturedOutput(s: string): string {
  return stripTerminalEscapes(collapseCarriageReturns(s))
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 || code === 0x0a || code === 0x09;
    })
    .join("");
}

/**
 * Normalize then cap a captured string to {@link CAPTURE_CAP}, keeping the head AND
 * tail when it overflows (a compiler lists the first error early; a runner prints
 * its summary at the end). Applied at the diagnostic boundary, not at capture, so
 * structured normalization (SARIF, JUnit XML) still sees the full output. Cuts are snapped off
 * UTF-16 surrogate boundaries so a multi-byte char is never split into a lone
 * surrogate.
 */
export function capText(s: string): CappedText {
  const normalized = normalizeCapturedOutput(s);
  if (normalized.length <= CAPTURE_CAP) {
    return { text: normalized, truncated: false, fullText: normalized };
  }

  let marker = "";
  let head = 0;
  let tailStart = normalized.length;
  for (let i = 0; i < 4; i += 1) {
    const budget = CAPTURE_CAP - marker.length;
    head = Math.max(0, Math.floor(budget * 0.6));
    if (head > 0 && isHighSurrogate(normalized.charCodeAt(head - 1))) {
      head -= 1; // don't split a surrogate pair at the head cut
    }
    const tailChars = Math.max(0, budget - head);
    tailStart = Math.max(head, normalized.length - tailChars);
    if (
      tailStart < normalized.length &&
      isLowSurrogate(normalized.charCodeAt(tailStart))
    ) {
      tailStart += 1; // …nor at the tail cut
    }
    const nextMarker = `\n… ${tailStart - head} chars elided …\n`;
    if (nextMarker === marker) {
      break;
    }
    marker = nextMarker;
  }
  return {
    text: `${normalized.slice(0, head)}${marker}${normalized.slice(tailStart)}`,
    truncated: true,
    fullText: normalized,
  };
}

// ── the shared human renderers ──────────────────────────────────────────────

/** One semantic group in a discern-managed human view. `id` is the stable,
 * non-rendered identity that makes the grouping explicit in code; `label` is
 * optional user-facing text; `items` are the group's ordered contents. */
export interface HumanOutputGroup<T> {
  id: string;
  label?: string | undefined;
  items: readonly T[];
}

/** Assert the non-rendered identity carried by every semantic output group. */
export function assertHumanOutputGroupId(id: string): void {
  if (id.trim() === "") {
    throw new Error("human output group id must not be blank");
  }
}

/** Assert one optional user-facing group label. */
export function assertHumanOutputGroupLabel(id: string, label: string): void {
  if (label.trim() === "") {
    throw new Error(`human output group ${id.trim()} label must not be blank`);
  }
  if (/\r|\n/.test(label)) {
    throw new Error(`human output group ${id.trim()} label must be one line`);
  }
}

/** Validate semantic group identities and drop groups with no contents. The
 * generic form is shared by text reports and interactive option lists. */
export function populatedHumanOutputGroups<T>(
  groups: readonly HumanOutputGroup<T>[],
): HumanOutputGroup<T>[] {
  const seen = new Set<string>();
  const populated: HumanOutputGroup<T>[] = [];
  for (const group of groups) {
    const id = group.id.trim();
    assertHumanOutputGroupId(id);
    if (group.label !== undefined) {
      assertHumanOutputGroupLabel(id, group.label);
    }
    if (seen.has(id)) {
      throw new Error(`duplicate human output group id: ${id}`);
    }
    seen.add(id);
    if (group.items.length > 0) {
      populated.push(group);
    }
  }
  return populated;
}

export interface HumanOutputRenderOptions {
  /** Render one label line above a populated group's items. */
  renderLabel?:
    | ((group: HumanOutputGroup<string>) => string | undefined)
    | undefined;
  /** Start the first populated group after one empty line. */
  leadingBoundary?: boolean | undefined;
}

/** Render text groups with one empty line between each populated group. Leading
 * and trailing line breaks on individual items are removed so the grouping
 * helper, rather than a caller's string literal, owns every outer boundary. */
export function renderHumanOutputGroups(
  groups: readonly HumanOutputGroup<string>[],
  options: HumanOutputRenderOptions = {},
): string {
  const blocks = populatedHumanOutputGroups(groups).flatMap((group) => {
    const lines = group.items
      .map((item) => item.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, ""))
      .filter((item) => item !== "");
    if (lines.length === 0) {
      return [];
    }
    const label = options.renderLabel?.(group);
    return [[...(label === undefined ? [] : [label]), ...lines].join("\n")];
  });
  if (blocks.length === 0) {
    return "";
  }
  return `${options.leadingBoundary === true ? "\n" : ""}${
    blocks.join("\n\n")
  }`;
}

/**
 * The minimal output surface the renderer needs. Implemented by both the gate's
 * `Out` and the installer's `Logger` through `outSink` / `loggerSink` (which live
 * with the writer they adapt), so one renderer serves both paths.
 */
export interface RenderSink {
  heading(text: string): void;
  line(text: string): void;
  /** Dim a fragment (returns it unchanged when colour is off). */
  dim(text: string): string;
}

/**
 * Dim a multi-line block for terminal output — how quoted page content (the
 * receipt) reads as secondary against the narration around it. Wrapped per
 * line, not per block: attributes never straddle a newline, so the shading
 * survives pagers and partial scrollback. Empty lines stay bare, and a
 * colour-off `dim` passes the block through unchanged.
 */
export function dimBlock(text: string, dim: RenderSink["dim"]): string {
  return text
    .split("\n")
    .map((line) => line === "" ? line : dim(line))
    .join("\n");
}

/** Short, human label for each disposition. */
const DISPOSITION_LABEL: Record<StepDisposition, string> = {
  run: "run",
  skip: "skip",
  gate: "check",
};

/**
 * Render a plan as a per-step listing under its heading — the `--dry-run` view.
 * Every populated section gets one dim label and one clean boundary; steps
 * without a named `group` collect under "Steps".
 */
export function renderPlan(sink: RenderSink, plan: EnginePlan): void {
  sink.heading(plan.title);
  const groups: HumanOutputGroup<string>[] = plan.details.length === 0 ? [] : [{
    id: "context",
    label: "Context",
    items: plan.details.map((detail) => `  ${sink.dim(detail)}`),
  }];
  let group: string | undefined;
  let groupItems: string[] = [];
  const flush = (): void => {
    if (groupItems.length === 0) return;
    const namedGroup = group !== undefined && group !== "";
    groups.push({
      id: namedGroup ? `steps:${group}` : "steps",
      label: namedGroup ? group : "Steps",
      items: groupItems,
    });
    groupItems = [];
  };
  for (const step of plan.steps) {
    if (step.group !== group) {
      flush();
      group = step.group;
    }
    const indent = step.group !== undefined && step.group !== ""
      ? "    "
      : "  ";
    const label = DISPOSITION_LABEL[step.disposition].padEnd(6);
    const note = step.note !== undefined ? sink.dim(` — ${step.note}`) : "";
    groupItems.push(`${indent}${label} ${step.label}${note}`);
  }
  flush();
  if (plan.steps.length === 0) {
    groups.push({
      id: "steps-empty",
      label: "Steps",
      items: [`  ${sink.dim("(nothing to do)")}`],
    });
  }
  const rendered = renderHumanOutputGroups(groups, {
    leadingBoundary: true,
    renderLabel: (renderedGroup) =>
      renderedGroup.label === undefined
        ? undefined
        : `  ${sink.dim(renderedGroup.label)}`,
  });
  for (const line of rendered.split("\n")) sink.line(line);
}

/** A complete, renderable apply result: a titled executed-step list. */
export interface StepResultsView {
  /** Heading for the apply summary (e.g. "Standard results"). */
  title: string;
  /** Context lines shown above the steps. */
  details?: string[] | undefined;
  steps: StepResult[];
}

/** Short, human label for each executed-step outcome. */
const OUTCOME_LABEL: Record<StepOutcome, string> = {
  ok: "ok",
  failed: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
};

function stepResultNote(result: StepResult): string | undefined {
  const parts: string[] = [];
  if (result.step.note !== undefined) {
    parts.push(result.step.note);
  }

  const metadata: string[] = [];
  if (result.durationS !== undefined) {
    metadata.push(`${result.durationS}s`);
  }
  if (result.outputLines !== undefined) {
    metadata.push(
      `${result.outputLines} output line${result.outputLines === 1 ? "" : "s"}`,
    );
  }
  if (result.errorLikeLines !== undefined && result.errorLikeLines > 0) {
    metadata.push(
      `${result.errorLikeLines} diagnostic-like line${
        result.errorLikeLines === 1 ? "" : "s"
      }`,
    );
  }
  if (result.outputPath !== undefined) {
    metadata.push(`output: ${result.outputPath}`);
  }
  if (metadata.length > 0) {
    parts.push(metadata.join(", "));
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

/**
 * Render executed steps as a per-step listing — the apply-mode mirror of
 * {@link renderPlan}. Named groups keep their label; unnamed steps use "Steps".
 */
export function renderStepResults(
  sink: RenderSink,
  view: StepResultsView,
): void {
  sink.heading(view.title);
  const details = view.details ?? [];
  const groups: HumanOutputGroup<string>[] = details.length === 0 ? [] : [{
    id: "context",
    label: "Context",
    items: details.map((detail) => `  ${sink.dim(detail)}`),
  }];
  let group: string | undefined;
  let groupItems: string[] = [];
  const flush = (): void => {
    if (groupItems.length === 0) return;
    const namedGroup = group !== undefined && group !== "";
    groups.push({
      id: namedGroup ? `steps:${group}` : "steps",
      label: namedGroup ? group : "Steps",
      items: groupItems,
    });
    groupItems = [];
  };
  for (const result of view.steps) {
    const step = result.step;
    if (step.group !== group) {
      flush();
      group = step.group;
    }
    const indent = step.group !== undefined && step.group !== ""
      ? "    "
      : "  ";
    const label = OUTCOME_LABEL[result.outcome].padEnd(8);
    const detail = stepResultNote(result);
    const note = detail !== undefined ? sink.dim(` - ${detail}`) : "";
    groupItems.push(`${indent}${label} ${step.label}${note}`);
  }
  flush();
  if (view.steps.length === 0) {
    groups.push({
      id: "steps-empty",
      label: "Steps",
      items: [`  ${sink.dim("(nothing ran)")}`],
    });
  }
  const rendered = renderHumanOutputGroups(groups, {
    leadingBoundary: true,
    renderLabel: (renderedGroup) =>
      renderedGroup.label === undefined
        ? undefined
        : `  ${sink.dim(renderedGroup.label)}`,
  });
  for (const line of rendered.split("\n")) sink.line(line);
}

// ── the JSON projections ────────────────────────────────────────────────────

/** The JSON-friendly shape of one step (the generic `--json` payloads). */
export interface PlanStepJson {
  kind: PlanStep["kind"];
  label: string;
  disposition: StepDisposition;
  note?: string | undefined;
  group?: string | undefined;
}

/** One step with its execution outcome, for the apply-mode results serialization. */
export interface StepResultJson extends PlanStepJson {
  outcome: StepOutcome;
  duration_s?: number | undefined;
  output_path?: string | undefined;
  output_lines?: number | undefined;
  error_like_lines?: number | undefined;
}

/** Reduce one step to its JSON-friendly shape. */
export function stepToJson(step: PlanStep): PlanStepJson {
  return {
    kind: step.kind,
    label: step.label,
    disposition: step.disposition,
    note: step.note,
    group: step.group,
  };
}

/** Reduce one executed step to its JSON-friendly shape. */
export function stepResultToJson(r: StepResult): StepResultJson {
  return {
    ...stepToJson(r.step),
    outcome: r.outcome,
    duration_s: r.durationS,
    output_path: r.outputPath,
    output_lines: r.outputLines,
    error_like_lines: r.errorLikeLines,
  };
}

/** The JSON-friendly shape of a whole plan (the `--dry-run` payload). */
export interface PlanJson {
  title: string;
  details: string[];
  steps: PlanStepJson[];
}

/** Reduce a plan to its JSON-friendly shape (no results — the dry-run payload). */
export function planToJson(plan: EnginePlan): PlanJson {
  return {
    title: plan.title,
    details: plan.details,
    steps: plan.steps.map(stepToJson),
  };
}

/**
 * Serialize (plan, results) into the legacy generic apply-mode shape `{ok, steps}`.
 * Retained for the verbs not yet migrated to a {@link DiscernResult}; new code
 * should build a {@link DiscernResult} and serialize that instead.
 */
export function resultsToJson(results: StepResult[]): {
  ok: boolean;
  steps: StepResultJson[];
} {
  return {
    ok: results.every((r) => r.outcome !== "failed"),
    steps: results.map(stepResultToJson),
  };
}

// ── envelope constructors ───────────────────────────────────────────────────

/**
 * A preview (dry-run) result: the plan that WOULD run, nothing executed. Carries
 * `plan` and no `steps`, the structural signal that nothing acted.
 */
export function previewResult(
  verb: string,
  plan: EnginePlan,
): DiscernResult<never> {
  return { ok: true, verb, dry_run: true, plan };
}

/**
 * An applied result: the steps that ran (ok when none failed), with optional
 * diagnostics. The single place the "ok = no step failed" rule lives, so every
 * plan/apply verb agrees on it.
 */
export function appliedResult(
  verb: string,
  results: StepResult[],
  diagnostics?: Diagnostic[],
): DiscernResult<never> {
  return {
    ok: results.every((r) => r.outcome !== "failed"),
    verb,
    steps: results,
    diagnostics: diagnostics !== undefined && diagnostics.length > 0
      ? diagnostics
      : undefined,
  };
}
