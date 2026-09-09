/**
 * Authored Markdown presentations for serialized Discern results.
 *
 * The contract presenter selects the facts that matter. This shared renderer
 * adds bounded envelope evidence and registered hints, then enforces the order
 * current state -> evidence -> authority boundary -> owner attention -> other
 * actions -> next action.
 */

import { format as formatBytes } from "@std/fmt/bytes";
import { checkpointDropMarkdown } from "./checkpoint_drops.ts";
import { withConfigExplanation } from "./config_explain.ts";
import * as view from "./docs_presentation.ts";
import { firedHintsFromTexts, type HintCategory, HINTS } from "./hints.ts";
import { productSentence } from "./product_sentence.ts";
import { sampleDiagnostics } from "./diagnostic_summary.ts";
import {
  boolean,
  code,
  number,
  object,
  records,
  strings,
  text,
  unique,
  uniqueVerbatim,
  verbatimText,
} from "./result_markdown_values.ts";
import { notApplicableCountLabel } from "./setup_assurance.ts";
import { describeEnvironmentProbe } from "./environment_probe.ts";
import {
  CompletionAssuranceSchema,
  describeCompletionAssurance,
} from "./completion_assurance_read.ts";

export interface ResultMarkdownPresentation {
  /** One authored statement of the current result state. */
  state: string;
  /** Contract-selected, bounded facts supporting that state. */
  evidence?: readonly string[] | undefined;
  /** Authored Markdown that must remain intact, such as a requested document. */
  supportingMarkdown?: readonly string[] | undefined;
  /** Authority, consent, or stop conditions that constrain the next move. */
  boundary?: readonly string[] | undefined;
  /** Decisions or supervision that belong to the owner, not the reading agent. */
  ownerAttention?: readonly string[] | undefined;
  /** Contract-specific actions. Registered next-step hints follow these. */
  action?: readonly string[] | undefined;
}

/** One authored projection chosen by a registered result contract. */
export type ResultMarkdownPresenter = (
  result: Readonly<Record<string, unknown>>,
) => ResultMarkdownPresentation;

const MAX_LIST_ITEMS = 6;
const MAX_DIAGNOSTICS = 3;
const MAX_DIAGNOSTIC_OUTPUT = 2_400;
const MAX_DIAGNOSTIC_MESSAGE = 900;

/** The state lead shared by every effectful Markdown preview. */
export const RESULT_MARKDOWN_DRY_RUN_LEAD = "**Dry run: nothing changed.**";

/** Read the result's data object, or an empty object for a data-less result. */
function dataOf(
  result: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return object(result.data) ?? {};
}

/** Shared config-issue payload carried by any verb whose config load refused. */
function configIssuesOf(
  result: Readonly<Record<string, unknown>>,
): Record<string, unknown>[] {
  return result.error === "invalid_config"
    ? records(dataOf(result).issues)
    : [];
}

/** Render the canonical CLI name for a serialized verb. */
function commandName(result: Readonly<Record<string, unknown>>): string {
  const verb = text(result.verb) ?? "result";
  return verb === "discern" ? "discern" : `discern ${verb}`;
}

/** Render a counted noun with its singular or plural form. */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The one bounded-list overflow sentence, so every count agrees with its noun. */
function omitted(count: number, noun: string): string {
  return `${plural(count, `additional ${noun}`)} omitted.`;
}

/** Render one elapsed span at a readable unit instead of raw milliseconds. */
function duration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1_000;
  if (seconds < 90) {
    return `${
      seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10
    } s`;
  }
  const minutes = seconds / 60;
  if (minutes < 90) {
    return `${Math.round(minutes)} min`;
  }
  return `${Math.round(minutes / 60 * 10) / 10} h`;
}

/** Render a bounded comma-separated list of code spans. */
function boundedCodes(values: readonly string[]): string {
  const shown = values.slice(0, MAX_LIST_ITEMS).map(code);
  const overflow = values.length - shown.length;
  return `${shown.join(", ")}${overflow > 0 ? `, plus ${overflow} more` : ""}`;
}

/** Render one labeled list fact when it has values. */
function listFact(
  label: string,
  values: readonly string[],
): string | undefined {
  return values.length === 0 ? undefined : `${label}: ${boundedCodes(values)}.`;
}

/** Select the result message or the standard state sentence. */
function defaultState(
  result: Readonly<Record<string, unknown>>,
  success?: string,
): string {
  const command = code(commandName(result));
  if (result.dry_run === true && result.ok === true) {
    return `${command} would proceed as described below.`;
  }
  const message = text(result.message);
  if (message !== undefined) {
    return message;
  }
  if (result.ok === true) {
    return success ?? `${command} completed successfully.`;
  }
  const error = text(result.error);
  return error === undefined
    ? `${command} failed.`
    : `${command} failed with ${code(error)}.`;
}

/**
 * State one grant's coverage gap in scope vocabulary. Grants are written in
 * scopes, so the mismatch reads in scopes; a handful of stragglers is named
 * outright, and generated paths collapse to a count either way. With no
 * recorded grant the conversation sentence already covers the whole tree, so
 * there is nothing to enumerate.
 */
function coverageGap(authority: Record<string, unknown>): string | undefined {
  const standing = strings(authority.standing_scopes);
  const entries = records(authority.uncovered);
  const total = number(authority.uncovered_total) ?? entries.length;
  if (standing.length === 0 || total === 0) {
    return undefined;
  }
  const grant = standing.map(code).join(", ");
  const generatedTotal = number(authority.uncovered_generated_total) ??
    entries.filter((entry) => entry.generated === true).length;
  if (total <= MAX_LIST_ITEMS) {
    const authored = entries
      .filter((entry) => entry.generated !== true)
      .map((entry) => text(entry.path))
      .filter((path): path is string => path !== undefined);
    const listed = [
      ...(authored.length > 0 ? [authored.map(code).join(", ")] : []),
      ...(generatedTotal > 0 ? [plural(generatedTotal, "generated file")] : []),
    ].join(", plus ");
    return `Outside the ${grant} grant: ${listed}.`;
  }
  const scopes = strings(authority.uncovered_scopes);
  const unscopedTotal = number(authority.uncovered_unscoped_total) ??
    entries.filter((entry) => strings(entry.scopes).length === 0).length;
  const touched = [
    ...(scopes.length > 0
      ? [
        `scope${scopes.length === 1 ? "" : "s"} ${scopes.map(code).join(", ")}`,
      ]
      : []),
    ...(unscopedTotal > 0
      ? [`${plural(unscopedTotal, "path")} matching no scope`]
      : []),
  ].join(" and ");
  return `The standing grant covers ${grant}. This change also touches ${touched} — ${
    plural(total, "changed file")
  }${generatedTotal > 0 ? ` (${generatedTotal} generated)` : ""}.`;
}

/** Project one landing-authority object into explicit boundary statements. */
function landingBoundary(data: Record<string, unknown>): string[] {
  const authority = object(data.landing_authority);
  if (authority === undefined) {
    return [];
  }
  const kind = text(authority.kind);
  const warnings = strings(authority.warnings);
  if (kind === "conversation-required") {
    return unique([
      "Landing requires approval from the current conversation.",
      coverageGap(authority),
      ...warnings,
    ]);
  }
  if (kind === "authorized") {
    const source = text(authority.source);
    const scopes = strings(authority.scopes);
    return unique([
      source === undefined
        ? "The current tree has recorded landing authority."
        : `Landing is authorized by ${code(source)}.`,
      listFact("Authorized scopes", scopes),
      ...warnings,
    ]);
  }
  return warnings;
}

/** Read the one-line rendering from a compact Proof. */
function proofLine(value: unknown): string | undefined {
  const proof = object(value);
  return proof === undefined ? undefined : text(proof.line);
}

/** Summarize one compact gate-Proof inspection. */
function gateProofFact(value: unknown): string | undefined {
  const proof = object(value);
  if (proof === undefined) {
    return undefined;
  }
  const status = text(proof.status);
  const reason = text(proof.reason);
  if (status === undefined) {
    return undefined;
  }
  return `Gate Proof: ${code(status)}${
    reason === undefined ? "" : ` (${reason})`
  }.`;
}

/** Read canonical CommonMark Proof-line source from a compact inspection. */
function gateProofLine(value: unknown): string | undefined {
  const proof = object(value);
  return proofLine(proof?.proof) ?? text(proof?.proof_line);
}

