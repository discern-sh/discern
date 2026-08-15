/** External-consumer contract for Discern's selected design-system CLI release. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { packageManifest } from "discern-design-system";
import {
  createCliPresenter,
  measureText,
  renderBadgeCli,
  renderCommandCli,
  renderFleetCli,
  renderHeadingCli,
  renderNoteLine,
  renderRadioCli,
  renderResultSummaryGroupCli,
  renderSuccessLine,
  renderSwitchCli,
  renderTextareaCli,
  type TerminalCapabilities,
} from "discern-design-system/cli";
import {
  InlineFramePainter,
  type InteractionEntry,
  requestSelection,
  senseTerminalBackground,
  type TerminalIO,
  type TerminalSize,
} from "discern-design-system/cli/interactive";
import { projectTerminalHtml } from "discern-design-system/cli/projection";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SELECTED_VERSION = "0.17.0";
const SELECTED_SPECIFIER = `jsr:@discern-sh/design-system@${SELECTED_VERSION}`;
const PACKAGE_VERSION_PATTERN =
  /@discern-sh\/design-system\/(\d+\.\d+\.\d+)\//u;
const encoder = new TextEncoder();
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);

interface DenoConfig {
  readonly imports: Readonly<Record<string, string>>;
}

interface DenoLock {
  readonly specifiers: Readonly<Record<string, string>>;
  readonly jsr: Readonly<Record<string, unknown>>;
}

interface DenoInfoResolution {
  readonly specifier: string;
}

interface DenoInfoDependency {
  readonly specifier: string;
  readonly code?: DenoInfoResolution;
  readonly type?: DenoInfoResolution;
}

interface DenoInfoModule {
  readonly specifier?: string;
  readonly dependencies?: readonly DenoInfoDependency[];
}

interface DenoInfo {
  readonly roots?: readonly string[];
  readonly redirects?: Readonly<Record<string, string>>;
  readonly modules?: readonly DenoInfoModule[];
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
  readonly #capabilities: TerminalCapabilities;
  readonly #size: TerminalSize;

  constructor(
    chunks: readonly string[],
    capabilities: TerminalCapabilities = {
      ansiControl: true,
      colorDepth: "none",
      columns: 60,
      unicode: true,
    },
    size: TerminalSize = { columns: 60, rows: 24 },
  ) {
    this.#chunks = chunks.map((chunk) => encoder.encode(chunk));
    this.#capabilities = capabilities;
    this.#size = size;
  }

  isInteractive(): boolean {
    return true;
  }

  capabilities(): TerminalCapabilities {
    return this.#capabilities;
  }

  size(): TerminalSize {
    return this.#size;
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
async function moduleGraph(entrypoint: string): Promise<DenoInfo> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return JSON.parse(new TextDecoder().decode(output.stdout)) as DenoInfo;
}

/** Resolve a graph edge through Deno's package-export redirect table. */
function resolvedEdge(info: DenoInfo, specifier: string): string {
  return info.redirects?.[specifier] ?? specifier;
}

Deno.test("the selected release exposes all four public consumer graphs", async () => {
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
    ansiControl: true,
    colorDepth: "none",
    columns: 60,
    unicode: true,
  };
  assertEquals(
    renderBadgeCli({ label: "Published", tone: "success" }, capabilities),
    "[Published]",
  );
  assertStringIncludes(
    projectTerminalHtml("\x1b[1mPublished\x1b[0m"),
    "font-weight:700",
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
  ] as const satisfies readonly InteractionEntry<string>[];
  const io = new ConsumerTerminal(["\x1b[B\r"]);
  assertEquals(
    await requestSelection({ label: "Pick", choices, reservedRows: 2 }, { io }),
    "two",
  );
  assertEquals(io.rawTransitions, [true, false]);
  const terminalOutput = io.writes.join("");
  assertStringIncludes(terminalOutput, "PRIMARY");
  assertStringIncludes(terminalOutput, "SECONDARY");

  const choiceFrames = io.writes.filter((write) =>
    write.includes("One") && write.includes("Two")
  );
  assert(choiceFrames.length >= 2);
  for (const frame of choiceFrames) {
    const lines = frame.replaceAll(ANSI_PATTERN, "").split("\n");
    const one = lines.find((line) => line.includes("One"));
    const two = lines.find((line) => line.includes("Two"));
    assert(one !== undefined);
    assert(two !== undefined);
    assertEquals(one.indexOf("One"), two.indexOf("Two"));
  }

  const staticIo = new ConsumerTerminal([], {
    ansiControl: false,
    colorDepth: "none",
    columns: 60,
    unicode: true,
  });
  const staticPainter = new InlineFramePainter(staticIo);
  assertEquals(staticPainter.replace("one\ntwo"), {
    status: "refused",
    reason: "ansi-control-unavailable",
    frameLines: 2,
    previousFrameLines: 0,
    viewportRows: 24,
  });
  assertEquals(staticIo.writes, []);

  const shortIo = new ConsumerTerminal([], capabilities, {
    columns: 60,
    rows: 2,
  });
  const shortPainter = new InlineFramePainter(shortIo);
  assertEquals(shortPainter.replace("one\ntwo\nthree"), {
    status: "refused",
    reason: "frame-exceeds-viewport",
    frameLines: 3,
    previousFrameLines: 0,
    viewportRows: 2,
  });
  assertEquals(shortIo.writes, []);

  const hintedIo = new ConsumerTerminal([], {
    ansiControl: false,
    colorDepth: "none",
    columns: 60,
    unicode: true,
  });
  assertEquals(
    await senseTerminalBackground({
      io: hintedIo,
      environment: { COLORFGBG: "0;15" },
      timeoutMs: 1,
    }),
    {
      ground: "light",
      evidence: { source: "environment-hint", value: "0;15" },
    },
  );
  assertEquals(hintedIo.writes, []);
});

