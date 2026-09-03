/**
 * Tests for `discern docs` — the surface that ships discern's OWN documentation
 * to every install. It shares the docs core (`src/commands/docs.ts`), so these
 * focus on what is genuinely different: it serves the BUNDLED tree (never the
 * project's `docs/`), it is available before project setup,
 * and it surfaces only the public subtrees. The command is driven end-to-end via
 * the CLI subprocess (piped stdio — the non-interactive agent/script path), with
 * `DISCERN_DOCS_DIR` pointing the bundled-docs resolver at a controlled fixture.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { measureText, stripAnsi } from "discern-design-system/cli";
import {
  assertTerminalTextIncludes,
  fakeEnv,
  readTarget,
  runCli,
  seedConfig,
  unexpectedTerminalControls,
  withTempDir,
} from "./helpers.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import {
  COMMAND_SYNONYM_SUGGESTIONS,
  RETIRED_COMMAND_REDIRECTS,
} from "../src/shared/vocabulary.ts";
import { DISCERN_MARK } from "../src/shared/brand.ts";
import { stageBundledManual } from "../scripts/build.ts";
import {
  approvedDocsExternalUrl,
  DOCS_AGENT_CONTEXT_HINT,
  docsBrowseNavigationChoices,
  docsBrowseProjection,
  renderDocsCorpusHeader,
  renderExternalDecisionsNotice,
  resolveDocsBrowserLink,
} from "../src/commands/docs.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { ptyOutputContains, runPtyProcess } from "./fixtures/pty_process.ts";
import { engineRunArgs } from "./engine_helpers.ts";
import { realPtyTest } from "./real_pty.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

type DocsResult = CliResultForCommand<"docs">;
type DocsData = Exclude<NonNullable<DocsResult["data"]>, { issues: unknown }>;
type PresentDocsDataKey<Key extends keyof DocsData> =
  & DocsData
  & {
    [Property in Key]-?: NonNullable<DocsData[Property]>;
  };

/** Prove that one decoded docs payload field is present and non-nullish. */
function assertDocsDataKey<Key extends keyof DocsData>(
  result: DocsResult,
  key: Key,
): asserts result is DocsResult & { data: PresentDocsDataKey<Key> } {
  assertResultDataKey(result, key);
  assertExists(result.data[key]);
}

/** Decode docs stdout and require the payload field this assertion consumes. */
function decodeDocsData<Key extends keyof DocsData>(
  stdout: string,
  key: Key,
): PresentDocsDataKey<Key> {
  const result = decodeCliResult(stdout, "docs");
  assertDocsDataKey(result, key);
  return result.data;
}

/** This repo's root — used by the dogfood test to resolve discern's real docs. */
const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

Deno.test("docs browser offers its online manual without adding it to map", () => {
  assertEquals(
    docsBrowseNavigationChoices("docs").map((choice) => choice.name),
    ["Read the docs online", "Quit"],
  );
  assertEquals(
    docsBrowseNavigationChoices("map").map((choice) => choice.name),
    ["Quit"],
  );
});

Deno.test("docs browser resolves fragments and admitted Markdown paths from its in-memory corpus", () => {
  const availableDocuments = [
    { id: "root", name: "Welcome", path: "README.md" },
    { id: "start", name: "Start", path: "00-start/start.md" },
    { id: "other", name: "Other", path: "00-start/other.md" },
    { id: "next", name: "Next", path: "10-next/README.md" },
    { id: "target", name: "Target", path: "10-next/target.md" },
  ] as const;
  const resolve = (destination: string) =>
    resolveDocsBrowserLink({
      sourceDocumentId: "start",
      sourcePath: "00-start/start.md",
      destination,
      availableDocuments,
    });

  assertEquals(resolve("#details"), {
    kind: "fragment",
    fragment: "#details",
  });
  for (const destination of ["other.md", "./other.md"]) {
    assertEquals(resolve(destination), {
      kind: "document",
      documentId: "other",
    });
  }
  assertEquals(resolve("../10-next/target.md#result"), {
    kind: "document",
    documentId: "target",
    fragment: "#result",
  });
  assertEquals(resolve("/README.md"), {
    kind: "document",
    documentId: "root",
  });
  assertEquals(resolve("../10-next/"), {
    kind: "document",
    documentId: "next",
  });
});

Deno.test("docs browser leaves unadmitted, unsafe, and malformed destinations inert", () => {
  const availableDocuments = [
    { id: "start", name: "Start", path: "00-start/start.md" },
  ] as const;
  for (
    const destination of [
      "../../outside.md",
      "../src/main.ts",
      "../_private/hidden.md",
      "missing.md",
      "file:///etc/passwd",
      "mailto:hello@example.com",
      "javascript:alert(1)",
      "//example.com/docs",
      "%ZZ.md",
      "../%2e%2e/outside.md",
      "..\\outside.md",
      "#%ZZ",
    ]
  ) {
    const result = resolveDocsBrowserLink({
      sourceDocumentId: "start",
      sourcePath: "00-start/start.md",
      destination,
      availableDocuments,
    });
    assertEquals(result.kind, "unresolved", destination);
    if (result.kind === "unresolved") {
      assertStringIncludes(result.message ?? "", "Choose a document");
    }
  }
});

Deno.test("docs browser admits only absolute HTTP and HTTPS effects", () => {
  for (
    const destination of ["https://example.com/docs", "http://example.com"]
  ) {
    assertEquals(approvedDocsExternalUrl(destination), destination);
    assertEquals(
      resolveDocsBrowserLink({
        sourceDocumentId: "readme",
        sourcePath: "README.md",
        destination,
        availableDocuments: [{
          id: "readme",
          name: "Welcome",
          path: "README.md",
        }],
      }),
      { kind: "external", destination },
    );
  }
  for (
    const destination of [
      "//example.com/docs",
      "mailto:hello@example.com",
      "file:///tmp/readme.md",
      " https://example.com/docs",
    ]
  ) {
    assertEquals(approvedDocsExternalUrl(destination), undefined);
  }
});

Deno.test("docs headers preserve exact facts at narrow and wide TTY widths", () => {
  const directory = "/a/long/grapheme-safe/café-🙂/manual";
  for (const width of [24, 80]) {
    const terminal = resolveTerminalContext({
      noColor: false,
      env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
      isTerminal: () => true,
      consoleSize: () => ({ columns: width, rows: 24 }),
    });
    const rendered = stripAnsi(
      renderDocsCorpusHeader("docs", 17, directory, width, terminal),
    );
    for (const line of rendered.split("\n")) {
      assert(
        measureText(line) <= width,
        `${width}-column docs header overflowed: ${JSON.stringify(line)}`,
      );
    }
    assertStringIncludes(rendered, "DISCERN DOCS");
    assertStringIncludes(rendered, DISCERN_MARK);
    assertEquals(
      rendered.split("\n").slice(1).join("").replaceAll(/\s+/gu, ""),
      `— 17 documents in ${directory}`.replaceAll(/\s+/gu, ""),
    );
  }
});