/** Build bounded evidence shared by every envelope contract. */
function envelopeEvidence(
  result: Readonly<Record<string, unknown>>,
): { facts: string[]; markdown: string[] } {
  const facts: string[] = [];
  const markdown: string[] = [];
  const plan = object(result.plan);
  if (plan !== undefined) {
    const steps = records(plan.steps);
    const title = text(plan.title) ?? "Plan";
    const details = strings(plan.details).slice(0, MAX_LIST_ITEMS);
    if (details.length > 0) {
      facts.push(...details);
    }
    facts.push(withDetails(
      `${title}: ${plural(steps.length, "step")}.`,
      steps.slice(0, MAX_LIST_ITEMS).map((step) => {
        const label = text(step.label) ?? "unnamed step";
        const disposition = text(step.disposition) ?? "planned";
        const note = text(step.note);
        const action = disposition === "run"
          ? "run"
          : disposition === "skip"
          ? "skip"
          : disposition === "gate"
          ? "check"
          : "plan";
        return `Would ${action} ${code(label)}${
          note === undefined ? "." : ` (${note}).`
        }`;
      }),
      steps.length - MAX_LIST_ITEMS,
      "plan step",
    ));
  }

  const stepResults = records(result.steps);
  if (stepResults.length > 0) {
    const counts = new Map<string, number>();
    for (const step of stepResults) {
      const outcome = text(step.outcome) ?? "unknown";
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    const notable = stepResults.filter((entry) => entry.outcome !== "ok");
    facts.push(withDetails(
      `Steps: ${
        [...counts.entries()].map(([outcome, count]) => `${count} ${outcome}`)
          .join(", ")
      }.`,
      notable.slice(0, MAX_LIST_ITEMS).map((step) => {
        const label = text(step.label) ?? "unnamed step";
        const outcome = text(step.outcome) ?? "unknown";
        const outputPath = text(step.output_path);
        return `${code(label)}: ${outcome}${
          outputPath === undefined ? "" : `; full output: ${code(outputPath)}`
        }.`;
      }),
      notable.length - MAX_LIST_ITEMS,
      "step",
    ));
  }

  const waitedMs = number(result.waited_ms);
  if (waitedMs !== undefined && waitedMs > 0) {
    facts.push(`Waited ${duration(waitedMs)} for an execution slot.`);
  }

  const configIssues = configIssuesOf(result);
  if (configIssues.length > 0) {
    facts.push(withDetails(
      `Config issues: ${plural(configIssues.length, "issue")}.`,
      configIssues.slice(0, MAX_LIST_ITEMS).map((issue) => {
        const path = text(issue.path) ?? "discern.toml";
        const message = text(issue.message) ?? "No issue message was recorded.";
        return `${code(path)}: ${message}`;
      }),
      configIssues.length - MAX_LIST_ITEMS,
      "config issue",
    ));
  }

  const diagnostics = records(result.diagnostics);
  const evidence = object(result.diagnostic_evidence);
  const repeats = Array.isArray(evidence?.repeats) ? evidence.repeats : [];
  const displayed = sampleDiagnostics(diagnostics, MAX_DIAGNOSTICS).map(
    (entry) => ({
      ...entry,
      count: number(repeats[diagnostics.indexOf(entry.diagnostic)]) ??
        entry.count,
    }),
  );
  if (typeof evidence?.path === "string") {
    facts.push(
      `Complete diagnostic evidence: ${code(evidence.path)} (${
        number(evidence.total) ?? diagnostics.length
      } observations).`,
    );
  }
  for (const { diagnostic, count } of displayed) {
    const tool = text(diagnostic.tool) ?? "diagnostic";
    const message = text(diagnostic.message) ??
      "No diagnostic message was recorded.";
    const file = text(diagnostic.file);
    const line = number(diagnostic.line);
    const rule = text(diagnostic.rule);
    const location = file === undefined
      ? ""
      : ` at ${code(`${file}${line === undefined ? "" : `:${line}`}`)}`;
    const reproduce = text(diagnostic.reproduce_cmd);
    const outputPath = text(diagnostic.output_path);
    facts.push(
      `${code(tool)}${location}${
        rule === undefined ? "" : ` [rule ${code(rule)}]`
      }: ${capText(message, MAX_DIAGNOSTIC_MESSAGE)}${
        reproduce === undefined ? "" : ` Reproduce with ${code(reproduce)}.`
      }${outputPath === undefined ? "" : ` Full output: ${code(outputPath)}.`}${
        count === 1 ? "" : ` Repeated ${count} times.`
      }`,
    );
  }
  const remaining = (number(evidence?.total) ?? diagnostics.length) -
    displayed.reduce((sum, entry) => sum + entry.count, 0);
  if (remaining > 0) {
    facts.push(omitted(remaining, "diagnostic"));
  }
  const firstOutput = verbatimText(displayed[0]?.diagnostic.output);
  if (firstOutput !== undefined) {
    markdown.push(
      `### First diagnostic output\n\n${
        fencedText(capText(firstOutput, MAX_DIAGNOSTIC_OUTPUT))
      }`,
    );
  }
  return { facts, markdown };
}

/** Bound one diagnostic string while retaining its head and tail. */
function capText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  const marker = `\n... ${
    plural(value.length - limit, "character")
  } omitted ...\n`;
  const remaining = limit - marker.length;
  const head = Math.max(0, Math.floor(remaining * 0.6));
  const tail = Math.max(0, remaining - head);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - tail)}`;
}

/** Fence arbitrary diagnostic text without colliding with embedded backticks. */
function fencedText(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${value}\n${fence}`;
}

/** One action item beside the hint family that groups its variants. */
interface ActionItem {
  text: string;
  family: string | undefined;
}

/** Sort fired hint prose into evidence, boundary, and action channels. */
function hintSections(
  result: Readonly<Record<string, unknown>>,
): {
  evidence: string[];
  boundary: string[];
  ownerAttention: string[];
  action: ActionItem[];
} {
  const hintTexts = strings(result.hints);
  const fired = firedHintsFromTexts(
    Array.isArray(result.hints) ? result.hints as string[] : undefined,
  );
  const defs = new Map<
    string,
    { category: HintCategory; family: string | undefined }
  >();
  for (const def of Object.values(HINTS)) {
    defs.set(def.id, { category: def.category, family: def.family });
  }
  const byText = new Map<
    string,
    { category: HintCategory; family: string | undefined }
  >();
  for (const hint of fired) {
    const def = defs.get(hint.id);
    if (def !== undefined) {
      byText.set(hint.text, def);
    }
  }
  const evidence: string[] = [];
  const boundary: string[] = [];
  const ownerAttention: string[] = [];
  const action: ActionItem[] = [];
  for (const hint of hintTexts) {
    const def = byText.get(hint);
    switch (def?.category) {
      case "notice":
        evidence.push(hint);
        break;
      case "guardrail":
        boundary.push(hint);
        break;
      case "owner-attention":
        ownerAttention.push(hint);
        break;
      case "next-step":
        action.push({ text: hint, family: def?.family });
        break;
      default:
        // An unregistered string cannot disappear from a text-only host. Put it
        // at the action boundary, the safest interpretation of advisory prose.
        action.push({ text: hint, family: undefined });
    }
  }
  return { evidence, boundary, ownerAttention, action };
}

/** Indent a multi-line item's continuation lines one list level deeper. */
function indented(item: string, depth: number): string {
  return item.replaceAll("\n", `\n${"  ".repeat(depth)}`);
}

/** Render one or several ordered presentation items. */
function renderItems(items: readonly string[]): string {
  if (items.length === 1) {
    return items[0] ?? "";
  }
  return items.map((item) => `- ${indented(item, 1)}`).join("\n");
}

/** Render a summary fact with its detail rows nested beneath it. */
function withDetails(
  summary: string,
  details: readonly string[],
  overflow: number,
  noun: string,
): string {
  const rows = [
    ...details,
    ...(overflow > 0 ? [omitted(overflow, noun)] : []),
  ];
  return [summary, ...rows.map((row) => `- ${indented(row, 1)}`)].join("\n");
}

/** Render secondary actions, nesting each hint family's variants under its head. */
function renderOtherActions(items: readonly ActionItem[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0]?.text ?? "";
  }
  const groups: { text: string; children: string[] }[] = [];
  const byFamily = new Map<string, { text: string; children: string[] }>();
  for (const { text, family } of items) {
    const head = family === undefined ? undefined : byFamily.get(family);
    if (head !== undefined) {
      head.children.push(text);
      continue;
    }
    const group = { text, children: [] as string[] };
    if (family !== undefined) {
      byFamily.set(family, group);
    }
    groups.push(group);
  }
  const deferred = groups.map((group) =>
    [
      `- ${indented(group.text, 1)}`,
      ...group.children.map((child) => `  - ${indented(child, 2)}`),
    ].join("\n")
  ).join("\n");
  return deferred;
}

/** Project typed optional degradations without asking a verb presenter to parse them. */
function completionAdvisorySections(
  result: Readonly<Record<string, unknown>>,
): { evidence: string[]; action: ActionItem[] } {
  const evidence: string[] = [];
  const action: ActionItem[] = [];
  for (const advisory of records(result.advisories)) {
    const kind = text(advisory.kind);
    const details = strings(advisory.evidence);
    const next = text(advisory.next_action);
    if (kind !== undefined && details.length > 0) {
      evidence.push(
        `Advisory ${code(kind)}: ${details.join("; ")}`,
      );
    }
    if (next !== undefined) {
      action.push({
        text: next,
        family: `completion-advisory:${kind ?? "unknown"}`,
      });
    }
  }
  return { evidence, action };
}

