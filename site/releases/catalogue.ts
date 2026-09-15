/** Build and load the publication projection; this module belongs only to the site. */
import { z } from "@zod/zod";
import { DISCERN_VERSION } from "../../src/lib/version.ts";
import { currentRelease, loadReleaseRecords } from "./records.ts";
import {
  type CatalogueRecord,
  catalogueRecordSchema,
  publicationSchema,
  releaseCatalogue,
} from "./model.ts";

/** Ephemeral CI input included in the uploaded source; never commit this file. */
export const PUBLICATION_INPUT = new URL(
  "../release-publication.json",
  import.meta.url,
);
export const CATALOGUE_OUTPUT = new URL(
  "../pages/release-catalogue.json",
  import.meta.url,
);

/** Missing publication evidence means a local candidate preview. Other failures refuse. */
export async function buildReleaseCatalogue(): Promise<CatalogueRecord[]> {
  let input: unknown = [];
  try {
    input = JSON.parse(await Deno.readTextFile(PUBLICATION_INPUT));
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
  const records = await loadReleaseRecords();
  currentRelease(records, DISCERN_VERSION);
  const catalogue = releaseCatalogue(
    records,
    z.array(publicationSchema).parse(input),
  );
  await Deno.mkdir(new URL("../pages/", import.meta.url), { recursive: true });
  await Deno.writeTextFile(
    CATALOGUE_OUTPUT,
    `${JSON.stringify(catalogue, null, 2)}\n`,
  );
  return catalogue;
}

/** Read only the site build's validated snapshot at runtime. */
export async function loadReleaseCatalogue(): Promise<CatalogueRecord[]> {
  return z.array(catalogueRecordSchema).parse(
    JSON.parse(await Deno.readTextFile(CATALOGUE_OUTPUT)),
  );
}
