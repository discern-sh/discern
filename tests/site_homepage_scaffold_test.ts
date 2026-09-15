/** Guards for the shared campaign scaffold and thin homepage route adapter. */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COPY_PROMPT_TEXT,
  CopyPrompt,
} from "../site/ui/components/CopyPrompt.tsx";
import { renderLanding } from "../site/ui/pages/HomePage.tsx";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Compose the real shared scheduler and Copy prompt client for JSDOM. */
async function executableCopyPromptClient(): Promise<string> {
  const [scheduler, client] = await Promise.all([
    Deno.readTextFile(join(ROOT, "site/pages/assets/scheduler.js")),
    Deno.readTextFile(join(ROOT, "site/page-src/copy-prompt.js")),
  ]);
  return `${scheduler.replace(/^export /gm, "")}\n${
    client.replace(/^import .*?;\n/gm, "")
  }`;
}

/** Flush the promise turns used by an asynchronous click listener. */
async function flushCopyClick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

Deno.test("the homepage has static landmarks, a manual action, and local assets", async () => {
  const dom = new JSDOM(renderLanding());
  const document = dom.window.document;
  for (const landmark of ["header", "main", "footer", "h1"]) {
    assertEquals(document.querySelectorAll(landmark).length, 1, landmark);
  }
  assert(document.querySelector('main a[href="/docs/start"]'));
  for (
    const asset of document.querySelectorAll(
      "link[rel=stylesheet], script[src]",
    )
  ) {
    const path = asset.getAttribute("href") ?? asset.getAttribute("src") ?? "";
    assert(path.startsWith("/assets/"), path);
    const stat = await Deno.stat(join(ROOT, "site/pages", path));
    assert(stat.isFile, path);
  }
  dom.window.close();
});

Deno.test("Copy prompt is a complete static fallback with a two-word default action", () => {
  const markup = renderToStaticMarkup(CopyPrompt({
    id: "fixture-prompt",
    label: "Commission the agent.",
  }));
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const target = document.getElementById("fixture-prompt");
  const button = document.querySelector<HTMLButtonElement>(
    "[data-copy-prompt]",
  );
  const link = document.querySelector<HTMLAnchorElement>(
    ".landing-copy-prompt__link",
  );
  const status = document.getElementById("fixture-prompt-status");

  assertEquals(target?.textContent, COPY_PROMPT_TEXT);
  assertEquals(target?.hasAttribute("hidden"), false);
  assertEquals(button?.hidden, true);
  assertEquals(button?.textContent, "Copy prompt");
  assertEquals(button?.getAttribute("data-copy-label"), "Copy prompt");
  assertEquals(link?.getAttribute("href"), "/llms.txt");
  assertEquals(status?.getAttribute("role"), "status");
  assertEquals(status?.getAttribute("aria-live"), "polite");
  assertEquals(markup.split(COPY_PROMPT_TEXT).length - 1, 1);
  dom.window.close();
});

Deno.test("shared Copy prompt enhancement copies, announces, resets, and selects on failure", async () => {
  const markup = renderToStaticMarkup(CopyPrompt({
    id: "fixture-prompt",
    label: "Commission the agent.",
  }));
  const client = await executableCopyPromptClient();
  const successDom = new JSDOM(markup, { runScripts: "outside-only" });
  const successWindow = successDom.window;
  const copied: string[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduledDelays: number[] = [];
  let nextTimer = 0;
  successWindow.setTimeout = ((callback: TimerHandler, delay?: number) => {
    if (typeof callback !== "function") {
      throw new Error("test scheduler requires a callback");
    }
    const id = ++nextTimer;
    const numericDelay = delay ?? 0;
    scheduledDelays.push(numericDelay);
    timers.set(id, { callback: () => callback(), delay: numericDelay });
    return id;
  }) as typeof successWindow.setTimeout;
  successWindow.clearTimeout = ((id?: number) => {
    if (id !== undefined) timers.delete(id);
  }) as typeof successWindow.clearTimeout;
  Object.defineProperty(successWindow.navigator, "clipboard", {
    value: {
      writeText: (text: string): Promise<void> => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  successWindow.eval(client);

  const successButton = successWindow.document.querySelector<HTMLButtonElement>(
    "[data-copy-prompt]",
  );
  const successStatus = successWindow.document.getElementById(
    "fixture-prompt-status",
  );
  assert(successButton !== null);
  assertEquals(successButton.hidden, false);
  successButton.click();
  await flushCopyClick();
  assertEquals(copied, [COPY_PROMPT_TEXT]);
  assertEquals(successButton.textContent, "Prompt copied");
  assertEquals(successButton.hasAttribute("data-prompt-copied"), true);
  assertEquals(
    successStatus?.textContent,
    "Paste this into a coding-agent session rooted in your project.",
  );
  assertEquals(scheduledDelays, [1000, 2000]);
  const reset = [...timers.values()].find(({ delay }) => delay === 2000);
  assert(reset !== undefined);
  reset.callback();
  assertEquals(successButton.textContent, "Copy prompt");
  assertEquals(successStatus?.textContent, "");
  successDom.window.close();

  const fallbackDom = new JSDOM(markup, { runScripts: "outside-only" });
  fallbackDom.window.eval(client);
  const fallbackButton = fallbackDom.window.document
    .querySelector<HTMLButtonElement>("[data-copy-prompt]");
  assert(fallbackButton !== null);
  fallbackButton.click();
  await flushCopyClick();
  assertEquals(fallbackButton.textContent, "Copy prompt");
  assertEquals(
    fallbackDom.window.getSelection()?.toString(),
    COPY_PROMPT_TEXT,
  );
  assertEquals(
    fallbackDom.window.document.getElementById("fixture-prompt-status")
      ?.textContent,
    "",
  );
  fallbackDom.window.close();
});
