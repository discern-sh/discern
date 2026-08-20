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
  assertRejects,
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
import { stageBundledDocs } from "../scripts/build.ts";
import {
  approvedDocsExternalUrl,
  docsBrowseNavigationChoices,
  renderDocsCorpusHeader,
  renderExternalDecisionsNotice,
  resolveDocsBrowserLink,
} from "../src/commands/docs.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { type PtyInputPhase, runPtyProcess } from "./fixtures/pty_process.ts";
import { engineRunArgs } from "./engine_helpers.ts";

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
    { id: "start", name: "Start", path: "00-orientation/start.md" },
    { id: "other", name: "Other", path: "00-orientation/other.md" },
    { id: "next", name: "Next", path: "10-next/README.md" },
    { id: "target", name: "Target", path: "10-next/target.md" },
  ] as const;
  const resolve = (destination: string) =>
    resolveDocsBrowserLink({
      sourceDocumentId: "start",
      sourcePath: "00-orientation/start.md",
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
    { id: "start", name: "Start", path: "00-orientation/start.md" },
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
      sourcePath: "00-orientation/start.md",
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

/**
 * Lay a project that has BOTH its own `docs/` (a decoy `docs` must never show)
 * and a separate "bundled" docs fixture, including internal `_`-prefixed subtrees
 * that `docs` must exclude. Returns the fixture path to pass as `DISCERN_DOCS_DIR`.
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

  // discern's bundled docs fixture (a differently-named tree the resolver points
  // at via DISCERN_DOCS_DIR), carrying internal subtrees curation must drop.
  const docs = join(dir, "manual-fixture");
  const files: Record<string, string> = {
    "README.md": "# discern documentation\n\nWelcome.\n\n" +
      "Read [Concepts](00-orientation/concepts.md#concepts-at-a-glance) " +
      "or visit the [website](https://example.com/docs).\n",
    "00-orientation/README.md": "# Intro\n",
    "00-orientation/concepts.md": "# Concepts at a glance\n\n" +
      "The concepts body, decided early ([ADR 0001](../_adr/0001-first.md)).\n",
    "00-orientation/glossary.md": "# Glossary\n",
    "00-orientation/hidden.md":
      "---\npublish: false\n---\n# Hidden draft\n\nWithheld.\n",
    "50-engine-internals/README.md":
      "# Engine internals\n\nContributor-only.\n",
    "55-observability/telemetry.md":
      "# Instrumentation laboratory\n\nFresh-name contributor fixture.\n",
    "_adr/0001-first.md": "# ADR 0001: First\n",
    "_internal/brief.md": "# Documenter brief\n",
    "_private/positioning.md": "# Positioning\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    await Deno.mkdir(join(docs, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(docs, rel), content);
  }
  return docs;
}

/** Install a deterministic host browser launcher ahead of the real PATH. */
async function fakeBrowserLauncher(
  dir: string,
  exitCode: number,
): Promise<{ readonly path: string; readonly marker: string }> {
  const bin = join(dir, "browser-bin");
  const marker = join(dir, "browser-destination.txt");
  await Deno.mkdir(bin, { recursive: true });
  const command = Deno.build.os === "darwin" ? "open" : "xdg-open";
  const executable = join(bin, command);
  await Deno.writeTextFile(
    executable,
    `#!/bin/sh\nprintf '%s' "$1" > ${
      JSON.stringify(marker)
    }\nexit ${exitCode}\n`,
  );
  await Deno.chmod(executable, 0o755);
  return {
    path: `${bin}:${Deno.env.get("PATH") ?? ""}`,
    marker,
  };
}

Deno.test({
  name:
    "docs browser opens a split reader and restores the full picker through the real PTY",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs"]),
        cwd: dir,
        env: { DISCERN_DOCS_DIR: docs, NO_COLOR: "1", PAGER: "false" },
        input: [
          // Browse is first, so one move selects the root document.
          {
            waitFor: "Enter open/action  Esc cancel",
            captureAs: "initial",
            steps: [{ bytes: "\x1b[B\r" }],
          },
          {
            waitFor: ["Welcome.", "Tab picker"],
            captureAs: "split",
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: ["discern documentation", "Esc cancel"],
            captureAs: "restored",
            // From the remembered root document: three Intro documents, then Quit.
            steps: [{ bytes: "\x1b[B".repeat(4) + "\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertEquals(process.stderr, "", process.transcript);
      assert((process.transcript.match(/Welcome\./gu)?.length ?? 0) >= 1);
      assertStringIncludes(process.transcript, "DISCERN DOCS — 4 DOCUMENTS");
      assert(!process.transcript.includes("Press Enter to continue."));
      assert(!process.transcript.includes("The pager failed"));

      const initial = process.keyframes.initial ?? "";
      const groupOffsets = ["BROWSE", "OVERVIEW", "INTRO", "ACTIONS"].map(
        (label) => initial.indexOf(label),
      );
      assert(groupOffsets.every((offset) => offset >= 0), initial);
      assertEquals([...groupOffsets].sort((a, b) => a - b), groupOffsets);
      for (
        const visible of [
          "Read the docs online",
          "discern documentation",
          "README.md",
          "00-orientation/",
          "Concepts at a glance",
          "concepts.md",
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
      assertStringIncludes(process.keyframes.restored ?? "", "× Quit");
    });
  },
});

for (const exitCode of [0, 9]) {
  Deno.test({
    name: `docs online action restores and resumes the rich browser after ${
      exitCode === 0 ? "success" : "failure"
    }`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withTempDir(async (dir) => {
        const docs = await makeDocsFixture(dir);
        const launcher = await fakeBrowserLauncher(dir, exitCode);
        const input: readonly PtyInputPhase[] = exitCode === 0
          ? [
            {
              waitFor: "Enter open/action  Esc cancel",
              steps: [{ bytes: "\r" }],
            },
            {
              waitFor: ["Read the docs online", "Esc cancel"] as const,
              steps: [{ bytes: "\x1b[B".repeat(5) + "\r" }],
            },
          ]
          : [
            {
              waitFor: "Enter open/action  Esc cancel",
              steps: [{ bytes: "\r" }],
            },
            {
              waitFor: [
                "discern couldn't open the docs",
                "Press Enter to continue.",
              ] as const,
              steps: [{ bytes: "\r" }],
            },
            {
              waitFor: ["Read the docs online", "Esc cancel"] as const,
              steps: [{ bytes: "\x1b[B".repeat(5) + "\r" }],
            },
          ];
        const process = await runPtyProcess({
          command: Deno.execPath(),
          args: engineRunArgs(["docs"]),
          cwd: dir,
          env: {
            DISCERN_DOCS_DIR: docs,
            NO_COLOR: "1",
            PAGER: "false",
            PATH: launcher.path,
          },
          input,
          timeoutMs: 8_000,
        });

        assertEquals(process.code, 0, process.transcript);
        assertEquals(
          await Deno.readTextFile(launcher.marker),
          "https://discern.sh/docs",
        );
        assertEquals(
          process.transcript.includes("Press Enter to continue."),
          exitCode !== 0,
        );
      });
    },
  });
}

Deno.test({
  name:
    "docs browser follows an admitted relative fragment without a host effect",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const launcher = await fakeBrowserLauncher(dir, 0);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs"]),
        cwd: dir,
        env: {
          DISCERN_DOCS_DIR: docs,
          NO_COLOR: "1",
          PATH: launcher.path,
        },
        input: [
          {
            waitFor: "Enter open/action  Esc cancel",
            steps: [{ bytes: "\x1b[B\r" }],
          },
          {
            waitFor: ["Welcome.", "Tab picker"],
            steps: [{ bytes: "]\r" }],
          },
          {
            waitFor: ["Document · Concepts at a glance", "The concepts body"],
            captureAs: "fragment",
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: ["discern documentation", "Esc cancel"],
            steps: [{ bytes: "\x1b[B".repeat(4) + "\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertStringIncludes(
        process.keyframes.fragment ?? "",
        "Concepts at a glance",
      );
      await assertRejects(
        () => Deno.readTextFile(launcher.marker),
        Deno.errors.NotFound,
      );
    });
  },
});

Deno.test({
  name:
    "docs browser opens an external link only after restoration and resumes its state",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const launcher = await fakeBrowserLauncher(dir, 0);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs"]),
        cwd: dir,
        env: {
          DISCERN_DOCS_DIR: docs,
          NO_COLOR: "1",
          PATH: launcher.path,
        },
        input: [
          {
            waitFor: "Enter open/action  Esc cancel",
            steps: [{ bytes: "\x1b[B\r" }],
          },
          {
            waitFor: ["Welcome.", "Tab picker"],
            steps: [{ bytes: "]]\r" }],
          },
          {
            waitFor: ["website", "Enter follow"],
            captureAs: "resumed-link",
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: ["discern documentation", "Esc cancel"],
            steps: [{ bytes: "\x1b[B".repeat(4) + "\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertEquals(
        await Deno.readTextFile(launcher.marker),
        "https://example.com/docs",
      );
      assertStringIncludes(process.keyframes["resumed-link"] ?? "", "website");
    });
  },
});

for (
  const testCase of [
    { query: "Concepts at a glance", body: "The concepts body" },
    { query: "concepts.md", body: "The concepts body" },
    { query: "nested/deep.md", body: "Nested path body" },
  ] as const
) {
  Deno.test({
    name: `docs picker finds a document by ${testCase.query}`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withTempDir(async (dir) => {
        const docs = await makeDocsFixture(dir);
        await Deno.mkdir(join(docs, "00-orientation", "nested"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(docs, "00-orientation", "nested", "deep.md"),
          "# Deep document\n\nNested path body.\n",
        );
        const process = await runPtyProcess({
          command: Deno.execPath(),
          args: engineRunArgs(["docs"]),
          cwd: dir,
          env: { DISCERN_DOCS_DIR: docs, NO_COLOR: "1", PAGER: "false" },
          input: [
            {
              waitFor: "nested/deep.md",
              steps: [{ bytes: `${testCase.query}\r` }],
            },
            {
              waitFor: [testCase.body, "Tab picker"],
              steps: [{ bytes: "\x03" }],
            },
          ],
          timeoutMs: 8_000,
        });

        assertEquals(process.code, 0, process.transcript);
        assertStringIncludes(process.transcript, testCase.body);
      });
    },
  });
}

Deno.test({
  name:
    "map browser omits Browse and closes its split reader through a real PTY",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["map"]),
        cwd: dir,
        env: { NO_COLOR: "1", PAGER: "false" },
        input: [
          {
            waitFor: "Enter open/action  Esc cancel",
            captureAs: "initial",
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: [
              "The project's own docs.",
              "Tab picker",
            ],
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: ["Project Decoy", "Esc cancel"],
            steps: [{ bytes: "\x1b[B\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertEquals(process.stderr, "", process.transcript);
      assertStringIncludes(process.transcript, "DISCERN MAP — 1 DOCUMENT");
      assertStringIncludes(process.transcript, "The project's own docs.");
      assert(!process.transcript.includes("Press Enter to continue."));
      assert(!(process.keyframes.initial ?? "").includes("BROWSE"));
      assertStringIncludes(process.keyframes.initial ?? "", "ACTIONS");
      assert(!process.transcript.includes("The pager failed"));
    });
  },
});

Deno.test({
  name:
    "typed small-terminal refusal uses the sequential reader and remembered selection",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs"]),
        cwd: dir,
        env: { DISCERN_DOCS_DIR: docs, NO_COLOR: "1", PAGER: "false" },
        geometry: { columns: 31, rows: 24 },
        input: [
          {
            waitFor: "○ Quit",
            steps: [{ bytes: "\x1b[B\x1b[B\r" }],
          },
          {
            waitFor: ["Welcome.", "Press Enter to continue."],
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: ["discern documentation", "○ Quit"],
            steps: [{ bytes: "\x1b[B".repeat(4) + "\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertStringIncludes(process.transcript, "Press Enter to continue.");
      assert(!process.transcript.includes("Tab picker"));
    });
  },
});

Deno.test({
  name: "explicit pager exit restores the docs picker without acknowledgement",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs", "--pager"]),
        cwd: dir,
        env: { DISCERN_DOCS_DIR: docs, NO_COLOR: "1", PAGER: "cat" },
        input: [
          {
            waitFor: "○ Quit",
            steps: [{ bytes: "\x1b[B\x1b[B\r" }],
          },
          {
            waitFor: ["Welcome.", "○ Quit"],
            steps: [{ bytes: "\x1b[B".repeat(4) + "\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertStringIncludes(process.transcript, "Welcome.");
      assert(!process.transcript.includes("Press Enter to continue."));
      assert(!process.transcript.includes("The pager failed"));
    });
  },
});

Deno.test({
  name:
    "failed explicit pager warns, falls back internally, and restores the picker",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const docs = await makeDocsFixture(dir);
      const process = await runPtyProcess({
        command: Deno.execPath(),
        args: engineRunArgs(["docs", "--pager"]),
        cwd: dir,
        env: { DISCERN_DOCS_DIR: docs, NO_COLOR: "1", PAGER: "false" },
        input: [
          {
            waitFor: "○ Quit",
            steps: [{ bytes: "\x1b[B\x1b[B\r" }],
          },
          {
            waitFor: [
              "Showing the document in discern.",
              "Welcome.",
              "Press Enter to continue.",
            ],
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: ["discern documentation", "○ Quit"],
            steps: [{ bytes: "\x1b[B".repeat(4) + "\r" }],
          },
        ],
        timeoutMs: 8_000,
      });

      assertEquals(process.code, 0, process.transcript);
      assertStringIncludes(
        process.transcript,
        "The pager failed.",
      );
      assertStringIncludes(process.transcript, "Press Enter to continue.");
    });
  },
});

for (
  const testCase of [
    {
      name: "default internal target",
      args: [] as string[],
      pager: "false",
      warning: false,
      color: false,
    },
    {
      name: "explicit target pager",
      args: ["--pager"],
      pager: "cat",
      warning: false,
      color: true,
    },
    {
      name: "failed target pager fallback",
      args: ["--pager"],
      pager: "false",
      warning: true,
      color: false,
    },
  ] as const
) {
  Deno.test({
    name: `${testCase.name} exits directly through a real PTY`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withTempDir(async (dir) => {
        const docs = await makeDocsFixture(dir);
        const process = await runPtyProcess({
          command: Deno.execPath(),
          args: engineRunArgs(["docs", "concepts", ...testCase.args]),
          cwd: dir,
          env: {
            DISCERN_DOCS_DIR: docs,
            PAGER: testCase.pager,
            NO_COLOR: testCase.color ? "" : "1",
            FORCE_COLOR: testCase.color ? "1" : "",
          },
          geometry: { columns: 80, rows: 24 },
          keepInputOpen: true,
          timeoutMs: 8_000,
        });

        assertEquals(process.code, 0, process.transcript);
        assertStringIncludes(process.transcript, "The concepts body");
        assertEquals(
          process.transcript.includes("The pager failed"),
          testCase.warning,
        );
        assert(!process.transcript.includes("Press Enter to continue."));
        if (testCase.color) {
          assertStringIncludes(process.transcript, "\x1b[");
        }
      });
    },
  });
}

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
    assertTerminalTextIncludes(
      JSON.parse(json.stdout).message,
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

Deno.test("docs terminal facts are inert while machine Markdown stays exact", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const target = `hostile${"long".repeat(18)}\u202E`;
    const source = "# café 👩‍💻\x1b\u0085\u202E\r\n\r\nbody\x07 control\r\n";
    await Deno.writeTextFile(
      join(docs, "00-orientation", `${target}.md`),
      source,
    );
    const env = { DISCERN_DOCS_DIR: docs };

    const human = await runCli(
      ["docs", target, "--plain", "--width", "48"],
      dir,
      env,
    );
    assertEquals(human.code, 0);
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
    const rows = list.stdout.slice(list.stdout.indexOf("00-orientation/"));
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
    assertEquals(raw.stdout, source);

    const json = await runCli(["docs", target, "--json"], dir, env);
    assertEquals(json.code, 0);
    assertEquals(JSON.parse(json.stdout).data.doc.content, source);

    const exported = await runCli(["docs", "--export", "public"], dir, env);
    assertEquals(exported.code, 0);
    assertStringIncludes(exported.stdout, source);
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
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "docs");
    assertEquals(res.data.map_dir, undefined);
    // Exactly the 4 PUBLISHED docs of the fixture — not the project's decoy,
    // and not the publish: false draft (docs honours isPublicDoc).
    assertEquals(res.data.count, 4);
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
    const dres = JSON.parse(map.stdout);
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
    const foundData = JSON.parse(found.stdout).data;
    assertEquals(foundData.results[0].target, "00-orientation/concepts");
    assertEquals(foundData.results[0].match, "complete");

    const scoped = await runCli(
      [
        "docs",
        "00-orientation",
        "--search",
        "concepts body",
        "--json",
      ],
      dir,
      env,
    );
    assertEquals(scoped.code, 0);
    assertEquals(JSON.parse(scoped.stdout).data.scope, "00-orientation");

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
    assertEquals(JSON.parse(withheld.stdout).data.results, []);
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
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "docs");
    assertEquals(res.data.doc.slug, "concepts");
    assertEquals(res.data.doc.target, "00-orientation/concepts");
    // Human-facing product docs: the inline citation group is stripped from
    // content, and the clause still reads; the decision survives as a field.
    assertStringIncludes(
      res.data.doc.content,
      "The concepts body, decided early.",
    );
    assert(!res.data.doc.content.includes("[ADR 0001]"));
    assertEquals(res.data.doc.cited_adrs, [
      { number: "0001", slug: "first", path: "../_adr/0001-first.md" },
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
      "# Concepts at a glance\n\n" +
        "The concepts body, decided early ([ADR 0001](../_adr/0001-first.md)).\n",
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
    assertEquals(JSON.parse(target.stdout).error, "not_found");

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
      assertEquals(JSON.parse(result.stdout).error, "not_found", target);
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
    assertStringIncludes(stdout, "00-orientation/");
    assertStringIncludes(stdout, "Concepts at a glance");
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
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "not_found");
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
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "not_found");
    assertStringIncludes(res.message, "Closest match");
    assertEquals(res.data.suggestions[0].slug, "concepts");
    assertEquals(
      res.data.suggestions[0].path,
      "manual-fixture/00-orientation/concepts.md",
    );
  });
});

