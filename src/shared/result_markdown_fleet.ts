/** Fleet-row facts for the status Markdown presentation. */

import {
  boolean,
  code,
  number,
  object,
  text,
} from "./result_markdown_values.ts";

/** One fact for a configured env file that status could not read. */
export function readFailureFact(value: unknown): string | undefined {
  const failure = object(value);
  const file = text(failure?.file);
  const reason = text(failure?.reason);
  if (file === undefined || reason === undefined) return undefined;
  return `Env file ${code(file)} is unreadable: ${code(reason)}.`;
}

/** One fleet row's Git state, divergence, Proof status, and any failed read
 * as a single line. */
export function statusFleetRowFact(entry: Record<string, unknown>): string {
  const rowBranch = text(entry.branch) ?? "unknown branch";
  const unreadable = readFailureFact(entry.read_failure);
  const suffix = unreadable === undefined ? "" : ` ${unreadable}`;
  if (boolean(entry.git_unavailable) === true) {
    return `${code(rowBranch)}: Git state unavailable.${suffix}`;
  }
  const rowProof = object(entry.gate_proof);
  return `${code(rowBranch)}: ${
    boolean(entry.clean) === true ? "clean" : "dirty"
  }, ${number(entry.ahead) ?? "unknown"} ahead, ${
    number(entry.behind) ?? "unknown"
  } behind, Proof ${code(text(rowProof?.status) ?? "unknown")}.${suffix}`;
}