Deno.test("docs headers keep the original one-line fact for pipes", () => {
  const terminal = resolveTerminalContext({
    noColor: true,
    env: fakeEnv({}),
    isTerminal: () => false,
    consoleSize: () => ({ columns: 24, rows: 24 }),
  });
  assertEquals(
    renderDocsCorpusHeader("docs", 17, "manual", 24, terminal),
    "discern docs — 17 documents in manual",
  );
});

Deno.test("docs headers make hostile directory facts inert before rendering", () => {
  const width = 48;
  const terminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: width, rows: 24 }),
  });
  const rendered = stripAnsi(
    renderDocsCorpusHeader(
      "docs",
      3,
      "/tmp/café-👩‍💻\x1b\u0085\u202E\r\nmanual",
      width,
      terminal,
    ),
  );

  assertEquals(unexpectedTerminalControls(rendered), []);
  assert(!/[\p{Cc}\p{Cf}]/u.test(rendered.replaceAll("\n", "")));
  for (const visible of ["<U+200D>", "␛", "<U+0085>", "<U+202E>", "␍", "␊"]) {
    assertStringIncludes(rendered, visible);
  }
  for (const line of rendered.split("\n")) {
    assert(measureText(line) <= width);
  }
});

Deno.test("installed decision redirects use a TTY Callout and one pipe-safe line", () => {
  const width = 56;
  const tty = resolveTerminalContext({
    noColor: true,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: width, rows: 24 }),
  });
  const rendered = renderExternalDecisionsNotice(tty, width);
  assertStringIncludes(rendered, "Decision records live online");
  assertStringIncludes(rendered, "https://discern.sh/docs/decisions");
  for (const line of rendered.split("\n")) assert(measureText(line) <= width);

  const pipe = resolveTerminalContext({
    noColor: true,
    env: fakeEnv({}),
    isTerminal: () => false,
    consoleSize: () => ({ columns: width, rows: 24 }),
  });
  const plain = renderExternalDecisionsNotice(pipe, width);
  assert(!plain.includes("Decision records live online"));
  assertStringIncludes(plain, "not bundled with installed binaries");
  assertStringIncludes(plain, "https://discern.sh/docs/decisions");
});

/** Build one strict manual source used by the focused delivery fixtures. */
function manualFixturePage(
  id: string,
  title: string,
  kind:
    | "tutorial"
    | "guide"
    | "explanation"
    | "reference"
    | "troubleshooting",
  order: number,
  body: string,
  publish = true,
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(title)}`,
    `description: ${
      JSON.stringify(
        "A complete product-manual fixture description for this focused documentation test.",
      )
    }`,
    `order: ${order}`,
    `publish: ${publish}`,
    `kind: ${kind}`,
    "aliases:",
    `  - ${JSON.stringify(`${id} alias`)}`,
    "---",
    "",
    body,
  ].join("\n");
}

/**
 * Lay a project that has BOTH its own `docs/` (a decoy `docs` must never show)
 * and a separate strict manual fixture. Returns the fixture path to pass as
 * `DISCERN_DOCS_DIR`.
 */
async function makeDocsFixture(
  dir: string,
  config =
    '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
): Promise<string> {
  await seedConfig(dir, config);

  // The project's OWN docs/ — present so a passing test proves `docs` ignores it.
  await Deno.mkdir(join(dir, "docs"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "docs/decoy.md"),
    "# Project Decoy\n\nThe project's own docs.\n",
  );

  // A strict bundled-manual fixture. Every registered section has one index;
  // the source carries no Map or protected subtree.
  const docs = join(dir, "manual-fixture");
  const files: Record<string, string> = {
    "README.md": manualFixturePage(
      "manual-home",
      "discern documentation",
      "tutorial",
      0,
      "# discern documentation\n\nWelcome.\n\n" +
        "<!-- BEGIN MANUAL FRONT DOORS -->\n" +
        "- [Start](00-start/README.md)\n" +
        "<!-- END MANUAL FRONT DOORS -->\n\n" +
        "Read [Concepts](00-start/concepts.md#concepts-at-a-glance) " +
        "or visit the [website](https://example.com/docs).\n",
    ),
    "00-start/README.md": manualFixturePage(
      "start-index",
      "Intro",
      "tutorial",
      0,
      "# Intro\n\nRead [Concepts](concepts.md).\n",
    ),
    "00-start/concepts.md": manualFixturePage(
      "start-concepts",
      "Concepts at a glance",
      "explanation",
      10,
      "# Concepts at a glance\n\n" +
        "The concepts body, decided early ([ADR 0001](https://discern.sh/docs/decisions/0001-first)).\n",
    ),
    "00-start/hidden.md": manualFixturePage(
      "start-hidden",
      "Hidden draft",
      "tutorial",
      20,
      "# Hidden draft\n\nWithheld.\n",
      false,
    ),
    "10-guides/README.md": manualFixturePage(
      "guide-index",
      "Guides",
      "guide",
      0,
      "# Guides\n",
    ),
    "20-understand/README.md": manualFixturePage(
      "understand-index",
      "Understand",
      "explanation",
      0,
      "# Understand\n",
    ),
    "30-reference/README.md": manualFixturePage(
      "reference-index",
      "Reference",
      "reference",
      0,
      "# Reference\n\nRead the [Glossary](glossary.md).\n",
    ),
    "30-reference/glossary.md": manualFixturePage(
      "reference-glossary",
      "Glossary",
      "reference",
      10,
      "# Glossary\n",
    ),
    "40-troubleshooting/README.md": manualFixturePage(
      "troubleshooting-index",
      "Troubleshooting",
      "troubleshooting",
      0,
      "# Troubleshooting\n",
    ),
  };
  for (const [rel, content] of Object.entries(files)) {
    await Deno.mkdir(join(docs, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(docs, rel), content);
  }
  return docs;
}

/** Add enough exact manual matches to exercise the bounded search projection. */
async function addSearchMatches(docs: string, count: number): Promise<void> {
  const indexPath = join(docs, "10-guides", "README.md");
  const links: string[] = [];
  for (let number = 1; number <= count; number += 1) {
    const slug = `search-match-${number}`;
    links.push(`- [Search match ${number}](${slug}.md)`);
    await Deno.writeTextFile(
      join(docs, "10-guides", `${slug}.md`),
      manualFixturePage(
        `guide-${slug}`,
        `Search match ${number}`,
        "guide",
        number * 10,
        `# Search match ${number}\n\nThe exact diagnostic token is \`orchard-signal\`.\n`,
      ),
    );
  }
  await Deno.writeTextFile(
    indexPath,
    `${await Deno.readTextFile(indexPath)}\n${links.join("\n")}\n`,
  );
}

