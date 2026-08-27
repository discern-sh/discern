/** The public Desk action table is an exact projection of its typed registry. */

import { assert, assertEquals } from "@std/assert";
import {
  DESK_ACTION_REGISTRY,
  DESK_ACTIONS,
  type DeskConfirmationPolicy,
} from "../src/engine/desk/model.ts";
import { splitRow } from "../src/lib/markdown.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

const START = "<!-- BEGIN DESK ACTION REGISTRY -->";
const END = "<!-- END DESK ACTION REGISTRY -->";

/** Preserve contextual placeholders without letting Markdown parse HTML tags. */
function proseCell(value: string): string {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Project the registry's safe confirmation policy into one stable table cell. */
function confirmationCell(policy: DeskConfirmationPolicy): string {
  if (policy.kind === "none") return "None";
  return policy.kind === "typed-branch"
    ? `No by default; ${policy.yesLabel}, then type the branch before discarding work`
    : `No by default; ${policy.yesLabel}`;
}

/** Project every checked-in action row from the action-fact authority. */
function actionReferenceRows(): string[][] {
  const context = {
    trunk: "<trunk>",
    branch: "<branch>",
    path: "<path>",
    containedIn: "<later-branch>",
    proofHonored: false,
  };
  const rows = DESK_ACTIONS.map((action) => {
    const metadata = DESK_ACTION_REGISTRY[action];
    const labels = [
      metadata.label(context),
      metadata.label({ ...context, proofHonored: true }),
    ].filter((label, index, all) => all.indexOf(label) === index);
    const group = metadata.group.charAt(0).toUpperCase() +
      metadata.group.slice(1);
    return [
      `\`${action}\``,
      group,
      proseCell(labels.join(" / ")),
      `\`${metadata.command(context).argv.join(" ")}\``,
      confirmationCell(metadata.confirmation),
    ];
  });
  return rows;
}

Deno.test("the public Desk action table matches the canonical registry", async () => {
  const path = `${REPO_AUTHORED_PATHS.manual}/10-guides/delegate-work.md`;
  const source = await Deno.readTextFile(path);
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  assert(start >= 0 && end > start, `${path} is missing the action table`);
  const lines = source.slice(start + START.length, end).trim().split("\n");
  const header = lines.shift();
  const divider = lines.shift();
  assert(header !== undefined && divider !== undefined);
  assertEquals(splitRow(header), [
    "Id",
    "Group",
    "Contextual label",
    "Command evidence",
    "Confirmation",
  ]);
  assertEquals(
    splitRow(divider).map((cell) => /^-+$/u.test(cell)),
    [true, true, true, true, true],
  );
  assertEquals(
    lines.map(splitRow),
    actionReferenceRows(),
    `${path} has stale Desk action facts; update it from DESK_ACTION_REGISTRY`,
  );
});
