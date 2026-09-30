/**
 * Build or serve discern.sh against a local design-system package without
 * changing the committed exact JSR dependency.
 */

import { join } from "@std/path";
import { denoRunInvocation } from "../site/dev_invocation.ts";
import {
  designSystemSpecifier,
  inheritedCommand,
  REPO_ROOT,
  resolveDesignSystemCheckout,
  runLocalDesignSystemTool,
  SITE_DESIGN_SYSTEM_EXPORTS,
  withLocalDesignSystem,
} from "./local_design_system.ts";
import { parseToolArguments } from "./tool_arguments.ts";

type JsonObject = Record<string, unknown>;

/** Command-line choices for one local-package preview. */
export interface LocalDesignSystemArgs {
  readonly buildOnly: boolean;
  readonly packageRoot: string;
}

/**
 * Resolve an explicit override or the conventional package checkout beside
 * discern's Git main checkout.
 */
export async function resolveLocalDesignSystemArgs(
  args: readonly string[],
  resolveMainCheckout?: () => Promise<string | undefined>,
): Promise<LocalDesignSystemArgs> {
  const parsed = parseToolArguments(args, {
    flags: ["--build-only"],
    operand: "design-system checkout",
  });
  return {
    buildOnly: parsed.flags.has("--build-only"),
    packageRoot: await resolveDesignSystemCheckout(
      parsed.operand,
      resolveMainCheckout,
    ),
  };
}

/** Arguments for a one-shot site build through the temporary link. */
function buildArgs(configPath: string): string[] {
  return [
    "run",
    "--config",
    configPath,
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env=NODE_ENV",
    join(REPO_ROOT, "site/build.ts"),
  ];
}

/** The consumer config's watch task command, the linked server's flag source. */
export function watchTaskCommand(rootConfig: Readonly<JsonObject>): string {
  const tasks = rootConfig.tasks;
  const command =
    typeof tasks === "object" && tasks !== null && !Array.isArray(tasks)
      ? (tasks as JsonObject).watch
      : undefined;
  if (typeof command !== "string") {
    throw new Error("the consumer config declares no watch task to derive");
  }
  return command;
}

/**
 * Arguments for a linked server whose every rebuild retains the override. The
 * sandbox comes from the watch task's own permission flags, so the preview's
 * environment needs stay declared in exactly one place, plus the write access
 * the linked rebuild adds.
 */
export function serverArgs(
  configPath: string,
  packageRoot: string,
  watchCommand: string,
): string[] {
  const invocation = denoRunInvocation(watchCommand);
  if (
    invocation === undefined ||
    invocation.entry.replace(/^\.\//, "") !== "site/dev.ts"
  ) {
    throw new Error(
      "the watch task no longer runs site/dev.ts directly; realign the " +
        "linked design-system server with the preview runtime",
    );
  }
  return [
    "run",
    "--config",
    configPath,
    "--watch",
    ...invocation.permissionFlags,
    "--allow-write",
    join(REPO_ROOT, "site/dev.ts"),
    "--watch",
    "--build-config",
    configPath,
    "--watch-input",
    join(packageRoot, "src"),
    "--watch-input",
    join(packageRoot, "deno.json"),
  ];
}

/** Print the public Project Script contract. */
function printHelp(): void {
  console.log(`Serve discern.sh against a local design-system checkout

Usage:
  discern scripts site-design-system
  discern scripts site-design-system -- --build-only
  discern scripts site-design-system [<checkout>]

The helper uses the sibling discern-design-system repository beside discern's
Git main checkout. Pass another checkout as the positional argument to
override it.
It writes an untracked temporary Deno config whose alias names no version, so
the link holds for an ahead or behind checkout and through a version bump made
while it serves. It verifies that the public exports resolve locally and leaves
deno.json and deno.lock unchanged. Without --build-only it serves and watches
both repositories.`);
}

/** Run the complete temporary-link lifecycle. */
async function main(): Promise<number> {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    printHelp();
    return 0;
  }
  const options = await resolveLocalDesignSystemArgs(Deno.args);
  return await withLocalDesignSystem(
    options.packageRoot,
    SITE_DESIGN_SYSTEM_EXPORTS,
    async (link) => {
      console.log(
        `Resolved runtime: ${
          link.resolutions.get(designSystemSpecifier("./runtime"))
        }`,
      );
      const exitCode = await inheritedCommand(
        options.buildOnly ? buildArgs(link.configPath) : serverArgs(
          link.configPath,
          link.packageRoot,
          watchTaskCommand(link.rootConfig),
        ),
      );
      if (options.buildOnly && exitCode === 0) {
        console.log(
          "Built the local design-system preview; refresh the browser.",
        );
      }
      return exitCode;
    },
  );
}

if (import.meta.main) {
  await runLocalDesignSystemTool("site-design-system", main);
}
