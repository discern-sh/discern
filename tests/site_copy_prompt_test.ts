/** Runtime contract for the homepage's framework-free interactions. */

import { assert, assertEquals } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { COPY_PROMPT_TEXT, renderLanding } from "../site/page-src/landing.tsx";

interface PromptWindow extends Window {
  eval(source: string): unknown;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/** Collapse rendered text without weakening punctuation or URL equality. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

Deno.test("Copy prompt stays readable without JavaScript and copies the exact approved instruction", async () => {
  const html = renderLanding();
  const client = await Deno.readTextFile(
    new URL("../site/page-src/landing.js", import.meta.url),
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://discern.sh/",
  });
  const window = dom.window as unknown as PromptWindow;
  const document = window.document;
  const prompts = [
    ...document.querySelectorAll<HTMLElement>(".landing-copy-prompt__text"),
  ];
  const controls = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-copy-prompt]"),
  ];
  const preview = document.querySelector<HTMLElement>("[data-project-preview]");
  const previewControls = document.querySelector<HTMLElement>(
    "[data-preview-controls]",
  );
  const previewButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-preview-control]"),
  ];

  assertEquals(prompts.length, 2);
  assertEquals(
    prompts.map((prompt) => readableText(prompt.textContent)),
    [COPY_PROMPT_TEXT, COPY_PROMPT_TEXT],
  );
  assert(
    prompts.every((prompt) => prompt.closest("[hidden]") === null),
    "the approved prompt must remain visible and selectable without JavaScript",
  );
  assertEquals(controls.map((control) => control.hidden), [true, true]);
  assert(preview !== null);
  assert(previewControls !== null);
  assertEquals(previewControls.hidden, true);
  assertEquals(preview.hasAttribute("data-preview-enhanced"), false);

  const copied: string[] = [];
  let externalRequests = 0;
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: (value: string): Promise<void> => {
        copied.push(value);
        return Promise.resolve();
      },
    },
  });
  window.fetch = (): Promise<Response> => {
    externalRequests++;
    return Promise.reject(new Error("unexpected request"));
  };

  window.eval(client);
  assertEquals(controls.map((control) => control.hidden), [
    false,
    false,
  ]);
  assertEquals(previewControls.hidden, false);
  assertEquals(preview.hasAttribute("data-preview-enhanced"), true);
  assertEquals(previewButtons.length, 4);

  previewButtons[0]?.click();
  assertEquals(preview.getAttribute("data-preview-stage"), "brief");
  assertEquals(
    previewButtons.map((control) => control.getAttribute("aria-pressed")),
    ["true", "false", "false", "false"],
  );
  assertEquals(
    document.querySelector("[data-preview-status]")?.textContent,
    "Showing the Brief stage.",
  );

  controls[0]?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(copied, [COPY_PROMPT_TEXT]);
  assertEquals(externalRequests, 0);
  assertEquals(
    controls[0]?.querySelector(".discern-button__label")?.textContent,
    "Copied! Now paste it to your agent.",
  );
  assertEquals(controls[0]?.hasAttribute("data-prompt-copied"), true);
  assertEquals(
    document.getElementById("hero-copy-prompt-status")?.textContent,
    "Copied! Now paste it to your agent.",
  );

  for (
    const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "new Image"]
  ) {
    assertEquals(client.includes(forbidden), false, forbidden);
  }
  dom.window.close();
});
