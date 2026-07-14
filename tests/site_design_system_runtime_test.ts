/** Browser-facing checks for the built design-system demo artifact. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runtimeAssetReferences } from "../site/design-system/tests/runtime_references.ts";
import { handler } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

Deno.test("the design-system demo routes serve generated static editions", async () => {
  for (
    const [route, marker] of [
      [
        "/design-system-demo",
        "typed React at build time · static HTML at runtime",
      ],
      ["/content-design-demo", "editorial engineering · static by design"],
    ] as const
  ) {
    const response = await handler(
      new Request(`https://discern.sh${route}`, { headers: BROWSER }),
    );
    assertEquals(response.status, 200);
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      "text/html",
    );
    const html = await response.text();
    assertStringIncludes(html, "data-ds-root");
    assertStringIncludes(html, marker);

    const runtimeRefs = runtimeAssetReferences(html);
    assert(
      runtimeRefs.every((value) => value.startsWith("/")),
      `${route} remote runtime references: ${runtimeRefs.join(", ")}`,
    );
    assertEquals(
      runtimeRefs.filter((value) => value.endsWith(".js")),
      ["/assets/design-system/demo.js"],
    );
  }
});

Deno.test("every referenced design-system asset is served with its browser type", async () => {
  const expected = new Map([
    ["/assets/design-system/discern.css", "text/css"],
    ["/assets/design-system/demo.css", "text/css"],
    ["/assets/design-system/content-demo.css", "text/css"],
    ["/assets/design-system/fonts.css", "text/css"],
    ["/assets/design-system/demo.js", "text/javascript"],
    ["/assets/design-system/manifest.json", "application/json"],
    ["/assets/design-system/textures/grain.png", "image/png"],
    ["/assets/design-system/fonts/crimson-pro-roman.woff2", "font/woff2"],
    ["/assets/design-system/fonts/crimson-pro-italic.woff2", "font/woff2"],
    ["/assets/design-system/fonts/inter.woff2", "font/woff2"],
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
