/**
 * The shared vocabulary hint definitions draw on: the entry shape, its
 * classification and follow-through types, the command references hints cite
 * most, and the wording cores that several catalogs complete. Catalog
 * modules beside this one hold the entries; `../hints.ts` composes them into
 * the one registry every emission site fires from.
 */

import { markdownCodeSpan } from "../markdown_code.ts";
import {
  discernCommand,
  flag,
  ownerDiscernCommand,
  positional,
} from "../command_reference.ts";

/**
 * Shared references for the commands hints cite most. Each is one token
 * rendered per surface at delivery; a template interpolates it instead of
 * spelling the command as prose.
 */
export const CMD = {
  done: discernCommand("done"),
  doneCi: discernCommand("done", flag("ci")),
  prepare: discernCommand("prepare"),
  test: discernCommand("test"),
  update: discernCommand("update"),
  refresh: discernCommand("refresh"),
  accept: discernCommand("accept"),
  status: discernCommand("status"),
  statusFull: discernCommand("status", flag("verbose"), flag("json")),
  start: discernCommand("start"),
  setupDone: discernCommand("setup done"),
} as const;

/** The owner's Proof retrieval command — CLI-spelled on every surface because
 * the executor is the human owner at a terminal, never the reading agent. */
export const OWNER_STATUS_VERBOSE = ownerDiscernCommand(
  "status",
  flag("verbose"),
);

/**
 * How an entry means to steer the caller. `next-step` names the action to
 * take from here; `guardrail` states a rule protecting shared state before
 * it is broken; `owner-attention` identifies a decision or supervisory concern
 * that belongs to the owner and remains observational for the reading agent;
 * `notice` discloses a condition the caller should weigh but need not act on.
 */
export type HintCategory =
  | "next-step"
  | "guardrail"
  | "owner-attention"
  | "notice";

/**
 * Semantic audience and interactive-terminal suppression, not format routing.
 * Every entry reaches JSON, Markdown, and MCP. `all` also reaches the terminal;
 * `agent` is suppressed there, while `owner` reserves an external effect or
 * decision for the human owner. Projection reads this field, never rendered prose.
 */
export type HintAudience = "all" | "agent" | "owner";

/**
 * A data-only declaration of what observable action a delivered hint invites.
 * The logbook reader interprets these shapes; shared hint definitions carry no
 * detector functions or engine imports.
 */
export type HintFollowThroughRule =
  | Readonly<{
    family: string;
    kind: "branch-action-before-boundary";
    actionVerbs: readonly string[];
    boundaryVerb: string;
  }>
  | Readonly<{
    family: string;
    kind: "session-action-before-repeat";
    actionVerb: string;
  }>
  | Readonly<{
    family: string;
    kind: "main-session-start-before-dirty";
    actionVerb: string;
  }>
  | Readonly<{
    /** A checkpoint serving invites a relevant in-scope revision before its
     * declaration. Episodes come from the events' recorded checkpoint
     * observations — per checkpoint id, so every configured checkpoint
     * (present and future) enrols without naming itself anywhere: a serving
     * opens an episode, a declaration after a relevant revision resolves it
     * followed, one on the unchanged subject resolves it not followed, and a
     * missing block, a missing revision flag, or the end of history censors. */
    family: string;
    kind: "checkpoint-revision-before-declaration";
  }>;

/** One registered hint: a stable id, its classification, and a typed template. */
export interface HintDef<P = undefined> {
  /** Stable kebab-case identifier — the logbook, renderers, and tests key on it. */
  readonly id: string;
  readonly category: HintCategory;
  readonly audience: HintAudience;
  /**
   * The one surface this entry can be delivered on, when it has one. `mcp`
   * marks an entry only the MCP server fires; its prose may name MCP tools,
   * and the CLI-rendering guard exempts it. Absent means both surfaces.
   */
  readonly delivery?: "mcp";
  /** One-line emitting condition shown in the generated inventory. */
  readonly when?: string;
  /**
   * Groups variants of one underlying fact (the restart-session family, the
   * generated-file-drift family) so wording reviews see them side by side.
   */
  readonly family?: string;
  /** Optional observable-outcome declaration for the advisory logbook reader. */
  readonly followThrough?: HintFollowThroughRule;
  /** Realistic placeholder parameters for validation and generated inventory. */
  readonly example: P;
  /** Renders the hint from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
  /** Optional interactive-terminal wording for the same facts. Serialized
   * results keep the canonical template; terminal renderers use this projection
   * when structured field names would make the instruction less useful there. */
  readonly interactiveTemplate?: ((params: P) => string) | undefined;
}

