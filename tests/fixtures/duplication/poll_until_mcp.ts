/** Inert source fixture that calibrates MCP clone detection. */

const rawTimer = "set" + "Timeout";

export default [
  "/** Poll until `check` is true, failing the test after the deadline. */",
  "async function pollUntil(",
  "  check: () => Promise<boolean> | boolean,",
  "  what: string,",
  "  timeoutMs = 30_000,",
  "): Promise<void> {",
  "  const deadline = Date.now() + timeoutMs;",
  "  while (Date.now() < deadline) {",
  "    if (await check()) {",
  "      return;",
  "    }",
  `    await new Promise((r) => ${rawTimer}(r, 50));`,
  "  }",
  "  throw new Error(`timed out waiting for ${what}`);",
  "}",
  "",
].join("\n");