/** Render one contract's authored projection in the fixed agent-reading order. */
export function renderResultMarkdown(
  result: Readonly<Record<string, unknown>>,
  presenter: ResultMarkdownPresenter,
): string {
  // A config-load refusal occurs before the selected verb can produce its own
  // data. Use the universal envelope state instead of asking (for example) the
  // status presenter to interpret config issues as status facts.
  const presented = configIssuesOf(result).length > 0
    ? presentEnvelope(result)
    : presenter(result);
  const envelope = envelopeEvidence(result);
  const hints = hintSections(result);
  const advisories = completionAdvisorySections(result);
  const evidence = unique([
    ...(presented.evidence ?? []),
    ...envelope.facts,
    ...advisories.evidence,
    ...hints.evidence,
  ]);
  const supporting = uniqueVerbatim([
    ...(presented.supportingMarkdown ?? []),
    ...envelope.markdown,
  ]);
  const boundary = unique([
    ...(presented.boundary ?? []),
    ...hints.boundary,
  ]);
  const ownerAttention = unique([
    ...(presented.ownerAttention ?? []),
    ...hints.ownerAttention,
  ]);
  const seenActions = new Set<string>();
  const action: ActionItem[] = [];
  for (
    const item of [
      ...(presented.action ?? []).map((text) => ({
        text,
        family: undefined,
      })),
      ...advisories.action,
      ...hints.action,
    ]
  ) {
    const trimmed = item.text.trim();
    if (trimmed === "" || seenActions.has(trimmed)) {
      continue;
    }
    seenActions.add(trimmed);
    action.push({ text: trimmed, family: item.family });
  }
  const state = presented.state.trim();
  const stateAccount = result.dry_run === true
    ? `${RESULT_MARKDOWN_DRY_RUN_LEAD}\n\n${state}`
    : state;
  const sections = [
    `# ${code(commandName(result))}`,
    `## Current state\n\n${stateAccount}`,
  ];
  if (evidence.length > 0 || supporting.length > 0) {
    const evidenceParts = [
      ...(evidence.length === 0 ? [] : [renderItems(evidence)]),
      ...supporting,
    ];
    sections.push(`## Evidence\n\n${evidenceParts.join("\n\n")}`);
  }
  if (boundary.length > 0) {
    sections.push(`## Authority and boundaries\n\n${renderItems(boundary)}`);
  }
  if (ownerAttention.length > 0) {
    sections.push(`## Owner attention\n\n${renderItems(ownerAttention)}`);
  }
  if (action.length > 0) {
    const [primary, ...other] = action;
    if (other.length > 0) {
      sections.push(`## Other actions\n\n${renderOtherActions(other)}`);
    }
    if (primary !== undefined) {
      sections.push(`## Next action\n\n${primary.text}`);
    }
  }
  return `${sections.join("\n\n")}\n`;
}

const presentEnvelope: ResultMarkdownPresenter = (result) => ({
  state: defaultState(result),
});

const presentSetup: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const project = object(data.project);
  const progress = object(data.progress);
  const instructionRefresh = object(data.instruction_refresh);
  const plan = records(data.plan);
  const action = result.error === "awaiting_consent"
    ? undefined
    : text(data.next_action) ?? text(data.command);
  const instructions = uniqueVerbatim([
    verbatimText(data.agent_instructions),
    verbatimText(data.human_relay),
    verbatimText(data.instructions),
    verbatimText(data.human_framing),
  ]).map((value) => `### Setup instructions\n\n${value}`);
  return {
    state: defaultState(result),
    evidence: unique([
      text(data.phase) === undefined
        ? undefined
        : `Setup phase: ${code(data.phase)}.`,
      text(project?.slug) === undefined
        ? undefined
        : `Project: ${code(project?.slug)}.`,
      plan.length === 0
        ? undefined
        : `Setup plan: ${plural(plan.length, "file operation")}.`,
      progress === undefined
        ? undefined
        : listFact("Pending setup markers", strings(progress.pending_markers)),
      listFact(
        result.dry_run === true ? "Would write" : "Written files",
        strings(data.written),
      ),
      listFact(
        result.dry_run === true ? "Would compile agent files" : "Agent files",
        strings(instructionRefresh?.compiled),
      ),
      text(instructionRefresh?.status) === undefined
        ? undefined
        : `Instruction refresh: ${code(instructionRefresh?.status)}.`,
    ]),
    supportingMarkdown: instructions,
    action: action === undefined ? [] : [action],
  };
};

const presentSetupVerify: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const findings = object(data.findings);
  const git = object(findings?.git);
  const conflicts = records(data.conflicts);
  const next = text(data.next_action);
  const instructions = verbatimText(data.instructions);
  return {
    state: defaultState(
      result,
      `Setup preflight is ${
        boolean(data.ready) === false ? "not ready" : "ready"
      }.`,
    ),
    evidence: unique([
      text(data.phase) === undefined
        ? undefined
        : `Setup phase: ${code(data.phase)}.`,
      git === undefined
        ? undefined
        : `Git repository: ${
          boolean(git.repo) === true ? "yes" : "no"
        }; clean: ${boolean(git.clean) === true ? "yes" : "no"}; identity: ${
          boolean(git.identity) === true ? "available" : "missing"
        }.`,
      conflicts.length === 0
        ? undefined
        : `Preflight found ${
          plural(conflicts.length, "condition")
        } to account for.`,
      ...conflicts.slice(0, MAX_LIST_ITEMS).map((entry) => text(entry.detail)),
    ]),
    supportingMarkdown: instructions === undefined
      ? []
      : [`### Consent instructions\n\n${instructions}`],
    action: next === undefined ? [] : [next],
  };
};

const presentSetupStep: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const spine = object(data.spine) ?? {};
  const title = text(data.title);
  const instructions = verbatimText(data.instructions);
  const phase = text(spine.phase);
  const stableTarget = text(spine.stable_target);
  const authority = strings(spine.authority_boundaries);
  const stops = strings(spine.stop_conditions);
  const recovery = strings(spine.recovery);
  return {
    state: defaultState(
      result,
      `${
        number(data.step) === undefined
          ? "Setup step"
          : `Setup step ${number(data.step)}`
      }${title === undefined ? "" : `, ${title}`}, is ready to follow.`,
    ),
    evidence: unique([
      phase === undefined ? undefined : `Phase: ${phase}`,
      stableTarget === undefined ? undefined : `Stable target: ${stableTarget}`,
      text(spine.intent),
      listFact("Inspect before acting", strings(spine.files_to_read)),
      ...strings(spine.must_do),
      text(spine.completion_check) === undefined
        ? undefined
        : `Completion check: ${text(spine.completion_check)}`,
    ]),
    supportingMarkdown: [
      ...(instructions === undefined
        ? []
        : [`### Step instructions\n\n${instructions}`]),
    ],
    boundary: unique([
      ...authority.map((item) => `Authority: ${item}`),
      ...strings(spine.what_not_to_do),
      ...stops.map((item) => `Stop: ${item}`),
    ]),
    action: unique([
      ...recovery.map((item) => `Recovery: ${item}`),
      text(spine.next_action) === undefined
        ? undefined
        : text(spine.next_action),
    ]),
  };
};

