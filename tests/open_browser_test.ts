import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  type BrowserCommandResult,
  browserLaunch,
  browserOpenFailureMessage,
  openInBrowser,
} from "../src/lib/open_browser.ts";

const URL = "https://discern.sh/docs";

Deno.test("browser launcher maps every supported host without a shell", () => {
  assertEquals(browserLaunch(URL, "darwin"), {
    command: "open",
    args: [URL],
  });
  assertEquals(browserLaunch(URL, "linux"), {
    command: "xdg-open",
    args: [URL],
  });
  assertEquals(browserLaunch(URL, "windows"), undefined);
});

Deno.test("browser opener reports success, process failure, and launch failure", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const success = (
    command: string,
    args: readonly string[],
  ): Promise<BrowserCommandResult> => {
    calls.push({ command, args });
    return Promise.resolve({ success: true, code: 0, stderr: "" });
  };

  assertEquals(
    await openInBrowser(URL, { os: "linux", wsl: false, run: success }),
    {
      status: "opened",
      launch: { command: "xdg-open", args: [URL] },
    },
  );
  assertEquals(calls, [{ command: "xdg-open", args: [URL] }]);

  assertEquals(
    await openInBrowser(URL, {
      os: "darwin",
      run: () => Promise.resolve({ success: false, code: 3, stderr: "no app" }),
    }),
    {
      status: "failed",
      launch: { command: "open", args: [URL] },
      message: "no app",
    },
  );

  assertEquals(
    await openInBrowser(URL, {
      os: "linux",
      wsl: false,
      run: () => {
        throw new Error("missing xdg-open");
      },
    }),
    {
      status: "failed",
      launch: { command: "xdg-open", args: [URL] },
      message: "missing xdg-open",
    },
  );
});

Deno.test("browser opener gives an explicit unsupported-platform outcome", async () => {
  const result = await openInBrowser(URL, { os: "windows" });
  assertEquals(result, {
    status: "unsupported",
    message: "browser opening is unavailable on windows",
  });
  if (result.status === "opened") {
    throw new Error("the unsupported platform unexpectedly opened a browser");
  }
  assertEquals(
    browserOpenFailureMessage("the docs", URL, result),
    "discern couldn't open the docs: browser opening is unavailable on windows. " +
      `Open ${URL} in your browser.`,
  );
});

/** The text of one call expression from its name to its balanced closing paren. */
function callText(source: string, start: number): string {
  let depth = 0;
  for (let i = source.indexOf("(", start); i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Linux launches in `source` that leave the WSL question to the host: no
 * `wsl` answer and no environment of their own. */
function unansweredLinuxLaunches(source: string): string[] {
  return [...source.matchAll(/\bopenInBrowser\(/gu)]
    .map((match) => callText(source, match.index))
    .filter((call) => /\bos:\s*["']linux["']/u.test(call))
    .filter((call) => !/\bwsl:/u.test(call) && !/\bget:/u.test(call))
    .map((call) => call.split("\n")[0] ?? call);
}

Deno.test("tests that launch on Linux answer the WSL question instead of inheriting the host's", async () => {
  const files = await structuralGuardScope({
    guard: "tests/open_browser_test.ts#linux-launch-declares-wsl",
    universe: "authored-ts",
    narrow: {
      reason: "only tests exercise the launcher with a chosen platform",
      include: (rel) => rel.startsWith("tests/"),
    },
  });
  const offenders = await Promise.all(
    files.map(async (rel) =>
      unansweredLinuxLaunches(await Deno.readTextFile(join(REPO_ROOT, rel)))
        .map((call) => `${rel}: ${call}`)
    ),
  );
  assertEquals(offenders.flat(), []);
});

Deno.test("the launch guard catches a Linux launch that inherits the host", () => {
  // Spelled in two halves so this file's own text never matches the guard.
  const call = "openInBrowser" + '(url, { os: "linux", run })';
  assertEquals(unansweredLinuxLaunches(`await ${call};`), [call]);
  assertEquals(
    unansweredLinuxLaunches('openInBrowser(url, { os: "linux", wsl: false })'),
    [],
  );
  assertEquals(
    unansweredLinuxLaunches(
      'openInBrowser(url, { os: "linux" }, { get: () => undefined })',
    ),
    [],
  );
  assertEquals(
    unansweredLinuxLaunches('openInBrowser(url, { os: "darwin" })'),
    [],
  );
});