realPtyTest({
  name:
    "docs browser opens a split reader and restores the full picker through the real PTY",
  contracts: [
    "line-discipline",
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
  ],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs"]),
        cwd: dir,
        env: { DISCERN_DOCS_DIR: docs, NO_COLOR: "1", PAGER: "false" },
        geometry: { columns: 80, rows: 40 },
        input: [
          // Browse and Start here precede the complete-navigation root.
          {
            waitFor: "Enter open/action  Esc cancel",
            capture: {
              name: "initial",
              when: ptyOutputContains([
                "BROWSE",
                "START HERE",
                "OVERVIEW",
                "INTRO",
                "Concepts at a glance",
                "Enter open/action  Esc cancel",
              ]),
            },
            steps: [{ bytes: "\x1b[B\x1b[B\r" }],
          },
          {
            waitFor: ["Welcome.", "Tab picker"],
            capture: {
              name: "split",
              when: ptyOutputContains(["Welcome.", "Tab picker"]),
            },
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: ["discern documentation", "Esc cancel"],
            capture: {
              name: "restored",
              when: ptyOutputContains([
                "discern documentation",
                "Esc cancel",
              ]),
            },
            steps: [{ bytes: "\x03" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertEquals(process.stderr, "", process.transcript);
      assert((process.transcript.match(/Welcome\./gu)?.length ?? 0) >= 1);
      assertStringIncludes(process.transcript, "DISCERN DOCS — 8 DOCUMENTS");
      assert(!process.transcript.includes("Press Enter to continue."));
      assert(!process.transcript.includes("The pager failed"));

      const initial = process.keyframes.initial ?? "";
      assertStringIncludes(
        initial,
        "If useful, ask your coding agent to explain this page in your project's",
      );
      assertStringIncludes(
        initial,
        "context. discern does not bundle, choose, or contact models.",
      );
      const groupOffsets = [
        "BROWSE",
        "START HERE",
        "OVERVIEW",
        "INTRO",
      ].map(
        (label) => initial.indexOf(label),
      );
      assert(groupOffsets.every((offset) => offset >= 0), initial);
      assertEquals([...groupOffsets].sort((a, b) => a - b), groupOffsets);
      for (
        const visible of [
          "Read the docs online",
          "discern documentation",
          "README.md",
          "00-start/",
          "Concepts at a glance",
        ]
      ) {
        assertStringIncludes(initial, visible);
      }
      const split = process.keyframes.split ?? "";
      assertStringIncludes(split, "Picker");
      assertStringIncludes(split, "Document · discern documentation");
      assertStringIncludes(split, "Welcome.");
      assertStringIncludes(
        process.keyframes.restored ?? "",
        "discern documentation",
      );
      assertStringIncludes(process.keyframes.restored ?? "", "START HERE");
    });
  },
});

realPtyTest({
  name: "a failed target pager restores the terminal and exits without input",
  contracts: ["terminal-modes", "process-lifecycle", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs", "concepts", "--pager"]),
        cwd: dir,
        env: { DISCERN_DOCS_DIR: docs, PAGER: "false", NO_COLOR: "1" },
        geometry: { columns: 80, rows: 24 },
        keepInputOpen: true,
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertStringIncludes(process.transcript, "The concepts body");
      assertStringIncludes(process.transcript, "The pager failed");
      assert(!process.transcript.includes("Press Enter to continue."));
    });
  },
});

Deno.test("promoted and complete manual entries keep distinct picker values", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const discovered = await discoverDocs({ cwd: dir, dir: docs });
    assertExists(discovered);
    const manual = await buildManualProjection(discovered.entries);
    const projection = await docsBrowseProjection("docs", {
      ...discovered,
      entries: manual.pages.map((page) => page.entry),
    });
    assertEquals(
      projection.groups.find((group) => group.id === "browse")?.items[0]
        ?.description,
      DOCS_AGENT_CONTEXT_HINT,
    );
    assert(
      projection.groups.some((group) =>
        group.items.some((item) => item.description?.startsWith("Tutorial ·"))
      ),
    );
    const mapProjection = await docsBrowseProjection("map", discovered);
    assert(
      !JSON.stringify(mapProjection.groups).includes(DOCS_AGENT_CONTEXT_HINT),
    );
    const items = projection.groups.flatMap((group) => group.items);
    const selectable = items.map((item) => JSON.stringify(item.value));
    assertEquals(new Set(selectable).size, selectable.length);
    const promoted = items.find((item) => item.id?.startsWith("promoted:"));
    const complete = items.find((item) =>
      item.id ===
        `document:${
          promoted?.value.kind === "promoted-document"
            ? promoted.value.path
            : ""
        }`
    );
    assertEquals(promoted?.value.kind, "promoted-document");
    assertEquals(complete?.value.kind, "document");
  });
});
Deno.test("docs and map expose only the explicit pager flag", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    for (const verb of ["docs", "map"]) {
      const help = await runCli([verb, "--help"], dir, env);
      assertEquals(help.code, 0, help.stderr);
      assertStringIncludes(help.stdout, "--pager");
      assert(!help.stdout.includes("--no-pager"), help.stdout);

      const removed = await runCli([verb, "--no-pager"], dir, env);
      assert(removed.code !== 0, removed.stdout + removed.stderr);
      assertStringIncludes(removed.stdout + removed.stderr, "--no-pager");
    }
  });
});

