/**
 * Every path that can overwrite a compiled agent file stays enrolled, goes
 * through the one discard-reporting writer, and declares how its caller
 * learns what the overwrite threw away.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { accessorUses } from "./call_site_scan.ts";
import {
  AGENT_FILE_RENDER_USES,
  AGENT_FILE_RENDERERS,
  AGENT_FILE_WRITE_CHAIN,
  AGENT_FILE_WRITE_USES,
} from "./agent_file_writers.ts";

/** The module that owns the writer. */
const WRITER_MODULE = "src/engine/instructions.ts";

/** Shipped TypeScript: the only code that writes into a user's project. */
const SHIPPED_ONLY = {
  reason:
    "Only shipped source overwrites a user's agent files; tests drive those paths.",
  include: (path: string): boolean => path.startsWith("src/"),
};

/** Every shipped use of `names`, keyed `<module>#<function> > <name>`. */
async function shippedUses(
  guard: string,
  names: readonly string[],
): Promise<Set<string>> {
  const accessors = new Set(names);
  const uses = new Set<string>();
  for (
    const path of await structuralGuardScope({
      guard,
      universe: "authored-ts",
      narrow: SHIPPED_ONLY,
    })
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    for (const use of accessorUses(path, text, accessors)) uses.add(use);
  }
  return uses;
}

/** Assert the scanned uses and the declarations name the same set. */
function assertEnrolled(
  found: ReadonlySet<string>,
  declared: Readonly<Record<string, unknown>>,
  what: string,
): void {
  const keys = new Set(Object.keys(declared));
  assertEquals(
    [...found].filter((use) => !keys.has(use)).sort(),
    [],
    `a new ${what}: declare it in tests/agent_file_writers.ts`,
  );
  assertEquals(
    [...keys].filter((use) => !found.has(use)).sort(),
    [],
    `a declared ${what} no longer exists: remove it`,
  );
}

/** The enclosing function a use key names. */
function enclosingFunction(use: string): string {
  return use.slice(use.indexOf("#") + 1, use.indexOf(" > "));
}

Deno.test("every use of the compiled agent-file render is enrolled, and only the refresh planner writes it", async () => {
  assertEnrolled(
    await shippedUses(
      "tests/agent_file_writers_guard_test.ts#render-uses",
      AGENT_FILE_RENDERERS,
    ),
    AGENT_FILE_RENDER_USES,
    "agent-file render use",
  );
  assertEquals(
    Object.entries(AGENT_FILE_RENDER_USES)
      .filter(([, use]) => use.posture === "plan")
      .map(([key]) => key),
    ["src/engine/tracked_refresh.ts#planRefresh > renderAgentFiles"],
    "only the refresh planner turns rendered agent files into writes",
  );
});

Deno.test("every agent-file write path is enrolled and declares how its caller learns what it discarded", async () => {
  assertEnrolled(
    await shippedUses(
      "tests/agent_file_writers_guard_test.ts#write-uses",
      AGENT_FILE_WRITE_CHAIN,
    ),
    AGENT_FILE_WRITE_USES,
    "agent-file write path",
  );
  const chain = new Set(AGENT_FILE_WRITE_CHAIN);
  for (const [use, declaration] of Object.entries(AGENT_FILE_WRITE_USES)) {
    if (declaration.role === "writer") {
      assert(
        use.startsWith(`${WRITER_MODULE}#`),
        `${use} declares the writer role; route the overwrite through ${WRITER_MODULE}`,
      );
      continue;
    }
    if (declaration.role === "forwards") {
      assertEquals(
        declaration.via,
        enclosingFunction(use),
        `${use} forwards through its own enclosing function`,
      );
      assert(
        chain.has(declaration.via),
        `${use}: enroll ${declaration.via} in AGENT_FILE_WRITE_CHAIN so its callers are declared too`,
      );
      continue;
    }
    if (declaration.role !== "reports") continue;
    if ("sameAs" in declaration) {
      const proven = AGENT_FILE_WRITE_USES[declaration.sameAs];
      assert(
        proven !== undefined && proven.role === "reports" &&
          "proof" in proven,
        `${use} reports the same way as ${declaration.sameAs}, which must be a proven reporting use`,
      );
      continue;
    }
    const proof = await Deno.readTextFile(
      join(REPO_ROOT, declaration.proof.file),
    );
    assert(
      proof.includes(JSON.stringify(declaration.proof.test)),
      `${use}: ${declaration.proof.file} has no test named ${
        JSON.stringify(declaration.proof.test)
      }`,
    );
  }
});

Deno.test("the use scanner keys each call by its site and callee, through aliases", () => {
  const fixture = [
    'import { compileInstructions as compile } from "../engine/instructions.ts";',
    "/** See {@link compileInstructions}. */",
    "export async function both(root: string): Promise<void> {",
    "  await compile(root);",
    "  await worktreeSetup(root);",
    "}",
    "const arrow = async () => await compileInstructions('.');",
    "export function shadowed(): void {",
    "  let worktreeSetup = 0;",
    "  worktreeSetup += 1;",
    "}",
  ].join("\n");
  const path = "src/commands/fixture.ts";
  assertEquals(
    accessorUses(
      path,
      fixture,
      new Set(["compileInstructions", "worktreeSetup"]),
    ),
    [
      `${path}#arrow > compileInstructions`,
      `${path}#both > compileInstructions`,
      `${path}#both > worktreeSetup`,
    ],
  );
});
