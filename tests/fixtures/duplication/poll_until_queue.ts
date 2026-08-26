/** Inert source fixture that calibrates queue clone detection. */

const rawTimer = "set" + "Timeout";

export default [
  "/** Poll a predicate until it holds or the named readiness condition expires. */",
  "async function pollUntil(",
  "  what: string,",
  "  predicate: () => boolean | Promise<boolean>,",
  "): Promise<void> {",
  "  const deadline = Date.now() + TEST_PROCESS_TIMEOUT_MS;",
  "  while (!(await predicate())) {",
  "    if (Date.now() >= deadline) {",
  "      throw new Error(`timed out waiting for ${what}`);",
  "    }",
  `    await new Promise((resolve) => ${rawTimer}(resolve, 50));`,
  "  }",
  "}",
  "",
].join("\n");