Deno.test("pager refuses every static and machine projection with recovery", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs, PAGER: "cat" };
    const humanCases = [
      { args: ["docs", "README", "--pager", "--plain"], flag: "--plain" },
      { args: ["docs", "README", "--pager", "--raw"], flag: "--raw" },
      { args: ["docs", "--pager", "--list"], flag: "--list" },
      {
        args: ["docs", "--pager", "--search", "welcome"],
        flag: "--search",
      },
      {
        args: ["docs", "--pager", "--export", "public"],
        flag: "--export",
      },
      {
        args: ["docs", "--pager", "--output", "bundle.md"],
        flag: "--output",
      },
    ];
    for (const testCase of humanCases) {
      const result = await runCli(testCase.args, dir, env);
      assertEquals(result.code, 1, testCase.args.join(" "));
      assertTerminalTextIncludes(
        result.stderr,
        `--pager cannot be combined with ${testCase.flag}`,
      );
      assertTerminalTextIncludes(result.stderr, "Remove --pager");
      assertEquals(result.stdout, "");
    }

    const json = await runCli(
      ["docs", "README", "--pager", "--json"],
      dir,
      env,
    );
    assertEquals(json.code, 1);
    const jsonResult = decodeCliResult(json.stdout, "docs");
    assertExists(jsonResult.message);
    assertTerminalTextIncludes(
      jsonResult.message,
      "--pager cannot be combined with --json",
    );
    assertEquals(json.stderr, "");

    const markdown = await runCli(
      ["docs", "README", "--pager", "--markdown"],
      dir,
      env,
    );
    assertEquals(markdown.code, 1);
    assertTerminalTextIncludes(
      markdown.stdout,
      "--pager cannot be combined with --markdown",
    );
    assertEquals(markdown.stderr, "");

    const rendered = await runCli(
      ["docs", "README", "--pager", "--render"],
      dir,
      env,
    );
    assertEquals(rendered.code, 1);
    assertTerminalTextIncludes(
      rendered.stdout,
      "--pager cannot be combined with --render",
    );
    assertEquals(rendered.stderr, "");

    for (
      const args of [
        ["docs", "README", "--pager"],
        ["map", "decoy", "--pager"],
      ]
    ) {
      const result = await runCli(args, dir, env);
      assertEquals(result.code, 1, args.join(" "));
      assertTerminalTextIncludes(
        result.stderr,
        "--pager requires an interactive terminal",
      );
      assertTerminalTextIncludes(result.stderr, "Remove --pager");
    }
  });
});

Deno.test("a static rendered target never consults PAGER by default", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const result = await runCli(
      ["docs", "concepts"],
      dir,
      { DISCERN_DOCS_DIR: docs, PAGER: "false" },
    );
    assertEquals(result.code, 0, result.stderr);
    assertTerminalTextIncludes(result.stdout, "The concepts body");
    assert(!result.stderr.includes("The pager failed"));
  });
});

Deno.test("the coding-agent hint stays inside the interactive manual picker", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    for (
      const args of [
        ["docs", "concepts", "--markdown"],
        ["docs", "concepts", "--json"],
        ["docs", "concepts", "--raw"],
        ["docs", "no-such-page"],
      ]
    ) {
      const result = await runCli(args, dir, env);
      assert(
        !(result.stdout + result.stderr).includes(DOCS_AGENT_CONTEXT_HINT),
        args.join(" "),
      );
    }
  });
});

Deno.test("reader results hide source comments while raw and export retain them", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    const comment = "<!-- source note: `phantom-capability` -->";
    const inlineControl = "<!-- literal-inline-control -->";
    const fencedControl = "<!-- literal-fenced-control -->";
    const conceptsPath = join(docs, "00-start", "concepts.md");
    const conceptsSource = `${await Deno.readTextFile(conceptsPath)}\n` +
      `Visible recovery context.\n\n${comment}\n\n` +
      `Use \`${inlineControl}\` literally.\n\n` +
      `\`\`\`markdown\n${fencedControl}\n\`\`\`\n`;
    await Deno.writeTextFile(conceptsPath, conceptsSource);

    const json = await runCli(["docs", "concepts", "--json"], dir, env);
    const content = decodeDocsData(json.stdout, "doc").doc.content;
    assert(!content.includes("phantom-capability"));
    assertStringIncludes(content, `\`${inlineControl}\``);
    assertStringIncludes(content, fencedControl);

    for (
      const args of [
        ["docs", "concepts", "--markdown"],
        ["docs", "concepts", "--plain"],
      ]
    ) {
      const result = await runCli(args, dir, env);
      assertEquals(result.code, 0, result.stdout + result.stderr);
      assert(!result.stdout.includes("phantom-capability"), args.join(" "));
    }

    const phantom = await runCli(
      ["docs", "--search", "phantom-capability", "--json"],
      dir,
      env,
    );
    assertEquals(decodeDocsData(phantom.stdout, "results").results, []);
    const literal = await runCli(
      ["docs", "--search", inlineControl, "--json"],
      dir,
      env,
    );
    assertEquals(
      decodeDocsData(literal.stdout, "results").results[0]?.target,
      "00-start/concepts",
    );

    const raw = await runCli(["docs", "concepts", "--raw"], dir, env);
    assertEquals(raw.stdout, conceptsSource);
    const exported = await runCli(["docs", "--export", "public"], dir, env);
    assertStringIncludes(exported.stdout, comment);
    assertStringIncludes(exported.stdout, inlineControl);

    const mapSource = [
      "# Reader projection",
      "",
      "Visible Map context.",
      "",
      comment,
      "",
      `Use \`${inlineControl}\` literally.`,
      "",
      "```markdown",
      fencedControl,
      "```",
      "",
    ].join("\n");
    await Deno.writeTextFile(join(dir, "docs", "reader.md"), mapSource);
    const map = await runCli(["map", "reader", "--json"], dir);
    const mapResult = decodeCliResult(map.stdout, "map");
    assertResultDataKey(mapResult, "doc");
    assertExists(mapResult.data.doc);
    assert(!mapResult.data.doc.content.includes("phantom-capability"));
    assertStringIncludes(mapResult.data.doc.content, inlineControl);
    assertStringIncludes(mapResult.data.doc.content, fencedControl);

    const mapPhantom = await runCli(
      ["map", "--search", "phantom-capability", "--json"],
      dir,
    );
    const mapPhantomResult = decodeCliResult(mapPhantom.stdout, "map");
    assertResultDataKey(mapPhantomResult, "results");
    assertEquals(mapPhantomResult.data.results, []);
    const mapLiteral = await runCli(
      ["map", "--search", inlineControl, "--json"],
      dir,
    );
    const mapLiteralResult = decodeCliResult(mapLiteral.stdout, "map");
    assertResultDataKey(mapLiteralResult, "results");
    assertEquals(mapLiteralResult.data.results?.[0]?.target, "reader");

    const mapRaw = await runCli(["map", "reader", "--raw"], dir);
    assertEquals(mapRaw.stdout, mapSource);
    const mapExport = await runCli(["map", "--export", "all"], dir);
    assertStringIncludes(mapExport.stdout, comment);
  });
});

