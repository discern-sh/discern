/**
 * The logbook **no-network guard** — the architectural test that keeps the trust
 * page's claim checkable forever: the logbook subsystem records locally and has
 * NO PATH to the network, in any release. The claim is held by a check, not a
 * promise (the write-surface and subprocess-SSOT guards are the pattern).
 *
 * Two rules over the subsystem's whole module graph, walked statically from
 * every file under `src/engine/logbook/` (a new module auto-enrols):
 *
 *  1. **No network API in any first-party module of the graph.** `fetch`, the
 *     `Deno.connect`/`listen`/`serve` family, DNS resolution, HTTP clients,
 *     WebSockets, `XMLHttpRequest`, `EventSource`, beacons — none may appear in
 *     any `src/` module the logbook imports, directly or transitively.
 *  2. **No un-vetted external dependency.** Every external specifier in the
 *     graph must be on the explicit allowlist below — each vetted as
 *     network-free for the logbook's use. A new dependency fails until a human
 *     re-vets and extends the list deliberately.
 *
 * When this fails, the fix is to remove the network reach (or restructure so
 * the logbook stops importing the module that gained it) — never to widen the
 * scan or silence the finding.
 *
 * Guards: boundary:local-private-evidence, boundary:offline-owned-engine, claim:local-logbook
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { NETWORK_TOKEN } from "./network_boundary.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { Node, Project, SyntaxKind } from "ts-morph";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/**
 * The vetted external dependencies of the logbook graph. Each entry is a
 * specifier PREFIX, checked as vetted-for-this-graph: path/filesystem/assert
 * std modules, the TOML parser and Zod (the config schema), the terminal
 * design-system CLI graph (pure rendering and capability types), and the
 * process, os, and async-context shims the shared modules use (`os` supplies
 * tmpdir; `async_hooks` supplies in-process AsyncLocalStorage). None opens a
 * socket.
 */
const ALLOWED_EXTERNAL_PREFIXES = [
  "@std/path",
  "@std/fs",
  "@std/toml",
  "@std/fmt",
  "@zod/zod",
  "@cliffy/ansi",
  "discern-design-system/cli",
  "node:process",
  "process",
  "node:os",
  "os",
  "async_hooks",
] as const;

/** Every import/re-export specifier in a TypeScript source, static and dynamic.
 * A dynamic import of a non-literal specifier cannot be walked, so it is
 * reported as a violation rather than silently skipped. */
