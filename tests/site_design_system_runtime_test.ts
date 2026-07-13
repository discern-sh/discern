/** Browser-facing checks for the built design-system demo artifact. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { handler } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

Deno.test("the design-system demo route serves the generated static edition", async () => {
  const response = await handler(
    new Request("https://discern.sh/design-system-demo", { headers: BROWSER }),
  );
  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");
  const html = await response.text();
  assertStringIncludes(html, "data-ds-root");
  assertStringIncludes(
    html,
    "typed React at build time · static HTML at runtime",
  );

  const runtimeRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((value) => !value.startsWith("#") && !value.startsWith("data:"));
  assert(
    runtimeRefs.every((value) => value.startsWith("/")),
    `remote runtime references: ${runtimeRefs.join(", ")}`,
  );
  assertEquals(
    runtimeRefs.filter((value) => value.endsWith(".js")),
    ["/assets/design-system/demo.js"],
  );
});

Deno.test("every referenced design-system asset is served with its browser type", async () => {
  const expected = new Map([
    ["/assets/design-system/discern.css", "text/css"],
    ["/assets/design-system/demo.css", "text/css"],
    ["/assets/design-system/fonts.css", "text/css"],
    ["/assets/design-system/demo.js", "text/javascript"],
    ["/assets/design-system/manifest.json", "application/json"],
    ["/assets/design-system/textures/grain.png", "image/png"],
    ["/assets/design-system/fonts/eb-garamond-roman.woff2", "font/woff2"],
    ["/assets/design-system/fonts/eb-garamond-italic.woff2", "font/woff2"],
    ["/assets/design-system/fonts/inter.woff2", "font/woff2"],
    ["/assets/design-system/fonts/ibm-plex-sans.woff2", "font/woff2"],
    ["/assets/design-system/fonts/jetbrains-mono.woff2", "font/woff2"],
  ]);

  for (const [path, contentType] of expected) {
    const response = await handler(
      new Request(`https://discern.sh${path}`, { headers: BROWSER }),
    );
    assertEquals(response.status, 200, path);
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      contentType,
      path,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length > 0, `${path} is empty`);
  }
});
