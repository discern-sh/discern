/**
 * Typed command references — the one representation behind every `discern`
 * command a result envelope tells its caller to run.
 *
 * A hint template never spells a runnable discern command as free prose.
 * It interpolates a {@link CommandRef} built by {@link discernCommand} (or
 * {@link ownerDiscernCommand}), which serializes the reference as a delimited
 * token inside the authored string. Each delivery surface then resolves the
 * token through its renderer: {@link renderCommandRefsCli} produces the CLI
 * spelling (`` `discern start --name "<task>"` ``), and
 * {@link renderCommandRefsMcp} produces the tool spelling for a verb with an
 * MCP tool (`` `discern_start` (name: "<task>") ``), or the explicit
 * shell-instruction form (`` `discern desk` (in a shell) ``) for a verb
 * without one. Owner-executed references — commands the agent relays for a
 * human to run at a terminal — keep the CLI spelling on every surface.
 *
 * The token grammar is closed: only the constructors here produce it, the
 * constructors validate their parts, and the registry guards resolve every
 * reference against the live verb and tool registries — so a renamed verb or
 * flag fails the gate, never a user's session. Tokens are an in-process
 * representation only; both public surfaces resolve them before
 * serialization, and the serialization boundary refuses a token that leaks.
 */

import { KNOWN_VERBS } from "./verbs.ts";

declare const commandRefBrand: unique symbol;

/**
 * A serialized command-reference token, branded so a hint parameter that
 * carries a command cannot be satisfied by a free-prose string. It is a plain
 * string at runtime, so templates interpolate it directly.
 */
export type CommandRef = string & { readonly [commandRefBrand]: true };

/** One argument of a referenced command, in CLI order. */
export type CommandRefArg =
  /** A `--name` flag; with `value`, a `--name <value>` pair. */
  | { readonly flag: string; readonly value?: string }
  /** A positional value; `param` names the MCP tool parameter it maps to. */
  | { readonly positional: string; readonly value: string }
  /** The `--` end-of-flags separator (CLI-only; surface renderers may drop it). */
  | { readonly endOfFlags: true };

/**
 * A parsed command reference: the command words after `discern` (`""` for the
 * bare root, as in `discern --help`), its ordered arguments, and who executes
 * it. `caller` is the agent reading the envelope, so the spelling follows the
 * delivery surface; `owner` is the human the agent reports to, so the CLI
 * spelling is correct on every surface.
 */
export interface CommandReference {
  readonly words: string;
  readonly args: readonly CommandRefArg[];
  readonly executor: "caller" | "owner";
}

/** How a surface renders one reference into prose. */
export type CommandRefRenderer = (ref: CommandReference) => string;

/**
 * Resolve a verb's MCP tool name (`"update"` → `"discern_update"`), or
 * undefined when the verb has no tool. Supplied by the MCP boundary from its
 * own `TOOLS` table — this module never holds a second copy of that mapping.
 */
export type McpToolLookup = (words: string) => string | undefined;

const TOKEN_OPEN = "⟦discern-cmd:";
const TOKEN_CLOSE = "⟧";
const TOKEN_PATTERN = /⟦discern-cmd:([^⟦⟧]*)⟧/g;

/** Characters no reference part may carry: the token delimiters, a code-span
 * backtick, or a newline — each would corrupt the rendered prose. */
const FORBIDDEN_PART = /[⟦⟧`\r\n]/;

/** Assert the part. */
function assertPart(kind: string, value: string): void {
  if (FORBIDDEN_PART.test(value)) {
    throw new Error(
      `command reference ${kind} ${
        JSON.stringify(value)
      } contains a delimiter, backtick, or newline`,
    );
  }
}

/** Build a `--flag` argument; pass `value` for a `--flag <value>` pair. */
export function flag(name: string, value?: string): CommandRefArg {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
    throw new Error(
      `command reference flag ${JSON.stringify(name)} must be a bare flag name`,
    );
  }
  if (value !== undefined) {
    assertPart("flag value", value);
    return { flag: name, value };
  }
  return { flag: name };
}

/** Build a positional argument; `param` names the MCP tool parameter. */
export function positional(param: string, value: string): CommandRefArg {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(param)) {
    throw new Error(
      `command reference positional ${
        JSON.stringify(param)
      } must name a tool parameter`,
    );
  }
  assertPart("positional value", value);
  return { positional: param, value };
}

/** The `--` end-of-flags separator, for a positional that begins with `-`. */
export function endOfFlags(): CommandRefArg {
  return { endOfFlags: true };
}

/** Build the reference. */
function buildReference(
  words: string,
  args: readonly CommandRefArg[],
  executor: CommandReference["executor"],
): CommandRef {
  assertPart("words", words);
  const [first] = words.split(" ");
  if (words === "") {
    if (args.length === 0) {
      throw new Error(
        "a root command reference (empty words) needs at least one argument",
      );
    }
  } else if (first === undefined || !KNOWN_VERBS.has(first)) {
    throw new Error(
      `command reference names unknown verb ${JSON.stringify(words)}`,
    );
  }
  const reference: CommandReference = { words, args, executor };
  return `${TOKEN_OPEN}${
    JSON.stringify(reference)
  }${TOKEN_CLOSE}` as CommandRef;
}

/**
 * Reference a discern command the envelope's reader should run, e.g.
 * `discernCommand("start", flag("name", '"<task>"'))`. The first word must be
 * a live verb; renderers spell the whole reference for their surface.
 */
export function discernCommand(
  words: string,
  ...args: CommandRefArg[]
): CommandRef {
  return buildReference(words, args, "caller");
}

/**
 * Reference a discern command the reader RELAYS for their owner — a human at
 * a terminal — to run. It keeps the CLI spelling on every surface, including
 * MCP, because the executor is never the connected agent.
 */
export function ownerDiscernCommand(
  words: string,
  ...args: CommandRefArg[]
): CommandRef {
  return buildReference(words, args, "owner");
}

/** Render one reference as its backticked CLI spelling. */
export function renderCliReference(ref: CommandReference): string {
  const parts = ["discern"];
  if (ref.words !== "") {
    parts.push(ref.words);
  }
  for (const arg of ref.args) {
    if ("flag" in arg) {
      parts.push(`--${arg.flag}`);
      if (arg.value !== undefined) {
        parts.push(arg.value);
      }
    } else if ("positional" in arg) {
      parts.push(arg.value);
    } else {
      parts.push("--");
    }
  }
  return `\`${parts.join(" ")}\``;
}

