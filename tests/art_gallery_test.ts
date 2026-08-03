/** Contract coverage for the maintainer-facing terminal-art gallery task. */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dirname, fromFileUrl } from "@std/path";
import {
  artAnimationScenes,
  type ArtCommandEnvironment,
  executeArtCommand,
  planArtCommand,
  renderArtGallery,
} from "../scripts/art.ts";
import { DISCERN_ART_VARIANTS } from "../src/shared/brand_art.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const DECODER = new TextDecoder();
const ANIMATED_ENVIRONMENT: ArtCommandEnvironment = {
  stdoutIsTerminal: true,
  ci: undefined,
  term: "xterm-256color",
  terminalColumns: 80,
  terminalRows: 24,
};

Deno.test("the art gallery enrolls every registered variant in order", () => {
  const expected = Object.entries(DISCERN_ART_VARIANTS)
    .map(([name, variant]) => `[${name}]\n${variant.render()}`)
    .join("\n\n");

  assertEquals(renderArtGallery(), expected);
});

Deno.test("gallery labels and composed output stay terminal-safe", () => {
  for (const name of Object.keys(DISCERN_ART_VARIANTS)) {
    assertMatch(name, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  }

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

Deno.test("the animated gallery enrolls every registered variant in order", () => {
  const scenes = artAnimationScenes();
  assertEquals(
    scenes.map((scene) => scene.label),
    Object.keys(DISCERN_ART_VARIANTS).map((name) => `[${name}]`),
  );
  for (
    const [index, variant] of Object.values(DISCERN_ART_VARIANTS).entries()
  ) {
    assertEquals(scenes[index]?.frames.at(-1), variant.render());
  }
});

Deno.test("art command planning keeps motion opt-in and terminal-safe", () => {
  const staticOutput = `${renderArtGallery()}\n`;
  assertEquals(planArtCommand([], ANIMATED_ENVIRONMENT), {
    mode: "static",
    output: staticOutput,
  });
  assertEquals(
    planArtCommand(["--animate"], ANIMATED_ENVIRONMENT).mode,
    "animate",
  );
  for (
    const environment of [
      { ...ANIMATED_ENVIRONMENT, stdoutIsTerminal: false },
      { ...ANIMATED_ENVIRONMENT, ci: "1" },
      { ...ANIMATED_ENVIRONMENT, term: "dumb" },
      { ...ANIMATED_ENVIRONMENT, terminalColumns: 46 },
      { ...ANIMATED_ENVIRONMENT, terminalRows: 12 },
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
      terminalColumns: 47,
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
  assertEquals(stdout.at(-1), `${renderArtGallery()}\n`);
  assert(!stdout.some((value) => value.includes("\x1b[?")));
  assert(waits.length > artAnimationScenes().length);
});

Deno.test("deno task art prints the complete plain-text gallery", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "art"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = DECODER.decode(result.stderr);

  assertEquals(result.code, 0, stderr);
  assertEquals(DECODER.decode(result.stdout), `${renderArtGallery()}\n`);
});

Deno.test("piped deno task art --animate falls back to the static gallery", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "art", "--animate"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = DECODER.decode(result.stderr);
  const stdout = DECODER.decode(result.stdout);

  assertEquals(result.code, 0, stderr);
  assertEquals(stdout, `${renderArtGallery()}\n`);
  assert(!stdout.includes("\x1b"));
});
