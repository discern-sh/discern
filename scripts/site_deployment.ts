/** Plan and stage a website revision against an immutable published product. */
import { z } from "@zod/zod";
import { join, resolve } from "@std/path";
import { compareVersions, parseVersion } from "../src/shared/semver.ts";
import { runReleaseCommand } from "./release_command.ts";
import {
  loadReleaseContext,
  publishedReleases,
} from "./release_publication.ts";
import { sitePublicationPlan } from "./release_site.ts";
import { withToolTempDir } from "./temp_dir.ts";
import type { Publication } from "../site/releases/model.ts";

/** Product-owned inputs stay at the released revision, including renderer helpers. */
export const SITE_PRODUCT_PATHS = [
  "src",
  "templates",
  "schema",
  "project/manual",
  "install.sh",
  "scripts/glossary_registry.ts",
  "scripts/build_targets.ts",
] as const;
const SHA = z.string().regex(/^[a-f0-9]{40}$/u);
const PackageSchema = z.object({ version: z.string() }).passthrough();

/** The default website documents the greatest published stable version. */
export function siteProductVersion(published: readonly Publication[]): string {
  const stable = published.filter((release) =>
    (parseVersion(release.version).prerelease?.length ?? 0) === 0
  ).toSorted((a, b) => compareVersions(b.version, a.version));
  const selected = stable[0];
  if (!selected) {
    throw new Error("Website deployment requires a published stable product.");
  }
  return selected.version;
}

/** Export only committed input into a fresh destination; never mutate a checkout. */
export async function stageSiteSnapshot(
  root: string,
  destination: string,
  source: string,
  product: string,
  publicationInput: string,
): Promise<void> {
  SHA.parse(source);
  SHA.parse(product);
  await Deno.mkdir(destination); // Existing destinations are refused, even if empty.
  await withToolTempDir("site-deployment", async (scratch) => {
    const archive = join(scratch, "snapshot.tar");
    await runReleaseCommand("git", [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      source,
    ], root);
    await runReleaseCommand("tar", ["-xf", archive, "-C", destination], root);
    for (const path of SITE_PRODUCT_PATHS) {
      try {
        await Deno.remove(join(destination, path), { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    await runReleaseCommand("git", [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      product,
      "--",
      ...SITE_PRODUCT_PATHS,
    ], root);
    await runReleaseCommand("tar", ["-xf", archive, "-C", destination], root);
    const released = PackageSchema.parse(
      JSON.parse(
        (await runReleaseCommand("git", ["show", `${product}:deno.json`], root))
          .stdout,
      ),
    );
    const configPath = join(destination, "deno.json");
    const config = PackageSchema.parse(
      JSON.parse(await Deno.readTextFile(configPath)),
    );
    config.version = released.version;
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );
    // The deploy collector honors Git ignore rules even outside a Git checkout.
    await Deno.writeTextFile(
      join(destination, ".gitignore"),
      "\n# Staged publication evidence belongs in this upload.\n!/site/release-publication.json\n",
      { append: true },
    );
    await Deno.writeTextFile(
      join(destination, "site/release-publication.json"),
      publicationInput,
    );
    await Deno.writeTextFile(
      join(destination, "site-deployment.json"),
      JSON.stringify({ source, product, version: released.version }, null, 2) +
        "\n",
    );
  });
}

/** Validate live publication and ancestry before exporting the deployment input. */
async function main(root: string = Deno.cwd()): Promise<void> {
  const [sourceInput, snapshot, destinationInput] = Deno.args;
  const source = SHA.parse(sourceInput);
  if (!snapshot || !destinationInput) {
    throw new Error(
      "usage: site_deployment.ts <source-sha> <releases-json> <new-destination>",
    );
  }
  if (
    (await runReleaseCommand("git", ["rev-parse", "HEAD"], root)).stdout
      .trim() !== source
  ) {
    throw new Error("Deployment source differs from the verified checkout.");
  }
  const observation = JSON.parse(await Deno.readTextFile(snapshot));
  const version = siteProductVersion(publishedReleases(observation));
  const context = await loadReleaseContext(snapshot, root, version);
  const plan = sitePublicationPlan(`v${version}`, context, version);
  const product = SHA.parse(
    (await runReleaseCommand("git", [
      "rev-parse",
      `refs/tags/v${version}^{commit}`,
    ], root)).stdout.trim(),
  );
  const pkg = PackageSchema.parse(
    JSON.parse(
      (await runReleaseCommand("git", ["show", `${product}:deno.json`], root))
        .stdout,
    ),
  );
  if (pkg.version !== version) {
    throw new Error("Published tag does not match its product version.");
  }
  await stageSiteSnapshot(
    root,
    resolve(destinationInput),
    source,
    product,
    plan.publicationInput,
  );
  console.log(
    `Website ${source} with published product v${version} at ${product}.`,
  );
}

if (import.meta.main) await main();