Deno.test("the selected release supplies Discern's revised static contracts", () => {
  const capabilities: TerminalCapabilities = {
    ansiControl: true,
    colorDepth: "none",
    columns: 40,
    unicode: true,
  };

  const presenter = createCliPresenter(capabilities, {
    theme: "dark",
    width: 32,
  });
  const effectiveCapabilities = { ...capabilities, columns: 32 };
  assertEquals(
    presenter.present(renderBadgeCli, {
      label: "Published",
      tone: "success",
    }),
    renderBadgeCli({
      label: "Published",
      theme: "dark",
      tone: "success",
    }, effectiveCapabilities),
  );
  assertEquals(
    presenter.success("Package ready."),
    renderSuccessLine(
      { text: "Package ready.", theme: "dark" },
      effectiveCapabilities,
    ),
  );
  assertEquals(
    presenter.note("Inspect the render."),
    renderNoteLine(
      { text: "Inspect the render.", theme: "dark" },
      effectiveCapabilities,
    ),
  );

  const box = presenter.box({ body: "Ready", title: "Status", width: 32 });
  assertEquals(box.split("\n").map(measureText), [32, 32, 32]);
  assert(presenter.triangleSpinnerFrame(0).length > 0);
  const section = presenter.triangleSectionRule("Status", { width: 32 });
  assertStringIncludes(section, "STATUS");
  assertEquals(measureText(section), 32);
  const workflow = presenter.triangleWorkflowStepper([
    { label: "Pending", status: "pending" },
    { label: "Running", status: "active", phase: 0 },
    { label: "Passed", status: "complete" },
  ]);
  const labelColumns = workflow.split("\n")
    .filter((_, index) => index % 2 === 0)
    .map((line) => {
      const plain = line.replaceAll(ANSI_PATTERN, "");
      return Math.max(
        plain.indexOf("Pending"),
        plain.indexOf("Running"),
        plain.indexOf("Passed"),
      );
    });
  assertEquals(labelColumns, [4, 4, 4]);

  const colorCapabilities: TerminalCapabilities = {
    ...capabilities,
    colorDepth: "truecolor",
  };
  const lightSection = createCliPresenter(colorCapabilities, {
    theme: "light",
    width: 32,
  }).triangleSectionRule("Status", { width: 32 });
  const darkSection = createCliPresenter(colorCapabilities, {
    theme: "dark",
    width: 32,
  }).triangleSectionRule("Status", { width: 32 });
  assert(lightSection !== darkSection, "the presenter must bind motif theme");

  assertEquals(
    renderHeadingCli({ text: "Calm title", level: 2 }, capabilities),
    "\n## Calm title",
  );
  assertEquals(
    renderHeadingCli({
      text: "Calm title",
      level: 2,
      leadingBlankLines: 0,
    }, capabilities),
    "## Calm title",
  );

  const command = renderCommandCli({
    command: "discern status",
    explanation: "See the current state.",
  }, capabilities);
  assertEquals(command, "Run: discern status\nSee the current state.");
  assert(!command.includes("$ "), "a suggestion must not resemble prior input");

  const confirm = (value: boolean): string =>
    renderSwitchCli({
      kind: "confirm",
      label: "Proceed",
      lifecycle: { status: "active" },
      value,
      yesLabel: "Deploy now",
      noLabel: "Keep waiting",
      width: 40,
    }, capabilities);
  assertEquals(
    confirm(false),
    "Proceed [active]\n" +
      "┌──────────────────────────────────────┐\n" +
      "│› Keep waiting ●──○ Deploy now        │\n" +
      "└──────────────────────────────────────┘\n",
  );
  assertEquals(
    confirm(true),
    "Proceed [active]\n" +
      "┌──────────────────────────────────────┐\n" +
      "│› Keep waiting ○──● Deploy now        │\n" +
      "└──────────────────────────────────────┘\n",
  );
  for (const value of [false, true]) {
    const frame = confirm(value).split("\n").slice(1);
    assertEquals(frame.at(-1), "");
    assertEquals(frame.slice(0, -1).map(measureText), [40, 40, 40]);
  }

  assertEquals(
    renderRadioCli({
      kind: "select",
      label: "Pick",
      lifecycle: { status: "active" },
      options: [
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ],
      highlightedIndex: 0,
      selectedId: "two",
      width: 40,
    }, capabilities),
    "Pick [active]\n" +
      "┌──────────────────────────────────────┐\n" +
      "│› ○ One                               │\n" +
      "│  ◉ Two                               │\n" +
      "└──────────────────────────────────────┘\n",
  );

  const resultGroup = renderResultSummaryGroupCli({
    items: [
      { state: "passed", fact: "short" },
      { state: "changed", fact: "longer" },
    ],
  }, capabilities);
  assertEquals(resultGroup, "✓ Passed:  short\n◇ Changed: longer");
  const [passed = "", changed = ""] = resultGroup.split("\n");
  assertEquals(passed.indexOf("short"), changed.indexOf("longer"));

  const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`)
    .join("\n");
  const textarea = renderTextareaCli({
    kind: "textarea",
    label: "Notes",
    lifecycle: { status: "active" },
    value: text,
    cursor: text.length,
    rows: 12,
    width: 40,
  }, capabilities);
  const textareaLines = textarea.split("\n");
  assertEquals(textareaLines.length, 16);
  assertEquals(textareaLines.at(-1), "");
  assertEquals(
    textareaLines.slice(1, -1).map(measureText),
    Array(14).fill(40),
  );
  assertStringIncludes(textarea, "line 1");
  assertStringIncludes(textarea, "line 12");
});

Deno.test("CLI-only design-system graphs stay external, exact, and React-free", async () => {
  const entrypoint = join(ROOT, "tests/fixtures/design_system_cli_graph.ts");
  const info = await moduleGraph(entrypoint);
  const modules = (info.modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
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

  const moduleBySpecifier = new Map(
    (info.modules ?? []).flatMap((module) =>
      module.specifier === undefined
        ? []
        : [[module.specifier, module] as const]
    ),
  );
  const rootSpecifier = info.roots?.[0];
  assert(rootSpecifier !== undefined);
  const root = moduleBySpecifier.get(rootSpecifier);
  assert(root !== undefined);
  const packageRoots = new Map(
    (root.dependencies ?? [])
      .filter((dependency) =>
        dependency.specifier === "discern-design-system" ||
        dependency.specifier === "discern-design-system/cli" ||
        dependency.specifier === "discern-design-system/cli/interactive" ||
        dependency.specifier === "discern-design-system/cli/projection"
      )
      .flatMap((dependency) =>
        dependency.code === undefined ? [] : [
          [
            dependency.specifier,
            resolvedEdge(info, dependency.code.specifier),
          ] as const,
        ]
      ),
  );
  assertEquals([...packageRoots.keys()], [
    "discern-design-system",
    "discern-design-system/cli",
    "discern-design-system/cli/interactive",
    "discern-design-system/cli/projection",
  ]);
  const allowedOrigin =
    `https://jsr.io/@discern-sh/design-system/${SELECTED_VERSION}/`;
  for (const [publicRoot, resolvedRoot] of packageRoots) {
    const pending = [resolvedRoot];
    const packageClosure = new Set<string>();
    while (pending.length > 0) {
      const specifier = pending.pop();
      assert(specifier !== undefined);
      if (packageClosure.has(specifier)) continue;
      assert(
        specifier.startsWith(allowedOrigin),
        `${publicRoot} graph escaped ${allowedOrigin}: ${specifier}`,
      );
      packageClosure.add(specifier);
      const module = moduleBySpecifier.get(specifier);
      assert(module !== undefined, `missing resolved module ${specifier}`);
      for (const dependency of module.dependencies ?? []) {
        for (const resolution of [dependency.code, dependency.type]) {
          if (resolution !== undefined) {
            pending.push(resolvedEdge(info, resolution.specifier));
          }
        }
      }
    }
    assert(packageClosure.size > 1, `${publicRoot} closure was not traversed`);
  }

  assertEquals(
    reactRuntimeModules([
      "npm:/@types/react@18.3.12",
      "npm:/react-dom@18.3.1/server",
    ]),
    ["npm:/react-dom@18.3.1/server"],
  );
  const forbidden = modules.filter((specifier) =>
    reactRuntimeModules([specifier]).length > 0
  );
  assertEquals(forbidden, []);
});
