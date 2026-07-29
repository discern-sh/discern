/** Shared scanners for backticked `discern …` command spans, used by the
 * hint command guard and the surface-rendering guard. */

/** Extract Markdown code spans whose content is a `discern` command. */
export function quotedDiscernCommands(text: string): string[] {
  const commands: string[] = [];
  for (const match of text.matchAll(/`([^`\r\n]+)`/gu)) {
    const code = (match[1] ?? "").trim();
    if (/^discern(?:\s|$)/u.test(code)) commands.push(code);
  }
  return commands;
}

/**
 * Extract backticked `discern …` spans from SOURCE text — TypeScript, not
 * rendered prose. Code spans appear there in two spellings: `\`…\`` inside a
 * template literal and bare `` ` `` inside a quoted string. The escaped form
 * is rewritten to a private delimiter first so the two systems cannot pair
 * with each other, and string-concatenation glue is dropped so a span split
 * across `+` pieces survives. Spans containing `${` are skipped — their
 * command text only exists after rendering.
 */
export function sourceDiscernCommands(source: string): string[] {
  // `"…" + "…"` renders as one string: drop the glue between string literals
  // so a code span split across the pieces is extracted whole.
  const glued = source.replace(/(["'`])\s*\+\s*(["'`])/gu, "");
  // Escaped backticks (code spans inside template literals) become a private
  // delimiter that cannot pair with the literals' own bare-backtick delimiters.
  const marked = glued.replace(/\\`/gu, "");
  const spans = [
    ...marked.matchAll(/([^`\r\n]+)/gu),
    ...marked.matchAll(/`([^`\r\n]+)`/gu),
  ];
  const commands: string[] = [];
  for (const match of spans) {
    const code = (match[1] ?? "").trim();
    if (/^discern(?:\s|$)/u.test(code) && !code.includes("${")) {
      commands.push(code);
    }
  }
  return commands;
}
