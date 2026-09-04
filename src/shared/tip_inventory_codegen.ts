/**
 * Render the internal tip inventory from the live registry. The committed page
 * is a generated audit surface; it has no hand-maintained entry list.
 *
 * Unlike the hint inventory's id-sorted sections, entries here follow the
 * registry's authored order: that order is the Desk's teaching curriculum
 * (ADR 0234), and the inventory exists partly so a curriculum review can read
 * it as the Desk will teach it.
 */

import {
  type RegisteredTip,
  renderTipCli,
  TIP_COVERAGE_DELIBERATELY_ABSENT,
  TIP_RENDERED_LENGTH_LIMIT,
  TIPS,
} from "./tips.ts";
import { markdownBlockquote } from "./markdown_blockquote.ts";
import { GENERATED_INVENTORY_POLICIES } from "../../scripts/generated_inventory_policy.ts";

/** Render one registry entry with its registered example parameters. */
function renderEntry(tip: RegisteredTip): string {
  const when = tip.when.trim();
  if (when === "") {
    throw new Error(`tip ${tip.id} has no relevance context`);
  }
  if (/\r|\n/.test(when)) {
    throw new Error(`tip ${tip.id} has a multi-line relevance context`);
  }
  // The inventory shows the line exactly as the Desk delivers it: command
  // references in their CLI spelling, at full width.
  const line = renderTipCli(tip);
  const features = tip.features.map((id) => `\`${id}\``).join(", ");
  const followThrough = tip.followThrough === undefined
    ? "—"
    : `\`${tip.followThrough.kind}\` (${
      tip.followThrough.verbs.map((verb) => `\`${verb}\``).join(", ")
    })`;
  return [
    `## \`${tip.id}\``,
    "",
    `- Relevance: ${when}`,
    `- Predicate: ${
      tip.predicate === undefined ? "—" : `\`${tip.predicate.kind}\``
    }`,
    `- Since: ${tip.since === undefined ? "—" : `\`${tip.since}\``}`,
    `- Teaches: ${features}`,
    `- Follow-through: ${followThrough}`,
    "",
    "Rendered line:",
    "",
    markdownBlockquote(line),
  ].join("\n");
}

/** Render the feature-and-verb members deliberately left out of the tips. */
function renderAbsenceLedger(): string {
  const rows = Object.entries(TIP_COVERAGE_DELIBERATELY_ABSENT)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([member, reason]) =>
      `| \`${member}\` | ${reason.replaceAll("|", "\\|")} |`
    );
  return [
    "## Coverage absences",
    "",
    "The enrollment guard derives every feature node and top-level verb from its live registry. A member without a tip appears here with the reason. An unexplained member fails the gate.",
    "",
    "| Member | Why it has no tip |",
    "| ------ | ----------------- |",
    ...rows,
  ].join("\n");
}

/** Render the complete tip inventory, in curriculum (authored) order. */
export function renderTipInventoryDoc(): string {
  const policy = GENERATED_INVENTORY_POLICIES.tips;
  const framing = policy.framing.map((paragraph) =>
    paragraph.replace(
      "{{TIP_RENDERED_LENGTH_LIMIT}}",
      String(TIP_RENDERED_LENGTH_LIMIT),
    )
  );
  return [
    policy.banner,
    "",
    `# ${policy.title}`,
    "",
    `_${policy.subtitle}_`,
    "",
    ...framing.flatMap((paragraph) => [paragraph, ""]),
    TIPS.map(renderEntry).join("\n\n"),
    "",
    renderAbsenceLedger(),
    "",
  ].join("\n");
}