/** Identity helper so an entry's parameter type is inferred at the definition. */
export function defineHint<P = undefined>(def: HintDef<P>): HintDef<P> {
  return def;
}

export const STATUS_BRANCH_UPDATE_FOLLOW_THROUGH = Object.freeze(
  {
    family: "branch-update",
    kind: "session-action-before-repeat",
    actionVerb: "update",
  } as const satisfies HintFollowThroughRule,
);

const RED_GATE_FOLLOW_THROUGH = Object.freeze(
  {
    family: "red-gate-remedy",
    kind: "branch-action-before-boundary",
    actionVerbs: Object.freeze(["prepare"] as const),
    boundaryVerb: "done",
  } as const satisfies HintFollowThroughRule,
);

export const MAIN_WORKTREE_FOLLOW_THROUGH = Object.freeze(
  {
    family: "main-worktree-first",
    kind: "main-session-start-before-dirty",
    actionVerb: "start",
  } as const satisfies HintFollowThroughRule,
);

export const CHECKPOINT_DECLARATION_FOLLOW_THROUGH = Object.freeze(
  {
    family: "checkpoint-declaration",
    kind: "checkpoint-revision-before-declaration",
  } as const satisfies HintFollowThroughRule,
);

/**
 * A gate-failure remedy that prescribes the prepare inner loop carries the
 * family's declared outcome rule; a remedy prescribing another action (refresh,
 * update, a reproduce command) declares none, so the follow-through detector
 * never scores a hint against an action its text did not ask for. The parity
 * guard in `tests/patterns_test.ts` derives the split from each entry's own
 * rendered text, so a reworded remedy enrols or retires itself.
 */
export function defineGateFailureRemedyHint<P = undefined>(
  def: HintDef<P> & { readonly family: "gate-failure-remedy" },
): HintDef<P> {
  return defineHint({ ...def, followThrough: RED_GATE_FOLLOW_THROUGH });
}

/** Optional diagnostic reason rendered in the existing parenthesized form. */
export function reasonSuffix(reason: string | undefined): string {
  return reason === undefined ? "" : ` (${reason})`;
}

/** Append full-list commands to an update summary without adding pagination hints. */
export function updateOverflowAdvice(
  filesRange: string | undefined,
  commitsRange: { before: string; main: string } | undefined,
): string {
  const actions: string[] = [];
  if (filesRange !== undefined) {
    actions.push(
      `Use \`git diff --stat ${filesRange}\` for the full file list and ` +
        `\`git diff ${filesRange} -- <path>\` for one file.`,
    );
  }
  if (commitsRange !== undefined) {
    actions.push(
      `Use \`git log --oneline ${commitsRange.before}..${commitsRange.main}\` ` +
        `for the full commit list.`,
    );
  }
  return actions.length === 0 ? "" : ` ${actions.join(" ")}`;
}

/** Shared non-negotiable action for every unfinished-setup context. */
const SETUP_UNFINISHED_CORE =
  "Setup is incomplete. Stay in this agent session and finish the setup brief before reporting or stopping. " +
  `Run ${discernCommand("setup begin")} to print or ` +
  "reprint it without changing your work, complete every step, then run " +
  `${CMD.setupDone}. Report setup complete only after ${CMD.setupDone} ` +
  "passes.";

/** Append one context-specific reason to the canonical unfinished-setup action. */
export function setupUnfinishedHint(context: string): string {
  return `${SETUP_UNFINISHED_CORE} ${context}`;
}

/** Shared remedy for every missing or stale discern-managed artifact. */
const GENERATED_DRIFT_CORE =
  `Run ${CMD.refresh} to restore discern-managed artifacts.`;

/** Add one artifact-specific context and optional source-ownership instruction. */
export function generatedDriftHint(context: string, followUp?: string): string {
  return `${GENERATED_DRIFT_CORE} ${context}${
    followUp === undefined ? "" : ` ${followUp}`
  }`;
}

