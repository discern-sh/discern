/** POSIX command evidence shared by human-facing plans and diagnostics. */

/** Quote one argv word so the displayed command can be copied without change. */
export function quoteCommandWord(word: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Render exact argv as one safely quoted, copyable command. */
export function commandEvidence(argv: readonly string[]): string {
  return argv.map(quoteCommandWord).join(" ");
}