const presentSetupDone: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const assurance = object(data.assurance);
  const environmentProbe = object(data.environment_probe);
  const completion = CompletionAssuranceSchema.safeParse(
    object(assurance?.completion),
  );
  const inventory = object(data.inventory);
  const landing = object(data.landing);
  const reactivation = object(data.reactivation);
  const improvement = object(data.optional_improvement);
  const unproven = text(data.setup_completion) === "unproven";
  const unmet = records(data.unmet);
  const instructions = verbatimText(data.instructions);
  const activation = records(reactivation?.per_agent).flatMap((agent) =>
    unique([text(agent.step)])
  );
  const action = unproven
    ? []
    : boolean(landing?.on_target) === false
    ? unique([text(landing?.command)])
    : unique([
      ...activation,
      text(improvement?.command) === undefined
        ? undefined
        : `After activation succeeds, optionally run ${
          code(improvement?.command)
        }.`,
    ]);
  return {
    state: defaultState(
      result,
      unproven
        ? "discern setup was recorded without gate Proof."
        : "discern setup is complete.",
    ),
    evidence: unique([
      assurance === undefined
        ? undefined
        : `Applicable protections: ${number(assurance.enforced) ?? 0} of ${
          number(assurance.total) ?? 0
        } enforced; ${
          notApplicableCountLabel(number(assurance.not_applicable) ?? 0)
        }; verdict ${code(assurance.verdict)}.`,
      `Gate proven: ${boolean(data.gate_proven) === true ? "yes" : "no"}.`,
      `Worktree proven: ${
        boolean(data.worktree_proven) === true ? "yes" : "no"
      }.`,
      ...(completion.success
        ? describeCompletionAssurance(completion.data)
        : []),
      environmentProbe === undefined ? undefined : describeEnvironmentProbe({
        proven: strings(environmentProbe.proven),
        undeclared: strings(environmentProbe.undeclared),
      }),
      gateProofFact(data.proof),
      inventory === undefined
        ? undefined
        : `Map regions: ${
          number(object(inventory.map_regions)?.count) ?? 0
        }; ledger items: ${
          number(object(inventory.ledger_items)?.count) ?? 0
        }.`,
      inventory === undefined
        ? undefined
        : `Jobs — enforced: ${
          strings(object(inventory.jobs)?.enforced).join(", ") || "none"
        }; deferred: ${
          strings(object(inventory.jobs)?.deferred).join(", ") || "none"
        }; absent: ${
          strings(object(inventory.jobs)?.absent).join(", ") || "none"
        }; do not apply: ${
          strings(object(inventory.jobs)?.not_applicable).join(", ") || "none"
        }.`,
      listFact("Leftover setup markers", strings(data.leftover)),
      ...unmet.slice(0, MAX_LIST_ITEMS).map((check) => {
        const step = number(check.step);
        const describe = text(check.describe) ?? "Unmet setup check.";
        return `${
          step === undefined ? "Setup check" : `Step ${step}`
        }: ${describe}`;
      }),
      unmet.length > MAX_LIST_ITEMS
        ? omitted(unmet.length - MAX_LIST_ITEMS, "setup check")
        : undefined,
    ]),
    supportingMarkdown: uniqueVerbatim([
      gateProofLine(data.proof),
      instructions === undefined
        ? undefined
        : `### Completion instructions\n\n${instructions}`,
    ]),
    action,
  };
};

const presentSetupAccept: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const landed = boolean(data.landed);
  const reactivation = object(data.reactivation);
  const improvement = object(data.optional_improvement);
  return {
    state: defaultState(
      result,
      landed === true
        ? `The setup branch landed on ${code(data.target)}.`
        : "The setup landing preview is ready.",
    ),
    evidence: unique([
      text(data.branch) === undefined
        ? undefined
        : `Branch: ${code(data.branch)}.`,
      text(data.target) === undefined
        ? undefined
        : `Target: ${code(data.target)}.`,
      `Fast-forward: ${boolean(data.fast_forward) === true ? "yes" : "no"}.`,
      gateProofFact(data.proof),
      text(data.validated_commit) === undefined
        ? undefined
        : `Validated commit: ${code(data.validated_commit)}.`,
      `Merge validated: ${
        boolean(data.merge_validated) === true ? "yes" : "no"
      }.`,
      `Local agent artifacts converged: ${
        boolean(data.local_artifacts_converged) === true ? "yes" : "no"
      }.`,
      landed === true
        ? `Branch deleted: ${
          boolean(data.branch_deleted) === true ? "yes" : "no"
        }.`
        : undefined,
      landed === true ? text(data.activation_context) : undefined,
    ]),
    supportingMarkdown: uniqueVerbatim([gateProofLine(data.proof)]),
    action: landed !== true ? [] : unique([
      ...records(reactivation?.per_agent).flatMap((agent) =>
        unique([text(agent.step)])
      ),
      text(improvement?.command) === undefined
        ? undefined
        : `After activation succeeds, optionally run ${
          code(improvement?.command)
        }.`,
    ]),
  };
};

const presentUpgrade: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const schema = object(data.schema);
  const instructionRefresh = object(data.instruction_refresh);
  return {
    state: defaultState(result),
    evidence: unique([
      schema === undefined
        ? undefined
        : `Schema: recorded ${number(schema.recorded) ?? "none"}; current ${
          number(schema.current) ?? "unknown"
        }.`,
      `Pending migrations: ${records(data.pending_migrations).length}.`,
      `${
        result.dry_run === true
          ? "Would apply migrations"
          : "Applied migrations"
      }: ${records(data.migrations_applied).length}.`,
      listFact(
        result.dry_run === true ? "Planned changes" : "Changes",
        strings(data.changes),
      ),
      listFact(
        result.dry_run === true
          ? "Would generate agent files"
          : "Generated agent files",
        strings(instructionRefresh?.compiled),
      ),
      text(instructionRefresh?.status) === undefined
        ? undefined
        : `Instruction refresh: ${code(instructionRefresh?.status)}.`,
    ]),
  };
};

const presentUninstall: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const worktrees = strings(data.worktrees);
  const resources = strings(data.resources);
  const removed = result.dry_run === true ? "Would remove" : "Removed";
  const removedGitConfig = strings(data.removed_git_config);
  const keptGitConfig = strings(data.kept_git_config);
  return {
    state: defaultState(result),
    evidence: unique([
      listFact(removed, strings(data.removed)),
      listFact(
        result.dry_run === true
          ? "Would strip from shared files"
          : "Stripped from shared files",
        strings(data.stripped),
      ),
      listFact(
        result.dry_run === true
          ? "Would keep user content"
          : "Kept user content",
        strings(data.kept),
      ),
      listFact(`${removed} local Git configuration`, removedGitConfig),
      listFact("Retained local Git configuration", keptGitConfig),
      listFact("Retained local Git refs", strings(data.retained_refs)),
      listFact("Optional ref cleanup", strings(data.optional_cleanup)),
      text(data.binary_hint),
    ]),
    boundary: unique([
      listFact("Active worktrees block uninstall", worktrees),
      listFact("Provisioned resources block uninstall", resources),
      listFact("Git cleanup planning failed", strings(data.git_config_errors)),
    ]),
  };
};

const presentDoctor: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const environment = object(data.environment);
  const checks = records(data.checks);
  const problems = checks.filter((check) => check.status !== "ok");
  return {
    state: defaultState(
      result,
      problems.length === 0
        ? `All ${plural(checks.length, "doctor check")} passed.`
        : `${plural(problems.length, "doctor check")} need attention.`,
    ),
    evidence: unique([
      text(data.discern_version) === undefined
        ? undefined
        : `discern version: ${code(data.discern_version)}.`,
      environment === undefined
        ? undefined
        : `Platform: ${code(environment.platform)}; Git: ${
          code(text(environment.git) ?? "unavailable")
        }.`,
      ...problems.slice(0, MAX_LIST_ITEMS).map((check) => {
        const name = text(check.name) ?? "check";
        const detail = text(check.detail) ?? "No detail recorded.";
        const fix = text(check.fix);
        return `${code(name)}: ${detail}${
          fix === undefined ? "" : ` Fix: ${fix}`
        }`;
      }),
    ]),
  };
};

const presentInventory: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const art = verbatimText(data.art);
  return {
    state: defaultState(result),
    evidence: unique([
      Array.isArray(data.documents)
        ? `First-party documents: ${data.documents.length}.`
        : undefined,
      Array.isArray(data.components)
        ? `Bundled components: ${data.components.length}.`
        : undefined,
      text(data.mark) === undefined
        ? undefined
        : `Project mark: ${code(data.mark)}.`,
      listFact(
        result.dry_run === true ? "Would write" : "Written files",
        strings(data.written),
      ),
    ]),
    supportingMarkdown: art === undefined
      ? []
      : [`### Mark\n\n${fencedText(art)}`],
  };
};

const presentDocs: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const doc = object(data.doc);
  const results = records(data.results);
  const docs = records(data.docs);
  const suggestions = records(data.suggestions);
  const content = verbatimText(doc?.content);
  const title = text(doc?.title);
  const query = text(data.query);
  const resultCount = view.count(number(data.count), results.length);
  const state = doc !== undefined
    ? `Returned ${
      title === undefined ? "the requested document" : code(title)
    }.`
    : query !== undefined
    ? `Found ${
      plural(resultCount, "documentation match", "documentation matches")
    } for ${code(query)}.`
    : `Indexed ${plural(number(data.count) ?? docs.length, "document")}.`;
  return {
    state: defaultState(result, state),
    evidence: unique([
      text(doc?.path) === undefined ? undefined : `Source: ${code(doc?.path)}.`,
      listFact("Ambiguous candidates", strings(data.candidates)),
      ...suggestions.slice(0, MAX_LIST_ITEMS).map((entry) => {
        const target = text(entry.target) ?? text(entry.path) ?? "unknown";
        const suggestionTitle = text(entry.title);
        return suggestionTitle === undefined
          ? `${code(target)}.`
          : productSentence(`${code(target)}: ${suggestionTitle}`);
      }),
      suggestions.length > MAX_LIST_ITEMS
        ? omitted(suggestions.length - MAX_LIST_ITEMS, "suggestion")
        : undefined,
      ...results.slice(0, MAX_LIST_ITEMS).map((entry) => {
        const target = text(entry.target) ?? "unknown";
        const resultTitle = text(entry.title) ?? target;
        const snippet = text(entry.snippet);
        const heading = productSentence(
          `${view.kindPrefix(text(entry.manual_kind))}${
            code(target)
          }: ${resultTitle}`,
        );
        return `${heading}${view.snippetSuffix(snippet)}`;
      }),
      view.truncation(
        data.truncated,
        results.length,
        resultCount,
      ),
    ]),
    supportingMarkdown: content === undefined
      ? []
      : [`### Requested document\n\n${content}`],
  };
};

