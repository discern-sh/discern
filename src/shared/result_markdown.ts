/**
 * Authored Markdown presentations for serialized Discern results.
 *
 * The contract presenter selects the facts that matter. This shared renderer
 * adds bounded envelope evidence and registered hints, then enforces the order
 * current state -> evidence -> authority boundary -> next action.
 */

import { firedHintsFromTexts, type HintCategory, HINTS } from "./hints.ts";
import { markdownCodeSpan } from "./markdown_code.ts";

export interface ResultMarkdownPresentation {
  /** One authored statement of the current result state. */
  state: string;
  /** Contract-selected, bounded facts supporting that state. */
  evidence?: readonly string[] | undefined;
  /** Authored Markdown that must remain intact, such as a requested document. */
  supportingMarkdown?: readonly string[] | undefined;
  /** Authority, consent, or stop conditions that constrain the next move. */
  boundary?: readonly string[] | undefined;
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

/** Narrow one unknown serialized value to a plain object. */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Read the result's data object, or an empty object for a data-less result. */
function dataOf(
  result: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return object(result.data) ?? {};
}

/** Read and trim a non-empty string. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** Read one finite numeric value. */
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Read one boolean value. */
function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Keep the plain-object members of one unknown array. */
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const row = object(entry);
      return row === undefined ? [] : [row];
    })
    : [];
}

/** Keep the string members of one unknown array. */
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Render the canonical CLI name for a serialized verb. */
function commandName(result: Readonly<Record<string, unknown>>): string {
  const verb = text(result.verb) ?? "result";
  return verb === "discern" ? "discern" : `discern ${verb}`;
}

/** Render an unknown dynamic value as a safe Markdown code span. */
function code(value: unknown): string {
  return markdownCodeSpan(String(value));
}

/** Render a counted noun with its singular or plural form. */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The one bounded-list overflow sentence, so every count agrees with its noun. */
function omitted(count: number, noun: string): string {
  return `${plural(count, `additional ${noun}`)} omitted.`;
}

/** Remove blank and duplicate presentation items without reordering them. */
function unique(items: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item?.trim();
    if (normalized === undefined || normalized === "" || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
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
  const message = text(result.message);
  if (message !== undefined) {
    return message;
  }
  const command = code(commandName(result));
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
  const line = proofLine(proof.proof) ?? text(proof.proof_line);
  const reason = text(proof.reason);
  if (status === undefined) {
    return line;
  }
  return `Gate Proof: ${code(status)}${
    reason === undefined ? "" : ` (${reason})`
  }${line === undefined ? "." : `. ${line}`}`;
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
        return `${code(label)}: ${disposition}${
          note === undefined ? "" : `, ${note}`
        }.`;
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
    facts.push(`Waited ${Math.round(waitedMs)} ms for an execution slot.`);
  }

  const diagnostics = records(result.diagnostics);
  for (const diagnostic of diagnostics.slice(0, MAX_DIAGNOSTICS)) {
    const tool = text(diagnostic.tool) ?? "diagnostic";
    const message = text(diagnostic.message) ??
      "No diagnostic message was recorded.";
    const file = text(diagnostic.file);
    const line = number(diagnostic.line);
    const location = file === undefined
      ? ""
      : ` at ${code(`${file}${line === undefined ? "" : `:${line}`}`)}`;
    const reproduce = text(diagnostic.reproduce_cmd);
    const outputPath = text(diagnostic.output_path);
    facts.push(
      `${code(tool)}${location}: ${message}${
        reproduce === undefined ? "" : ` Reproduce with ${code(reproduce)}.`
      }${outputPath === undefined ? "" : ` Full output: ${code(outputPath)}.`}`,
    );
  }
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    facts.push(omitted(diagnostics.length - MAX_DIAGNOSTICS, "diagnostic"));
  }
  const firstOutput = text(diagnostics[0]?.output);
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
): { evidence: string[]; boundary: string[]; action: ActionItem[] } {
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
      case "next-step":
        action.push({ text: hint, family: def?.family });
        break;
      default:
        // An unregistered string cannot disappear from a text-only host. Put it
        // at the action boundary, the safest interpretation of advisory prose.
        action.push({ text: hint, family: undefined });
    }
  }
  return { evidence, boundary, action };
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

/** Keep the immediate action at the context tail; later work stays visible
 * first, with each hint family's variants nested under its first item. */
