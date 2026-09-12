/**
 * Structural census and parity check for checkout-changing Git invocations.
 *
 * The workspace contract (ADR 0389) lets an operation change the checked-out
 * revision, index, or working tree only of the checkout it was invoked in, of
 * a worktree discern itself created, or of the main checkout a landing
 * converges. Every argument list in authored TypeScript that hands Git one of
 * the commands able to install a revision or replace a tree — `checkout`,
 * `switch`, `reset`, `read-tree`, `restore`, `clean`, `worktree add`, and
 * `worktree remove` — must match one exact row in
 * `CHECKOUT_MUTATION_BOUNDARIES`, naming its allowance and reason, and every
 * row must still name an actual site. The command refuses drift before
 * emitting the Standard.
 */

import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import {
  CHECKOUT_MUTATION_BOUNDARIES,
  CHECKOUT_MUTATION_COMMANDS,
  type CheckoutMutationBoundary,
  type CheckoutMutationCommand,
  registeredCheckoutMutationCount,
} from "../tests/checkout_mutation_surfaces.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import {
  enclosingFunction,
  resolveSpawnExpression,
} from "./subprocess_spawn_boundaries.ts";

/** One checkout-changing Git argument list discovered from syntax. */
export interface CheckoutMutationSite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly command: CheckoutMutationCommand;
  readonly line: number;
  readonly column: number;
}

/** Global Git options that consume the following argument. */
const VALUED_GLOBAL_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree"]);

/** Subcommands that change a checkout directly; `worktree` needs its verb. */
const DIRECT_COMMANDS: ReadonlySet<string> = new Set(
  CHECKOUT_MUTATION_COMMANDS.filter((command) => !command.includes(" ")),
);

/** Literal text of one array element, or undefined for a computed element. */
function literalText(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return undefined;
}

/**
 * The guarded command an argument list names, if any. Leading global options
 * are skipped the way Git parses them, so `["-C", dir, "checkout", …]` is
 * still a checkout. A computed element in the subcommand position stays
 * outside the census: an argument list assembled at runtime is a runner's
 * concern, and the shared runner's own constructor is registered elsewhere.
 */
export function guardedCommandOf(
  elements: readonly (string | undefined)[],
): CheckoutMutationCommand | undefined {
  let index = 0;
  while (index < elements.length) {
    const element = elements[index];
    if (element === undefined || !element.startsWith("-")) break;
    index += VALUED_GLOBAL_OPTIONS.has(element) ? 2 : 1;
  }
  const subcommand = elements[index];
  if (subcommand === undefined) return undefined;
  if (DIRECT_COMMANDS.has(subcommand)) {
    return subcommand as CheckoutMutationCommand;
  }
  if (subcommand !== "worktree") return undefined;
  const verb = elements[index + 1];
  return verb === "add" || verb === "remove"
    ? `worktree ${verb}` as CheckoutMutationCommand
    : undefined;
}

/**
 * Callees that hand an argument list to a process: the shared Git runner, its
 * local wrappers, and every other runner-shaped name. A keyword list passed to
 * `new Set` or a schema builder is not an invocation. A wrapper named outside
 * this shape evades the census, so the registry reviewer keeps runner names
 * recognizable.
 */
const RUNNER_CALLEE = /git|run|exec|spawn|invoke/iu;

/** The final identifier of a callee expression, when it has one. */
function calleeName(node: Node): string | undefined {
  const expression = Node.isCallExpression(node) || Node.isNewExpression(node)
    ? node.getExpression()
    : undefined;
  if (expression === undefined) return undefined;
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName();
  }
  return undefined;
}

/** Array literals a process invocation hands to Git, following local aliases. */
function argumentArrays(node: Node): Node[] {
  const arrays: Node[] = [];
  const array = (argument: Node | undefined): void => {
    const resolved = resolveSpawnExpression(argument);
    if (resolved !== undefined && Node.isArrayLiteralExpression(resolved)) {
      arrays.push(resolved);
    }
  };
  if (Node.isNewExpression(node)) {
    // `new Deno.Command("git", { args: [...] })` carries its list in `args`;
    // every other constructor receives data, not a command line.
    if (node.getExpression().getText() !== "Deno.Command") return arrays;
    for (const argument of node.getArguments()) {
      const resolved = resolveSpawnExpression(argument);
      if (resolved === undefined || !Node.isObjectLiteralExpression(resolved)) {
        continue;
      }
      const property = resolved.getProperty("args");
      if (property !== undefined && Node.isPropertyAssignment(property)) {
        array(property.getInitializer());
      }
    }
    return arrays;
  }
  if (Node.isCallExpression(node)) {
    const name = calleeName(node);
    if (name === undefined || !RUNNER_CALLEE.test(name)) return arrays;
    for (const argument of node.getArguments()) array(argument);
  }
  return arrays;
}

