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
