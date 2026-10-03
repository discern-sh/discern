/**
 * Deno's configured file-discovery exclusions, read the way Deno applies them.
 *
 * A top-level `exclude` in `deno.json` removes its paths from every
 * subcommand that discovers files (`fmt`, `lint`, `check`, `test`, and the
 * rest). A subcommand section's own `exclude` adds to that list for that
 * subcommand alone, and a native `--ignore` flag replaces both. Repository
 * tools that model one subcommand's selection read both lists here, so a
 * top-level entry cannot silently fall outside their model.
 */

import { join } from "@std/path";
import { z } from "@zod/zod";

const PatternsSchema = z.array(z.string());
const SectionSchema = z.object({ exclude: PatternsSchema.optional() })
  .passthrough();
const DenoExclusionConfigSchema = z.object({
  exclude: PatternsSchema.optional(),
  fmt: SectionSchema.optional(),
  lint: SectionSchema.optional(),
  test: SectionSchema.optional(),
}).passthrough();

/**
 * The Deno subcommands that discover files and apply these exclusions.
 * `check` has no section of its own, so it applies the top-level list alone.
 */
export const DENO_DISCOVERY_COMMANDS = [
  "check",
  "fmt",
  "lint",
  "test",
] as const;

/** One subcommand that discovers files under the configured exclusions. */
export type DenoDiscoveryCommand = typeof DENO_DISCOVERY_COMMANDS[number];

/** A `deno.json` section that may declare its own `exclude`. */
export type DenoExcludeSection = Exclude<DenoDiscoveryCommand, "check">;

/** One `deno.json`'s exclusions: the shared list and each section's additions. */
export interface DenoExclusions {
  /** The top-level `exclude`, applied by every discovering subcommand. */
  readonly workspace: readonly string[];
  /** Each section's own `exclude`, applied on top of `workspace`. */
  readonly sections: Readonly<Record<DenoExcludeSection, readonly string[]>>;
}

/**
 * Decode a parsed `deno.json` value into its exclusion lists. A value that is
 * not an object, or an `exclude` that is not a list of strings, yields
 * undefined so each caller decides whether malformed config refuses or falls
 * back.
 */
export function decodeDenoExclusions(
  config: unknown,
): DenoExclusions | undefined {
  const parsed = DenoExclusionConfigSchema.safeParse(config);
  if (!parsed.success) return undefined;
  return {
    workspace: parsed.data.exclude ?? [],
    sections: {
      fmt: parsed.data.fmt?.exclude ?? [],
      lint: parsed.data.lint?.exclude ?? [],
      test: parsed.data.test?.exclude ?? [],
    },
  };
}

/** Decode `deno.json` text into its exclusion lists, refusing malformed config. */
export function parseDenoExclusions(configText: string): DenoExclusions {
  const exclusions = decodeDenoExclusions(JSON.parse(configText));
  if (exclusions === undefined) {
    throw new Error(
      "deno.json must be an object whose exclude lists are arrays of strings",
    );
  }
  return exclusions;
}

/** Read the exclusion lists of the `deno.json` at one project root. */
export async function readDenoExclusions(
  root: string,
): Promise<DenoExclusions> {
  return parseDenoExclusions(
    await Deno.readTextFile(join(root, "deno.json")),
  );
}

/** The complete list one subcommand applies, shared entries first. */
export function commandExclusions(
  exclusions: DenoExclusions,
  command: DenoDiscoveryCommand,
): string[] {
  return [
    ...exclusions.workspace,
    ...(command === "check" ? [] : exclusions.sections[command]),
  ];
}
