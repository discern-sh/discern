/** Real-layout release checks: readable commands, keyboard access, contrast, and no-JS. */
import { assert, assertEquals } from "@std/assert";
import axe from "axe-core";
import { Buffer } from "buffer";
import { handlerWithRouting } from "../site/serve.ts";
import { INSTALL_COMMAND } from "../src/shared/product_identity.ts";
import { launchBrowser } from "./browser_helpers.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import {
  releasePageCatalogue,
  releasePageRouting,
} from "./release_page_fixtures.ts";

Deno.test(
  "release notes and update instructions remain usable across browser modes",
  async (
    _test,
    evidence = Deno.env.get(
      DISCERN_ENVIRONMENT_VARIABLES.releaseReviewDirectory,
    ),
  ) => {
    const routing = await releasePageRouting(releasePageCatalogue());
    const browser = await launchBrowser();
    try {
      for (
        const mode of [
          {
            name: "desktop-light",
            width: 1280,
            height: 900,
            colorScheme: "light",
            javaScriptEnabled: true,
          },
          {
            name: "mobile-dark",
            width: 390,
            height: 844,
            colorScheme: "dark",
            javaScriptEnabled: true,
          },
          {
            name: "mobile-no-js",
            width: 320,
            height: 800,
            colorScheme: "light",
            javaScriptEnabled: false,
          },
        ] as const
      ) {
        const context = await browser.newContext({
          viewport: { width: mode.width, height: mode.height },
          colorScheme: mode.colorScheme,
          javaScriptEnabled: mode.javaScriptEnabled,
        });
        context.setDefaultTimeout(10_000);
        const page = await context.newPage();
        await page.route("http://127.0.0.1:18899/**", async (route) => {
          const request = route.request();
          const response = await handlerWithRouting(
            new Request(request.url(), {
              method: request.method(),
              headers: request.headers(),
            }),
            routing,
          );
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
        });
        const failures: string[] = [];
        page.on("pageerror", (error) => failures.push(error.message));
        try {
          const response = await page.goto(
            "http://127.0.0.1:18899/releases?since=7.8.0",
          );
          assertEquals(response?.status(), 200);
          if (mode.javaScriptEnabled) {
            await page.evaluate(async () => await document.fonts.ready);
          }
          assertEquals(
            await page.locator("[data-release-status]").getAttribute(
              "data-release-status",
            ),
            "update-available",
          );
          assertEquals(
            await page.locator("#update code").textContent(),
            INSTALL_COMMAND,
          );
          assertEquals(
            await page.locator("[data-release-version]").count(),
            routing.releases?.length,
          );
          assertEquals(
            await page.evaluate(() =>
              document.documentElement.scrollWidth <= innerWidth
            ),
            true,
            mode.name,
          );
          const fits = await page.locator("#update code").evaluate(
            (element) => {
              const bounds = element.getBoundingClientRect();
              return bounds.left >= 0 && bounds.right <= innerWidth &&
                element.scrollWidth <= element.clientWidth;
            },
          );
          assert(
            fits,
            `${mode.name}: installer text must wrap within its readable box`,
          );
          if (evidence !== undefined) {
            await Deno.mkdir(evidence, { recursive: true });
            await page.screenshot({
              path: `${evidence}/${mode.name}-viewport.png`,
            });
          }
          await page.keyboard.press("Tab");
          assertEquals(
            await page.locator(":focus").getAttribute("href"),
            "#main",
          );
          await page.keyboard.press("Enter");
          assertEquals(await page.evaluate(() => location.hash), "#main");
          await page.getByRole("link", {
            name: "Review the update steps",
            exact: true,
          }).click();
          assert(await page.locator("#update-heading").isVisible());
          if (evidence !== undefined) {
            await Deno.mkdir(evidence, { recursive: true });
            await page.screenshot({
              path: `${evidence}/${mode.name}.png`,
              fullPage: true,
            });
          }
          if (mode.javaScriptEnabled) {
            assertEquals(
              await page.locator("html").getAttribute("data-discern-theme"),
              mode.colorScheme,
            );
            await page.getByRole("button", { name: /Switch to the .* theme/ })
              .click();
            assertEquals(
              await page.locator("html").getAttribute("data-discern-theme"),
              mode.colorScheme === "light" ? "dark" : "light",
            );
          }
          if (mode.javaScriptEnabled) {
            await page.evaluate(axe.source);
            const findings = await page.evaluate(async () => {
              const runner = (window as unknown as { axe: typeof axe }).axe;
              const result = await runner.run(document, {
                runOnly: {
                  type: "tag",
                  values: [
                    "wcag2a",
                    "wcag2aa",
                    "wcag21a",
                    "wcag21aa",
                    "wcag22aa",
                  ],
                },
              });
              return result.violations.map((violation) => ({
                id: violation.id,
                nodes: violation.nodes.map((node) => node.target),
              }));
            });
            assertEquals(findings, [], mode.name);
          }
          assertEquals(failures, [], mode.name);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  },
);