Deno.test("docs terminal facts are inert while machine Markdown stays exact", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const target = `hostile${"long".repeat(18)}\u202E`;
    const source = "# café 👩‍💻\x1b\u0085\u202E\r\n\r\nbody\x07 control\r\n";
    const authored = manualFixturePage(
      "start-hostile-terminal-facts",
      "hostile title\u202E",
      "reference",
      40,
      source,
    );
    await Deno.writeTextFile(
      join(docs, "00-start", `${target}.md`),
      authored,
    );
    const env = { DISCERN_DOCS_DIR: docs };

    const human = await runCli(
      ["docs", target, "--plain", "--width", "48"],
      dir,
      env,
    );
    assertEquals(human.code, 0, human.stdout + human.stderr);
    assertEquals(unexpectedTerminalControls(human.stdout), []);
    assert(!/[\p{Cc}\p{Cf}]/u.test(human.stdout.replaceAll("\n", "")));
    for (
      const visible of [
        "\\u{200D}",
        "\\u{1B}",
        "\\u{85}",
        "\\u{202E}",
        "\\u{7}",
      ]
    ) {
      assertStringIncludes(human.stdout, visible);
    }
    for (const line of human.stdout.trimEnd().split("\n")) {
      assert(measureText(line) <= 48, JSON.stringify(line));
    }

    const list = await runCli(
      ["docs", "--list", "--width", "48"],
      dir,
      env,
    );
    assertEquals(list.code, 0);
    assertEquals(unexpectedTerminalControls(list.stdout), []);
    assertStringIncludes(list.stdout, "hostilelonglong");
    assertStringIncludes(list.stdout, "<U+202E>");
    const rows = list.stdout.slice(list.stdout.indexOf("00-start/"));
    for (const line of rows.trimEnd().split("\n")) {
      assert(
        measureText(line) <= 48,
        `plain docs row overflowed: ${JSON.stringify(line)}`,
      );
    }

    const search = await runCli(
      ["docs", "--search", `absent\x1b\u0085\u202E`],
      dir,
      env,
    );
    assertEquals(search.code, 0);
    assertEquals(unexpectedTerminalControls(search.stdout), []);
    assertStringIncludes(search.stdout, "absent␛<U+0085><U+202E>");

    const raw = await runCli(["docs", target, "--raw"], dir, env);
    assertEquals(raw.code, 0);
    assertEquals(raw.stdout, authored);

    const json = await runCli(["docs", target, "--json"], dir, env);
    assertEquals(json.code, 0);
    const normalizedBody = source.replaceAll("\r\n", "\n");
    assertEquals(
      decodeDocsData(json.stdout, "doc").doc.content,
      normalizedBody,
    );

    const exported = await runCli(["docs", "--export", "public"], dir, env);
    assertEquals(exported.code, 0);
    assertStringIncludes(exported.stdout, normalizedBody);
  });
});

Deno.test("docs serves the bundled tree, never the project's own docs/", async () => {
  await withTempDir(async (dir) => {
    const manualDir = await makeDocsFixture(dir);
    const { code, stdout } = await runCli(
      ["docs", "--json"],
      dir,
      { DISCERN_DOCS_DIR: manualDir },
    );
    assertEquals(code, 0);
    const res = decodeCliResult(stdout, "docs");
    assertEquals(res.ok, true);
    assertEquals(res.verb, "docs");
    assertDocsDataKey(res, "docs");
    assertExists(res.data.count);
    assertEquals(res.data.map_dir, undefined);
    // Exactly the 8 PUBLISHED docs of the fixture — not the project's decoy,
    // and not the publish: false draft (docs honours isPublicDoc).
    assertEquals(res.data.count, 8);
    assert(
      res.data.docs.every((entry) =>
        entry.target !== undefined && entry.manual_kind !== undefined
      ),
      "every manual index row carries its canonical target and kind",
    );
    assert(res.data.docs.some((d: { slug: string }) => d.slug === "concepts"));
    assert(
      !res.data.docs.some((d: { slug: string }) => d.slug === "hidden"),
      "docs must withhold publish: false docs",
    );
    assert(
      !res.data.docs.some((d: { slug: string }) => d.slug === "decoy"),
      "docs must not surface the project's own docs/",
    );
    assert(
      !res.data.docs.some((d: { path: string }) =>
        d.path.includes("50-engine-internals") ||
        d.path.includes("55-observability")
      ),
      "docs must not surface numbered contributor sections",
    );

    // Contrast: `map` (same cwd) DOES serve the project tree — they diverge.
    const map = await runCli(["map", "--json"], dir);
    const dres = decodeCliResult(map.stdout, "map");
    assertResultDataKey(dres, "docs");
    assertExists(dres.data.docs);
    assert(
      dres.data.docs.some((d: { slug: string }) => d.slug === "decoy"),
      "map must serve the project's own docs/",
    );
    assertEquals(dres.verb, "map");
  });
});

Deno.test("docs search returns public manual targets and supports region scope", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    const found = await runCli(
      [
        "docs",
        "--search",
        "concepts body",
        "--json",
      ],
      dir,
      env,
    );
    assertEquals(found.code, 0);
    const foundData = decodeDocsData(found.stdout, "results");
    const foundResult = foundData.results[0];
    assertExists(foundResult);
    assertEquals(foundResult.target, "00-start/concepts");
    assertEquals(foundResult.page_id, "start-concepts");
    assertEquals(foundResult.manual_kind, "explanation");
    assertEquals(foundResult.match, "complete");

    const scoped = await runCli(
      [
        "docs",
        "00-start",
        "--search",
        "concepts body",
        "--json",
      ],
      dir,
      env,
    );
    assertEquals(scoped.code, 0);
    assertEquals(
      decodeDocsData(scoped.stdout, "scope").scope,
      "00-start",
    );

    const withheld = await runCli(
      [
        "docs",
        "--search",
        "withheld",
        "--json",
      ],
      dir,
      env,
    );
    assertEquals(withheld.code, 0);
    assertEquals(decodeDocsData(withheld.stdout, "results").results, []);
  });
});

