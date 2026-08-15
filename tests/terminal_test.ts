/** Tests for Discern's process, Token, and untrusted-text terminal boundary. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { renderBadgeCli, stripAnsi } from "discern-design-system/cli";
import {
  productionTerminalContext,
  resolveTerminalContext,
  terminalLine,
  terminalMultiline,
  terminalSize,
} from "../src/lib/terminal.ts";
import { fakeEnv } from "./helpers.ts";

const throwsConsoleSize = (): { columns: number; rows: number } => {
  throw new Error("not a terminal");
};

Deno.test("terminal context snapshots process facts and observes dimensions once", () => {
  let observations = 0;
  let attachmentObservations = 0;
  const context = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_GB.UTF-8",
      COLUMNS: "91",
      LINES: "33",
      CI: "1",
    }),
    isTerminal: () => {
      attachmentObservations += 1;
      return true;
    },
    consoleSize: () => {
      observations += 1;
      return { columns: 101, rows: 51 };
    },
  });
  assertEquals(observations, 1);
  assertEquals(attachmentObservations, 1);
  assertEquals(context.size, { columns: 101, rows: 51 });
  assertEquals(context.capabilities, {
    ansiControl: true,
    colorDepth: "truecolor",
    columns: 101,
    hyperlinks: true,
    unicode: true,
  });
  assertEquals(context.themeVariant, "dark");
  assertEquals(context.color, true);
  assertEquals(context.stdoutIsTerminal, true);
  assertEquals(context.ciRequestsStaticOutput, true);
  assertEquals(context.environment.CI, "1");
  assertEquals(stripAnsi(context.role("Strong", "strong")), "Strong");
  assertEquals(stripAnsi(context.tone("Done", "success")), "Done");
});

Deno.test("terminal viewport observation samples live dimensions and closes permanently", () => {
  let size = { columns: 80, rows: 24 };
  let observations = 0;
  const context = resolveTerminalContext({
    noColor: true,
    env: fakeEnv({ TERM: "xterm", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => {
      observations += 1;
      return size;
    },
  });
  assertEquals(
    observations,
    1,
    "context construction takes the initial snapshot",
  );

  const viewport = context.observeViewport();
  size = { columns: 96, rows: 40 };
  assertEquals(viewport.sample(), size);
  assertEquals(observations, 2);

  viewport.close();
  size = { columns: 32, rows: 6 };
  assertEquals(
    viewport.sample(),
    { columns: 96, rows: 40 },
    "a closed observation never calls the process reader again",
  );
  assertEquals(observations, 2);
});

Deno.test("unsupported live viewport observation retains the initial snapshot", () => {
  let observations = 0;
  const context = resolveTerminalContext({
    noColor: true,
    env: fakeEnv({ COLUMNS: "73", LINES: "29" }),
    isTerminal: () => true,
    consoleSize: () => {
      observations += 1;
      throw new Error("console size unavailable");
    },
  });
  const viewport = context.observeViewport();
  assertEquals(context.size, { columns: 73, rows: 29 });
  assertEquals(viewport.sample(), context.size);
  assertEquals(observations, 2);
  viewport.close();
});

Deno.test("flag-forced no-colour is visible to package capability detection", () => {
  const context = resolveTerminalContext({
    noColor: true,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 80, rows: 24 }),
  });
  assertEquals(context.environment.NO_COLOR, "1");
  assertEquals(context.capabilities.colorDepth, "none");
  assertEquals(context.capabilities.ansiControl, true);
  assertEquals(context.capabilities.unicode, true);
  assertEquals(context.tone("Done", "success"), "Done");
});

Deno.test("empty NO_COLOR, non-TTY, dumb TERM, and C locale degrade distinctly", () => {
  const emptyNoColor = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ NO_COLOR: "", TERM: "xterm", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: throwsConsoleSize,
  });
  assertEquals(
    Object.prototype.hasOwnProperty.call(emptyNoColor.environment, "NO_COLOR"),
    false,
  );
  assertEquals(emptyNoColor.capabilities.colorDepth, "ansi16");

  const nonTerminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => false,
    consoleSize: throwsConsoleSize,
  });
  assertEquals(nonTerminal.capabilities, {
    ansiControl: false,
    colorDepth: "none",
    columns: 80,
    hyperlinks: false,
    unicode: true,
  });
  assertEquals(nonTerminal.stdoutIsTerminal, false);
  assertEquals(nonTerminal.ciRequestsStaticOutput, false);

  const dumb = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "dumb", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: throwsConsoleSize,
  });
  assertEquals(dumb.capabilities.colorDepth, "none");
  assertEquals(dumb.capabilities.ansiControl, false);
  assertEquals(dumb.capabilities.unicode, true);

  const ascii = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "xterm", LC_ALL: "C" }),
    isTerminal: () => true,
    consoleSize: throwsConsoleSize,
  });
  assertEquals(ascii.capabilities.colorDepth, "ansi16");
  assertEquals(ascii.capabilities.ansiControl, true);
  assertEquals(ascii.capabilities.unicode, false);
});

Deno.test("Codex and Claude dumb terminals retain their UTF-8 repertoire", () => {
  for (const locale of ["C.UTF-8", "C.utf8"]) {
    const context = resolveTerminalContext({
      noColor: false,
      env: fakeEnv({ TERM: "dumb", NO_COLOR: "1", LC_ALL: locale }),
      isTerminal: () => true,
      consoleSize: () => ({ columns: 80, rows: 24 }),
    });
    assertEquals(context.capabilities, {
      ansiControl: false,
      colorDepth: "none",
      columns: 80,
      hyperlinks: false,
      unicode: true,
    });
  }
});

Deno.test("production constructor retains environment and dimension fallbacks", () => {
  const context = productionTerminalContext({
    env: fakeEnv({
      TERM: "xterm-256color",
      LANG: "en_GB.UTF-8",
      COLUMNS: "93",
      LINES: "37",
    }),
    isTerminal: () => true,
    consoleSize: throwsConsoleSize,
    theme: "light",
  });
  assertEquals(context.size, { columns: 93, rows: 37 });
  assertEquals(context.capabilities.columns, 93);
  assertEquals(context.themeVariant, "light");
});

Deno.test("terminal-size compatibility reads only dimension facts", () => {
  const reads: string[] = [];
  const size = terminalSize({
    env: {
      get: (key: string): string | undefined => {
        reads.push(key);
        if (key === "COLUMNS") return "72";
        if (key === "LINES") return "31";
        throw new Error(`unexpected terminal capability read: ${key}`);
      },
    },
    consoleSize: throwsConsoleSize,
  });
  assertEquals(reads, ["COLUMNS", "LINES"]);
  assertEquals(size, { columns: 72, rows: 31 });
});

Deno.test("untrusted single-line text names every control without losing Unicode", () => {
  const safe = terminalLine(
    "café 界 👩‍💻\nbranch\t\x1b[31m\u0085\u200D",
  );
  assertStringIncludes(safe, "café 界 👩<U+200D>💻");
  assertStringIncludes(safe, "␊branch␉␛[31m<U+0085><U+200D>");
  assertEquals(/[\p{Cc}\p{Cf}]/u.test(safe), false);

  const rendered = renderBadgeCli(
    { label: safe, maxWidth: 60 },
    { colorDepth: "none", columns: 60, unicode: true },
  );
  assertStringIncludes(rendered, "café");
});

Deno.test("untrusted multiline text preserves only explicitly requested line feeds", () => {
  const safe = terminalMultiline("one\r\ntwo\rthree\u202Efour");
  assertEquals(safe, "one\ntwo␍three<U+202E>four");
  assertEquals(safe.split("\n").length, 2);
  assertEquals(/[\p{Cc}\p{Cf}]/u.test(safe.replaceAll("\n", "")), false);
  assert(safe.length >= "one\ntwothreefour".length);
});