function renderActions(items: readonly ActionItem[]): string {
  const [primary, ...later] = items;
  if (primary === undefined) {
    return "";
  }
  if (later.length === 0) {
    return primary.text;
  }
  const groups: { text: string; children: string[] }[] = [];
  const byFamily = new Map<string, { text: string; children: string[] }>();
  for (const { text, family } of later) {
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
  return `Later:\n\n${deferred}\n\n**Do this next:** ${primary.text}`;
}

/** Render one contract's authored projection in the fixed agent-reading order. */
export function renderResultMarkdown(
  result: Readonly<Record<string, unknown>>,
  presenter: ResultMarkdownPresenter,
): string {
  const presented = presenter(result);
  const envelope = envelopeEvidence(result);
  const hints = hintSections(result);
  const evidence = unique([
    ...(presented.evidence ?? []),
    ...envelope.facts,
    ...hints.evidence,
  ]);
  const supporting = unique([
    ...(presented.supportingMarkdown ?? []),
    ...envelope.markdown,
  ]);
  const boundary = unique([
    ...(presented.boundary ?? []),
    ...hints.boundary,
  ]);
  const seenActions = new Set<string>();
  const action: ActionItem[] = [];
  for (
    const item of [
      ...(presented.action ?? []).map((text) => ({
        text,
        family: undefined,
      })),
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
  const sections = [
    `# ${code(commandName(result))}`,
    `## Current state\n\n${presented.state.trim()}`,
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
  if (action.length > 0) {
    sections.push(`## Next action\n\n${renderActions(action)}`);
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
  const plan = records(data.plan);
  const action = result.error === "awaiting_consent"
    ? undefined
    : text(data.next_action) ?? text(data.command);
  const guidance = unique([
    text(data.agent_guidance),
    text(data.guidance),
    text(data.instructions),
    text(data.human_framing),
  ]).map((value) => `### Setup guidance\n\n${value}`);
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
      listFact("Written files", strings(data.written)),
      listFact("Agent files", strings(data.compiled)),
    ]),
    supportingMarkdown: guidance,
    action: action === undefined ? [] : [action],
  };
};

const presentSetupVerify: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const findings = object(data.findings);
  const git = object(findings?.git);
  const conflicts = records(data.conflicts);
  const next = text(data.next_action);
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
    supportingMarkdown: text(data.guidance) === undefined
      ? []
      : [`### Consent guidance\n\n${text(data.guidance)}`],
    action: next === undefined ? [] : [next],
  };
};

const presentSetupStep: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const spine = object(data.spine) ?? {};
  const title = text(data.title);
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
      text(spine.intent),
      listFact("Read", strings(spine.files_to_read)),
      ...strings(spine.must_do),
      text(spine.completion_check) === undefined
        ? undefined
        : `Completion check: ${text(spine.completion_check)}`,
    ]),
    supportingMarkdown: text(data.guidance) === undefined
      ? []
      : [`### Step guidance\n\n${text(data.guidance)}`],
    boundary: strings(spine.what_not_to_do),
    action: text(spine.next_action) === undefined
      ? []
      : [text(spine.next_action) ?? ""],
  };
};

const presentSetupDone: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const assurance = object(data.assurance);
  const landing = object(data.landing);
  const reactivation = object(data.reactivation);
  const unmet = records(data.unmet);
  const action = boolean(landing?.on_target) === false
    ? text(landing?.command)
    : text(reactivation?.summary);
  return {
    state: defaultState(result, "discern setup is complete."),
    evidence: unique([
      assurance === undefined
        ? undefined
        : `Known jobs: ${number(assurance.enforced) ?? 0} of ${
          number(assurance.total) ?? 0
        } enforced; verdict ${code(assurance.verdict)}.`,
      `Gate proven: ${boolean(data.gate_proven) === true ? "yes" : "no"}.`,
      `Worktree proven: ${
        boolean(data.worktree_proven) === true ? "yes" : "no"
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
    supportingMarkdown: text(data.guidance) === undefined
      ? []
      : [`### Completion guidance\n\n${text(data.guidance)}`],
    action: action === undefined ? [] : [action],
  };
};

const presentSetupAccept: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const landed = boolean(data.landed);
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
      landed === true
        ? `Branch deleted: ${
          boolean(data.branch_deleted) === true ? "yes" : "no"
        }.`
        : undefined,
    ]),
  };
};

