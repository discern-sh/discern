import { assertEquals } from "@std/assert";
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

  assertEquals(await openInBrowser(URL, { os: "linux", run: success }), {
    status: "opened",
    launch: { command: "xdg-open", args: [URL] },
  });
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
