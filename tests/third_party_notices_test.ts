/**
 * Third-party notices GUARD — the committed notices artifacts must stay tied to
 * the dependency reality the binary embeds, with no hand-maintained manifest in
 * between (ADR 0136).
 *
 * Three independent ties:
 *
 *  1. REGENERATION PARITY — the committed artifacts equal a fresh offline
 *     generation from the compile graph, so any dependency add/remove/bump that
 *     lands without `deno task codegen` fails the gate. `allowFetch: false`
 *     keeps the guard offline: a new JSR dependency whose license is not yet in
 *     the committed cache fails with a "run codegen" message rather than
 *     fetching.
 *  2. CLOSURE CLOSEDNESS — checked against `deno.lock`, not the generator: for
 *     every credited npm package, every dependency its lock entry declares is
 *     credited too. A generator regression that silently drops part of the
 *     embedded closure (the defect class that motivated ADR 0136) fails here
 *     even though regeneration would still be self-consistent.
 *  3. DIRECT-IMPORT COVERAGE — every jsr:/npm: package the import map serves to
 *     `src/` imports is credited, scanned from the source text independently of
 *     `deno info`.
 *
 * When a tie fails, the fix is `deno task codegen` (and committing the result)
 * — never weakening the assertion.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  generateThirdPartyArtifacts,
  THIRD_PARTY_ARTIFACT_PATHS,
} from "../src/shared/third_party_codegen.ts";
import type { ThirdPartyComponent } from "../src/lib/third_party_types.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));

async function committedComponents(): Promise<ThirdPartyComponent[]> {
  return JSON.parse(
    await Deno.readTextFile(
      join(repoRoot, THIRD_PARTY_ARTIFACT_PATHS.components),
    ),
  ) as ThirdPartyComponent[];
}

Deno.test("committed notices artifacts regenerate identically from the compile graph (run `deno task codegen`)", async () => {
  const fresh = await generateThirdPartyArtifacts({
    repoRoot,
    allowFetch: false,
  });
  const expected = [
    [THIRD_PARTY_ARTIFACT_PATHS.notices, fresh.notices],
    [THIRD_PARTY_ARTIFACT_PATHS.components, fresh.componentsJson],
    [THIRD_PARTY_ARTIFACT_PATHS.jsrLicenseCache, fresh.jsrLicenseCacheJson],
  ] as const;
  for (const [rel, artifact] of expected) {
    assertEquals(
      await Deno.readTextFile(join(repoRoot, rel)),
      artifact,
      `${rel} is stale — run \`deno task codegen\` and commit the result`,
    );
  }
});

/** `name@version` from a deno.lock npm key, dropping any `_peer` suffix. */
function parseLockKey(key: string): { name: string; version: string } {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  const name = key.slice(0, at);
  const version = key.slice(at + 1).split("_")[0] ?? "";
  return { name, version };
}

Deno.test("the credited npm set is closed under deno.lock dependency edges", async () => {
  const lock = JSON.parse(
    await Deno.readTextFile(join(repoRoot, "deno.lock")),
  ) as { npm?: Record<string, { dependencies?: string[] }> };
  const npmComponents = (await committedComponents())
    .filter((c) => c.registry === "npm");
  const credited = new Set(npmComponents.map((c) => `${c.name}@${c.version}`));
  const creditedNames = new Set(npmComponents.map((c) => c.name));
  assert(credited.size > 0, "no npm components credited — the walk is broken");

  const uncredited: string[] = [];
  for (const [key, entry] of Object.entries(lock.npm ?? {})) {
    const pkg = parseLockKey(key);
    if (!credited.has(`${pkg.name}@${pkg.version}`)) continue;
    for (const depKey of entry.dependencies ?? []) {
      // A dependency entry is a bare name, with `@version` appended only when
      // the lock resolves the name at more than one version.
      const versioned = depKey.includes("@", 1);
      const covered = versioned
        ? credited.has(
          `${parseLockKey(depKey).name}@${parseLockKey(depKey).version}`,
        )
        : creditedNames.has(depKey);
      if (!covered) {
        uncredited.push(`${depKey} (dependency of ${pkg.name})`);
      }
    }
  }
  assertEquals(
    uncredited,
    [],
    "npm packages the binary embeds (dependencies of credited packages) are " +
      "missing from the notices — `deno compile` embeds npm dependencies at " +
      "package granularity, so the whole closure must be credited: " +
      uncredited.join(", "),
  );
});

Deno.test("every jsr:/npm: package src/ imports through the import map is credited", async () => {
  const denoJson = JSON.parse(
    await Deno.readTextFile(join(repoRoot, "deno.json")),
  ) as { imports?: Record<string, string> };
  const importMap = denoJson.imports ?? {};

  /** The registry package name of a jsr:/npm: specifier, or undefined. */
  const packageOf = (spec: string): string | undefined => {
    const match = /^(?:jsr|npm):\/?(@[^/@]+\/[^/@]+|[^/@]+)/.exec(spec);
    return match?.[1];
  };
  /** Resolve a source-text import through the import map (exact or prefix). */
  const resolve = (spec: string): string => {
    const exact = importMap[spec];
    if (exact !== undefined) return exact;
    for (const [key, value] of Object.entries(importMap)) {
      if (key.endsWith("/") && spec.startsWith(key)) {
        return value + spec.slice(key.length);
      }
    }
    return spec;
  };

  const imported = new Set<string>();
  for await (const entry of walk(join(repoRoot, "src"))) {
    if (!entry.isFile || !entry.path.endsWith(".ts")) continue;
    const source = await Deno.readTextFile(entry.path);
    for (const match of source.matchAll(/from\s*["']([^"']+)["']/g)) {
      const spec = match[1];
      if (spec === undefined) continue;
      const pkg = packageOf(resolve(spec));
      if (pkg !== undefined) imported.add(pkg);
    }
  }
  assert(
    imported.size > 0,
    "no registry imports found under src/ — the scan is broken, not the manifest",
  );

  const credited = new Set((await committedComponents()).map((c) => c.name));
  for (const pkg of imported) {
    assert(
      credited.has(pkg),
      `src/ imports "${pkg}" but the notices do not credit it — run \`deno task codegen\``,
    );
  }
});
