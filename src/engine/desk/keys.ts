/**
 * The Desk's one key map.
 *
 * Every layer the Desk shows (the inbox with a task, a parked branch, or a
 * landed row selected, the action menu, the palette, a sheet or form, a
 * reader) resolves each key to exactly one meaning: a task action from the
 * action registry, a command from the command registry, or a navigation
 * gesture. Task mnemonics, command keys, and the decision groups a number
 * jumps to come from their registries, never from a copy here; a key that
 * runs a registered control names that control, so its label is read from
 * the vocabulary. The inbox's key bindings, its footer hints, and the keys
 * reader all project this map. The registry guard proves one meaning per key
 * per layer and keeps mnemonics clear of the package's keys.
 */

import {
  DESK_ACTION_REGISTRY,
  DESK_ACTIONS,
  type DeskAction,
  type DeskActionMetadata,
} from "./model.ts";
import {
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  type DeskCommand,
  type DeskCommandMetadata,
  type DeskCommandScope,
} from "./commands.ts";
import {
  FLEET_ROW_DECISIONS,
  type FleetRowGroup,
} from "../../shared/fleet_row_vocabulary.ts";

/** The layers that own the keyboard, bottom to top. */
export const DESK_LAYERS = [
  "inbox",
  "branch",
  "landed",
  "menu",
  "palette",
  "sheet",
  "reader",
] as const;
export type DeskLayer = (typeof DESK_LAYERS)[number];

/** Movement and layer mechanics that are not a registry action or command. */
export type DeskGesture =
  | "move"
  | "first"
  | "last"
  | "page"
  | "next-group"
  | "previous-group"
  | "jump-group"
  | "next-step"
  | "actions"
  | "back"
  | "details"
  | "filter"
  | "palette"
  | "dismiss"
  | "run"
  | "open"
  | "type"
  | "next-button"
  | "previous-button"
  | "next-control"
  | "previous-control"
  | "activate"
  | "toggle-plan"
  | "toggle-command"
  | "toggle-changes"
  | "edit-text"
  | "review-again"
  | "full-output"
  | "open-editor";

/** What one key does in one layer. */
export type DeskKeyMeaning =
  | { readonly kind: "action"; readonly action: DeskAction }
  | { readonly kind: "command"; readonly command: DeskCommand }
  | {
    readonly kind: "gesture";
    readonly gesture: DeskGesture;
    /** The footer and keys-sheet words for it; never a control's label. */
    readonly label: string;
    /**
     * What the keys reader says it does, where the footer's word is too
     * short to stand alone there; keys with the same words share a row.
     */
    readonly reads?: string;
    /** For a group jump, the decision group it selects. */
    readonly group?: FleetRowGroup;
  };

/** One key in one layer. `key` uses the terminal's key names ("up",
 * "ctrl-k") for named keys and the typed character for text keys. */
export interface DeskKeyBinding {
  readonly key: string;
  readonly meaning: DeskKeyMeaning;
  /**
   * False for an alternative the keys reader leaves to the manual, such as
   * Shift with an arrow for paging, so each row stays short.
   */
  readonly listed?: false;
}

/**
 * Keys the package's application runtime reserves on the inbox: list
 * movement, paging, the filter, details zoom and scroll, and the Vi pair. A
 * test holds this list equal to the package's own reservation for the
 * inbox's body; no registry mnemonic or command key may take one.
 */
export const PACKAGE_RESERVED_KEYS = [
  "up",
  "down",
  "home",
  "end",
  "page-up",
  "page-down",
  "tab",
  "shift-tab",
  "enter",
  "shift-up",
  "shift-down",
  "space",
  "left",
  "/",
  "j",
  "k",
] as const;

/**
 * Chords the package's text editor binds for line editing. A sheet's own
 * chords must avoid them, because they must work while a field has focus.
 */
