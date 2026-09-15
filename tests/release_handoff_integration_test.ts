/** The offline handoff's actual URLs reach the production page and JSON comparison unchanged. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { releasesResult } from "../src/commands/releases.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { fire, HINTS } from "../src/shared/hints.ts";
import { loadReleaseCatalogue } from "../site/releases/catalogue.ts";
import { compareReleases, comparisonSchema } from "../site/releases/model.ts";
import { handler } from "../site/serve.ts";

Deno.test("release handoff composes with the production page, JSON, and shared update sequence", async () => {
  const handoff = await releasesResult(undefined, {
    mode: "json",
    stdinTty: true,
    stdoutTty: true,
    dryRun: false,
  }, {
    open: () => {
      throw new Error("an agent handoff cannot launch");
    },
    write: () => {
      throw new Error("outside-repository handoff cannot write");
    },
  });
  assert(handoff.ok && handoff.data);
  assertEquals(handoff.data.running_version, DISCERN_VERSION);
  assertEquals(handoff.data.network_request, false);
  const expected = compareReleases(
    await loadReleaseCatalogue(),
    DISCERN_VERSION,
  );
  const json = await handler(new Request(handoff.data.urls.json));
  assertEquals(json.status, 200);
  const comparison = comparisonSchema.parse(await json.json());
  assertEquals(comparison, expected);
  assertEquals(comparison.urls.html, handoff.data.urls.html);
  assertEquals(comparison.urls.json, handoff.data.urls.json);
  const html = await handler(new Request(handoff.data.urls.html));
  assertEquals(html.status, 200);
  const page = await html.text();
  assertStringIncludes(page, `data-release-status="${expected.status}"`);
  assertStringIncludes(page, DISCERN_VERSION);
  assertStringIncludes(
    fire(HINTS["release-check-sequence"]).text,
    "follow the release page's update steps",
  );
});
