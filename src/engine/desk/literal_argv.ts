/** One literal argv tail entered without invoking a shell. */
export type LiteralArgvParse =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly message: string };

const SIMPLE_COMMAND_SHELL_SYNTAX = new Set([
  ..."`$(){};&|<>*?[]#!~\n\r",
]);

/**
 * Split one literal command line. The editor boundary may additionally refuse
 * shell-looking syntax; Project Script arguments retain it as ordinary text.
 */
function parseLiteralArgv(
  input: string,
  refuseShellSyntax: boolean,
): LiteralArgvParse {
  const args: string[] = [];
  let word = "";
  let started = false;
  let quote: "single" | "double" | undefined;
  const push = (): void => {
    if (!started) return;
    args.push(word);
    word = "";
    started = false;
  };
  for (let index = 0; index < input.length; index++) {
    const char = input[index] ?? "";
    if (quote === "single") {
      if (char === "'") quote = undefined;
      else word += char;
      started = true;
      continue;
    }
    if (quote === "double") {
      if (char === '"') {
        quote = undefined;
      } else if (char === "\\") {
        const next = input[index + 1];
        if (next === undefined) {
          return {
            ok: false,
            message: "The argument line ends with an incomplete escape.",
          };
        }
        word += next;
        index++;
      } else if (
        refuseShellSyntax && (char === "$" || char === "`")
      ) {
        return { ok: false, message: "Shell syntax is not accepted here." };
      } else {
        word += char;
      }
      started = true;
      continue;
    }
    if (/\s/u.test(char)) {
      push();
      continue;
    }
    if (char === "'") {
      quote = "single";
      started = true;
      continue;
    }
    if (char === '"') {
      quote = "double";
      started = true;
      continue;
    }
    if (char === "\\") {
      const next = input[index + 1];
      if (next === undefined) {
        return {
          ok: false,
          message: "The argument line ends with an incomplete escape.",
        };
      }
      word += next;
      started = true;
      index++;
      continue;
    }
    if (refuseShellSyntax && SIMPLE_COMMAND_SHELL_SYNTAX.has(char)) {
      return { ok: false, message: "Shell syntax is not accepted here." };
    }
    word += char;
    started = true;
  }
  if (quote !== undefined) {
    return {
      ok: false,
      message: `The argument line has an unclosed ${quote} quote.`,
    };
  }
  push();
  return { ok: true, args };
}

/**
 * Split Project Script arguments while preserving every non-separator
 * character literally. The resulting argv never crosses a shell.
 */
export function parseProjectScriptArguments(input: string): LiteralArgvParse {
  return parseLiteralArgv(input, false);
}

/** Parse one bounded editor command, refusing shell syntax and empty input. */
export function simpleCommandArgv(command: string): string[] | undefined {
  const parsed = parseLiteralArgv(command, true);
  return parsed.ok && parsed.args.length > 0 ? [...parsed.args] : undefined;
}