export const EDITOR_RESERVED_CHORDS = [
  "ctrl-a",
  "ctrl-b",
  "ctrl-d",
  "ctrl-e",
  "ctrl-f",
  "ctrl-h",
  "ctrl-n",
  "ctrl-p",
  "ctrl-u",
  "ctrl-w",
] as const;

/** A gesture binding. */
function gesture(
  key: string,
  name: DeskGesture,
  label: string,
  words: { readonly reads?: string; readonly group?: FleetRowGroup } = {},
): DeskKeyBinding {
  return {
    key,
    meaning: {
      kind: "gesture",
      gesture: name,
      label,
      ...(words.reads === undefined ? {} : { reads: words.reads }),
      ...(words.group === undefined ? {} : { group: words.group }),
    },
  };
}

/** A binding the keys reader leaves to the manual. */
function unlisted(binding: DeskKeyBinding): DeskKeyBinding {
  return { ...binding, listed: false };
}

/** The keys reader's words for a group jump, which the Parked key shares. */
export const JUMP_GROUP_READS = "Jump to a group";

/** Every registered action's mnemonic, read from the action registry. */
function actionKeys(): DeskKeyBinding[] {
  return DESK_ACTIONS.flatMap((action) => {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    return metadata.key === undefined
      ? []
      : [{ key: metadata.key, meaning: { kind: "action", action } }];
  });
}

/** A key that runs one registered task action from another layer. */
function runs(key: string, action: DeskAction): DeskKeyBinding {
  return { key, meaning: { kind: "action", action } };
}

/** A key that runs one registered command. */
function calls(key: string, command: DeskCommand): DeskKeyBinding {
  return { key, meaning: { kind: "command", command } };
}

/** Every keyed command of one scope, read from the command registry. */
function commandKeys(scope: DeskCommandScope): DeskKeyBinding[] {
  return DESK_COMMANDS.flatMap((command) => {
    const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
    return metadata.key === undefined || metadata.scope !== scope
      ? []
      : [{ key: metadata.key, meaning: { kind: "command", command } }];
  });
}

/** List movement shared by the inbox with a task or a branch selected. */
const LIST_GESTURES = [
  gesture("up", "move", "Move"),
  gesture("down", "move", "Move"),
  gesture("k", "move", "Move"),
  gesture("j", "move", "Move"),
  gesture("home", "first", "First row", { reads: "First or last row" }),
  gesture("end", "last", "Last row", { reads: "First or last row" }),
  gesture("tab", "next-group", "Next group", {
    reads: "Next or previous group",
  }),
  gesture("shift-tab", "previous-group", "Previous group", {
    reads: "Next or previous group",
  }),
  gesture("page-up", "page", "Scroll details"),
  gesture("page-down", "page", "Scroll details"),
  unlisted(gesture("shift-up", "page", "Scroll details")),
  unlisted(gesture("shift-down", "page", "Scroll details")),
  gesture("space", "details", "Details", { reads: "Zoom details" }),
  gesture("/", "filter", "Filter"),
  gesture("escape", "dismiss", "Clear", {
    reads: "Clear filter, leave zoom",
  }),
  gesture("ctrl-k", "palette", "Commands"),
  gesture(":", "palette", "Commands"),
  unlisted(calls("ctrl-c", "quit")),
  // One number per decision group, in status's display order.
  ...FLEET_ROW_DECISIONS.map((group, index) =>
    gesture(String(index + 1), "jump-group", "Go to group", {
      reads: JUMP_GROUP_READS,
      group,
    })
  ),
  ...commandKeys("global"),
] as const;

/**
 * Zoom's words for the package keys it gives its own meanings: Up and Down
 * walk to the next task, Left returns.
 */
export const ZOOM_HINT_LABELS = { walk: "Next task", back: "Back" } as const;