/** Every checkout-changing argument list in one parsed source file. */
function sitesInSourceFile(
  path: string,
  sourceFile: SourceFile,
): CheckoutMutationSite[] {
  const sites: CheckoutMutationSite[] = [];
  const seen = new Set<Node>();
  const invocations = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression),
  ];
  for (const invocation of invocations) {
    for (const array of argumentArrays(invocation)) {
      if (seen.has(array) || !Node.isArrayLiteralExpression(array)) continue;
      seen.add(array);
      const command = guardedCommandOf(
        array.getElements().map((element) => literalText(element)),
      );
      if (command === undefined) continue;
      const location = sourceFile.getLineAndColumnAtPos(array.getStart());
      sites.push({
        path,
        enclosingFunction: enclosingFunction(array),
        command,
        line: location.line,
        column: location.column,
      });
    }
  }
  return sites;
}

/** Parse one source string for focused and planted tests. */
export function checkoutMutationSitesInSource(
  source: string,
  path = "fixture.ts",
): CheckoutMutationSite[] {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return sitesInSourceFile(path, project.createSourceFile(path, source));
}

/** A cheap textual pre-check: a file without a guarded token has no site. */
const TOKEN_PATTERN = new RegExp(
  `["'\`](?:${
    [...new Set(CHECKOUT_MUTATION_COMMANDS.map((c) => c.split(" ")[0]))].join(
      "|",
    )
  })["'\`]`,
  "u",
);

/**
 * The production-and-tooling universe: authored TypeScript outside test
 * harnesses, which build fixture repositories with raw Git and are not
 * discern operations. A future top-level tooling root joins automatically.
 */
export async function checkoutMutationFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await structuralGuardScope({
    guard: "scripts/checkout_mutation_boundaries.ts#checkout-mutation-sites",
    universe: "authored-ts",
    narrow: {
      reason:
        "The workspace contract governs discern's own operations; test harnesses build fixture repositories with raw Git.",
      include: (path) => !path.startsWith("tests/"),
    },
  }, root);
}

/** Scan checkout-changing argument lists in a declared source set. */
export async function checkoutMutationSitesInFiles(
  root: string,
  files: readonly string[],
): Promise<CheckoutMutationSite[]> {
  const sites: CheckoutMutationSite[] = [];
  for (const path of files) {
    const source = await Deno.readTextFile(join(root, path));
    if (!TOKEN_PATTERN.test(source)) continue;
    sites.push(...checkoutMutationSitesInSource(source, path));
  }
  return sites;
}

/** Match currency shared by syntax findings and registry rows. */
function boundaryKey(
  boundary: Pick<
    CheckoutMutationBoundary,
    "path" | "enclosingFunction" | "command"
  >,
): string {
  return `${boundary.path}\0${boundary.enclosingFunction}\0${boundary.command}`;
}

/**
 * Bidirectional parity diagnostics. Repeated invocations inside one function
 * remain count-sensitive, so a second `read-tree` in a rollback path needs its
 * own registered row.
 */
export function checkoutMutationParityFindings(
  actual: readonly CheckoutMutationSite[],
  registered: readonly CheckoutMutationBoundary[],
): string[] {
  const remaining = new Map<string, CheckoutMutationBoundary[]>();
  for (const boundary of registered) {
    const key = boundaryKey(boundary);
    remaining.set(key, [...(remaining.get(key) ?? []), boundary]);
  }
  const findings: string[] = [];
  for (const site of actual) {
    const key = boundaryKey(site);
    const matches = remaining.get(key) ?? [];
    if (matches.length === 0) {
      findings.push(
        `unregistered checkout-changing git ${site.command} at ${site.path}:${site.line}:${site.column} inside ${site.enclosingFunction}`,
      );
      continue;
    }
    matches.shift();
    remaining.set(key, matches);
  }
  for (const boundaries of remaining.values()) {
    for (const boundary of boundaries) {
      findings.push(
        `stale checkout-mutation boundary ${boundary.path}#${boundary.enclosingFunction} (git ${boundary.command})`,
      );
    }
  }
  return findings.sort();
}

/** Scan and refuse registry drift before returning the live census. */
export async function validateCheckoutMutationBoundaries(
  root: string = REPO_ROOT,
): Promise<CheckoutMutationSite[]> {
  const actual = await checkoutMutationSitesInFiles(
    root,
    await checkoutMutationFiles(root),
  );
  const findings = checkoutMutationParityFindings(
    actual,
    CHECKOUT_MUTATION_BOUNDARIES,
  );
  if (findings.length > 0) {
    throw new Error(
      "checkout-changing git invocations diverged from tests/checkout_mutation_surfaces.ts:\n  " +
        findings.join("\n  "),
    );
  }
  return actual;
}

/** Validate and print the falling registry census. */
async function main(): Promise<void> {
  await validateCheckoutMutationBoundaries();
  for (const boundary of CHECKOUT_MUTATION_BOUNDARIES) {
    console.error(
      `${boundary.path}#${boundary.enclosingFunction} git ${boundary.command} [${boundary.allowance}] — ${boundary.reason}`,
    );
  }
  const count = registeredCheckoutMutationCount();
  console.error(
    `${count} registered checkout-changing git invocations under the workspace contract.`,
  );
  console.log(`DISCERN_METRIC checkout_mutation_boundaries ${count}`);
}

if (import.meta.main) await main();
