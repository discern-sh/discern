/**
 * The compact launch-audit digest is a total projection of the authored audit:
 * every future finding and fixer batch enrolls automatically, while evidence
 * and recommendations remain in the authority instead of being copied.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  LAUNCH_LOCKDOWN_AUDIT_REL,
  LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL,
  parseLaunchLockdownAudit,
  renderLaunchLockdownAuditSummary,
} from "../scripts/launch_lockdown_audit_summary.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const PROGRAMME_README_REL =
  "project/map/_private/planning/launch-lockdown-workstreams/README.md";

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
    [...renderedIds].sort(),
    [...sourceIds].sort(),
    "the compact index must preserve every finding",
  );
  assertEquals(
    new Set(renderedIds).size,
    renderedIds.length,
    "the compact index must render every finding exactly once",
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

  const completedHeading = rendered.indexOf("\n## Completed (");
  const activeProjection = completedHeading < 0
    ? rendered
    : rendered.slice(0, completedHeading);
  const completedProjection = completedHeading < 0
    ? ""
    : rendered.slice(completedHeading);
  const completedFindings = audit.findings.filter((finding) =>
    finding.completion !== undefined
  );
  const activeFindings = audit.findings.filter((finding) =>
    finding.completion === undefined
  );
  for (const finding of activeFindings) {
    assertStringIncludes(activeProjection, `**${finding.id}**`);
  }
  for (const finding of completedFindings) {
    assert(!activeProjection.includes(`**${finding.id}**`));
    assertStringIncludes(completedProjection, `**${finding.id}**`);
    assertStringIncludes(completedProjection, finding.completion ?? "");
  }
  assertStringIncludes(
    rendered,
    `${completedFindings.length} completed`,
  );
  const activeIds = new Set(activeFindings.map((finding) => finding.id));
  for (const batch of audit.batches) {
    const activeCount = batch.findingIds.filter((id) =>
      activeIds.has(id)
    ).length;
    assertStringIncludes(
      rendered,
      `**${batch.id}** — ${batch.title} · ${activeCount} active / ${batch.findingIds.length} total`,
    );
  }
});

/** Expand the compact D-01–D-03 notation used by the closeout table. */
function decisionIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/D-(\d{2})(?:–D-(\d{2}))?/g)) {
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    for (let value = first; value <= last; value++) {
      ids.push(`D-${String(value).padStart(2, "0")}`);
    }
  }
  return ids;
}

Deno.test("the programme closeout accounts for every finding and decision", async () => {
  const source = await sourceAudit();
  const audit = parseLaunchLockdownAudit(source);
  assertEquals(
    audit.findings.filter((finding) => finding.completion === undefined),
    [],
    "every finding needs a completion or routing outcome",
  );
  assertEquals(audit.findings.length, 186);
  assertEquals(
    audit.findings
      .filter((finding) => /\brouted\b/iu.test(finding.completion ?? ""))
      .map((finding) => finding.id),
    ["L-034", "L-037", "L-074", "L-098"],
  );

  const programme = await Deno.readTextFile(
    join(REPO_ROOT, PROGRAMME_README_REL),
  );
  const accountingStart = programme.indexOf("\n## Final accounting");
  const accountingEnd = programme.indexOf(
    "\n## External joins",
    accountingStart,
  );
  assert(accountingStart >= 0 && accountingEnd > accountingStart);
  const accounting = programme.slice(accountingStart, accountingEnd);
  const decisionRows = accounting.split("\n").filter((line) => {
    const carrier = line.split("|")[1]?.trim();
    return carrier !== undefined && /^[1-6]A$/.test(carrier);
  });
  const accounted = decisionRows.flatMap(decisionIds);
  const declared = [...source.matchAll(/^\d+\. \[x\] \*\*(D-\d{2}) /gm)]
    .map((match) => match[1] ?? "");
  assertEquals(new Set(accounted).size, accounted.length);
  assertEquals(
    accounted.toSorted(),
    declared.toSorted(),
    "the decision table must name every settled decision exactly once",
  );
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

  const metadata =
    "Class: guard-gap · Surface: test · Confidence: high · Verdict: unverified — no skeptic pass · Irreversible after tag: no · Sources: synthetic-1";
  const completion =
    "Synthetic future finding proved that completed members enroll.";
  const completedFuture = parseLaunchLockdownAudit(
    mutated.replace(metadata, `${metadata}\n\nCompleted: ${completion}`),
  );
  assertEquals(completedFuture.findings.at(-1)?.completion, completion);
  const completedRendered = renderLaunchLockdownAuditSummary(completedFuture);
  const completedAt = completedRendered.indexOf("\n## Completed (");
  assert(completedAt >= 0);
  assert(
    !completedRendered.slice(0, completedAt).includes(`**${nextId}**`),
    "a completed future finding must leave the active projection",
  );
  assertStringIncludes(completedRendered.slice(completedAt), `**${nextId}**`);
  assertStringIncludes(completedRendered.slice(completedAt), completion);
});

Deno.test("completion outcomes are non-empty, unique metadata-adjacent paragraphs", async () => {
  const source = await sourceAudit();
  const headingAt = source.indexOf("\n#### L-001 ");
  assert(headingAt >= 0, "fixture needs L-001");
  const metadataAt = source.indexOf("\nClass: ", headingAt);
  assert(metadataAt >= 0, "fixture needs L-001 metadata");
  const metadataEnd = source.indexOf("\n", metadataAt + 1);
  assert(metadataEnd >= 0, "fixture needs a complete metadata line");
  const before = source.slice(0, metadataEnd);
  const after = source.slice(metadataEnd).replace(
    /^\n\nCompleted: [^\n]+\n\n/,
    "\n\n",
  );

  assertThrows(
    () => parseLaunchLockdownAudit(`${before}\n\nCompleted:${after}`),
    Error,
    "empty Completed outcome",
  );
  assertThrows(
    () =>
      parseLaunchLockdownAudit(
        `${before}\n\nCompleted: first\n\nCompleted: second${after}`,
      ),
    Error,
    "more than one Completed line",
  );
  assertThrows(
    () =>
      parseLaunchLockdownAudit(
        `${before}\n\nProgress: partial\n\nCompleted: misplaced${after}`,
      ),
    Error,
    "must put Completed in its own first paragraph after metadata",
  );
  assertThrows(
    () =>
      parseLaunchLockdownAudit(
        `${before} Completed: formatter-collapsed${after}`,
      ),
    Error,
    "must put Completed in its own paragraph after metadata",
  );
});