/** `config` edits and shell-friendly reads; `config explain` presents as its
 * own document through the wrapper below, owned beside its renderer. */
const presentConfigOperation: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const operation = text(data.operation);
  const values = strings(data.values);
  return {
    state: defaultState(
      result,
      operation === undefined
        ? undefined
        : `Configuration ${code(operation)} completed.`,
    ),
    evidence: unique([
      text(data.file) === undefined ? undefined : `File: ${code(data.file)}.`,
      text(data.key) === undefined ? undefined : `Key: ${code(data.key)}.`,
      text(data.value) === undefined
        ? undefined
        : `Value: ${code(data.value)}.`,
      boolean(data.present) === undefined
        ? undefined
        : `Present: ${boolean(data.present) === true ? "yes" : "no"}.`,
      listFact("Values", values),
      Array.isArray(data.edits)
        ? `${
          result.dry_run === true ? "Planned edits" : "Edits"
        }: ${data.edits.length}.`
        : undefined,
    ]),
  };
};

const presentConfig: ResultMarkdownPresenter = withConfigExplanation(
  presentConfigOperation,
  defaultState,
);

/** Name each producer that ran or whose recorded evidence stood in, and why. */
function producerEvidenceFacts(data: Record<string, unknown>): string[] {
  const rows = records(data.producer_evidence);
  const describe = (row: Record<string, unknown>): string =>
    `${code(text(row.producer) ?? "producer")} (${
      text(row.closure) === "candidate" ? "candidate-bound" : "declared inputs"
    }${
      text(row.from) === undefined
        ? ""
        : `, from ${code((text(row.from) ?? "").slice(0, 12))}`
    })`;
  const group = (use: string, label: string): string | undefined => {
    const matching = rows.filter((row) => text(row.use) === use);
    if (matching.length === 0) return undefined;
    const shown = matching.slice(0, MAX_LIST_ITEMS).map(describe).join(", ");
    const rest = matching.length - MAX_LIST_ITEMS;
    return `${label}: ${shown}${rest > 0 ? `, and ${rest} more` : ""}.`;
  };
  return [
    group("executed", "Producers executed"),
    group("reused", "Evidence reused"),
  ].filter((fact): fact is string => fact !== undefined);
}

/** Outstanding emergency checks stay visible wherever normal completion state is presented. */
function emergencyValidationFacts(data: Record<string, unknown>): string[] {
  return records(data.emergency_validation).map((row) =>
    `Emergency ${code(row.landing_id)}: validation ${
      text(row.state) ?? "outstanding"
    }. ${text(row.next_action) ?? ""}`
  );
}

const presentGate: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const checkpoints = object(data.checkpoints);
  const review = object(checkpoints?.review);
  const failedStage = text(data.failed_stage);
  const standards = records(data.standards);
  const previews = records(data.preview_actions);
  const proof = object(data.proof);
  const standardProposals = records(proof?.standard_proposals);
  const unreviewed = records(review?.unreviewed);
  const regressions = standards.filter((reading) =>
    reading.verdict === "regressed"
  );
  return {
    state: defaultState(
      result,
      failedStage === undefined
        ? `${code(commandName(result))} passed.`
        : `${code(commandName(result))} stopped at ${code(failedStage)}.`,
    ),
    evidence: unique([
      ...records(data.execution_recovery).map((row) =>
        `Execution environment ${code(row.environment_id)} requires recovery: ${
          text(row.reason) ?? ""
        } Next: ${code(row.next_action)}.`
      ),
      ...emergencyValidationFacts(data),
      failedStage === undefined
        ? undefined
        : `Failed stage: ${code(failedStage)}.`,
      listFact("Changed scopes", strings(data.scopes_changed)),
      ...previews.map((preview) => {
        const scope = text(preview.scope) ?? "unnamed";
        const command = text(preview.command) ?? "";
        return `Preview ${code(scope)}: run ${
          code(command)
        } from this worktree. ` +
          "The gate did not run this command.";
      }),
      standards.length === 0
        ? undefined
        : `Standards: ${standards.length} read, ${regressions.length} regressed.`,
      ...producerEvidenceFacts(data),
      review === undefined
        ? undefined
        : `Checkpoint review: reported and was not enforced; ${
          text(review.status) === "unreviewed"
            ? plural(records(review.unreviewed).length, "question") +
              " unreviewed"
            : "no review was needed"
        }.`,
      ...unreviewed.slice(0, MAX_LIST_ITEMS).map((entry) => {
        const source = text(entry.question_file);
        const reference = text(entry.reference);
        return `${code(entry.id)} (${
          text(entry.mode) ?? "stop"
        }) is unreviewed.\n\n` +
          `Question: ${text(entry.question) ?? ""}` +
          (source === undefined
            ? ""
            : `\n\nQuestion source: ${code(source)}.`) +
          (reference === undefined ? "" : `\n\nReference: ${code(reference)}.`);
      }),
      unreviewed.length > MAX_LIST_ITEMS
        ? omitted(unreviewed.length - MAX_LIST_ITEMS, "checkpoint question")
        : undefined,
      ...records(checkpoints?.drops).map(checkpointDropLine),
      ...standardProposals.slice(0, MAX_LIST_ITEMS).map((proposal) => {
        const standard = text(proposal.standard) ?? "unknown";
        const proposed = number(proposal.proposed_limit);
        const delta = number(proposal.delta);
        const reason = text(proposal.reason) ?? "No reason recorded.";
        return `Standard limit proposal for ${
          code(standard)
        }: exact owner approval is required for limit ${proposed ?? "unknown"}${
          delta === undefined ? "" : ` (delta ${delta >= 0 ? "+" : ""}${delta})`
        }.\n\nReason: ${reason}`;
      }),
      standardProposals.length > MAX_LIST_ITEMS
        ? omitted(
          standardProposals.length - MAX_LIST_ITEMS,
          "Standard limit proposal",
        )
        : undefined,
      gateProofFact(data.gate_proof),
    ]),
    supportingMarkdown: uniqueVerbatim([
      proofLine(proof),
      gateProofLine(data.gate_proof),
    ]),
    boundary: landingBoundary(data),
  };
};

/** One structured checkpoint fail-open record on any result surface. */
function checkpointDropLine(drop: Record<string, unknown>): string {
  return checkpointDropMarkdown(drop);
}

const presentImprovement: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const next = object(data.next_action);
  const against = object(next?.against);
  return {
    state: defaultState(
      result,
      `Improvement score: ${number(data.score) ?? "unavailable"}.`,
    ),
    evidence: unique([
      `Weak areas: ${number(data.weak) ?? 0}; open reviews: ${
        number(data.open_reviews) ?? 0
      }.`,
      text(next?.why),
      text(against?.source) === undefined
        ? undefined
        : `Evidence from ${code(against?.source)}: ${
          text(against?.excerpt) ?? "no excerpt recorded"
        }.`,
    ]),
    action: text(next?.action) === undefined ? [] : [text(next?.action) ?? ""],
  };
};

/** One checkpoint row's compact state phrase, from the serialized fields. */
function checkpointRowLine(row: Record<string, unknown>): string {
  const id = code(row.id);
  const mode = text(row.mode) ?? "stop";
  const obligation = text(row.obligation);
  const openQuestion = object(row.open_question);
  const preview = object(row.preview);
  const question = text(row.question);
  const source = text(row.question_file);
  const reference = text(row.reference);
  const withQuestion = (phrase: string): string =>
    [
      phrase,
      question === undefined ? undefined : `Question: ${question}`,
      source === undefined ? undefined : `Question source: ${code(source)}.`,
      reference === undefined ? undefined : `Reference: ${code(reference)}.`,
    ].filter((part): part is string => part !== undefined).join("\n\n");
  if (obligation === "unknown") {
    return withQuestion(
      `${id} (${mode}): strict obligation unknown — checkpoint state failed open.`,
    );
  }
  if (
    openQuestion !== undefined && obligation !== "none" &&
    obligation !== "will_open"
  ) {
    const declaration = object(openQuestion.declaration);
    const why = text(declaration?.why);
    switch (text(openQuestion.state)) {
      case "declared_met":
        return withQuestion(`${id} (${mode}): declared met.`);
      case "declared_unmet":
        return withQuestion(
          `${id} (${mode}): declared unmet${
            openQuestion.variance_required === true
              ? " — owner variance required to land"
              : ""
          }${
            // The rationale is opaque agent evidence: in an interpreted
            // Markdown document it renders only through the code-span escaping
            // boundary, exactly as the Proof page renders it.
            why === undefined ? "" : `. Rationale: ${code(why)}`}.`,
        );
      case "reopened":
        return withQuestion(
          `${id} (${mode}): reopened — a relevant change unbound the declared conclusion; declare again.`,
        );
      default:
        return withQuestion(
          `${id} (${mode}): awaiting a declared conclusion.`,
        );
    }
  }
  if (preview === undefined) {
    return withQuestion(
      `${id} (${mode}): state unknown — the effort diff could not be read.`,
    );
  }
  if (preview.holds !== true) {
    return withQuestion(`${id} (${mode}): idle.`);
  }
  const matched = strings(preview.matched).length;
  if (preview.when_pending === true) {
    return withQuestion(
      `${id} (${mode}): may fire at done — its when command decides (${matched} matched).`,
    );
  }
  return withQuestion(
    `${id} (${mode}): would fire at done (${matched} matched).`,
  );
}

