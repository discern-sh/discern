import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import { emitDesignSystemRuntime } from "discern-design-system/runtime";
import { type Browser, chromium } from "playwright-core";
import { renderWorkflowMarkdown } from "../site/workflow.ts";
import { withTempDir } from "./helpers.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const ORIGIN = "https://discern.test";
const CODE_LINES = [
  "┌──────────────┐",
  "│ ASCII        │",
  "│ CJK 界       │",
  "│ Emoji 🎨     │",
  "└──────────────┘",
] as const;
const CODE = CODE_LINES.join("\n");

/** Encode a font for a self-contained browser fixture. */
function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
    );
  }
  return btoa(chunks.join(""));
}

/** Launch an installed or Playwright-managed Chromium browser. */
async function launchBrowser(): Promise<Browser> {
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

/** Build the real docs composition around one fenced-code fixture. */
async function fixtureHtml(bundleRoot: string): Promise<string> {
  const fontsCss = await Deno.readTextFile(join(bundleRoot, "fonts.css"));
  const font = encodeBase64(
    await Deno.readFile(
      join(bundleRoot, "fonts", "jetbrains-mono.woff2"),
    ),
  );
  const embeddedFonts = fontsCss.replace(
    'url("./fonts/jetbrains-mono.woff2")',
    `url("data:font/woff2;base64,${font}")`,
  );
  const runtimeCss = await Deno.readTextFile(join(bundleRoot, "discern.css"));
  const docsCss = await Deno.readTextFile(
    join(ROOT, "site", "pages", "assets", "docs.css"),
  );
  const codeHtml = renderWorkflowMarkdown(
    `\`\`\`text\n${CODE}\n\`\`\``,
  ).html;
  return `<!doctype html>
<html data-discern-theme="light">
<head><style>${embeddedFonts}\n${runtimeCss}\n${docsCss}</style></head>
<body><main data-discern-root><article class="doc-body">${codeHtml}</article></main>
<script type="module" src="/docs.js"></script></body>
</html>`;
}

Deno.test(
  "fenced Markdown keeps terminal cells aligned and copyable in a real browser",
  async (test) => {
    await withTempDir(async (dir) => {
      const bundleRoot = join(dir, "design-system");
      await emitDesignSystemRuntime({
        outputRoot: new URL(`${toFileUrl(bundleRoot).href}/`),
        groups: ["Docs"],
        assets: ["fonts"],
        theme: "discern",
      });
      const html = await fixtureHtml(bundleRoot);
      const modules = new Map<string, string>();
      for (const name of ["docs.js", "docs-toc.js", "search.js"] as const) {
        modules.set(
          `/${name}`,
          await Deno.readTextFile(
            join(ROOT, "site", "pages", "assets", name),
          ),
        );
      }

      const browser = await launchBrowser();
      const context = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      try {
        for (const [path, body] of modules) {
          await page.route(`${ORIGIN}${path}`, async (route) => {
            await route.fulfill({
              body,
              headers: { "content-type": "text/javascript; charset=utf-8" },
            });
          });
        }
        await page.route(`${ORIGIN}/`, async (route) => {
          await route.fulfill({
            body: html,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        });
        await page.goto(`${ORIGIN}/`);
        await page.evaluate(async () => await document.fonts.ready);
        await page.locator(".docs-copy").waitFor();

        await test.step(
          "equal-width box rows align under the bundled JetBrains Mono fallback",
          async () => {
            const facts = await page.locator(".doc-body pre > code").evaluate(
              (element, expectedLineCount) => {
                const rightEdges: Array<number | undefined> = Array.from(
                  { length: expectedLineCount },
                  () => undefined,
                );
                let row = 0;
                for (const node of element.childNodes) {
                  if (
                    node instanceof HTMLElement &&
                    node.hasAttribute("data-discern-terminal-cell")
                  ) {
                    const right = node.getBoundingClientRect().right;
                    const current = rightEdges[row];
                    rightEdges[row] = current === undefined
                      ? right
                      : Math.max(current, right);
                  } else if (node instanceof Text) {
                    row += node.data.split("\n").length - 1;
                  }
                }
                return {
                  fontLoaded: document.fonts.check(
                    '400 16px "JetBrains Mono"',
                  ),
                  rightEdges,
                };
              },
              CODE_LINES.length,
            );
            assert(
              facts.fontLoaded,
              "the bundled JetBrains Mono face must load",
            );
            const firstRight = facts.rightEdges[0];
            if (firstRight === undefined) {
              throw new Error(
                "the first box row has no projected terminal cell",
              );
            }
            for (const [index, right] of facts.rightEdges.entries()) {
              if (right === undefined) {
                throw new Error(`box row ${index + 1} has no terminal cell`);
              }
              assert(
                Math.abs(right - firstRight) <= 0.5,
                `box row ${index + 1} ended at ${right}px`,
              );
            }
          },
        );

        for (
          const { name, text } of [
            { name: "CJK graphemes retain two terminal cells", text: "界" },
            { name: "emoji graphemes retain two terminal cells", text: "🎨" },
          ]
        ) {
          await test.step(name, async () => {
            const columns = await page.locator(
              "[data-discern-terminal-cell]",
            ).evaluateAll(
              (cells, expected) =>
                cells
                  .filter((cell) => cell.textContent === expected)
                  .map((cell) =>
                    cell.getAttribute("data-discern-terminal-cell")
                  ),
              text,
            );
            assertEquals(columns, ["2"]);
          });
        }

        await test.step("copying projected code preserves source text", async () => {
          assertEquals(
            await page.locator(".doc-body pre > code").innerText(),
            CODE,
          );
          await page.locator(".docs-copy").click();
          await page.locator(".docs-copy[data-discern-copied]").waitFor();
          assertEquals(
            await page.evaluate(async () =>
              await navigator.clipboard.readText()
            ),
            CODE,
          );
        });
      } finally {
        await context.close();
        await browser.close();
      }
    });
  },
);
