import { type Browser, chromium } from "playwright-core";

/** Launch an installed or Playwright-managed Chromium browser. */
export async function launchBrowser(): Promise<Browser> {
  const attempts: Array<{
    readonly label: string;
    readonly options: Parameters<typeof chromium.launch>[0];
  }> = [
    {
      label: "installed Google Chrome",
      options: { channel: "chrome", headless: true },
    },
    {
      label: "Playwright-managed Chromium",
      options: { headless: true },
    },
  ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      failures.push(
        `${attempt.label}: ${
          error instanceof Error ? error.message.split("\n")[0] : String(error)
        }`,
      );
    }
  }
  throw new Error(
    `No compatible Chromium browser was available. Install Google Chrome, ` +
      `or run the Playwright Chromium installer.\n${failures.join("\n")}`,
  );
}