/** One observed-economics row as a compact Markdown line. */
function checkpointEconomicsLine(row: Record<string, unknown>): string {
  const firedOn = number(row.efforts_fired) ?? 0;
  const fires = number(row.fires) ?? 0;
  const declared = number(row.declared) ?? 0;
  const unchanged = number(row.declared_unchanged) ?? 0;
  const unmet = number(row.declared_unmet) ?? 0;
  const variances = number(row.variances) ?? 0;
  const landed = number(row.efforts_landed) ?? 0;
  const median = number(row.median_declare_s);
  const parts = [
    `fired on ${firedOn} effort${firedOn === 1 ? "" : "s"} (${
      plural(fires, "serving")
    })`,
    declared === 0
      ? undefined
      : `declared ${declared} (${unchanged} on an unchanged subject, ${unmet} unmet)`,
    variances === 0
      ? undefined
      : `${plural(variances, "authorized variance")} across ${landed} landed`,
    median === undefined ? undefined : `median time to declare ${median}s`,
  ].filter((part): part is string => part !== undefined);
  return `Observed: ${code(row.id)} ${parts.join("; ")}.`;
}

const presentCheckpoints: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const rows = records(data.checkpoints);
  const ungoverned = records(data.ungoverned);
  const advisories = strings(data.advisories);
  const policy = text(data.policy);
  const economics = object(data.economics);
  const economicsRows = records(economics?.rows);
  const varianceIds = rows.filter((row) =>
    object(row.open_question)?.variance_required === true
  ).map((row) => code(row.id));
  return {
    state: defaultState(
      result,
      rows.length === 0
        ? "No checkpoint governs this effort."
        : `${plural(rows.length, "checkpoint")} govern${
          rows.length === 1 ? "s" : ""
        } this effort${
          policy === undefined ? "" : ` (policy ${policy.slice(0, 12)})`
        }.`,
    ),
    evidence: unique([
      ...rows.slice(0, MAX_LIST_ITEMS).map(checkpointRowLine),
      rows.length > MAX_LIST_ITEMS
        ? omitted(rows.length - MAX_LIST_ITEMS, "checkpoint")
        : undefined,
      ...ungoverned.slice(0, MAX_LIST_ITEMS).map((entry) =>
        `${
          code(entry.id)
        }: a recorded open question stands, but the current governing policy does not contain it.`
      ),
      ...advisories.map((advisory) => `Fail-open: ${advisory}`),
      ...records(data.drops).map(checkpointDropLine),
      ...economicsRows.slice(0, MAX_LIST_ITEMS).map(checkpointEconomicsLine),
      economicsRows.length > MAX_LIST_ITEMS
        ? omitted(
          economicsRows.length - MAX_LIST_ITEMS,
          "observed checkpoint",
        )
        : undefined,
      rows.length === 0 || economicsRows.length > 0
        ? undefined
        : "No observed checkpoint history yet.",
    ]),
    boundary: varianceIds.length === 0 ? [] : [
      `Landing requires the owner to authorize a variance for: ${
        varianceIds.join(", ")
      }. Recorded standing and effort grants never cover one.`,
    ],
  };
};

const presentStandards: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const standards = records(data.standards);
  const pinned = records(data.pinned);
  const proposalResult = object(data.proposal);
  const proposal = object(proposalResult?.proposal);
  const proposalName = text(proposal?.standard);
  const proposalReason = text(proposal?.reason);
  return {
    state: defaultState(
      result,
      proposal === undefined
        ? pinned.length > 0
          ? `Tightened ${plural(pinned.length, "standard limit")}.`
          : `Measured ${plural(standards.length, "standard")}.`
        : `${
          text(proposalResult?.status) ?? "Recorded"
        } the proposed limit for ${code(proposalName ?? "a standard")}.`,
    ),
    evidence: unique([
      proposal === undefined
        ? undefined
        : `${code(proposalName ?? "standard")}: ${
          number(proposal.trunk_limit) ?? "unknown"
        } → ${number(proposal.proposed_limit) ?? "unknown"}; measured ${
          number(proposal.measurement) ?? "unknown"
        }; delta ${number(proposal.delta) ?? "unknown"}.`,
      proposalReason === undefined ? undefined : `Reason: ${proposalReason}`,
      proposal === undefined
        ? undefined
        : listFact("Responsible paths", strings(proposal.evidence_paths)),
      ...producerEvidenceFacts(data),
      ...standards.slice(0, MAX_LIST_ITEMS).map((reading) => {
        const name = text(reading.name) ?? "standard";
        const measurement = text(reading.measurement) ?? "unknown";
        const value = number(reading.value);
        const limit = number(reading.limit);
        const verdict = text(reading.verdict);
        return `${code(name)}: ${measurement}${
          value === undefined ? "" : ` ${value}`
        }, limit ${limit ?? "unknown"}${
          verdict === undefined ? "" : `, ${verdict}`
        }.`;
      }),
      standards.length > MAX_LIST_ITEMS
        ? omitted(standards.length - MAX_LIST_ITEMS, "standard")
        : undefined,
    ]),
    boundary: proposal === undefined ? [] : [
      "The gate must remeasure this exact value. Landing requires explicit owner approval for this standard/value/reason tuple; generic grants never cover it.",
    ],
  };
};

const presentRefresh: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const skills = object(data.skills);
  const plan = object(result.plan);
  const targets = records(plan?.steps);
  const preview = result.dry_run === true;
  return {
    state: defaultState(result),
    evidence: unique([
      listFact(
        preview ? "Agent-file targets" : "Agent files written",
        strings(data.agents_written),
      ),
      listFact(
        preview ? "MCP integration targets" : "MCP integrations wired",
        strings(data.mcp_wired),
      ),
      listFact(
        preview ? "Hook targets" : "Hooks wired",
        strings(data.hooks_wired),
      ),
      skills === undefined
        ? undefined
        : `${preview ? "Planned skills" : "Skills"}: ${
          number(skills.copied) ?? 0
        } copied, ${number(skills.linked) ?? 0} linked, ${
          number(skills.pruned) ?? 0
        } pruned.`,
      listFact("Refresh errors", strings(data.errors)),
    ]),
    supportingMarkdown: preview && targets.length > 0
      ? [
        `### Refresh targets\n\n${
          targets.map((step) => {
            const label = text(step.label) ?? "unnamed target";
            const note = text(step.note);
            return `- ${code(label)}${note === undefined ? "" : ` — ${note}`}`;
          }).join("\n")
        }`,
      ]
      : undefined,
  };
};

const presentImpact: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const membership = object(data.membership);
  const scopes = strings(data.scopes);
  const previews = records(data.preview_actions);
  return {
    state: defaultState(
      result,
      membership === undefined
        ? `The current changes affect ${plural(scopes.length, "scope")}.`
        : `${code(membership.scope)} is ${
          boolean(membership.present) === true ? "present" : "absent"
        } in the current impact set.`,
    ),
    evidence: unique([
      listFact("Affected scopes", scopes),
      ...previews.map((preview) => {
        const scope = text(preview.scope) ?? "unnamed";
        const command = text(preview.command) ?? "";
        return `Preview ${code(scope)}: run ${
          code(command)
        } from this worktree. ` +
          "This command was not run.";
      }),
    ]),
  };
};

const presentCoupling: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const partners = records(data.partners);
  const commits = records(data.commits);
  return {
    state: defaultState(
      result,
      `Coupling ${code(text(data.mode) ?? "query")} returned ${
        plural(partners.length, "partner")
      }.`,
    ),
    evidence: unique([
      listFact("Changed paths", strings(data.changed)),
      text(data.target) === undefined
        ? undefined
        : `Target: ${code(data.target)}.`,
      ...partners.slice(0, MAX_LIST_ITEMS).map((partner) => {
        const path = text(partner.path) ?? "unknown";
        return `${code(path)}: ${number(partner.cochanges) ?? 0} of ${
          number(partner.of) ?? 0
        } commits; confidence ${number(partner.confidence) ?? 0}.`;
      }),
      commits.length === 0
        ? undefined
        : `Shared-history commits: ${commits.length}.`,
      ...commits.slice(0, MAX_LIST_ITEMS).map((commit) => {
        const sha = text(commit.sha) ?? "unknown";
        const date = text(commit.date);
        const subject = text(commit.subject) ?? "No subject recorded.";
        return `${code(sha)}${
          date === undefined ? "" : ` (${date})`
        }: ${subject}`;
      }),
      commits.length > MAX_LIST_ITEMS
        ? omitted(commits.length - MAX_LIST_ITEMS, "commit")
        : undefined,
    ]),
  };
};

