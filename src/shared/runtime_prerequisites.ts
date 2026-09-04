/** External commands the installed binary requires for ordinary project use. */
export const REQUIRED_RUNTIME_TOOLS = ["git", "sh"] as const;

/** Reader-facing rendering shared by the reference-doc contract tests. */
export function runtimePrerequisitesPhrase(): string {
  return "`git` and a POSIX `sh`";
}
