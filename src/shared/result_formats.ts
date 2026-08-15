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
