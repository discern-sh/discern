/**
 * The two explicit CLI result formats.
 *
 * Their names and help copy describe the representation. People, agents, and
 * tools may choose either format for the task at hand.
 */
export const CLI_RESULT_FORMATS = {
  json: {
    flag: "--json",
    description: "Print the result as one JSON document on stdout.",
  },
  markdown: {
    flag: "--markdown",
    description: "Print the result as one Markdown document on stdout.",
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
  description: "Print the Markdown result formatted for the terminal.",
} as const;