Deno.test("docs <ambiguous> --json reports ambiguous with candidates", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    // README exists at the root and under 00-orientation/ → a bare "README" is ambiguous.
    const { code, stdout } = await runCli(
      ["docs", "README", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.error, "ambiguous");
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
    const res = JSON.parse(index.stdout);
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
    assertEquals(JSON.parse(positioning.stdout).error, "not_found");

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
    const res = JSON.parse(stdout);
    assert(
      res.data.docs.some((d: { slug: string }) => d.slug === "0001-first"),
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
      ["docs", "--adr", "0001-first", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(withAdr.code, 0);
    assertEquals(JSON.parse(withAdr.stdout).data.doc.slug, "0001-first");

    const withoutAdr = await runCli(
      ["docs", "0001-first", "--json"],
      dir,
      { DISCERN_DOCS_DIR: docs },
    );
    assertEquals(withoutAdr.code, 1);
    assertEquals(JSON.parse(withoutAdr.stdout).error, "not_found");
  });
});

Deno.test("a target naming _adr/ is its own opt-in, on docs and map alike", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };

    // The explicit subtree target resolves with no --adr flag: the caller
    // already spelled the buried segment, and the records are public.
    const explicit = await runCli(
      ["docs", "_adr/0001-first", "--json"],
      dir,
      env,
    );
    assertEquals(explicit.code, 0, explicit.stdout);
    assertEquals(JSON.parse(explicit.stdout).data.doc.slug, "0001-first");

    // The map verb — which has no --adr flag at all — honours the same form
    // for the project's own decision records.
    await Deno.mkdir(join(dir, "docs/_adr"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs/_adr/0007-example.md"),
      "# ADR 0007: Example\n",
    );
    const viaMap = await runCli(["map", "_adr/0007-example", "--json"], dir);
    assertEquals(viaMap.code, 0, viaMap.stdout);
    assertEquals(JSON.parse(viaMap.stdout).data.doc.slug, "0007-example");

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
      assertEquals(JSON.parse(refused.stdout).error, "not_found");
    }

    // A near-miss suggestion prints the canonical target, so retrying the
    // suggestion verbatim resolves instead of refusing on the bare slug.
    const nearMiss = await runCli(
      ["docs", "--adr", "0001", "--json"],
      dir,
      env,
    );
    assertEquals(nearMiss.code, 1);
    assertStringIncludes(
      JSON.parse(nearMiss.stdout).message,
      "_adr/0001-first",
    );
  });
});