const presentAwait: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const observed = object(data.observed) ?? {};
  const met = boolean(data.met) === true;
  const condition = text(data.condition) ?? "condition";
  const branch = text(data.branch);
  return {
    state: defaultState(
      result,
      `${branch === undefined ? "The watched target" : code(branch)} ${
        met ? "met" : "has not met"
      } the ${code(condition)} condition.`,
    ),
    evidence: unique([
      `Waited ${duration(number(data.elapsed_ms) ?? 0)}.`,
      text(observed.proof_status) === undefined
        ? undefined
        : `Proof status: ${code(observed.proof_status)}.`,
      number(observed.behind) === undefined
        ? undefined
        : `Behind trunk by ${number(observed.behind)}.`,
      listFact("Incoming overlap", strings(observed.incoming_overlap)),
      text(data.resume) === undefined
        ? undefined
        : `Continuation: ${code(data.resume)}.`,
    ]),
  };
};

const presentPatterns: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const findings = records(data.findings);
  return {
    state: defaultState(
      result,
      `Patterns found ${
        plural(number(data.findings_total) ?? findings.length, "finding")
      }.`,
    ),
    evidence: unique([
      ...findings.slice(0, MAX_LIST_ITEMS).flatMap((finding) => [
        text(finding.summary),
        text(finding.observed) === undefined
          ? undefined
          : `Observed: ${text(finding.observed)}`,
      ]),
    ]),
    action: text(findings[0]?.next_step) === undefined
      ? []
      : [text(findings[0]?.next_step) ?? ""],
  };
};

const presentPatternsLifecycle: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const archives = records(data.archives);
  return {
    state: defaultState(result),
    evidence: unique([
      text(data.dir) === undefined
        ? undefined
        : `Directory: ${code(data.dir)}.`,
      text(data.archive_path) === undefined
        ? undefined
        : `Archive: ${code(data.archive_path)}.`,
      number(data.events) === undefined
        ? undefined
        : `Events: ${number(data.events)}.`,
      number(data.bytes) === undefined
        ? undefined
        : `Size: ${formatBytes(number(data.bytes) ?? 0)}.`,
      archives.length === 0 ? undefined : `Archives: ${archives.length}.`,
      text(data.recovery_path) === undefined
        ? undefined
        : `Recovery path: ${code(data.recovery_path)}.`,
    ]),
  };
};

const presentStatus: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const git = object(data.git);
  const worktree = object(data.worktree);
  const fleet = records(data.fleet).filter((entry) => entry.is_main !== true);
  const projection = object(data.projection);
  const setupUnfinished = object(data.setup_unfinished);
  const setupAssurance = object(setupUnfinished?.assurance);
  const projectionCounts = object(projection?.omitted);
  const fleetTotal = number(data.fleet_total) ?? fleet.length;
  const fleetCollisionTotal = records(data.fleet_collisions).length +
    (number(projectionCounts?.fleet_collisions) ?? 0);
  const adrCollisionTotal = records(data.adr_collisions).length +
    (number(projectionCounts?.adr_collisions) ?? 0);
  const branch = text(git?.branch) ?? text(worktree?.branch);
  const trunk = text(git?.trunk);
  const clean = boolean(git?.clean);
  const location = text(data.location) ?? "project";
  const state = git === undefined
    ? `Read ${
      code(text(data.project) ?? "the project")
    } from the ${location} view; Git state is unavailable.`
    : location === "main" && branch === trunk
    ? `${code(branch ?? "the main checkout")} is ${
      clean === true ? "clean" : "dirty"
    } in the main checkout.`
    : `${code(branch ?? "current branch")} is ${
      clean === true ? "clean" : "dirty"
    }${
      trunk === undefined
        ? ""
        : `, ${number(git.ahead_trunk) ?? "unknown"} ahead and ${
          number(git.behind_trunk) ?? "unknown"
        } behind ${code(trunk)}`
    }.`;
  const fleetFacts = fleet.slice(0, MAX_LIST_ITEMS).map((entry) => {
    const rowBranch = text(entry.branch) ?? "unknown branch";
    if (boolean(entry.git_unavailable) === true) {
      return `${code(rowBranch)}: Git state unavailable.`;
    }
    const rowProof = object(entry.gate_proof);
    return `${code(rowBranch)}: ${
      boolean(entry.clean) === true ? "clean" : "dirty"
    }, ${number(entry.ahead) ?? "unknown"} ahead, ${
      number(entry.behind) ?? "unknown"
    } behind, Proof ${code(text(rowProof?.status) ?? "unknown")}.`;
  });
  const fleetDropFacts = fleet.slice(0, MAX_LIST_ITEMS).flatMap((entry) => {
    const branch = text(entry.branch) ?? "unknown branch";
    const proof = object(entry.gate_proof);
    return records(proof?.checkpoint_drops).map((drop) =>
      `${code(branch)} — ${checkpointDropLine(drop)}`
    );
  });
  return {
    state: defaultState(result, state),
    evidence: unique([
      ...records(data.execution_recovery).map((row) =>
        `Execution environment ${code(row.environment_id)} requires recovery: ${
          text(row.reason) ?? ""
        } Next: ${code(row.next_action)}.`
      ),
      ...emergencyValidationFacts(data),
      text(data.root) === undefined ? undefined : `Root: ${code(data.root)}.`,
      git === undefined
        ? undefined
        : `Changed files: ${number(git.changed_files) ?? 0}.`,
      listFact("Incoming overlap", strings(git?.incoming_overlap)),
      listFact("Changed scopes", strings(data.scopes)),
      ...records(data.preview_actions).map((preview) => {
        const scope = text(preview.scope) ?? "unnamed";
        const command = text(preview.command) ?? "";
        return `Preview ${code(scope)}: run ${
          code(command)
        } from this worktree. ` +
          "This command was not run.";
      }),
      setupAssurance === undefined
        ? undefined
        : `Applicable protections: ${number(setupAssurance.enforced) ?? 0} of ${
          number(setupAssurance.total) ?? 0
        } enforced; ${
          notApplicableCountLabel(number(setupAssurance.not_applicable) ?? 0)
        }; verdict ${code(setupAssurance.verdict)}.`,
      gateProofFact(data.gate_proof),
      fleetTotal === 0
        ? undefined
        : `Fleet: ${plural(fleetTotal, "active worktree")}.`,
      ...fleetFacts,
      ...fleetDropFacts,
      fleetTotal > fleetFacts.length
        ? omitted(fleetTotal - fleetFacts.length, "fleet row")
        : undefined,
      fleetCollisionTotal === 0
        ? undefined
        : `Cross-worktree collisions: ${fleetCollisionTotal}.`,
      adrCollisionTotal === 0
        ? undefined
        : `ADR number collisions: ${adrCollisionTotal}.`,
      listFact(
        "Pending tracked refresh",
        strings(data.pending_tracked_refresh),
      ),
      listFact(
        "Unlanded branches without worktrees",
        strings(data.unlanded_branches),
      ),
    ]),
    supportingMarkdown: uniqueVerbatim([gateProofLine(data.gate_proof)]),
    boundary: landingBoundary(data),
  };
};

const presentStart: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const path = text(data.path);
  const branch = text(data.branch);
  const task = object(data.task);
  const createdFrom = object(task?.created_from);
  const preview = result.dry_run === true;
  return {
    state: defaultState(
      result,
      `${preview ? "Would create" : "Created"} ${
        code(branch ?? "a worktree")
      } at ${code(path ?? "an unknown path")}.`,
    ),
    evidence: unique([
      text(data.from) === undefined
        ? undefined
        : `Based on ${code(data.from)}.`,
      text(data.id) === undefined
        ? undefined
        : `Worktree id: ${code(data.id)}.`,
      verbatimText(task?.title) === undefined
        ? undefined
        : `Task title: ${code(task?.title)}.`,
      verbatimText(task?.brief) === undefined
        ? undefined
        : `Brief: ${code(task?.brief)}.`,
      text(createdFrom?.commit) === undefined
        ? undefined
        : `Base commit: ${code(createdFrom?.commit)}.`,
      text(data.name_note),
    ]),
    boundary: landingBoundary(data),
  };
};

