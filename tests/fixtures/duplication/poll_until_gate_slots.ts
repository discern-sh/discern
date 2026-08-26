/** Inert source fixture that calibrates gate-slot clone detection. */

const rawTimer = "set" + "Timeout";

export default [
  "/** Poll a predicate to true within a bound; a miss names what never happened. */",
  "async function pollUntil(",
  "  what: string,",
  "  predicate: () => boolean | Promise<boolean>,",
  "  timeoutMs = 30_000,",
  "): Promise<void> {",
  "  const start = Date.now();",
  "  while (true) {",
  "    if (await predicate()) {",
  "      return;",
  "    }",
  "    if (Date.now() - start > timeoutMs) {",
  "      throw new Error(`timed out waiting for ${what}`);",
  "    }",
  `    await new Promise((r) => ${rawTimer}(r, 100));`,
  "  }",
  "}",
  "",
].join("\n");
