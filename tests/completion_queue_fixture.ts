/** Queue-domain fixtures vary effort count without copying the canonical record contracts. */
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import type { CompletionQueue } from "../src/engine/completion/outcomes.ts";
import type { Candidate } from "../src/engine/completion/candidate.ts";
import { completionFixtures, completionId } from "./completion_fixtures.ts";
import { selectSource } from "../src/engine/landing_queue/model.ts";

/** Build an arbitrary number of independently authored immutable sources. */
export function queueExample(
  count: number,
): { queue: CompletionQueue; candidates: Map<string, Candidate> } {
  const candidate =
    COMPLETION_FAMILIES.candidate.schema.parse(completionFixtures().candidate)
      .data;
  let queue: CompletionQueue = {
    trunk: candidate.expected_predecessor.head,
    entries: [],
  };
  const candidates = new Map<string, Candidate>();
  for (let index = 0; index < count; index++) {
    const id = `effort-${index}`;
    const source = {
      ...candidate.source,
      effort_id: id,
      branch: `refs/heads/agent/${id}`,
      head: (index + 1).toString(16).padStart(40, "0"),
    };
    const selected = selectSource(queue, source, []);
    if (selected.kind !== "changed") {
      throw new Error("Queue fixture source could not be selected.");
    }
    queue = selected.queue;
    candidates.set(completionId(100 + index), {
      ...candidate,
      source,
      head: source.head,
    });
  }
  queue = {
    ...queue,
    entries: queue.entries.map((entry, index) => ({
      ...entry,
      candidate_id: completionId(100 + index),
    })),
  };
  return { queue, candidates };
}

/** Keep authority coordinates disjoint from candidate fixture coordinates. */
export function queueAuthority(index: number): string {
  return completionId(200 + index);
}
