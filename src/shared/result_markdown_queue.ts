/**
 * Queue-aware helpers for the Markdown result presentations: the status and
 * acceptance queue facts derived from submission rows, and the checkpoint
 * lines several presenters share.
 */
import {
  code,
  displayBranch,
  number,
  object,
  plural,
  records,
  strings,
  text,
} from "./result_markdown_values.ts";

/** Outstanding emergency checks stay visible wherever normal completion state is presented. */
export function emergencyValidationFacts(
  data: Record<string, unknown>,
): string[] {
  return records(data.emergency_validation).map((row) =>
    `Emergency ${code(row.landing_id)}: validation ${
      text(row.state) ?? "outstanding"
    }. ${text(row.next_action) ?? ""}`
  );
}

/** Close a fact as one sentence without doubling an existing terminator. */
export function closedSentence(fact: string): string {
  return /[.!?]$/.test(fact) ? fact : `${fact}.`;
}

/** One human-readable authority label per submission row — shared by every surface. */
export function submissionRowAuthorityLabel(
  row: { readonly authority?: unknown },
): string {
  return text(row.authority) === "pre-authorized"
    ? "pre-authorized"
    : "awaiting the owner";
}

/**
 * One queue row as one line: position, branch, submitted commit, authority,
 * then either "ready" or the single reason it waits. `currentEffort` marks the
 * caller's own row. Every surface derives the row from these words.
 */
export function submissionRowLine(
  row: Record<string, unknown>,
  currentEffort: string | undefined,
  options: { readonly code: boolean } = { code: true },
): string {
  const branch = displayBranch(text(row.branch) ?? "unknown");
  const name = options.code ? code(branch) : branch;
  const head = text(row.head);
  const mine = currentEffort !== undefined && text(row.effort) === currentEffort
    ? " (this effort)"
    : "";
  const readiness = text(row.readiness) === "ready"
    ? "ready"
    : text(row.reason) ?? "waiting";
  return `Queue ${number(row.position) ?? "?"}: ${name}${
    head === undefined ? "" : ` at ${head.slice(0, 12)}`
  }${mine} — ${submissionRowAuthorityLabel(row)}; ${
    /[.!?]$/.test(readiness) ? readiness : `${readiness}.`
  }`;
}

/** Bounded status queue lines with the current checkout's own effort marked. */
export function statusQueueFacts(
  data: Record<string, unknown>,
  limit: number,
): { lines: string[]; overflow: number } {
  const rows = records(data.queue);
  const currentEffort = text(object(data.worktree)?.id);
  const lines = rows.slice(0, limit).map((row) =>
    submissionRowLine(row, currentEffort)
  );
  return { lines, overflow: Math.max(0, rows.length - limit) };
}

/** One checkpoint row's compact state phrase, from the serialized fields. */
export function checkpointRowLine(row: Record<string, unknown>): string {
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
export function checkpointEconomicsLine(row: Record<string, unknown>): string {
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