const presentUpgrade: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const schema = object(data.schema);
  return {
    state: defaultState(result),
    evidence: unique([
      schema === undefined
        ? undefined
        : `Schema: recorded ${number(schema.recorded) ?? "none"}; current ${
          number(schema.current) ?? "unknown"
        }.`,
      `Pending migrations: ${records(data.pending_migrations).length}.`,
      `Applied migrations: ${records(data.migrations_applied).length}.`,
      listFact("Changes", strings(data.changes)),
      listFact("Generated agent files", strings(data.agents_written)),
    ]),
  };
};

const presentUninstall: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const worktrees = strings(data.worktrees);
  const resources = strings(data.resources);
  return {
    state: defaultState(result),
    evidence: unique([
      listFact("Removed", strings(data.removed)),
      listFact("Stripped from shared files", strings(data.stripped)),
      listFact("Kept user content", strings(data.kept)),
      text(data.binary_hint),
    ]),
    boundary: unique([
      listFact("Active worktrees block uninstall", worktrees),
      listFact("Provisioned resources block uninstall", resources),
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
      text(data.kit_version) === undefined
        ? undefined
        : `discern version: ${code(data.kit_version)}.`,
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
      listFact("Available presets", strings(data.available)),
      listFact("Written files", strings(data.written)),
    ]),
    supportingMarkdown: text(data.art) === undefined
      ? []
      : [`### Mark\n\n${fencedText(text(data.art) ?? "")}`],
  };
};

const presentDocs: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const doc = object(data.doc);
  const results = records(data.results);
  const docs = records(data.docs);
  const suggestions = records(data.suggestions);
  const title = text(doc?.title);
  const query = text(data.query);
  const state = doc !== undefined
    ? `Returned ${
      title === undefined ? "the requested document" : code(title)
    }.`
    : query !== undefined
    ? `Found ${
      plural(results.length, "documentation match", "documentation matches")
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
        return `${code(target)}${
          suggestionTitle === undefined ? "" : `: ${suggestionTitle}`
        }.`;
      }),
      suggestions.length > MAX_LIST_ITEMS
        ? omitted(suggestions.length - MAX_LIST_ITEMS, "suggestion")
        : undefined,
      ...results.slice(0, MAX_LIST_ITEMS).map((entry) => {
        const target = text(entry.target) ?? "unknown";
        const resultTitle = text(entry.title) ?? target;
        const snippet = text(entry.snippet);
        return `${code(target)}: ${resultTitle}${
          snippet === undefined ? "" : `. ${snippet}`
        }`;
      }),
    ]),
    supportingMarkdown: text(doc?.content) === undefined
      ? []
      : [`### Requested document\n\n${text(doc?.content)}`],
  };
};

const presentConfig: ResultMarkdownPresenter = (result) => {
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
      Array.isArray(data.edits) ? `Edits: ${data.edits.length}.` : undefined,
    ]),
  };
};

const presentGate: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const failedStage = text(data.failed_stage);
  const standards = records(data.standards);
  const proof = object(data.proof);
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
      failedStage === undefined
        ? undefined
        : `Failed stage: ${code(failedStage)}.`,
      listFact("Changed scopes", strings(data.scopes_changed)),
      standards.length === 0
        ? undefined
        : `Standards: ${standards.length} read, ${regressions.length} regressed.`,
      proofLine(proof),
      gateProofFact(data.gate_proof),
    ]),
    boundary: landingBoundary(data),
  };
};

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

const presentStandards: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const standards = records(data.standards);
  const pinned = records(data.pinned);
  return {
    state: defaultState(
      result,
      pinned.length > 0
        ? `Tightened ${plural(pinned.length, "standard limit")}.`
        : `Measured ${plural(standards.length, "standard")}.`,
    ),
    evidence: unique([
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
  };
};

const presentRefresh: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const skills = object(data.skills);
  return {
    state: defaultState(result),
    evidence: unique([
      listFact("Agent files written", strings(data.agents_written)),
      listFact("MCP integrations wired", strings(data.mcp_wired)),
      listFact("Hooks wired", strings(data.hooks_wired)),
      skills === undefined
        ? undefined
        : `Skills: ${number(skills.copied) ?? 0} copied, ${
          number(skills.linked) ?? 0
        } linked, ${number(skills.pruned) ?? 0} pruned.`,
      listFact("Refresh errors", strings(data.errors)),
    ]),
  };
};

