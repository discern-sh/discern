/** External-consumer contract for Discern's selected design-system CLI release. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "@zod/zod";
import { fromFileUrl, join } from "@std/path";
import { packageManifest } from "discern-design-system";
import {
  createCliPresenter,
  deriveTerminalMotif,
  DISCERN_TERMINAL_MOTIF,
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
  type MarkdownBrowserLinkResolution,
  MarkdownBrowserRefusalError,
  requestAcknowledgement,
  requestMarkdownBrowser,
  requestSelection,
  senseTerminalBackground,
  type TerminalIO,
  type TerminalMouseEvent,
  type TerminalSize,
} from "discern-design-system/cli/interactive";
import {
  encodeTerminalKeys,
  encodeTerminalMouseEvent,
  FakeTerminalIO,
} from "discern-design-system/cli/interactive/testing";
import { projectTerminalHtml } from "discern-design-system/cli/projection";
import { decodeWith } from "./decode_cli_result.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SELECTED_VERSION = "0.28.0";
const SELECTED_SPECIFIER = `jsr:@discern-sh/design-system@${SELECTED_VERSION}`;
const PACKAGE_VERSION_PATTERN =
  /@discern-sh\/design-system\/(\d+\.\d+\.\d+)\//u;
const encoder = new TextEncoder();
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);

const DenoConfigSchema = z.object({
  imports: z.record(z.string(), z.string()),
});
const LockPackageSchema = z.object({
  integrity: z.string(),
  dependencies: z.array(z.string()).optional(),
});
const DenoLockSchema = z.object({
  specifiers: z.record(z.string(), z.string()),
  jsr: z.record(z.string(), LockPackageSchema),
  npm: z.record(z.string(), LockPackageSchema),
});

interface DenoInfoResolution {
  readonly specifier: string;
}

interface DenoInfoDependency {
  readonly specifier: string;
  readonly code?: DenoInfoResolution | undefined;
  readonly type?: DenoInfoResolution | undefined;
}

interface DenoInfoModule {
  readonly kind?: string | undefined;
  readonly specifier?: string | undefined;
  readonly npmPackage?: string | undefined;
  readonly dependencies?: readonly DenoInfoDependency[] | undefined;
}

interface DenoInfo {
  readonly roots?: readonly string[] | undefined;
  readonly redirects?: Readonly<Record<string, string>> | undefined;
  readonly modules?: readonly DenoInfoModule[] | undefined;
}

const DenoInfoSchema = z.object({
  roots: z.array(z.string()).optional(),
  redirects: z.record(z.string(), z.string()).optional(),
  modules: z.array(z.object({
    kind: z.string().optional(),
    specifier: z.string().optional(),
    npmPackage: z.string().optional(),
    dependencies: z.array(z.object({
      specifier: z.string(),
      code: z.object({ specifier: z.string() }).optional(),
      type: z.object({ specifier: z.string() }).optional(),
    })).optional(),
  })).optional(),
});

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
  return decodeWith(
    DenoInfoSchema,
    new TextDecoder().decode(output.stdout),
  );
}

/** Resolve a graph edge through Deno's package-export redirect table. */
function resolvedEdge(info: DenoInfo, specifier: string): string {
  return info.redirects?.[specifier] ?? specifier;
}