export function importSpecifiers(
  source: string,
): { specifiers: string[]; unwalkableDynamicImport: boolean } {
  const parsed = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  })
    .createSourceFile("guard-input.ts", source);
  const specifiers: string[] = [];
  for (const statement of parsed.getStatements()) {
    if (
      Node.isImportDeclaration(statement) || Node.isExportDeclaration(statement)
    ) {
      const specifier = statement.getModuleSpecifierValue();
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  let unwalkableDynamicImport = false;
  for (const call of parsed.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const argument = call.getArguments()[0];
    if (
      Node.isStringLiteral(argument) ||
      Node.isNoSubstitutionTemplateLiteral(argument)
    ) {
      specifiers.push(argument.getLiteralText());
    } else {
      unwalkableDynamicImport = true;
    }
  }
  return { specifiers, unwalkableDynamicImport };
}

/** The logbook subsystem's entry modules: every .ts file in its directory. */
async function logbookEntryFiles(): Promise<string[]> {
  const out = (await structuralGuardScope({
    guard: "tests/logbook_no_network_test.ts#logbook-graph-entry-modules",
    universe: "authored-ts",
    narrow: {
      reason:
        "The no-network graph starts from every direct TypeScript module in the production logbook package.",
      include: (path) =>
        path.startsWith("src/engine/logbook/") &&
        !path.slice("src/engine/logbook/".length).includes("/"),
    },
  })).map((rel) => join(REPO_ROOT, rel));
  assert(out.length > 0, "the logbook subsystem has no modules to guard");
  return out.sort();
}

/** Walk the static module graph from the logbook entries: every reachable
 * first-party file (visited, as repo-relative paths) and every external
 * specifier encountered. */
async function walkLogbookGraph(): Promise<{
  files: Map<string, string>;
  externals: Set<string>;
  dynamicOffenders: string[];
}> {
  const queue = await logbookEntryFiles();
  const files = new Map<string, string>();
  const externals = new Set<string>();
  const dynamicOffenders: string[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const source = await Deno.readTextFile(path);
    const rel = relative(REPO_ROOT, path);
    files.set(rel, source);
    const { specifiers, unwalkableDynamicImport } = importSpecifiers(source);
    if (unwalkableDynamicImport) {
      dynamicOffenders.push(rel);
    }
    for (const spec of specifiers) {
      if (spec.startsWith(".")) {
        queue.push(resolve(dirname(path), spec));
      } else {
        externals.add(spec);
      }
    }
  }
  return { files, externals, dynamicOffenders };
}

Deno.test("the logbook module graph reaches no network API", async () => {
  const { files, dynamicOffenders } = await walkLogbookGraph();
  // Sanity: the walk must actually cross the subsystem boundary into shared code
  // (an empty or self-contained walk would mean the walker broke, not that the
  // subsystem got safer).
  assert(files.size > 5, `suspiciously small logbook graph: ${files.size}`);
  assert(
    [...files.keys()].some((f) => f.startsWith("src/shared/")),
    "the walk must reach the shared modules the logbook imports",
  );

  const offenders: string[] = [];
  for (const [rel, source] of files) {
    const hit = source.match(NETWORK_TOKEN);
    if (hit !== null) {
      offenders.push(`${rel} contains "${hit[0]}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    "a network API is reachable from the logbook subsystem — the logbook is " +
      "local forever, so remove the reach (or stop importing the module that " +
      `gained it); never widen this guard:\n  ${offenders.join("\n  ")}`,
  );
  assertEquals(
    dynamicOffenders,
    [],
    "a non-literal dynamic import in the logbook graph cannot be walked — " +
      `replace it with a static or literal import:\n  ${
        dynamicOffenders.join("\n  ")
      }`,
  );
});

Deno.test("every external dependency of the logbook graph is on the vetted allowlist", async () => {
  const { externals } = await walkLogbookGraph();
  const unvetted = [...externals].filter((spec) =>
    !ALLOWED_EXTERNAL_PREFIXES.some((prefix) =>
      spec === prefix || spec.startsWith(`${prefix}/`)
    )
  ).sort();
  assertEquals(
    unvetted,
    [],
    "the logbook graph gained an external dependency this guard has not " +
      "vetted as network-free — verify it opens no socket, then extend " +
      `ALLOWED_EXTERNAL_PREFIXES deliberately:\n  ${unvetted.join("\n  ")}`,
  );
});

// Positive controls: prove the detector detects, so the guard can't rot into a
// test that passes because it sees nothing.

Deno.test("no-network guard: the token scan catches each spelling", () => {
  for (
    const seeded of [
      'await fetch("https://example.com");',
      "const conn = await Deno.connect({ port: 443 });",
      "Deno.serve(() => new Response());",
      'new WebSocket("wss://example.com");',
      'import http from "node:http";',
      "await Deno.resolveDns(host, aaaa);",
    ]
  ) {
    assertMatch(seeded, NETWORK_TOKEN, `not caught: ${seeded}`);
  }
});

Deno.test("no-network guard: the import scanner sees static, re-export, and dynamic forms", () => {
  const source = `
import { a } from "./a.ts";
import type { B } from "@zod/zod";
export { c } from "../c.ts";
import "npm:left-pad";
const d = await import("./d.ts");
const e = await import(pickOne());
`;
  const { specifiers, unwalkableDynamicImport } = importSpecifiers(source);
  assertEquals(specifiers, [
    "./a.ts",
    "@zod/zod",
    "../c.ts",
    "npm:left-pad",
    "./d.ts",
  ]);
  assertEquals(unwalkableDynamicImport, true);
});

Deno.test("no-network guard: comments, strings, and type queries create no runtime import edges", () => {
  for (
    const source of [
      '/** See {@link import("./documentation.ts").Example}. */',
      '// import("./comment.ts")',
      `const description = 'import("./example.ts")';`,
      'type Example = import("./types.ts").Example;',
    ]
  ) {
    assertEquals(importSpecifiers(source), {
      specifiers: [],
      unwalkableDynamicImport: false,
    });
  }
});
