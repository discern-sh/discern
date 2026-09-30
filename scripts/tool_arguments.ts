/**
 * The argument grammar repository tools share when they take at most one
 * operand, boolean flags, and flags that carry one value: `[--] [options]
 * [operand]`, in any order. Each tool names its own options and operand; the
 * reading and the refusals are defined once here.
 */

/** What one tool accepts. */
export interface ToolArgumentGrammar {
  /** Flags that take no value, such as `--replace`. */
  readonly flags?: readonly string[];
  /** Flags followed by one value, such as `--config <path>`. */
  readonly values?: readonly string[];
  /** How refusals name the operand, such as "output directory". */
  readonly operand: string;
}

/** One parsed invocation. */
export interface ToolArguments {
  readonly operand?: string;
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

/** Read one tool invocation, refusing unknown options and a second operand. */
export function parseToolArguments(
  args: readonly string[],
  grammar: ToolArgumentGrammar,
): ToolArguments {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let operand: string | undefined;
  for (let at = 0; at < args.length; at += 1) {
    const argument = args[at] ?? "";
    if (argument === "--") continue;
    if (grammar.flags?.includes(argument) === true) {
      flags.add(argument);
    } else if (grammar.values?.includes(argument) === true) {
      const value = args[at + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new TypeError(`${argument} needs a value`);
      }
      values.set(argument, value);
      at += 1;
    } else if (argument.startsWith("-")) {
      throw new TypeError(`unknown option: ${argument}`);
    } else if (operand === undefined) {
      operand = argument;
    } else {
      throw new TypeError(`pass at most one ${grammar.operand}`);
    }
  }
  if (operand !== undefined && operand.trim() === "") {
    throw new TypeError(`the ${grammar.operand} cannot be empty`);
  }
  return { ...(operand === undefined ? {} : { operand }), flags, values };
}
