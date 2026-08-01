/**
 * Third-party notices GUARD — the committed notices artifacts must stay tied to
 * the dependency reality the binary embeds, with no hand-maintained manifest in
 * between (ADR 0136).
 *
 * Three independent ties:
 *
 *  1. REGENERATION PARITY — textual artifacts equal a fresh offline generation,
 *     while the compressed bundle's canonical bytes equal it. Any dependency
 *     add/remove/bump that lands without `deno task codegen` fails the gate,
 *     but equivalent gzip streams do not drift by Deno version or host.
 *     `allowFetch: false` keeps the guard offline: a new JSR dependency whose
 *     license is not yet in the committed cache fails with a "run codegen"
 *     message rather than fetching.
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

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { gzipSync } from "zlib";
import {
  generateThirdPartyArtifacts,
  sameThirdPartyBundlePayload,
  THIRD_PARTY_ARTIFACT_PATHS,
  thirdPartyBundlePayload,
  VENDORED_WASM_COMPONENTS,
} from "../src/shared/third_party_codegen.ts";
import { licensesResult } from "../src/commands/licenses.ts";
import type { ThirdPartyComponent } from "../src/lib/third_party_types.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));

/** The component list the binary actually serves, via the embedded bundle. */
function committedComponents(): readonly ThirdPartyComponent[] {
  return licensesResult().data?.components ?? [];
}

/** A generated-module-shaped fixture with caller-controlled gzip encoding. */
function bundleModule(payload: string, level: number): string {
  const compressed = new Uint8Array(gzipSync(payload, { level }));
  return `// unrelated generated wrapper
export const THIRD_PARTY_BUNDLE_B64 =
  "${encodeBase64(compressed)}";
`;
}

Deno.test("bundle payload comparison ignores the gzip representation but rejects stale or invalid content", () => {
  const payload = JSON.stringify({
    notices: "repeatable notices ".repeat(200),
    components: [{ name: "renamed-fixture", version: "1", registry: "test" }],
  });
  const fast = bundleModule(payload, 1);
  const compact = bundleModule(payload, 9);
  assertNotEquals(
    fast,
    compact,
    "the future-sibling fixture must use genuinely different gzip bytes",
  );
  assert(
    sameThirdPartyBundlePayload(fast, compact),
    "equivalent canonical payloads must preserve the committed representation",
  );
  assertEquals(
    new TextDecoder().decode(thirdPartyBundlePayload(fast)),
    payload,
  );

  assert(
    !sameThirdPartyBundlePayload(
      fast,
      bundleModule(`${payload} stale`, 9),
    ),
    "a stale payload must trigger regeneration",
  );
  assert(
    !sameThirdPartyBundlePayload(
      fast,
      'export const THIRD_PARTY_BUNDLE_B64 = "not-gzip";\n',
    ),
    "an invalid compressed representation must trigger regeneration",
  );
});

Deno.test("committed notices artifacts regenerate identically from the compile graph (run `deno task codegen`)", async () => {
  const fresh = await generateThirdPartyArtifacts({
    repoRoot,
    allowFetch: false,
  });
  const expected = [
    [THIRD_PARTY_ARTIFACT_PATHS.notices, fresh.notices],
    [THIRD_PARTY_ARTIFACT_PATHS.bundle, fresh.bundleModule],
    [THIRD_PARTY_ARTIFACT_PATHS.jsrLicenseCache, fresh.jsrLicenseCacheJson],
  ] as const;
  for (const [rel, artifact] of expected) {
    const committed = await Deno.readTextFile(join(repoRoot, rel));
    if (rel === THIRD_PARTY_ARTIFACT_PATHS.bundle) {
      assertEquals(
        thirdPartyBundlePayload(committed),
        thirdPartyBundlePayload(artifact),
        `${rel}'s canonical payload is stale — run \`deno task codegen\` and commit the result`,
      );
    } else {
      assertEquals(
        committed,
        artifact,
        `${rel} is stale — run \`deno task codegen\` and commit the result`,
      );
    }
  }
});

Deno.test("the complete license report includes the committed third-party notices", async () => {
  const { runLicenses } = await import("../src/commands/licenses.ts");
  const printed: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    printed.push(args.map((a) => String(a)).join(" "));
  };
  try {
    runLicenses({ json: false, noColor: true });
  } finally {
    console.log = original;
  }
  const committed = await Deno.readTextFile(
    join(repoRoot, THIRD_PARTY_ARTIFACT_PATHS.notices),
  );
  assertStringIncludes(
    printed.join("\n"),
    committed.trimEnd(),
    "the bundled notices drifted from THIRD_PARTY_NOTICES — run `deno task codegen`",
  );
});

Deno.test("every vendored formatter WASM is registered and credited", async () => {
  const directory = join(repoRoot, "src/lib/tidy_plugins");
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".wasm")) {
      onDisk.push(`src/lib/tidy_plugins/${entry.name}`);
    }
  }
  assertEquals(
    onDisk.sort(),
    VENDORED_WASM_COMPONENTS.map((component) => component.path).toSorted(),
    "the vendored WASM directory and its notices registry have drifted",
  );

  const credited = committedComponents();
  for (const component of VENDORED_WASM_COMPONENTS) {
    assert(
      credited.some((candidate) =>
        candidate.name === component.name &&
        candidate.version === component.version &&
        candidate.registry === "vendored" &&
        candidate.license === "MIT"
      ),
      `${component.name}@${component.version} is not credited in the embedded notices`,
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
  const npmComponents = committedComponents()
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

  const credited = new Set(committedComponents().map((c) => c.name));
  for (const pkg of imported) {
    assert(
      credited.has(pkg),
      `src/ imports "${pkg}" but the notices do not credit it — run \`deno task codegen\``,
    );
  }
});
