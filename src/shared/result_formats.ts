/**
 * The two explicit CLI result formats.
 *
 * Their names and help copy describe the representation. People, agents, and
 * tools may choose either format for the task at hand.
 */
export const CLI_RESULT_FORMATS = {
  json: {
    flag: "--json",
    description: "Emit one JSON result on stdout.",
  },
  markdown: {
    flag: "--markdown",
    description: "Emit one Markdown result on stdout.",
  },
} as const;

/**
 * Commands whose JSON flag needs semantic copy beyond the inherited global
 * representation description. The live-tree guard permits no other local
 * `--json` declaration.
 */
export const CLI_JSON_DESCRIPTION_OVERRIDES = {
  impact:
    "Emit a JSON result; `--has` reports `data.membership` and exits successfully for either Boolean value.",
  "config has":
    "Emit a JSON result with the predicate in `data.present` and exit successfully for either Boolean value.",
  "patterns reset":
    "Preview as one result; apply is refused with `--json` or `--markdown`.",
  "patterns seal":
    "Preview as one result; apply is refused with `--json` or `--markdown`.",
  status:
    "Emit a bounded orientation result; add `--verbose` for complete structured status.",
  desk:
    "The desk is interactive only; use `status --markdown` or `status --json` to list every worktree.",
  enter:
    "This command is interactive only; use `status --all --json` to inspect the fleet.",
} as const satisfies Readonly<Record<string, string>>;

/** One explicit CLI result-format id. */
export type ResultOutputFormat = keyof typeof CLI_RESULT_FORMATS;

/**
 * Secondary terminal convenience for reading the authored Markdown result.
 * This stays outside {@link CLI_RESULT_FORMATS}: JSON and Markdown remain the
 * explicit result representations and public integration contracts.
 */
export const CLI_RESULT_RENDER = {
  flag: "--render",
  description: "Render the Markdown result as terminal output.",
} as const;
