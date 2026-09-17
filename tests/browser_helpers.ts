import axe from "axe-core";
import { Buffer } from "buffer";
import { type Browser, chromium, type Page } from "playwright-core";

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

/** Answer every request under `origin` from a fetch-shaped handler instead of a socket. */
export async function serveThroughHandler(
  page: Page,
  origin: string,
  handle: (request: Request) => Promise<Response>,
): Promise<void> {
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const response = await handle(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
      }),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

/** One WCAG 2.2 AA finding from an in-browser axe run, with its targets. */
export interface AxeFinding {
  readonly id: string;
  readonly nodes: readonly axe.UnlabelledFrameSelector[];
}

/** Audit the page as it is now against the WCAG 2.2 AA tag set. */
export async function axeFindings(page: Page): Promise<AxeFinding[]> {
  await page.evaluate(axe.source);
  return await page.evaluate(async () => {
    const runner = (window as unknown as { axe: typeof axe }).axe;
    const result = await runner.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    }));
  });
}