Deno.test("installed docs with an explicit _adr target points to the public archive", async () => {
  await withTempDir(async (dir) => {
    const source = await makeDocsFixture(dir);
    const staged = join(dir, "staged-docs");
    await stageBundledDocs(source, staged);

    const json = await runCli(
      ["docs", "_adr/0001-first", "--json"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(json.code, 0);
    const result = JSON.parse(json.stdout);
    assertEquals(result.ok, true);
    assertStringIncludes(result.message, "https://discern.sh/docs/decisions");
  });
});

Deno.test("installed docs --adr points to the public decision archive", async () => {
  await withTempDir(async (dir) => {
    const source = await makeDocsFixture(dir);
    const staged = join(dir, "staged-docs");
    await stageBundledDocs(source, staged);

    const json = await runCli(
      ["docs", "--adr", "--json"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(json.code, 0);
    const result = JSON.parse(json.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "docs");
    assertStringIncludes(result.message, "not bundled with installed binaries");
    assertStringIncludes(result.message, "https://discern.sh/docs/decisions");
    assert(!result.message.includes("0001-first"));

    const human = await runCli(
      ["docs", "--adr"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(human.code, 0);
    assertStringIncludes(human.stdout, "https://discern.sh/docs/decisions");
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
    assertEquals(stdout.match(/^<!-- BEGIN SOURCE:/gm)?.length, 4);
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
    assertStringIncludes(stderr, "Exported 4 documents to docs-bundle.md");
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
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "no_docs");
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
  const sres = JSON.parse(single.stdout);
  assertEquals(sres.ok, true);
  assertEquals(sres.verb, "docs");
  assertEquals(sres.data.doc.slug, "config-reference");
  assertStringIncludes(sres.data.doc.content, "config reference");

  const index = await runCli(["docs", "--json"], REPO_ROOT);
  const ires = JSON.parse(index.stdout);
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
  const dres = JSON.parse(decision.stdout);
  assertEquals(dres.ok, true);
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
    const envelope = JSON.parse(result.stdout);
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

Deno.test("help <target> teaches for retired spellings and synonyms", async () => {
  await withTempDir(async (dir) => {
    const docs = await makeDocsFixture(dir);
    const env = { DISCERN_DOCS_DIR: docs };
    for (
      const [retired, successor] of Object.entries(RETIRED_COMMAND_REDIRECTS)
        .filter(([spelling]) => !spelling.includes(" "))
    ) {
      const r = await runCli(["help", retired], dir, env);
      assertEquals(r.code, 1, r.stdout + r.stderr);
      assertTerminalTextIncludes(r.stderr, "was renamed");
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