/** The one key map, per layer. */
export const DESK_KEYS: Readonly<Record<DeskLayer, readonly DeskKeyBinding[]>> =
  {
    inbox: [
      ...LIST_GESTURES,
      gesture("enter", "next-step", "Next step"),
      gesture("right", "actions", "Actions"),
      gesture(".", "actions", "Actions"),
      ...actionKeys(),
    ],
    branch: [
      ...LIST_GESTURES,
      gesture("enter", "next-step", "Next step"),
      gesture("right", "actions", "Actions"),
      gesture(".", "actions", "Actions"),
      ...commandKeys("parked-row"),
    ],
    landed: [
      ...LIST_GESTURES,
      gesture("enter", "next-step", "Next step"),
      ...commandKeys("landed-row"),
    ],
    menu: [
      gesture("up", "move", "Move"),
      gesture("down", "move", "Move"),
      gesture("tab", "next-group", "Next section"),
      gesture("shift-tab", "previous-group", "Previous section"),
      gesture("page-up", "page", "Page"),
      gesture("page-down", "page", "Page"),
      gesture("enter", "run", "Run"),
      gesture("right", "run", "Run"),
      gesture("left", "back", "Back"),
      gesture("escape", "back", "Back"),
      gesture("/", "filter", "Filter"),
      calls("ctrl-c", "quit"),
      ...actionKeys(),
    ],
    palette: [
      gesture("up", "move", "Move"),
      gesture("down", "move", "Move"),
      gesture("page-up", "page", "Page"),
      gesture("page-down", "page", "Page"),
      gesture("enter", "run", "Run"),
      gesture("escape", "dismiss", "Close"),
      calls("ctrl-c", "quit"),
    ],
    sheet: [
      gesture("left", "previous-button", "Buttons", {
        reads: "Move between buttons",
      }),
      gesture("right", "next-button", "Buttons", {
        reads: "Move between buttons",
      }),
      gesture("tab", "next-control", "Next field"),
      gesture("shift-tab", "previous-control", "Previous field"),
      gesture("enter", "activate", "Choose"),
      gesture("escape", "dismiss", "Keep", { reads: "The safe choice" }),
      gesture("up", "page", "Scroll"),
      gesture("down", "page", "Scroll"),
      gesture("page-up", "page", "Read more"),
      gesture("page-down", "page", "Read more"),
      gesture("d", "toggle-plan", "Plan", { reads: "Technical plan" }),
      gesture("c", "toggle-command", "Command"),
      gesture("v", "toggle-changes", "Changes"),
      gesture("ctrl-t", "toggle-plan", "Plan", { reads: "Technical plan" }),
      gesture("ctrl-x", "toggle-command", "Command"),
      gesture("ctrl-g", "toggle-changes", "Changes"),
      gesture("ctrl-o", "edit-text", "Edit"),
      // A sheet's alternatives switch to another registered action.
      runs("p", "park"),
      runs("a", "agent"),
      runs("u", "update"),
      gesture("o", "full-output", "Full output"),
      gesture("r", "review-again", "Review again"),
      calls("ctrl-c", "quit"),
    ],
    reader: [
      gesture("up", "move", "Scroll"),
      gesture("down", "move", "Scroll"),
      gesture("page-up", "page", "Page"),
      gesture("page-down", "page", "Page"),
      gesture("tab", "next-control", "Next row"),
      gesture("shift-tab", "previous-control", "Previous row"),
      gesture("enter", "open", "Open"),
      gesture("escape", "dismiss", "Close"),
      gesture("left", "back", "Back"),
      gesture("o", "full-output", "Full diff"),
      gesture("e", "open-editor", "Open in editor"),
      runs("s", "jump"),
      calls("x", "main_scripts"),
      calls("m", "manual"),
      calls("ctrl-c", "quit"),
    ],
  };

/** The sheet chords that work in every focus state, a text field included. */
export function sheetFieldChords(): readonly DeskKeyBinding[] {
  return DESK_KEYS.sheet.filter((binding) => binding.key.startsWith("ctrl-"));
}
