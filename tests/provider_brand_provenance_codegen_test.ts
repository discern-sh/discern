/** Provider-logo provenance stays a generated projection of the live registry. */

import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import {
  PROVIDER_BRAND_PROVENANCE_REL,
  renderProviderBrandProvenance,
} from "../scripts/provider_brand_provenance.ts";
import {
  PROVIDER_BRAND_ASSET_ROOT,
  PROVIDER_TRADEMARK_NOTICE,
  providerBrandSilhouette,
  PROVIDERS,
} from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

Deno.test("provider logo provenance is complete and current", async () => {
  const registered = new Set<string>();
  for (const name of AGENT_NAMES) {
    const brand = PROVIDERS[name].brand;
    assertMatch(brand.retrievedOn, /^\d{4}-\d{2}-\d{2}$/u);
    for (
      const value of [
        brand.sourceUrl,
        brand.assetSourceUrl,
        brand.brandRulesUrl,
      ]
    ) {
      assertMatch(value, /^https:\/\//u);
    }
    for (
      const asset of [
        brand.mark,
        providerBrandSilhouette(brand),
        brand.wordmark,
      ]
    ) {
      registered.add(asset.path);
    }
  }

  const assetPrefix = `site/pages${PROVIDER_BRAND_ASSET_ROOT}/`;
  const onDisk = new Set(
    (await structuralGuardScope({
      guard:
        "tests/provider_brand_provenance_codegen_test.ts#provider-brand-assets",
      universe: {
        kind: "specialized",
        name: "tracked SVG assets",
        reason:
          "Provider-brand provenance covers SVG files, which are outside the canonical source universes.",
        extensions: [".svg"],
      },
      narrow: {
        reason:
          "Only SVGs in the public integration asset directory belong to the provider-brand registry.",
        include: (rel) => rel.startsWith(assetPrefix),
      },
    })).map((rel) => rel.slice("site/pages".length)),
  );
  assertEquals([...registered].sort(), [...onDisk].sort());

  const path = join(REPO_ROOT, PROVIDER_BRAND_PROVENANCE_REL);
  const expected = await canonicalGeneratedMarkdown(
    path,
    renderProviderBrandProvenance(),
  );
  assertEquals(
    await Deno.readTextFile(path),
    expected,
  );
  assertEquals(expected.includes(PROVIDER_TRADEMARK_NOTICE), true);
});
