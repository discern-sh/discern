/** The public Desk action table is an exact projection of its typed registry. */

import { assert, assertEquals } from "@std/assert";
import {
  DESK_ACTION_REGISTRY,
  DESK_ACTION_SECTION_TITLES,
  DESK_ACTIONS,
  type DeskActionContext,
  type DeskActionMetadata,
  type DeskConfirmationPolicy,
} from "../src/engine/desk/model.ts";
import { DESK_ACTION_LABELS } from "../src/shared/desk_vocabulary.ts";
import { deskKeymap } from "../src/engine/desk/inbox_view.ts";
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

/** The keys this desk answers to. The manual names an action's key only
 * once the desk serves it, so it never documents a key that does nothing. */
const SERVED_KEYS: ReadonlySet<string> = new Set(
  deskKeymap().map((binding) => binding.key),
);

/** An action's key, when the desk answers to it. */
function servedKey(action: (typeof DESK_ACTIONS)[number]): string | undefined {
  const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
  const key = metadata.key;
  return key !== undefined && SERVED_KEYS.has(key) ? key : undefined;
}

/** Whether the table has a Key column: only while some action key works. */
const KEYED = DESK_ACTIONS.some((action) => servedKey(action) !== undefined);

/** The table's columns, in order. */
const HEADER = [
  "Id",
  ...(KEYED ? ["Key"] : []),
  "Section",
  "Label",
  "Command evidence",
  "Confirmation",
];

/** Project every checked-in action row from the action-fact authority. */
function actionReferenceRows(): string[][] {
  const context: DeskActionContext = {
    trunk: "<trunk>",
    title: "<task>",
    branch: "<branch>",
    path: "<path>",
    containedIn: "<later-branch>",
    proofHonored: false,
    taskMetadataRecorded: true,
    effortGranted: false,
    proofRecorded: false,
    queued: false,
    changedFiles: 0,
    ahead: 1,
    behind: 0,
    resources: ["<resource>"],
  };
  return DESK_ACTIONS.map((action) => {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    const key = servedKey(action);
    return [
      `\`${action}\``,
      ...(KEYED ? [key === undefined ? "—" : `\`${key}\``] : []),
      DESK_ACTION_SECTION_TITLES[metadata.section],
      proseCell(DESK_ACTION_LABELS[action]),
      `\`${metadata.command(context).argv.join(" ")}\``,
      confirmationCell(metadata.confirmation),
    ];
  });
}

Deno.test("the public Desk action table matches the canonical registry", async () => {
  const path =
    `${REPO_AUTHORED_PATHS.manual}/30-reference/worktrees-and-status.md`;
  const source = await Deno.readTextFile(path);
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  assert(start >= 0 && end > start, `${path} is missing the action table`);
  const lines = source.slice(start + START.length, end).trim().split("\n");
  const header = lines.shift();
  const divider = lines.shift();
  assert(header !== undefined && divider !== undefined);
  assertEquals(splitRow(header), HEADER);
  assertEquals(
    splitRow(divider).map((cell) => /^-+$/u.test(cell)),
    HEADER.map(() => true),
  );
  assertEquals(
    lines.map(splitRow),
    actionReferenceRows(),
    `${path} has stale Desk action facts; update it from DESK_ACTION_REGISTRY`,
  );
});