Deno.test("docs search reports the full count beside its bounded projection", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    await addSearchMatches(docs, 6);
    const env = { DISCERN_DOCS_DIR: docs };

    const human = await runCli(
      ["docs", "--search", "orchard-signal"],
      dir,
      env,
    );
    assertEquals(human.code, 0, human.stdout + human.stderr);
    assertTerminalTextIncludes(human.stdout, "6 results");
    assertTerminalTextIncludes(
      human.stdout,
      "Showing 5 highest-ranked matches of 6.",
    );

    const json = await runCli(
      ["docs", "--search", "orchard-signal", "--json"],
      dir,
      env,
    );
    assertEquals(json.code, 0, json.stdout + json.stderr);
    const data = decodeDocsData(json.stdout, "results");
    assertEquals(data.count, 6);
    assertEquals(data.results.length, 5);
    assertEquals(data.truncated, true);
    assert(data.results.every((entry) => entry.manual_kind === "guide"));

    // A narrow query fits under the cap: everything counted is returned.
    const narrow = await runCli(
      ["docs", "--search", "concepts body", "--json"],
      dir,
      env,
    );
    assertEquals(narrow.code, 0, narrow.stdout + narrow.stderr);
    const narrowData = decodeDocsData(narrow.stdout, "results");
    assert(narrowData.results.length >= 1);
    assert(narrowData.results.length <= 5);
    assertEquals(narrowData.count, narrowData.results.length);
    assertEquals(narrowData.truncated, false);
  });
});

Deno.test("docs <slug> --json strips inline citations, keeps them as fields", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout } = await runCli(
      ["docs", "concepts", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 0);
    const res = decodeCliResult(stdout, "docs");
    assertEquals(res.ok, true);
    assertEquals(res.verb, "docs");
    assertDocsDataKey(res, "doc");
    assertEquals(res.data.doc.slug, "concepts");
    assertEquals(res.data.doc.target, "00-start/concepts");
    // Human-facing product docs: the inline citation group is stripped from
    // content, and the clause still reads; the decision survives as a field.
    assertStringIncludes(
      res.data.doc.content,
      "The concepts body, decided early.",
    );
    assert(!res.data.doc.content.includes("[ADR 0001]"));
    assertEquals(res.data.doc.cited_adrs, [
      {
        number: "0001",
        slug: "first",
        path: "https://discern.sh/docs/decisions/0001-first",
      },
    ]);
  });
});

Deno.test("docs terminal render strips inline citations into a related-decisions footer", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const rendered = await runCli(
      ["docs", "concepts", "--plain", "--no-color"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(rendered.code, 0);
    assert(!rendered.stdout.includes("[ADR 0001]"));
    assertTerminalTextIncludes(rendered.stdout, "## Related decisions");
    assertStringIncludes(
      rendered.stdout,
      "https://discern.sh/docs/decisions/0001-first",
    );
    assertEquals(
      [...rendered.stdout.matchAll(/docs\/decisions\/0001-first/g)].length,
      1,
    );
  });
});

Deno.test("docs <slug> --raw prints the pristine source, citations included", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout } = await runCli(
      ["docs", "concepts", "--raw"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 0);
    assertEquals(
      stdout,
      manualFixturePage(
        "start-concepts",
        "Concepts at a glance",
        "explanation",
        10,
        "# Concepts at a glance\n\n" +
          "The concepts body, decided early ([ADR 0001](https://discern.sh/docs/decisions/0001-first)).\n",
      ),
    );
  });
});

Deno.test("a publish: false doc is unreachable through every docs surface", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);

    // Not resolvable as a target...
    const target = await runCli(
      ["docs", "hidden", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(target.code, 1);
    assertEquals(decodeCliResult(target.stdout, "docs").error, "not_found");

    // ...absent from the TOC...
    const list = await runCli(
      ["docs", "--list"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assert(!list.stdout.includes("Hidden draft"));

    // ...and absent from an export.
    const exported = await runCli(
      ["docs", "--export", "public"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(exported.code, 0);
    assert(!exported.stdout.includes("hidden.md"));
    assert(!exported.stdout.includes("Withheld."));
  });
});

Deno.test("numbered contributor sections are unreachable through every docs surface", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);

    for (
      const target of [
        "50-engine-internals/README",
        "55-observability/telemetry",
      ]
    ) {
      const result = await runCli(
        ["docs", target, "--json"],
        dir,
        { DISCERN_DOCS_DIR: docs },
      );
      assertEquals(result.code, 1, target);
      assertEquals(
        decodeCliResult(result.stdout, "docs").error,
        "not_found",
        target,
      );
    }

    const list = await runCli(
      ["docs", "--list"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assert(!list.stdout.includes("Engine internals"));
    assert(!list.stdout.includes("Instrumentation laboratory"));

    const exported = await runCli(
      ["docs", "--export", "public"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(exported.code, 0);
    assert(!exported.stdout.includes("Contributor-only."));
    assert(!exported.stdout.includes("Fresh-name contributor fixture."));
  });
});

Deno.test("docs --list prints a grouped TOC titled `discern docs`", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout } = await runCli(
      ["docs", "--list"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "discern docs");
    assertStringIncludes(stdout, "00-start/");
    assertStringIncludes(stdout, "Concepts at a glance");
    for (
      const kind of [
        "Tutorial",
        "Guide",
        "Explanation",
        "Reference",
        "Troubleshooting",
      ]
    ) {
      assertStringIncludes(stdout, `${kind} ·`);
    }
  });
});

Deno.test("docs <unknown> --json reports not_found, exit 1", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout } = await runCli(
      ["docs", "nonesuch", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 1);
    const res = decodeCliResult(stdout, "docs");
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "not_found");
    assertExists(res.message);
    assertStringIncludes(res.message, "nonesuch");
  });
});

Deno.test("docs <near miss> --json suggests valid doc targets", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout } = await runCli(
      ["docs", "concept", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 1);
    const res = decodeCliResult(stdout, "docs");
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "not_found");
    assertExists(res.message);
    assertStringIncludes(res.message, "Closest match");
    assertDocsDataKey(res, "suggestions");
    const suggestion = res.data.suggestions[0];
    assertExists(suggestion);
    assertEquals(suggestion.slug, "concepts");
    assertEquals(
      suggestion.path,
      "manual-fixture/00-start/concepts.md",
    );
  });
});

Deno.test("docs <ambiguous> --json reports ambiguous with candidates", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    await Deno.writeTextFile(
      join(docs, "00-start/shared.md"),
      manualFixturePage(
        "start-shared",
        "Shared start",
        "tutorial",
        15,
        "# Shared start\n",
      ),
    );
    await Deno.writeTextFile(
      join(docs, "10-guides/shared.md"),
      manualFixturePage(
        "guide-shared",
        "Shared guide",
        "guide",
        15,
        "# Shared guide\n",
      ),
    );
    // Two leaves share this basename/slug; neither is an exact canonical target.
    const { code, stdout } = await runCli(
      ["docs", "shared", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 1);
    const res = decodeCliResult(stdout, "docs");
    assertEquals(res.error, "ambiguous");
    assertDocsDataKey(res, "candidates");
    assert(res.data.candidates.length >= 2);
  });
});

