/** Stage publication evidence only after the current GitHub assets exist. */
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { PUBLICATION_INPUT } from "../site/releases/catalogue.ts";
import { compareReleases, releaseCatalogue } from "../site/releases/model.ts";
import {
  loadReleaseContext,
  type ReleaseContext,
} from "./release_publication.ts";
import { releasePlan } from "./release_plan.ts";

/** Validate the complete publication snapshot before the executor writes deployment input. */
export function sitePublicationPlan(
  tag: string,
  context: ReleaseContext,
  version: string = DISCERN_VERSION,
): { publicationInput: string } {
  releasePlan(tag, { ...context, version, repositoryPrivate: false });
  if (!context.published.some((release) => release.version === version)) {
    throw new Error(
      `${tag}: current release assets are not published; do not deploy the catalogue`,
    );
  }
  const model = compareReleases(
    releaseCatalogue(context.records, context.published),
  );
  if (model.history.candidates.some((record) => record.version === version)) {
    throw new Error(
      `${tag}: current release is missing from the site publication model`,
    );
  }
  return {
    publicationInput: `${JSON.stringify(context.published, null, 2)}\n`,
  };
}

/** Apply only the already-validated snapshot; the owner site build derives its catalogue. */
async function main(): Promise<void> {
  const [tag, snapshot] = Deno.args;
  if (tag === undefined || snapshot === undefined) {
    throw new Error("usage: release_site.ts <tag> <github-releases-json>");
  }
  const plan = sitePublicationPlan(tag, await loadReleaseContext(snapshot));
  await Deno.writeTextFile(PUBLICATION_INPUT, plan.publicationInput);
}

if (import.meta.main) await main();
