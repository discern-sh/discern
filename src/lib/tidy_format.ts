import { createFromBuffer, type Formatter } from "@dprint/formatter";
import { frontmatterParseIssue, readFrontmatterBlock } from "./frontmatter.ts";
import { indentToml } from "./toml_indent.ts";

/** Pinned embedded plugin versions. An upgrade changes discern's convention. */
export const MARKDOWN_PLUGIN_VERSION = "0.22.1";
export const TOML_PLUGIN_VERSION = "0.7.0";

/** Fixed cross-plugin convention. These settings are not project-configurable. */
const GLOBAL_CONFIG = {
  indentWidth: 2,
  lineWidth: 80,
  newLineKind: "lf",
  useTabs: false,
} as const;

export const MARKDOWN_CONFIG = {
  textWrap: "never",
} as const;

/** `#:schema <url>` at byte zero is a schema directive TOML editors read
 * verbatim; forcing a space after `#` (the plugin default) corrupts it into an
 * ordinary comment. The option stops forcing the space without stripping it
 * from comments that already carry one, so existing files stay stable. */
export const TOML_CONFIG = { "comment.forceLeadingSpace": false } as const;

/** A Markdown formatter refusal: the file's frontmatter does not parse, or
 * formatting would have altered the block. */
export class MarkdownFormatError extends Error {
  constructor(
    readonly filePath: string,
    message: string,
  ) {
    super(message);
    this.name = "MarkdownFormatError";
  }
}

/** A TOML formatter refusal, distinct from filesystem and migration failures. */
export class TomlFormatError extends Error {
  constructor(
    readonly filePath: string,
    message: string,
  ) {
    super(message);
    this.name = "TomlFormatError";
  }
}

let markdownFormatter: Promise<Formatter> | undefined;
let tomlFormatter: Promise<Formatter> | undefined;

/** Instantiate an embedded Wasm formatter and reject invalid bundled options. */
async function loadFormatter(
  asset: string,
  pluginConfig: Readonly<Record<string, unknown>>,
): Promise<Formatter> {
  const bytes = await Deno.readFile(
    new URL(`./tidy_plugins/${asset}`, import.meta.url),
  );
  const formatter = createFromBuffer(bytes);
  formatter.setConfig(GLOBAL_CONFIG, pluginConfig);
  const diagnostics = formatter.getConfigDiagnostics();
  if (diagnostics.length > 0) {
    throw new Error(
      `Invalid embedded formatter configuration: ${
        JSON.stringify(diagnostics)
      }`,
    );
  }
  return formatter;
}

/** Lazily share the configured Markdown formatter across tidy calls. */
async function markdown(): Promise<Formatter> {
  markdownFormatter ??= loadFormatter(
    `markdown-${MARKDOWN_PLUGIN_VERSION}.wasm`,
    MARKDOWN_CONFIG,
  );
  return await markdownFormatter;
}

/** Lazily share the configured TOML formatter across tidy calls. */
async function toml(): Promise<Formatter> {
  tomlFormatter ??= loadFormatter(
    `toml-${TOML_PLUGIN_VERSION}.wasm`,
    TOML_CONFIG,
  );
  return await tomlFormatter;
}

/**
 * Format Markdown without formatting the contents of fenced code blocks, and
 * without ever rewriting YAML frontmatter.
 *
 * The Markdown plugin can recursively format a fence whose info string names a
 * language it understands. `discern tidy` deliberately owns Markdown structure
 * only, so each fence receives a collision-proof, per-call ignore directive. The
 * directive is removed after formatting; the fenced block stays byte-for-byte
 * unchanged.
 *
 * A leading frontmatter block is under the same contract, both directions: a
 * block that does not parse as a YAML mapping refuses the whole file (a
 * formatter that "recovers" broken YAML restructures it into differently
 * broken YAML), and a block that does parse must come out of the plugin with
 * its content unchanged — {@link assertFrontmatterPreserved} turns a plugin
 * that starts rewriting frontmatter into a refusal instead of a rewrite. Line
 * endings follow the plugin's document-wide LF convention.
 */