Deno.test("docs excludes internal _adr/_internal/_private from every view", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);

    const index = await runCli(
      ["docs", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    const res = decodeCliResult(index.stdout, "docs");
    assertDocsDataKey(res, "docs");
    for (const buried of ["_adr", "_internal", "_private"]) {
      assert(
        res.data.docs.every((d: { path: string }) => !d.path.includes(buried)),
        `the docs index must not contain ${buried}`,
      );
    }
    // The marketing/internal bodies must not be reachable as targets either.
    const positioning = await runCli(
      ["docs", "positioning", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(positioning.code, 1);
    assertEquals(
      decodeCliResult(positioning.stdout, "docs").error,
      "not_found",
    );

    const list = await runCli(
      ["docs", "--list"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    for (const buried of ["_adr", "_internal", "_private", "Positioning"]) {
      assert(
        !list.stdout.includes(buried),
        `the docs TOC must not list ${buried}`,
      );
    }
  });
});

Deno.test("docs --adr surfaces ONLY the ADR tree, never _internal/_private", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);

    // --adr widens the index to include the ADR subtree...
    const { code, stdout } = await runCli(
      ["docs", "--adr", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 0);
    const res = decodeCliResult(stdout, "docs");
    assertDocsDataKey(res, "docs");
    assert(
      res.data.docs.some((d: { slug: string }) =>
        d.slug === "0003-named-metric-standards"
      ),
      "--adr surfaces the ADR docs",
    );
    // ...but never the other internal subtrees (allowlist, not all-internal).
    for (const buried of ["_internal", "_private"]) {
      assert(
        res.data.docs.every((d: { path: string }) => !d.path.includes(buried)),
        `--adr must not surface ${buried}`,
      );
    }

    // An ADR resolves as a target only with --adr; it is hidden by default.
    const withAdr = await runCli(
      ["docs", "--adr", "0003-named-metric-standards", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(withAdr.code, 0);
    assertEquals(
      decodeDocsData(withAdr.stdout, "doc").doc.slug,
      "0003-named-metric-standards",
    );

    const withoutAdr = await runCli(
      ["docs", "0003-named-metric-standards", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(withoutAdr.code, 1);
    assertEquals(decodeCliResult(withoutAdr.stdout, "docs").error, "not_found");
  });
});

Deno.test("a target naming _adr/ is its own opt-in, on docs and map alike", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };

    // The explicit subtree target resolves with no --adr flag: the caller
    // already spelled the buried segment, and the records are public.
    const explicit = await runCli(
      ["docs", "_adr/0003-named-metric-standards", "--json"],
      dir,
      env,
    );
    assertEquals(explicit.code, 0, explicit.stdout);
    assertEquals(
      decodeDocsData(explicit.stdout, "doc").doc.slug,
      "0003-named-metric-standards",
    );

    // The map verb — which has no --adr flag at all — honours the same form
    // for the project's own decision records.
    await Deno.mkdir(join(dir, "docs/_adr"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs/_adr/0007-example.md"),
      "# ADR 0007: Example\n",
    );
    const viaMap = await runCli(["map", "_adr/0007-example", "--json"], dir);
    assertEquals(viaMap.code, 0, viaMap.stdout);
    const mapResult = decodeCliResult(viaMap.stdout, "map");
    assertResultDataKey(mapResult, "doc");
    assertExists(mapResult.data.doc);
    assertEquals(mapResult.data.doc.slug, "0007-example");

    // The audience boundary holds: naming _internal or _private widens nothing.
    for (
      const [verb, target] of [
        ["docs", "_internal/brief"],
        ["docs", "_private/positioning"],
        ["map", "_internal/brief"],
      ] as const
    ) {
      const refused = await runCli([verb, target, "--json"], dir, env);
      assertEquals(refused.code, 1, `${verb} ${target} must refuse`);
      assertEquals(decodeCliResult(refused.stdout, verb).error, "not_found");
    }

    // A near-miss suggestion prints the canonical target, so retrying the
    // suggestion verbatim resolves instead of refusing on the bare slug.
    const nearMiss = await runCli(
      ["docs", "--adr", "0003", "--json"],
      dir,
      env,
    );
    assertEquals(nearMiss.code, 1);
    const nearMissResult = decodeCliResult(nearMiss.stdout, "docs");
    assertExists(nearMissResult.message);
    assertStringIncludes(
      nearMissResult.message,
      "_adr/0003-named-metric-standards",
    );
  });
});

Deno.test("staged manual keeps explicit decision reads on the source-checkout authority", async () => {
  await withTempDir(async (dir) => {
    const source = await makeDocsFixture(dir);
    const staged = join(dir, "staged-docs");
    await stageBundledManual(source, staged);

    const json = await runCli(
      ["docs", "_adr/0003-named-metric-standards", "--json"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(json.code, 0);
    const result = decodeCliResult(json.stdout, "docs");
    assertEquals(result.ok, true);
    assertDocsDataKey(result, "doc");
    assertEquals(result.data.doc.slug, "0003-named-metric-standards");
  });
});

Deno.test("staged manual keeps the decision index separate from manual bytes", async () => {
  await withTempDir(async (dir) => {
    const source = await makeDocsFixture(dir);
    const staged = join(dir, "staged-docs");
    await stageBundledManual(source, staged);

    const json = await runCli(
      ["docs", "--adr", "--json"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(json.code, 0);
    const result = decodeCliResult(json.stdout, "docs");
    assertEquals(result.ok, true);
    assertEquals(result.verb, "docs");
    assertDocsDataKey(result, "docs");
    assert(
      result.data.docs.some((entry) =>
        entry.slug === "0003-named-metric-standards"
      ),
    );
    assert(
      result.data.docs.every((entry) => entry.page_id === undefined),
      "decision records must not be projected from staged manual pages",
    );

    const human = await runCli(
      ["docs", "--adr"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(human.code, 0);
    assertStringIncludes(human.stdout, "0003-named-metric-standards");
  });
});

Deno.test("docs --adr cannot be combined with --export", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stderr } = await runCli(
      ["docs", "--export", "public", "--adr"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "--export cannot be combined with --adr");
  });
});

Deno.test("docs --export public concatenates only the public docs", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout, stderr } = await runCli(
      ["docs", "--export", "public"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 0);
    assertEquals(stderr, "");
    assert(
      stdout.startsWith("<!-- BEGIN SOURCE: manual-fixture/README.md -->\n\n"),
    );
    assertStringIncludes(stdout, "Concepts at a glance");
    assert(!stdout.includes("Positioning"), "must not export _private");
    assert(!stdout.includes("Documenter brief"), "must not export _internal");
    assertEquals(stdout.match(/^<!-- BEGIN SOURCE:/gm)?.length, 8);
  });
});