Deno.test("the selected release exposes the complete public reader contract", async () => {
  const config = decodeWith(
    DenoConfigSchema,
    await Deno.readTextFile(join(ROOT, "deno.json")),
  );
  const lock = decodeWith(
    DenoLockSchema,
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  );
  assertEquals(config.imports["discern-design-system"], SELECTED_SPECIFIER);
  assertEquals(lock.specifiers[SELECTED_SPECIFIER], SELECTED_VERSION);
  assert(`@discern-sh/design-system@${SELECTED_VERSION}` in lock.jsr);

  assertEquals(packageManifest.package, "@discern-sh/design-system");
  assert(packageManifest.components.length > 0);
  assertEquals(typeof requestAcknowledgement, "function");
  assertEquals(typeof requestMarkdownBrowser, "function");
  assertEquals(typeof MarkdownBrowserRefusalError, "function");
  assertEquals(typeof FakeTerminalIO, "function");
  const mouse: TerminalMouseEvent = {
    kind: "mouse",
    action: "wheel",
    direction: "down",
    column: 4,
    row: 8,
    modifiers: { shift: false, alt: false, control: false },
  };
  assertStringIncludes(encodeTerminalMouseEvent(mouse), "[<65;4;8M");
  const linkResolution: MarkdownBrowserLinkResolution = {
    kind: "document",
    documentId: "guide",
  };
  assertEquals(linkResolution.kind, "document");

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
    {
      kind: "group-heading",
      id: "primary",
      label: "Primary",
      description: "first/",
    },
    { id: "one", label: "One", description: "one.md", value: "one" },
    { kind: "group-heading", id: "secondary", label: "Secondary" },
    { id: "two", label: "Two", value: "two" },
  ] as const satisfies readonly InteractionEntry<string>[];
  const io = new ConsumerTerminal(["\x1b[B\r"]);
  assertEquals(
    await requestSelection({
      label: "Pick",
      choices,
      reservedRows: 2,
      presentation: "browsing",
      completion: "clear-frame",
    }, { io }),
    "two",
  );
  assertEquals(io.rawTransitions, [true, false]);
  const terminalOutput = io.writes.join("");
  assertStringIncludes(terminalOutput, "PRIMARY");
  assertStringIncludes(terminalOutput, "SECONDARY");
  assertStringIncludes(terminalOutput, "first/");
  assertStringIncludes(terminalOutput, "one.md");

  const browserIo = new FakeTerminalIO([encodeTerminalKeys("enter")], {
    ansiControl: true,
    columns: 80,
    rows: 24,
  });
  const browserResult = await requestMarkdownBrowser({
    label: "Published browser",
    entries: [{
      kind: "action",
      id: "return",
      label: "Return",
      value: "returned",
    }],
    mouse: true,
  }, { io: browserIo });
  assertEquals(browserResult.kind, "action");
  assertEquals(browserIo.rawTransitions, [true, false]);
  assertEquals(browserIo.resizeListenerCount, 0);

  const acknowledgementIo = new ConsumerTerminal(["\r"]);
  await requestAcknowledgement(
    { presentation: "compact" },
    { io: acknowledgementIo },
  );
  assertStringIncludes(
    acknowledgementIo.writes.join(""),
    "Press Enter to continue.",
  );

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
  assert(presenter.motif === DISCERN_TERMINAL_MOTIF);
  assertEquals(
    Array.from({ length: 4 }, (_, phase) => presenter.motifSpinnerFrame(phase)),
    ["◐", "◓", "◑", "◒"],
  );
  const customMotif = deriveTerminalMotif(DISCERN_TERMINAL_MOTIF, {
    unicode: { spinner: ["◴", "◷", "◶", "◵"] },
  });
  const customPresenter = presenter.with({ motif: customMotif });
  assert(customPresenter.motif === customMotif);
  assertEquals(
    Array.from(
      { length: 4 },
      (_, phase) => customPresenter.motifSpinnerFrame(phase),
    ),
    ["◴", "◷", "◶", "◵"],
  );
  assertEquals(presenter.motifSpinnerFrame(1, { motif: customMotif }), "◷");
  assertEquals(presenter.motifSpinnerFrame(1), "◓");

  const section = presenter.motifSectionRule("Status", { width: 32 });
  assertStringIncludes(section, "STATUS");
  assertEquals(measureText(section), 32);
  const workflow = presenter.motifWorkflowStepper([
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
  }).motifSectionRule("Status", { width: 32 });
  const darkSection = createCliPresenter(colorCapabilities, {
    theme: "dark",
    width: 32,
  }).motifSectionRule("Status", { width: 32 });
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
    "Proceed\n" +
      "┌──────────────────────────────────────┐\n" +
      "│ › Keep waiting × ●──○   Deploy now   │\n" +
      "└──────────────────────────────────────┘\n",
  );
  assertEquals(
    confirm(true),
    "Proceed\n" +
      "┌──────────────────────────────────────┐\n" +
      "│ › Keep waiting   ○──● ✓ Deploy now   │\n" +
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
    "Pick\n" +
      "┌──────────────────────────────────────┐\n" +
      "│ › ○ One                              │\n" +
      "│   ◉ Two                              │\n" +
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

Deno.test("CLI design-system graphs stay published, lock-resolved, and React-free", async () => {
  const entrypoint = join(ROOT, "tests/fixtures/design_system_cli_graph.ts");
  const info = await moduleGraph(entrypoint);
  const lock = decodeWith(
    DenoLockSchema,
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  );
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
        dependency.specifier ===
          "discern-design-system/cli/interactive/testing" ||
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
    "discern-design-system/cli/interactive/testing",
    "discern-design-system/cli/projection",
  ]);
  const allowedOrigin =
    `https://jsr.io/@discern-sh/design-system/${SELECTED_VERSION}/`;
  const packageLock = lock.jsr[`@discern-sh/design-system@${SELECTED_VERSION}`];
  assert(packageLock !== undefined);
  const declaredNpmPackages = (packageLock.dependencies ?? []).flatMap(
    (dependency) =>
      dependency.startsWith("npm:") ? [dependency.slice("npm:".length)] : [],
  );
  for (const [publicRoot, resolvedRoot] of packageRoots) {
    const pending = [resolvedRoot];
    const publicClosure = new Set<string>();
    while (pending.length > 0) {
      const specifier = pending.pop();
      assert(specifier !== undefined);
      if (publicClosure.has(specifier)) continue;
      publicClosure.add(specifier);
      const module = moduleBySpecifier.get(specifier);
      assert(module !== undefined, `missing resolved module ${specifier}`);
      if (!specifier.startsWith(allowedOrigin)) {
        assertEquals(
          module.kind,
          "npm",
          `${publicRoot} graph escaped its published package: ${specifier}`,
        );
        const packageKey = module.npmPackage;
        assert(
          packageKey !== undefined && packageKey in lock.npm,
          `${publicRoot} graph reached unlocked npm module ${specifier}`,
        );
        assert(
          declaredNpmPackages.some((name) => packageKey.startsWith(`${name}@`)),
          `${publicRoot} graph reached undeclared npm package ${packageKey}`,
        );
      }
      for (const dependency of module.dependencies ?? []) {
        for (const resolution of [dependency.code, dependency.type]) {
          if (resolution !== undefined) {
            pending.push(resolvedEdge(info, resolution.specifier));
          }
        }
      }
    }
    assert(publicClosure.size > 1, `${publicRoot} closure was not traversed`);
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