export async function formatMarkdownText(
  filePath: string,
  fileText: string,
): Promise<string> {
  const refusal = frontmatterParseIssue(fileText);
  if (refusal !== undefined) {
    throw new MarkdownFormatError(filePath, refusal);
  }
  const protectedCode = protectFencedCode(fileText);
  const formatted = (await markdown()).formatText({
    filePath,
    fileText: protectedCode.text,
  });
  const output: string[] = [];
  for (const line of formatted.split("\n")) {
    const preserved = protectedCode.blocks.find(({ marker }) =>
      line.includes(marker)
    );
    if (preserved === undefined) {
      output.push(line);
    } else {
      output.push(...preserved.lines);
    }
  }
  const result = output.join("\n");
  assertFrontmatterPreserved(filePath, fileText, result);
  return result;
}

/**
 * The write-side half of the frontmatter contract: formatting may never change
 * what the leading block says. Compares the blocks' verbatim interior — the
 * shared reader already accepts both line-ending conventions — so a formatter
 * that re-indents, drops, or invents a block is refused before any write.
 */
export function assertFrontmatterPreserved(
  filePath: string,
  before: string,
  after: string,
): void {
  if (readFrontmatterBlock(before)?.raw !== readFrontmatterBlock(after)?.raw) {
    throw new MarkdownFormatError(
      filePath,
      "the embedded Markdown formatter would have altered the frontmatter " +
        "block; discern preserves frontmatter as written",
    );
  }
}

interface ProtectedFencedCode {
  text: string;
  blocks: Array<{ marker: string; lines: string[] }>;
}

/** Replace fenced blocks with collision-free markers so formatting cannot alter them. */
function protectFencedCode(fileText: string): ProtectedFencedCode {
  let namespace = "tidy-fenced-code-block";
  while (fileText.includes(namespace)) {
    namespace += "-next";
  }

  const output: string[] = [];
  const blocks: ProtectedFencedCode["blocks"] = [];
  let active:
    | {
      char: "`" | "~";
      length: number;
      prefix: string;
      lines: string[];
    }
    | undefined;
  for (const line of fileText.split("\n")) {
    const match = /^((?:[ \t]{0,3}>[ \t]?)*[ \t]*)(`{3,}|~{3,})(.*)$/
      .exec(line);
    const prefix = match?.[1] ?? "";
    const run = match?.[2];
    const tail = match?.[3] ?? "";
    if (active === undefined && run !== undefined) {
      const char = run[0];
      if (char === "`" || char === "~") {
        active = { char, length: run.length, prefix, lines: [line] };
        continue;
      }
    }
    if (active !== undefined) {
      active.lines.push(line);
      if (
        run !== undefined && run[0] === active.char &&
        run.length >= active.length && tail.trim() === ""
      ) {
        const marker = `<!-- ${namespace}-${blocks.length} -->`;
        output.push(`${active.prefix}${marker}`);
        blocks.push({ marker, lines: active.lines });
        active = undefined;
      }
      continue;
    }
    output.push(line);
  }
  if (active !== undefined) {
    const marker = `<!-- ${namespace}-${blocks.length} -->`;
    output.push(`${active.prefix}${marker}`);
    blocks.push({ marker, lines: active.lines });
  }
  return { text: output.join("\n"), blocks };
}

/**
 * The canonical `discern.toml` convention: the embedded formatter normalizes
 * structure, then the depth indenter re-indents by table depth so the config
 * reads as the hierarchy it is. Applied by `discern tidy toml` and by every
 * production config write (via {@link writeDiscernToml}), so no write path
 * can leave the file off-convention for the next gate run to fix.
 */
export async function formatTomlText(
  filePath: string,
  fileText: string,
): Promise<string> {
  try {
    return indentToml(
      (await toml()).formatText({ filePath, fileText }),
      GLOBAL_CONFIG.indentWidth,
    );
  } catch (error) {
    if (error instanceof TomlFormatError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new TomlFormatError(filePath, detail);
  }
}

/**
 * Write root `discern.toml` bytes through the same convention `discern tidy
 * toml` applies. Every production config writer uses this boundary so a setup,
 * migration, pin, or programmatic edit is canonical before the next gate run.
 */
export async function writeDiscernToml(
  filePath: string,
  fileText: string,
): Promise<void> {
  await Deno.writeTextFile(filePath, await formatTomlText(filePath, fileText));
}

/** Canonicalize UTF-8 config bytes for a generic filesystem plan writer. */
export async function formatDiscernTomlBytes(
  filePath: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const text = new TextDecoder().decode(bytes);
  return new TextEncoder().encode(await formatTomlText(filePath, text));
}