Deno.test("docs rejects export scopes other than public", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    for (const scope of ["all", "select", "private"]) {
      const { code, stderr } = await runCli(
        ["docs", "--export", scope],
        dir,
        { DISCERN_DOCS_DIR: docs },
      );
      assertEquals(code, 1, scope);
      assertStringIncludes(stderr, "unknown export scope");
      assertStringIncludes(stderr, "expected public.");
    }
  });
});

Deno.test("docs --export public --output writes a bundle file", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const { code, stdout, stderr } = await runCli(
      ["docs", "--export", "public", "--output", "docs-bundle.md"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 0);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "Exported 8 documents to docs-bundle.md");
    const bundle = await readTarget(dir, "docs-bundle.md");
    assertStringIncludes(bundle, "discern documentation");
    assert(!bundle.includes("Positioning"));
  });
});

Deno.test("docs reports a build defect (no bundled tree) cleanly", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(dir, 'slug = "demo"\n');
    // Point the resolver at a path that does not exist: the override misses, the
    // resolver returns undefined, and docs must NOT fall back to the project's docs.
    const { code, stdout } = await runCli(
      ["docs", "--json"],
      dir,
      { DISCERN_DOCS_DIR: join(dir, "does-not-exist") },
    );
    assertEquals(code, 1);
    const res = decodeCliResult(stdout, "docs");
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "no_docs");
    assertExists(res.message);
    assertStringIncludes(res.message, "current release");
    assertStringIncludes(res.message, "open a new shell");
    assertStringIncludes(res.message, "discern doctor");
    assert(!res.message.includes("project map"));
    assert(!res.message.includes(DOCS_AGENT_CONTEXT_HINT));
  });
});

Deno.test("command help keeps the product manual and project Map distinct", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    const manual = await runCli(["docs", "--help"], dir, env);
    const map = await runCli(["map", "--help"], dir, env);
    assertEquals(manual.code, 0, manual.stderr);
    assertEquals(map.code, 0, map.stderr);
    assertTerminalTextIncludes(
      manual.stdout,
      "complete bundled product manual",
    );
    assertTerminalTextIncludes(map.stdout, "configured project Map");
    assert(!manual.stdout.includes("agent-maintained Map"));
  });
});

Deno.test("dogfood: docs serves THIS repo's own docs (config reference)", async () => {
  // No DISCERN_DOCS_DIR override: the resolver walks up from the module to this
  // repo's configured map, exactly as a checkout run does. Proves the real wiring, and
  // that the cwd's project resolution is bypassed.
  const single = await runCli(
    ["docs", "config-reference", "--json"],
    REPO_ROOT,
  );
  assertEquals(single.code, 0);
  const sres = decodeCliResult(single.stdout, "docs");
  assertEquals(sres.ok, true);
  assertEquals(sres.verb, "docs");
  assertDocsDataKey(sres, "doc");
  assertEquals(sres.data.doc.slug, "config-reference");
  assertStringIncludes(sres.data.doc.content, "config reference");

  const index = await runCli(["docs", "--json"], REPO_ROOT);
  const ires = decodeCliResult(index.stdout, "docs");
  assertDocsDataKey(ires, "docs");
  assertExists(ires.data.count);
  assertEquals(ires.data.map_dir, undefined);
  assert(ires.data.count > 0);
  assert(
    ires.data.docs.every((d: { path: string }) =>
      !d.path.includes("_adr") && !d.path.includes("_private") &&
      !d.path.includes("_internal")
    ),
    "the dogfood index must exclude discern's own internal subtrees",
  );

  const decision = await runCli(
    ["docs", "--adr", "0141-adr-citations-strip-at-render", "--json"],
    REPO_ROOT,
  );
  assertEquals(decision.code, 0);
  const dres = decodeCliResult(decision.stdout, "docs");
  assertEquals(dres.ok, true);
  assertDocsDataKey(dres, "doc");
  assertEquals(dres.data.doc.slug, "0141-adr-citations-strip-at-render");
});

Deno.test("docs treats a command name as a manual target", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const result = await runCli(
      ["docs", "done", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(result.code, 1);
    const envelope = decodeCliResult(result.stdout, "docs");
    assertEquals(envelope.verb, "docs");
    assertEquals(envelope.error, "not_found");
  });
});

// ── CLI-reference parity ─────────────────────────────────────────────────────
//
// Git users type `git help push` and `git push --help` interchangeably, and git
// forwards one to the other. `discern help <verb>` does the same: for every
// registered verb it renders that verb's own command help, byte-identical to
// `<verb> --help`. Driven off the verb registry, never a hand list, so a new
// verb auto-enrols.

Deno.test("bare help matches root --help", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    const rootHelp = await runCli(["--help"], dir, env);
    const commandHelp = await runCli(["help"], dir, env);
    assertEquals(commandHelp.code, 0, commandHelp.stderr);
    assertEquals(commandHelp.stdout, rootHelp.stdout);
  });
});

Deno.test("help <verb> matches <verb> --help for every registered verb", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    await Promise.all([...KNOWN_VERBS].map(async (verb) => {
      const direct = await runCli([verb, "--help"], dir, env);
      const fallthrough = await runCli(["help", verb], dir, env);
      assertEquals(direct.code, 0, `${verb} --help failed:\n${direct.stderr}`);
      assertEquals(
        fallthrough.code,
        0,
        `help ${verb} failed:\n${fallthrough.stderr}`,
      );
      assertEquals(
        fallthrough.stdout,
        direct.stdout,
        `help ${verb} diverged from ${verb} --help`,
      );
    }));
  });
});

Deno.test("help <target> points retired spellings and synonyms to canonical commands", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    for (
      const [retired, successor] of Object.entries(RETIRED_COMMAND_REDIRECTS)
        .filter(([spelling]) => !spelling.includes(" "))
    ) {
      const r = await runCli(["help", retired], dir, env);
      assertEquals(r.code, 1, r.stdout + r.stderr);
      assertTerminalTextIncludes(r.stderr, "is not a discern command");
      assertStringIncludes(r.stderr, successor);
    }
    for (
      const [synonym, canonical] of Object.entries(COMMAND_SYNONYM_SUGGESTIONS)
    ) {
      const r = await runCli(["help", synonym], dir, env);
      assertEquals(r.code, 1, r.stdout + r.stderr);
      assertTerminalTextIncludes(r.stderr, `unknown command "${synonym}"`);
      assertTerminalTextIncludes(r.stderr, `discern ${canonical}`);
    }
  });
});
