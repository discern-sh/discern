/** Authored project knowledge shared by gotchas resolution and transport tests. */
export const EXIT_127_TITLE = "A gate command fails with exit 127 (command not found)";

export const PROJECT_GOTCHAS = [
  "# Project recovery notes",
  "",
  `### ${EXIT_127_TITLE}`,
  "",
  "Install the project's required tools through `[repository].ensure`.",
  "",
  "```gotcha-match",
  "evidence = 'failed \\(exit 127\\)'",
  "```",
  "",
].join("\n");