const presentTaskRename: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const task = object(data.task);
  return {
    state: defaultState(result, "The task title was updated."),
    evidence: unique([
      verbatimText(data.previous_title) === undefined
        ? undefined
        : `Previous title: ${code(data.previous_title)}.`,
      verbatimText(task?.title) === undefined
        ? undefined
        : `Task title: ${code(task?.title)}.`,
      text(task?.id) === undefined
        ? undefined
        : `Worktree id: ${code(task?.id)}.`,
      text(task?.branch) === undefined
        ? undefined
        : `Branch: ${code(task?.branch)}.`,
      text(data.path) === undefined ? undefined : `Path: ${code(data.path)}.`,
    ]),
  };
};

const presentAccept: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const consent = object(data.consent);
  const landing = object(data.landing);
  const prefixes = records(data.queue);
  return {
    state: defaultState(
      result,
      text(data.root) === undefined
        ? undefined
        : prefixes.some((row) => object(row.exception) !== undefined)
        ? `Recorded landing outcomes for ${code(data.root)}.`
        : `Landed the validated tree into ${code(data.root)}.`,
    ),
    evidence: unique([
      ...records(data.execution_recovery).map((row) =>
        `Execution environment ${code(row.environment_id)} requires recovery: ${
          text(row.reason) ?? ""
        } Next: ${code(row.next_action)}.`
      ),
      ...emergencyValidationFacts(data),
      text(data.root) === undefined
        ? undefined
        : `Main checkout: ${code(data.root)}.`,
      ...prefixes.map((row) =>
        `${code(text(row.branch) ?? "candidate")}: ${
          text(row.state) ?? "pending"
        }; ${
          object(row.exception) === undefined
            ? "authority"
            : "emergency exception, no passing Proof; authorization"
        } ${
          text(row.authority_settlement) ?? text(row.authority) ?? "pending"
        }; convergence ${text(row.convergence) ?? "pending"}; retirement ${
          text(row.retirement) ?? "pending"
        }.`
      ),
      ...prefixes.flatMap((row) =>
        records(row.pending).map((item) =>
          `${code(text(row.branch) ?? "candidate")}: ${
            text(item.reason) ?? text(item.kind) ?? "pending"
          }.`
        )
      ),
      listFact("Landed scopes", strings(data.scopes_changed)),
      landing === undefined
        ? undefined
        : `Trunk landed: ${
          boolean(landing.trunk_landed) === true ? "yes" : "no"
        }; worktree removed: ${
          boolean(landing.worktree_removed) === true ? "yes" : "no"
        }; branch deleted: ${
          boolean(landing.branch_deleted) === true ? "yes" : "no"
        }.`,
      listFact("Authority warnings", strings(data.authority_warnings)),
      ...records(data.standard_approvals).map((proposal) =>
        `Standard limit proposal approved by the owner: ${
          code(text(proposal.standard) ?? "standard")
        } ${number(proposal.trunk_limit) ?? "unknown"} → ${
          number(proposal.proposed_limit) ?? "unknown"
        }; reason: ${text(proposal.reason) ?? "unknown"}.`
      ),
      ...records(data.standard_approvals_required).map((approval) => {
        const proposal = object(approval.proposal);
        return `Standard limit proposal awaiting exact owner approval: ${
          code(text(proposal?.standard) ?? "standard")
        } ${number(proposal?.trunk_limit) ?? "unknown"} → ${
          number(proposal?.proposed_limit) ?? "unknown"
        }; reason: ${text(proposal?.reason) ?? "unknown"}; approval token: ${
          code(text(approval.token) ?? "unavailable")
        }.`;
      }),
      ...records(data.checkpoint_drops).map(checkpointDropLine),
    ]),
    supportingMarkdown: uniqueVerbatim(
      prefixes.length === 0
        ? [text(data.proof_line)]
        : prefixes.map((row) => text(row.proof_line)),
    ),
    boundary: prefixes.length > 0
      ? prefixes.flatMap((row) => {
        const authority = object(row.consent);
        return authority === undefined ? [] : [
          `${code(text(row.branch) ?? "candidate")} uses ${
            code(text(authority.source) ?? "recorded")
          } consent.`,
        ];
      })
      : consent === undefined
      ? []
      : [`Landing used ${code(text(consent.source) ?? "recorded")} consent.`],
  };
};

const presentUpdate: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const commits = number(data.commits_total) ?? records(data.commits).length;
  const files = number(data.files_total) ?? records(data.files).length;
  const overlap = strings(data.overlap);
  return {
    state: defaultState(
      result,
      Object.keys(data).length === 0
        ? "The branch is already up to date."
        : `${result.dry_run === true ? "Would integrate" : "Integrated"} ${
          plural(commits, "commit")
        } affecting ${plural(files, "file")}.`,
    ),
    evidence: unique([
      `Behind before update: ${number(data.behind) ?? "unknown"}.`,
      listFact("Semantic overlap to re-read", overlap),
      listFact("Incoming scopes", strings(data.scopes_incoming)),
      listFact("Auto-resolved generated paths", strings(data.auto_resolved)),
      listFact("Regenerated groups", strings(data.regenerated)),
    ]),
  };
};

const presentIdentity: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const resources = object(data.resources);
  return {
    state: defaultState(result),
    evidence: unique([
      text(data.field) === undefined
        ? undefined
        : `${code(data.field)}: ${code(data.value)}.`,
      text(data.name) === undefined
        ? undefined
        : `${code(data.name)}: ${code(data.value)}.`,
      resources === undefined
        ? undefined
        : `Resources: ${boundedCodes(Object.keys(resources))}.`,
    ]),
  };
};

const presentScripts: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const scripts = records(data.scripts);
  return {
    state: defaultState(
      result,
      `Found ${plural(scripts.length, "Project Script")}.`,
    ),
    evidence: unique([
      text(data.directory) === undefined
        ? undefined
        : `Directory: ${code(data.directory)}.`,
      ...scripts.slice(0, MAX_LIST_ITEMS).map((script) => {
        const name = text(script.name) ?? "unknown";
        const description = text(script.description);
        return description === undefined
          ? `${code(name)}.`
          : productSentence(`${code(name)}: ${description}`);
      }),
    ]),
  };
};

const presentSkillsList: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const skills = records(data.skills);
  const active = skills.filter((skill) => skill.excluded !== true);
  return {
    state: defaultState(
      result,
      `Found ${plural(active.length, "effective skill")}.`,
    ),
    evidence: unique([
      ...active.slice(0, MAX_LIST_ITEMS).map((skill) => {
        const name = text(skill.name) ?? "unknown";
        const source = text(skill.source) ?? "unknown";
        return `${code(name)}: ${source}.`;
      }),
      skills.length > MAX_LIST_ITEMS
        ? omitted(skills.length - MAX_LIST_ITEMS, "skill")
        : undefined,
    ]),
  };
};

const presentSkillsEject: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const materialized = object(data.materialized);
  const preview = result.dry_run === true;
  return {
    state: defaultState(
      result,
      text(data.name) === undefined
        ? undefined
        : `Ejected ${code(data.name)} to ${code(data.dest_rel)}.`,
    ),
    evidence: unique([
      text(data.dest_abs) === undefined
        ? undefined
        : `${preview ? "Destination target" : "Destination"}: ${
          code(data.dest_abs)
        }.`,
      materialized === undefined
        ? undefined
        : `${
          preview ? "Planned materialized skills" : "Materialized skills"
        }: ${number(materialized.copied) ?? 0} copied, ${
          number(materialized.linked) ?? 0
        } linked, ${number(materialized.pruned) ?? 0} pruned.`,
      listFact("Materialization errors", strings(materialized?.errors)),
    ]),
  };
};

/**
 * Presenter families selected explicitly by every result-contract entry.
 * Sharing a family is intentional; registered contracts never fall through to
 * a mechanical object renderer.
 */
export const RESULT_MARKDOWN_PRESENTERS = {
  envelope: presentEnvelope,
  setup: presentSetup,
  setupVerify: presentSetupVerify,
  setupStep: presentSetupStep,
  setupDone: presentSetupDone,
  setupAccept: presentSetupAccept,
  upgrade: presentUpgrade,
  uninstall: presentUninstall,
  doctor: presentDoctor,
  inventory: presentInventory,
  docs: presentDocs,
  config: presentConfig,
  gate: presentGate,
  improvement: presentImprovement,
  checkpoints: presentCheckpoints,
  standards: presentStandards,
  refresh: presentRefresh,
  impact: presentImpact,
  coupling: presentCoupling,
  await: presentAwait,
  patterns: presentPatterns,
  patternsLifecycle: presentPatternsLifecycle,
  status: presentStatus,
  start: presentStart,
  taskRename: presentTaskRename,
  accept: presentAccept,
  update: presentUpdate,
  identity: presentIdentity,
  scripts: presentScripts,
  skillsList: presentSkillsList,
  skillsEject: presentSkillsEject,
} as const satisfies Record<string, ResultMarkdownPresenter>;
