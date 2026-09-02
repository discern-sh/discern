/**
 * The compact launch-audit digest is a total projection of the authored audit:
 * every future finding and fixer batch enrolls automatically, while evidence
 * and recommendations remain in the authority instead of being copied.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  LAUNCH_LOCKDOWN_AUDIT_REL,
  LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL,
  parseLaunchLockdownAudit,
  renderLaunchLockdownAuditSummary,
} from "../scripts/launch_lockdown_audit_summary.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

/** Read the authored audit that owns every projected finding fact. */
async function sourceAudit(): Promise<string> {
  return await Deno.readTextFile(join(REPO_ROOT, LAUNCH_LOCKDOWN_AUDIT_REL));
}

/** Read the committed generated digest. */
async function committedDigest(): Promise<string> {
  return await Deno.readTextFile(
    join(REPO_ROOT, LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL),
  );
}

Deno.test("the launch-audit digest matches its dedicated generator", async () => {
  const source = await sourceAudit();
  const rendered = renderLaunchLockdownAuditSummary(
    parseLaunchLockdownAudit(source),
  );
  assertEquals(
    await committedDigest(),
    await canonicalGeneratedMarkdown(
      join(REPO_ROOT, LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL),
      rendered,
    ),
    `${LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL} is stale — run \`deno task launch-audit-summary\``,
  );
});

Deno.test("the digest indexes every source finding once and stays compact", async () => {
  const source = await sourceAudit();
  const audit = parseLaunchLockdownAudit(source);
  const rendered = renderLaunchLockdownAuditSummary(audit);
  const sourceIds = [...source.matchAll(/^#### (L-\d{3}) /gm)].map((match) =>
    match[1] ?? ""
  );
  const renderedIds = [...rendered.matchAll(/^- \*\*(L-\d{3})\*\* — /gm)].map(
    (match) => match[1] ?? "",
  );
  assertEquals(
    renderedIds,
    sourceIds,
    "the compact index must preserve every finding exactly once in source order",
  );
  assert(
    rendered.length * 5 < source.length,
    "the digest must remain less than one fifth of the full audit",
  );
  assert(!rendered.includes("Evidence:"), "the digest must not copy evidence");
  assert(
    !rendered.includes("Why it matters:"),
    "the digest must not copy consequence prose",
  );
  assert(
    !rendered.includes("Proposed fix:"),
    "the digest must not copy recommendations",
  );
  for (const finding of audit.findings) {
    assert(finding.batches.length > 0, `${finding.id} needs a fixer batch`);
  }
});

Deno.test("a future finding enrolls in parsing, rendering, and batch membership", async () => {
  const source = await sourceAudit();
  const current = parseLaunchLockdownAudit(source);
  const nextId = `L-${String(current.findings.length + 1).padStart(3, "0")}`;
  const delegationAt = source.indexOf("\n## Delegation batches");
  assert(delegationAt >= 0, "fixture needs the delegation-batches section");
  const findingBlock = [
    "",
    `#### ${nextId} Synthetic future finding`,
    "",
    "Class: guard-gap · Surface: test · Confidence: high · Verdict: unverified — no skeptic pass · Irreversible after tag: no · Sources: synthetic-1",
    "",
  ].join("\n");
  let mutated = source.slice(0, delegationAt) + findingBlock +
    source.slice(delegationAt);

  const coverageAt = mutated.indexOf("\n## Coverage");
  assert(coverageAt >= 0, "fixture needs the coverage section");
  const lastBatchFindingsAt = mutated.slice(0, coverageAt).lastIndexOf(
    "- **Findings:**",
  );
  assert(lastBatchFindingsAt >= 0, "fixture needs a batch findings line");
  const batchLineEnd = mutated.indexOf("\n", lastBatchFindingsAt);
  assert(batchLineEnd >= 0, "batch findings line needs a newline");
  mutated = mutated.slice(0, batchLineEnd) + `, ${nextId}` +
    mutated.slice(batchLineEnd);

  const future = parseLaunchLockdownAudit(mutated);
  assertEquals(future.findings.length, current.findings.length + 1);
  assertEquals(future.findings.at(-1)?.id, nextId);
  assert((future.findings.at(-1)?.batches.length ?? 0) > 0);
  assertStringIncludes(
    renderLaunchLockdownAuditSummary(future),
    `**${nextId}**`,
  );
});