/** A value already `"…"`-quoted or purely numeric renders verbatim as an MCP
 * parameter; anything else is quoted. */
function mcpParamValue(value: string): string {
  if (/^".*"$/.test(value) || /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  return `"${value}"`;
}

/** CLI output-mode plumbing with no MCP parameter: tool results are already
 * structured, so the flag drops from the tool spelling. */
const MCP_DROPPED_FLAGS: ReadonlySet<string> = new Set(["json"]);

/**
 * Render one reference for the MCP surface: the tool spelling with arguments
 * as tool parameters when the verb has a tool, the CLI spelling for an
 * owner-executed reference, and the explicit shell-instruction form for a
 * verb with no tool — the documented CLI-fallback posture, stated where it
 * applies.
 */
export function renderMcpReference(
  ref: CommandReference,
  toolFor: McpToolLookup,
): string {
  if (ref.executor === "owner") {
    return renderCliReference(ref);
  }
  const tool = ref.words === "" ? undefined : toolFor(ref.words);
  if (tool === undefined) {
    return `${renderCliReference(ref)} (in a shell)`;
  }
  const params: string[] = [];
  for (const arg of ref.args) {
    if ("flag" in arg) {
      if (MCP_DROPPED_FLAGS.has(arg.flag)) {
        continue;
      }
      const name = arg.flag.replaceAll("-", "_");
      params.push(
        `${name}: ${
          arg.value === undefined ? "true" : mcpParamValue(arg.value)
        }`,
      );
    } else if ("positional" in arg) {
      params.push(
        `${arg.positional.replaceAll("-", "_")}: ${mcpParamValue(arg.value)}`,
      );
    }
  }
  return params.length === 0
    ? `\`${tool}\``
    : `\`${tool}\` (${params.join(", ")})`;
}

/** Parse the payload. */
function parsePayload(payload: string): CommandReference {
  const parsed = JSON.parse(payload) as CommandReference;
  if (typeof parsed.words !== "string" || !Array.isArray(parsed.args)) {
    throw new Error(`malformed command-reference token: ${payload}`);
  }
  return parsed;
}

/** Resolve every reference token in `text` through one surface renderer. */
export function renderCommandRefs(
  text: string,
  render: CommandRefRenderer,
): string {
  if (!text.includes(TOKEN_OPEN)) {
    return text;
  }
  return text.replaceAll(
    TOKEN_PATTERN,
    (_match, payload: string) => render(parsePayload(payload)),
  );
}

/** Resolve every reference in `text` to its CLI spelling. */
export function renderCommandRefsCli(text: string): string {
  return renderCommandRefs(text, renderCliReference);
}

/** Resolve every reference in `text` for the MCP surface. */
export function renderCommandRefsMcp(
  text: string,
  toolFor: McpToolLookup,
): string {
  return renderCommandRefs(text, (ref) => renderMcpReference(ref, toolFor));
}

/** True when `text` still carries an unresolved reference token. */
export function containsCommandRefTokens(text: string): boolean {
  return text.includes(TOKEN_OPEN);
}

/** Every reference in `text`, in order — the guards' structural view. */
export function extractCommandRefs(text: string): CommandReference[] {
  const refs: CommandReference[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    refs.push(parsePayload(match[1] ?? ""));
  }
  return refs;
}

/** `text` with every reference token removed — for scanning the prose around
 * references without the references themselves. */
export function stripCommandRefs(text: string): string {
  return text.replaceAll(TOKEN_PATTERN, "");
}