const presentImpact: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const membership = object(data.membership);
  const scopes = strings(data.scopes);
  return {
    state: defaultState(
      result,
      membership === undefined
        ? `The current changes affect ${plural(scopes.length, "scope")}.`
        : `${code(membership.scope)} is ${
          boolean(membership.present) === true ? "present" : "absent"
        } in the current impact set.`,
    ),
    evidence: unique([listFact("Affected scopes", scopes)]),
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
      `Waited ${number(data.waited_ms) ?? 0} ms.`,
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
        : `Bytes: ${number(data.bytes)}.`,
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
    }, ${number(entry.ahead) ?? 0} ahead, ${
      number(entry.behind) ?? 0
    } behind, Proof ${code(text(rowProof?.status) ?? "unknown")}.`;
  });
  return {
    state: defaultState(result, state),
    evidence: unique([
      text(data.root) === undefined ? undefined : `Root: ${code(data.root)}.`,
      git === undefined
        ? undefined
        : `Changed files: ${number(git.changed_files) ?? 0}.`,
      listFact("Incoming overlap", strings(git?.incoming_overlap)),
      listFact("Changed scopes", strings(data.scopes)),
      gateProofFact(data.gate_proof),
      fleet.length === 0
        ? undefined
        : `Fleet: ${plural(fleet.length, "active worktree")}.`,
      ...fleetFacts,
      fleet.length > MAX_LIST_ITEMS
        ? omitted(fleet.length - MAX_LIST_ITEMS, "fleet row")
        : undefined,
      records(data.fleet_collisions).length === 0
        ? undefined
        : `Cross-worktree collisions: ${
          records(data.fleet_collisions).length
        }.`,
      records(data.adr_collisions).length === 0
        ? undefined
        : `ADR number collisions: ${records(data.adr_collisions).length}.`,
      listFact(
        "Pending tracked refresh",
        strings(data.pending_tracked_refresh),
      ),
      listFact(
        "Unlanded branches without worktrees",
        strings(data.unlanded_branches),
      ),
    ]),
    boundary: landingBoundary(data),
  };
};

const presentStart: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const path = text(data.path);
  const branch = text(data.branch);
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
      text(data.name_note),
    ]),
    boundary: landingBoundary(data),
  };
};

const presentAccept: ResultMarkdownPresenter = (result) => {
  const data = dataOf(result);
  const consent = object(data.consent);
  const landing = object(data.landing);
  return {
    state: defaultState(
      result,
      text(data.root) === undefined
        ? undefined
        : `Landed the validated tree into ${code(data.root)}.`,
    ),
    evidence: unique([
      text(data.root) === undefined
        ? undefined
        : `Main checkout: ${code(data.root)}.`,
      listFact("Landed scopes", strings(data.scopes_changed)),
      landing === undefined
        ? undefined
        : `Trunk moved: ${
          boolean(landing.trunk_moved) === true ? "yes" : "no"
        }; worktree removed: ${
          boolean(landing.worktree_removed) === true ? "yes" : "no"
        }; branch deleted: ${
          boolean(landing.branch_deleted) === true ? "yes" : "no"
        }.`,
      text(data.proof_line),
      listFact("Authority warnings", strings(data.authority_warnings)),
    ]),
    boundary: consent === undefined
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
      `Behind before update: ${number(data.behind) ?? 0}.`,
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
        return `${code(name)}${
          description === undefined ? "" : `: ${description}`
        }.`;
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
        : `Destination: ${code(data.dest_abs)}.`,
      materialized === undefined
        ? undefined
        : `Materialized skills: ${number(materialized.copied) ?? 0} copied, ${
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
  standards: presentStandards,
  refresh: presentRefresh,
  impact: presentImpact,
  coupling: presentCoupling,
  await: presentAwait,
  patterns: presentPatterns,
  patternsLifecycle: presentPatternsLifecycle,
  status: presentStatus,
  start: presentStart,
  accept: presentAccept,
  update: presentUpdate,
  identity: presentIdentity,
  scripts: presentScripts,
  skillsList: presentSkillsList,
  skillsEject: presentSkillsEject,
} as const satisfies Record<string, ResultMarkdownPresenter>;
