/**
 * Queue-aware helpers for the Markdown result presentations: the status
 * queue facts, and the acceptance presentation's selected-effort
 * organisation — its verdict line first, other efforts labelled after it.
 */
import { checkoutOutcomeSentence } from "./result_completion.ts";
import {
  boolean,
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

/** One human-readable state label per queue row — shared by every surface. */
export function queueRowStateLabel(
  row: { readonly readiness?: unknown; readonly held?: unknown },
): string {
  return text(row.readiness) === "ready"
    ? "ready to land"
    : text(row.readiness) === "landing"
    ? "landing now"
    : boolean(row.held) === true
    ? "on hold"
    : "waiting";
}

/**
 * The selected effort's one-sentence verdict — one derivation for the
 * terminal message and every rendered presentation. An absent `state` means
 * the effort has no row at all: it has not validated.
 */
export function selectedVerdictSentence(input: {
  readonly branch: string;
  readonly state: string | undefined;
  readonly dryRun: boolean;
  readonly checkout?: {
    readonly retirement?: unknown;
    readonly retirement_reason?: unknown;
  };
}): string {
  const name = code(input.branch);
  if (input.state === undefined) {
    return `Selected effort ${name}: not validated. Run discern done from its clean committed worktree, then retry acceptance.`;
  }
  if (input.state === "landed") {
    return `Selected effort ${name}: landed. ${
      checkoutOutcomeSentence(input.checkout ?? {})
    }`;
  }
  if (input.state === "ready") {
    return `Selected effort ${name}: ready to land.`;
  }
  return `Selected effort ${name}: ${
    input.dryRun ? "not ready" : "not landed"
  }.`;
}

/** Bounded status queue lines: position, branch, state, single reason, with
 * the current checkout's own effort marked. */
export function statusQueueFacts(
  data: Record<string, unknown>,
  limit: number,
): { lines: string[]; overflow: number } {
  const rows = records(data.queue);
  const currentEffort = text(object(data.worktree)?.id);
  const lines = rows.slice(0, limit).map((row) => {
    const reason = text(row.reason);
    const mine = currentEffort !== undefined &&
        text(row.effort) === currentEffort
      ? " (this effort)"
      : "";
    return `Queue ${number(row.position) ?? "?"}: ${
      code(displayBranch(text(row.branch) ?? "unknown"))
    }${mine} — ${queueRowStateLabel(row)}${
      reason === undefined ? "." : `: ${reason}`
    }`;
  });
  return { lines, overflow: Math.max(0, rows.length - limit) };
}

/** The acceptance rows in presentation order with the selected effort's
 * verdict and per-row label. `rows` leads with the selected effort's row when
 * one is marked; `verdict` is its one-sentence state line. Labels come from
 * each row's recorded relation to the selected effort. */
export function acceptOrganization(
  data: Record<string, unknown>,
  dryRun: boolean,
): {
  rows: Record<string, unknown>[];
  own: Record<string, unknown> | undefined;
  verdict: string | undefined;
  label: (row: Record<string, unknown>) => string;
} {
  const prefixes = records(data.queue);
  const selected = text(data.selected_effort);
  const own = selected === undefined
    ? undefined
    : prefixes.find((row) => text(row.effort) === selected);
  const rows = own === undefined
    ? prefixes
    : [own, ...prefixes.filter((row) => row !== own)];
  const verdict = selected === undefined ? undefined : selectedVerdictSentence({
    branch: displayBranch(text(own?.branch) ?? selected),
    state: own === undefined ? undefined : text(own.state),
    dryRun,
    ...(own === undefined ? {} : { checkout: own }),
  });
  return {
    rows,
    own,
    verdict,
    label: (row) => {
      const name = code(text(row.branch) ?? "candidate");
      switch (text(row.relation)) {
        case "ahead":
          return `Ahead in the queue — ${name}`;
        case "behind":
          return `Behind in the queue — ${name}`;
        case "other":
          return `Other effort — ${name}`;
        default:
          return name;
      }
    },
  };
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
