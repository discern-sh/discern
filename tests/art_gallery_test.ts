/** Contract coverage for the maintainer-facing terminal-art gallery task. */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dirname, fromFileUrl } from "@std/path";
import { stripAnsi } from "discern-design-system/cli";
import {
  artAnimationScenes,
  type ArtCommandEnvironment,
  artGalleryEntries,
  executeArtCommand,
  planArtCommand,
  renderArtGallery,
} from "../scripts/art.ts";
import {
  DISCERN_PACKAGE_TRIANGLE_MOTIFS,
  DISCERN_PRODUCT_TRIANGLE_ART,
} from "../art/terminal/triangle.ts";
import { DISCERN_ART_VARIANTS } from "../art/terminal/brand.ts";
import { runPtyProcess } from "./fixtures/pty_process.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const DECODER = new TextDecoder();
const ANIMATED_ENVIRONMENT: ArtCommandEnvironment = {
  stdoutIsTerminal: true,
  ci: undefined,
  terminalColumns: 80,
  terminalRows: 24,
  capabilities: {
    ansiControl: true,
    colorDepth: "none",
    columns: 80,
    unicode: true,
  },
};
const PIPED_CAPABILITIES = {
  colorDepth: "none" as const,
  columns: 80,
  unicode: true,
};
const EXPECTED_ENTRIES = [
  ...Object.entries(DISCERN_ART_VARIANTS),
  ...Object.entries(DISCERN_PACKAGE_TRIANGLE_MOTIFS),
  ...Object.entries(DISCERN_PRODUCT_TRIANGLE_ART),
];

Deno.test("the art gallery enrolls both registries in stable order", () => {
  const expected = EXPECTED_ENTRIES
    .map(([name, variant]) => `[${name}]\n${variant.render()}`)
    .join("\n\n");

  assertEquals(renderArtGallery(), expected);
  assertEquals(
    artGalleryEntries().map(({ name }) => name),
    EXPECTED_ENTRIES.map(([name]) => name),
  );
});

Deno.test("gallery labels and composed output stay terminal-safe", () => {
  for (const [name] of EXPECTED_ENTRIES) {
    assertMatch(name, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  }
  assertEquals(
    new Set(EXPECTED_ENTRIES.map(([name]) => name)).size,
    EXPECTED_ENTRIES.length,
  );

  const gallery = renderArtGallery();
  for (const character of gallery) {
    assert(
      character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
      `gallery contains terminal control ${JSON.stringify(character)}`,
    );
  }
  for (const line of gallery.split("\n")) {
    assert(
      !/\s$/u.test(line),
      `gallery line has trailing whitespace: ${JSON.stringify(line)}`,
    );
  }
});

Deno.test("the animated gallery enrolls both registries in stable order", () => {
  const scenes = artAnimationScenes();
  assertEquals(
    scenes.map((scene) => scene.label),
    EXPECTED_ENTRIES.map(([name]) => `[${name}]`),
  );
  for (const [index, [, variant]] of EXPECTED_ENTRIES.entries()) {
    assertEquals(scenes[index]?.frames.at(-1), variant.render());
  }
});

Deno.test("art command planning keeps motion opt-in and terminal-safe", () => {
  const staticOutput = `${renderArtGallery()}\n`;
  assertEquals(planArtCommand([], ANIMATED_ENVIRONMENT), {
    mode: "static",
    output: staticOutput,
  });
  const roomyPlan = planArtCommand(["--animate"], ANIMATED_ENVIRONMENT);
  if (roomyPlan.mode !== "animate") {
    throw new Error("roomy art fixture did not produce an animated plan");
  }
  for (
    const environment of [
      { ...ANIMATED_ENVIRONMENT, stdoutIsTerminal: false },
      { ...ANIMATED_ENVIRONMENT, ci: "1" },
      {
        ...ANIMATED_ENVIRONMENT,
        capabilities: {
          ...ANIMATED_ENVIRONMENT.capabilities,
          ansiControl: false,
        },
      },
      {
        ...ANIMATED_ENVIRONMENT,
        terminalColumns: roomyPlan.playback.maxWidth,
        terminalRows: roomyPlan.playback.maxHeight + 1,
      },
      {
        ...ANIMATED_ENVIRONMENT,
        terminalColumns: roomyPlan.playback.maxWidth + 1,
        terminalRows: roomyPlan.playback.maxHeight,
      },
    ]
  ) {
    assertEquals(planArtCommand(["--animate"], environment), {
      mode: "static",
      output: staticOutput,
    });
  }
  assertEquals(
    planArtCommand(["--animate"], {
      ...ANIMATED_ENVIRONMENT,
      ci: "false",
      terminalColumns: roomyPlan.playback.maxWidth + 1,
      terminalRows: roomyPlan.playback.maxHeight + 1,
    }).mode,
    "animate",
  );

  const invalid = planArtCommand(["--dance"], ANIMATED_ENVIRONMENT);
  assertEquals(invalid.mode, "error");
  if (invalid.mode === "error") {
    assertStringIncludes(invalid.message, 'Received "--dance"');
    assertStringIncludes(invalid.message, "deno task art --animate");
  }
});

Deno.test("animated command playback settles on the exact static gallery", async () => {
  const plan = planArtCommand(["--animate"], ANIMATED_ENVIRONMENT);
  if (plan.mode !== "animate") {
    throw new Error("animated art fixture did not produce a playback plan");
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  const waits: number[] = [];
  const code = await executeArtCommand(
    plan,
    {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      terminalSize: () => ({ columns: 80, rows: 24 }),
    },
    new AbortController().signal,
  );

  assertEquals(code, 0);
  assertEquals(stderr, []);
  assertEquals(stdout[0], "\n");
  assertEquals(
    stdout.at(-1),
    `${renderArtGallery(ANIMATED_ENVIRONMENT.capabilities)}\n`,
  );
  assert(!stdout.some((value) => value.includes("\x1b[?")));
  assert(waits.length > artAnimationScenes().length);
});

Deno.test("deno task art prints the complete plain-text gallery", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "art"],
    cwd: REPO_ROOT,
    env: { LANG: "en_US.UTF-8" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = DECODER.decode(result.stderr);

  assertEquals(result.code, 0, stderr);
  assertEquals(
    DECODER.decode(result.stdout),
    `${renderArtGallery(PIPED_CAPABILITIES)}\n`,
  );
});

Deno.test({
  name: "deno task art renders its Unicode gallery without permission prompts",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: ["task", "art"],
      cwd: REPO_ROOT,
      timeoutMs: 5_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assert(
      !result.transcript.includes("Deno requests env access"),
      result.transcript,
    );
    assertStringIncludes(
      stripAnsi(result.transcript),
      "▴ -> ◂ -> ▾ -> ▸ -> (repeat)",
    );
  },
});

Deno.test("piped deno task art --animate falls back to the static gallery", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "art", "--animate"],
    cwd: REPO_ROOT,
    env: { LANG: "en_US.UTF-8" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = DECODER.decode(result.stderr);
  const stdout = DECODER.decode(result.stdout);

  assertEquals(result.code, 0, stderr);
  assertEquals(stdout, `${renderArtGallery(PIPED_CAPABILITIES)}\n`);
  assert(!stdout.includes("\x1b"));
});
