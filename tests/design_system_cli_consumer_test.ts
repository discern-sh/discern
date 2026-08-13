/** External-consumer contract for Discern's selected design-system CLI release. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { packageManifest } from "discern-design-system";
import {
  renderBadgeCli,
  renderFleetCli,
  type TerminalCapabilities,
} from "discern-design-system/cli";
import {
  type PromptChoiceEntry,
  promptSelect,
  type TerminalIO,
  type TerminalSize,
} from "discern-design-system/cli/interactive";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SELECTED_VERSION = "0.12.1";
const SELECTED_SPECIFIER = `jsr:@discern-sh/design-system@${SELECTED_VERSION}`;
const PACKAGE_VERSION_PATTERN =
  /@discern-sh\/design-system\/(\d+\.\d+\.\d+)\//u;
const encoder = new TextEncoder();

interface DenoConfig {
  readonly imports: Readonly<Record<string, string>>;
}

interface DenoLock {
  readonly specifiers: Readonly<Record<string, string>>;
  readonly jsr: Readonly<Record<string, unknown>>;
}

interface DenoInfo {
  readonly modules?: readonly { readonly specifier?: string }[];
}

/** Select React runtime modules while ignoring configured type declarations. */
function reactRuntimeModules(specifiers: readonly string[]): string[] {
  return specifiers.filter((specifier) =>
    !specifier.startsWith("npm:/@types/") &&
    /(?:^|[/@-])react(?:-dom)?(?:[/.@-]|$)/iu.test(specifier)
  );
}

/** Queue-backed terminal that proves the public interactive path without real effects. */
class ConsumerTerminal implements TerminalIO {
  readonly writes: string[] = [];
  readonly rawTransitions: boolean[] = [];
  readonly #chunks: Uint8Array[];

  constructor(chunks: readonly string[]) {
    this.#chunks = chunks.map((chunk) => encoder.encode(chunk));
  }

  isInteractive(): boolean {
    return true;
  }

  capabilities(): TerminalCapabilities {
    return { colorDepth: "none", columns: 60, unicode: true };
  }

  size(): TerminalSize {
    return { columns: 60, rows: 24 };
  }

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(this.#chunks.shift() ?? null);
  }

  setRawMode(enabled: boolean): void {
    this.rawTransitions.push(enabled);
  }

  write(value: string): void {
    this.writes.push(value);
  }
}

/** Read one resolved Deno graph as external-consumer evidence. */
async function moduleSpecifiers(entrypoint: string): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  const info = JSON.parse(new TextDecoder().decode(output.stdout)) as DenoInfo;
  return (info.modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
  );
}

Deno.test("the selected release exposes all three public consumer graphs", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as DenoConfig;
  const lock = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  ) as DenoLock;
  assertEquals(config.imports["discern-design-system"], SELECTED_SPECIFIER);
  assertEquals(lock.specifiers[SELECTED_SPECIFIER], SELECTED_VERSION);
  assert(`@discern-sh/design-system@${SELECTED_VERSION}` in lock.jsr);

  assertEquals(packageManifest.package, "@discern-sh/design-system");
  assert(packageManifest.components.length > 0);

  const capabilities: TerminalCapabilities = {
    colorDepth: "none",
    columns: 60,
    unicode: true,
  };
  assertEquals(
    renderBadgeCli({ label: "Published", tone: "success" }, capabilities),
    "[Published]",
  );

  const persona = "Terminal contract audit with complete identity";
  const branch = "agent/terminal-contract-audit-with-complete-identity";
  const fleet = renderFleetCli({
    identityMode: "lossless",
    maxWidth: 60,
    rows: [{ persona, branch, status: "working" }],
  }, capabilities);
  assertStringIncludes(fleet, persona);
  assertStringIncludes(fleet, branch);

  const choices = [
    { kind: "group-heading", id: "primary", label: "Primary" },
    { id: "one", label: "One", value: "one" },
    { kind: "group-heading", id: "secondary", label: "Secondary" },
    { id: "two", label: "Two", value: "two" },
  ] as const satisfies readonly PromptChoiceEntry<string>[];
  const io = new ConsumerTerminal(["\x1b[B\r"]);
  assertEquals(
    await promptSelect({ label: "Pick", choices }, { io }),
    "two",
  );
  assertEquals(io.rawTransitions, [true, false]);
  const terminalOutput = io.writes.join("");
  assertStringIncludes(terminalOutput, "Primary");
  assertStringIncludes(terminalOutput, "Secondary");
});

Deno.test("CLI-only design-system graphs stay external, exact, and React-free", async () => {
  const modules = await moduleSpecifiers(
    join(ROOT, "tests/fixtures/design_system_cli_graph.ts"),
  );
  const packageModules = modules.filter((specifier) =>
    specifier.includes("/@discern-sh/design-system/")
  );
  assert(packageModules.length > 0);

  const resolvedVersions = new Set(packageModules.flatMap((specifier) => {
    const match = specifier.match(PACKAGE_VERSION_PATTERN);
    return match?.[1] === undefined ? [] : [match[1]];
  }));
  assertEquals([...resolvedVersions], [SELECTED_VERSION]);

  assertEquals(
    reactRuntimeModules([
      "npm:/@types/react@18.3.12",
      "npm:/react-dom@18.3.1/server",
    ]),
    ["npm:/react-dom@18.3.1/server"],
  );
  const forbidden = modules.filter((specifier) =>
    reactRuntimeModules([specifier]).length > 0 ||
    specifier.includes("/Users/jack/Sites/discern-design-system/") ||
    specifier.includes("discern-design-system/src/")
  );
  assertEquals(forbidden, []);
});