/**
 * How content a tool maintains reaches every agent file: through a source the
 * compile reads and a generator discern reruns. One sentence, completing "If a
 * tool maintains them," or any lead-in that names the tool.
 */
export const TOOL_SOURCE_REDIRECT =
  "configure that tool to write into a file listed in " +
  "`[instructions].sources`, and declare that file under " +
  "`[generated.<name>]` with the tool's regenerate command as `run`; " +
  `${
    discernCommand("docs", positional("target", "config-reference"))
  } describes both tables.`;

/**
 * Where agent-file lines that no instruction source produces can live. The
 * gate, status, and refresh each meet such lines and offer the same three
 * choices; `otherwise` completes the last one in the caller's tense.
 */
export function unsourcedAgentLineChoices(otherwise: string): string {
  return "If you wrote them, move them into a file listed in " +
    `\`[instructions].sources\`. If a tool maintains them, ${TOOL_SOURCE_REDIRECT} ` +
    `Otherwise, ${otherwise}`;
}

/** Shared lifecycle fact behind every restart-session action. */
const RESTART_SESSION_CORE =
  "An open agent session does not discover a newly registered or upgraded discern " +
  "MCP server automatically. Restarting the session or reloading its MCP servers " +
  "loads the current server, engine, and templates.";

/** Add one context-specific restart action to the canonical lifecycle fact. */
export function restartSessionHint(leadIn: string): string {
  return `${leadIn} ${RESTART_SESSION_CORE}`;
}

/** Render exact TOML root-section names for config recovery prose. */
export function rootSectionList(sections: readonly string[]): string {
  return sections.map((section) => markdownCodeSpan(`[${section}]`)).join(
    ", ",
  );
}

/** The check-stage remedy: prepare re-runs the fixers and checks in seconds. */
export const GATE_PREPARE_REMEDY_CORE =
  "Fix the problems in the diagnostics; each carries its reproduce command. " +
  `Iterate with ${CMD.prepare}, the fast fix-then-check ` +
  `loop. Re-run ${CMD.done} only once ${CMD.prepare} is green: every red ` +
  `${CMD.done} pays for the full gate, tests included.`;

/** The test-stage remedy: reproduce narrowly, then run the final Gate. */
export const GATE_TEST_REMEDY_CORE =
  "Fix the failing tests with each diagnostic's reproduce command. " +
  `Use ${CMD.test} only when the complete test stage is the intended ` +
  `standalone result. Commit the final tree, then run ${CMD.done}; it runs ` +
  `the complete test stage.`;

/** The combined-stage remedy names the narrow loop for each half. */
export const GATE_CHECK_TEST_REMEDY_CORE =
  `Fix the problems in the diagnostics. Use ${CMD.prepare} for fix and ` +
  `check failures, and use each test diagnostic's reproduce command for ` +
  `test failures. Commit the final tree, then run ${CMD.done}; it runs the ` +
  `complete test stage.`;

/** The remedy for stages no narrower loop re-checks (build, scope gates):
 * the diagnostic's own reproduce command is the iteration. */
export const GATE_REPRODUCE_REMEDY_CORE =
  "Fix the problems in the diagnostics and confirm with each diagnostic's " +
  `reproduce command, then re-run ${CMD.done}.`;

/** Runtime facts needed to render a generated-artifact drift remedy. */
export interface GeneratedDriftRemedyParams {
  /** The `<name>` from the failed `[generated.<name>]` group. */
  readonly group: string;
  /** The resolved command declared by that group's `run`. */
  readonly run: string;
}

/** Runtime facts needed when generator output escaped every declared glob. */
export interface GeneratedUndercoverageRemedyParams {
  /** Candidate `<name>` values from the Build group, in declaration order. */
  readonly groups: readonly string[];
}

/** Maximum names rendered in one hint summary. */
export const HINT_NAME_CAP = 3;

/** Render a bounded name sample while preserving the class's full count. */
export function boundedNameSummary(
  total: number,
  names: readonly string[],
): string {
  const shown = names.slice(0, HINT_NAME_CAP);
  const remaining = Math.max(0, total - shown.length);
  return `${shown.join(", ")}${
    remaining > 0 ? `, … (+${remaining} more)` : ""
  }`;
}
