/**
 * Third-party notices GENERATOR — derives the set of components embedded in
 * the compiled binary from the actual compile graph, and reproduces each
 * package's own LICENSE file verbatim.
 *
 * Why derivation instead of a hand-kept manifest: `deno compile` embeds the
 * graph's JSR modules at file granularity but npm dependencies at PACKAGE
 * granularity — an npm package's whole dependency closure ships even when only
 * one of its entry points is imported, because there is no tree-shaking inside
 * npm packages. A hand-reasoned "not reachable, so not embedded" judgment is
 * wrong the moment it disagrees with the resolver, and the failure modes are
 * asymmetric: crediting a package that is not embedded is harmless, while
 * omitting one that is embedded violates its license. So the graph decides
 * (ADR 0136).
 *
 * Inputs, all deterministic and offline once cached:
 *
 *  - `deno info --json src/main.ts` — the compile graph: the JSR module set
 *    plus the npm resolution snapshot with its dependency edges.
 *  - Each npm package's extracted store directory — its LICENSE file and the
 *    `license` field of its `package.json`.
 *  - `scripts/jsr_license_cache.json` — committed verbatim LICENSE texts for
 *    the JSR packages. JSR requires every package to publish a LICENSE, but the
 *    local module cache holds only code, so codegen fetches a missing text from
 *    jsr.io once and the refreshed cache is committed.
 *
 * `deno task codegen` writes the three artifacts in
 * {@link THIRD_PARTY_ARTIFACT_PATHS}; the drift guard
 * (`tests/third_party_notices_test.ts`) regenerates them offline and fails the
 * gate when a dependency change lands without refreshed notices.
 */

import { join } from "@std/path";
import type { ThirdPartyComponent } from "../lib/third_party_types.ts";

/** A component resolved to its verbatim license text. */
export interface ResolvedComponent extends ThirdPartyComponent {
  readonly licenseText: string;
}

/** The committed artifacts `deno task codegen` writes for the notices. */
export interface ThirdPartyArtifacts {
  /** The `THIRD_PARTY_NOTICES` document (also embedded in the binary). */
  readonly notices: string;
  /** The structured component list the `licenses` verb serves as `--json`. */
  readonly componentsJson: string;
  /** The committed JSR license-text cache. */
  readonly jsrLicenseCacheJson: string;
}

/** Repo-relative paths of the three generated artifacts. */
export const THIRD_PARTY_ARTIFACT_PATHS = {
  notices: "THIRD_PARTY_NOTICES",
  components: "src/lib/third_party_components.json",
  jsrLicenseCache: "scripts/jsr_license_cache.json",
} as const;

/**
 * Escape hatch for a package whose license cannot be resolved automatically —
 * no LICENSE file in its npm tarball, or no fetchable JSR LICENSE. Keyed
 * `name@version`. Empty today: generation fails loudly rather than shipping a
 * component uncredited, and an entry here is a deliberate, per-version
 * exception — never a second manifest.
 */
const LICENSE_OVERRIDES: Readonly<
  Record<string, { readonly license: string; readonly text: string }>
> = {};

// ── the compile graph ─────────────────────────────────────────────────────────

interface GraphModule {
  readonly kind?: string;
  readonly specifier?: string;
  readonly npmPackage?: string;
}

interface GraphNpmPackage {
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly string[];
  /** The package's extracted directory when a local node_modules exists. */
  readonly localPath?: string;
}

interface CompileGraph {
  readonly modules: readonly GraphModule[];
  readonly npmPackages: Readonly<Record<string, GraphNpmPackage>>;
}

/** A package identity; JSR names keep their scope (`@std/fs`). */
export interface PackageRef {
  readonly name: string;
  readonly version: string;
}

async function denoInfoJson(
  repoRoot: string,
  extraArgs: readonly string[],
): Promise<unknown> {
  const out = await new Deno.Command("deno", {
    args: ["info", "--json", ...extraArgs],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `\`deno info --json ${extraArgs.join(" ")}\` failed: ${
        new TextDecoder().decode(out.stderr)
      }`,
    );
  }
  return JSON.parse(new TextDecoder().decode(out.stdout));
}

/** The JSR packages in the graph, from their `https://jsr.io/…` specifiers. */
function jsrPackagesOf(graph: CompileGraph): PackageRef[] {
  const byKey = new Map<string, PackageRef>();
  for (const module of graph.modules) {
    const spec = module.specifier;
    if (spec === undefined || !spec.startsWith("https://jsr.io/")) continue;
    const [scope, name, version] = spec
      .slice("https://jsr.io/".length)
      .split("/");
    if (scope === undefined || name === undefined || version === undefined) {
      continue;
    }
    byKey.set(`${scope}/${name}@${version}`, {
      name: `${scope}/${name}`,
      version,
    });
  }
  return [...byKey.values()];
}

/**
 * The npm packages the binary embeds: the dependency closure of the graph's
 * npm roots, walked over the resolution snapshot at package granularity — the
 * same set `deno compile` materializes. Packages in the snapshot but outside
 * this closure (other workspace roots) are excluded.
 */
function npmClosureOf(graph: CompileGraph): (PackageRef & {
  readonly localPath?: string;
})[] {
  const pending = graph.modules
    .filter((m) => m.kind === "npm")
    .map((m) => m.npmPackage)
    .filter((key): key is string => key !== undefined);
  const seen = new Set<string>();
  const byIdentity = new Map<string, PackageRef & { localPath?: string }>();
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    const pkg = graph.npmPackages[key];
    if (pkg === undefined) {
      throw new Error(
        `npm package "${key}" is in the module graph but missing from the resolution snapshot`,
      );
    }
    pending.push(...pkg.dependencies);
    const identity = `${pkg.name}@${pkg.version}`;
    if (!byIdentity.has(identity)) {
      const entry: PackageRef & { localPath?: string } = {
        name: pkg.name,
        version: pkg.version,
      };
      if (pkg.localPath !== undefined) entry.localPath = pkg.localPath;
      byIdentity.set(identity, entry);
    }
  }
  return [...byIdentity.values()];
}

// ── license resolution ────────────────────────────────────────────────────────

/** LICENSE, LICENCE, or COPYING, bare or with an extension. */
const LICENSE_FILE_RE = /^(licen[cs]e|copying)([._-].*)?$/i;

async function findLicenseFile(dir: string): Promise<string | undefined> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && LICENSE_FILE_RE.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } catch {
    return undefined;
  }
  // Prefer the bare LICENSE spelling over variants, deterministically.
  names.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return names[0];
}

/** The `license` field of a package.json (string or legacy `{ type }`). */
async function declaredNpmLicense(dir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(
      await Deno.readTextFile(join(dir, "package.json")),
    ) as { license?: unknown };
    if (typeof pkg.license === "string") return pkg.license;
    if (
      typeof pkg.license === "object" && pkg.license !== null &&
      "type" in pkg.license && typeof pkg.license.type === "string"
    ) {
      return pkg.license.type;
    }
  } catch {
    // fall through — the caller decides how to handle an unknown license
  }
  return undefined;
}

function normalizeLicenseText(text: string): string {
  return text.replaceAll("\r\n", "\n").trimEnd();
}

/**
 * Classify a verbatim license text by its permission language, for the display
 * label only — the text itself always ships verbatim regardless.
 */
export function classifyLicenseText(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ");
  if (t.includes("Permission is hereby granted, free of charge")) return "MIT";
  if (
    t.includes("Permission to use, copy, modify, and/or distribute this")
  ) {
    return "ISC";
  }
  if (t.includes("Redistribution and use in source and binary forms")) {
    return t.includes("endorse or promote") ? "BSD-3-Clause" : "BSD-2-Clause";
  }
  if (t.includes("Apache License")) return "Apache-2.0";
  return undefined;
}

/** The global extracted-package store, for a package with no localPath. */
async function globalNpmStoreDir(repoRoot: string): Promise<string> {
  const info = await denoInfoJson(repoRoot, []) as {
    denoDir?: string;
    npmCache?: string;
  };
  const base = info.npmCache ??
    (info.denoDir === undefined ? undefined : join(info.denoDir, "npm"));
  if (base === undefined) {
    throw new Error(
      "could not locate the npm package store: `deno info --json` reported neither npmCache nor denoDir",
    );
  }
  return join(base, "registry.npmjs.org");
}

async function resolveNpmComponent(
  pkg: PackageRef & { readonly localPath?: string },
  storeDir: () => Promise<string>,
): Promise<ResolvedComponent> {
  const identity = `${pkg.name}@${pkg.version}`;
  const override = LICENSE_OVERRIDES[identity];
  if (override !== undefined) {
    return {
      name: pkg.name,
      version: pkg.version,
      registry: "npm",
      license: override.license,
      licenseText: normalizeLicenseText(override.text),
    };
  }
  const dir = pkg.localPath ??
    join(await storeDir(), pkg.name, pkg.version);
  const fileName = await findLicenseFile(dir);
  if (fileName === undefined) {
    throw new Error(
      `${identity} ships no LICENSE file (looked in ${dir}) — ` +
        "add a LICENSE_OVERRIDES entry in src/shared/third_party_codegen.ts with the license text from the project's repository",
    );
  }
  const text = normalizeLicenseText(
    await Deno.readTextFile(join(dir, fileName)),
  );
  const license = await declaredNpmLicense(dir) ?? classifyLicenseText(text);
  if (license === undefined) {
    throw new Error(
      `${identity} declares no license field and its ${fileName} is not a recognized license — ` +
        "add a LICENSE_OVERRIDES entry in src/shared/third_party_codegen.ts",
    );
  }
  return {
    name: pkg.name,
    version: pkg.version,
    registry: "npm",
    license,
    licenseText: text,
  };
}

async function resolveJsrComponent(
  pkg: PackageRef,
  cache: Readonly<Record<string, string>>,
  allowFetch: boolean,
): Promise<ResolvedComponent> {
  const identity = `${pkg.name}@${pkg.version}`;
  const override = LICENSE_OVERRIDES[identity];
  const cached = override?.text ?? cache[identity];
  let text: string;
  if (cached !== undefined) {
    text = normalizeLicenseText(cached);
  } else if (!allowFetch) {
    throw new Error(
      `${identity} has no entry in ${THIRD_PARTY_ARTIFACT_PATHS.jsrLicenseCache} — ` +
        "run `deno task codegen` (it fetches the LICENSE from jsr.io) and commit the refreshed artifacts",
    );
  } else {
    const url = `https://jsr.io/${pkg.name}/${pkg.version}/LICENSE`;
    const response = await fetch(url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `GET ${url} returned ${response.status} — ` +
          "add a LICENSE_OVERRIDES entry in src/shared/third_party_codegen.ts with the license text from the package's repository",
      );
    }
    text = normalizeLicenseText(await response.text());
  }
  return {
    name: pkg.name,
    version: pkg.version,
    registry: "jsr",
    license: override?.license ?? classifyLicenseText(text) ??
      "See license text",
    licenseText: text,
  };
}

// ── rendering ─────────────────────────────────────────────────────────────────

const RULE = "-".repeat(78);

const LICENSE_DISPLAY: Readonly<Record<string, string>> = {
  "MIT": "MIT License",
  "ISC": "ISC License",
  "BSD-2-Clause": "BSD 2-Clause License",
  "BSD-3-Clause": "BSD 3-Clause License",
  "Apache-2.0": "Apache License 2.0",
};

/**
 * Render the notices document: an intro, the Deno-runtime credit, then one
 * section per distinct verbatim license text, listing the components it covers
 * followed by the text itself (each package's own copyright lines live inside
 * its verbatim text). Deterministic — the same components always yield the
 * same bytes, so the output is diff-guarded.
 */
export function renderThirdPartyNotices(
  components: readonly ResolvedComponent[],
): string {
  const nameWidth = Math.max(...components.map((c) => c.name.length));
  const versionWidth = Math.max(...components.map((c) => c.version.length));

  const lines: string[] = [
    "discern - Third-Party Software Notices",
    "=".repeat(78),
    "",
    "The discern binary bundles the third-party, open-source components listed",
    "below: every package in the compile graph of src/main.ts, with npm",
    "dependencies at package granularity - the same resolution `deno compile`",
    "embeds. Each component's license text (including its copyright notices) is",
    "reproduced verbatim from the package's own LICENSE file, as those licenses",
    "require.",
    "",
    "This file is generated from the dependency graph by `deno task codegen`;",
    "`discern licenses` prints the same notices from any installed binary.",
    "",
    RULE,
    "The Deno runtime",
    RULE,
    "",
    "The binary is produced by `deno compile` and embeds the Deno runtime",
    "alongside the components below. Deno is Copyright 2018-2026 the Deno",
    "authors, licensed under the MIT License; its license and the notices for",
    "the components the runtime itself embeds are published at",
    "https://github.com/denoland/deno.",
    "",
  ];

  const byText = new Map<string, ResolvedComponent[]>();
  for (const component of components) {
    const group = byText.get(component.licenseText);
    if (group === undefined) byText.set(component.licenseText, [component]);
    else group.push(component);
  }
  const labelOf = (group: readonly ResolvedComponent[]): string => {
    const id = group[0]?.license ?? "";
    return LICENSE_DISPLAY[id] ?? id;
  };
  const groups = [...byText.values()];
  for (const group of groups) {
    group.sort((a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    );
  }
  groups.sort((a, b) =>
    labelOf(a).localeCompare(labelOf(b)) ||
    (a[0]?.name ?? "").localeCompare(b[0]?.name ?? "")
  );

  for (const group of groups) {
    const label = labelOf(group);
    lines.push(RULE, label, RULE, "");
    lines.push(
      group.length === 1
        ? `The following component is licensed under the ${label}, reproduced below:`
        : `The following components are licensed under the ${label}, reproduced below:`,
      "",
    );
    for (const c of group) {
      lines.push(
        `  ${c.name.padEnd(nameWidth)}  ${
          c.version.padEnd(versionWidth)
        }  ${c.registry}`,
      );
    }
    lines.push("", group[0]?.licenseText ?? "", "");
  }

  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n") + "\n";
}

// ── generation ────────────────────────────────────────────────────────────────

/** Options for {@link generateThirdPartyArtifacts}. */
export interface GenerateThirdPartyOptions {
  readonly repoRoot: string;
  /**
   * Whether a JSR license text missing from the committed cache may be fetched
   * from jsr.io. Codegen passes true; the drift guard passes false, so tests
   * stay offline and a new JSR dependency fails with a "run codegen" message.
   */
  readonly allowFetch: boolean;
}

/**
 * Derive the embedded-component set from the compile graph and produce the
 * three committed artifacts. The JSR cache is pruned to exactly the packages
 * the graph contains, so removed dependencies leave no stale texts behind.
 */
export async function generateThirdPartyArtifacts(
  options: GenerateThirdPartyOptions,
): Promise<ThirdPartyArtifacts> {
  const graph = await denoInfoJson(
    options.repoRoot,
    ["src/main.ts"],
  ) as CompileGraph;
  if (!Array.isArray(graph.modules) || graph.npmPackages === undefined) {
    throw new Error(
      "`deno info --json src/main.ts` returned no module graph — cannot derive the third-party notices",
    );
  }

  let cache: Record<string, string> = {};
  try {
    cache = JSON.parse(
      await Deno.readTextFile(
        join(options.repoRoot, THIRD_PARTY_ARTIFACT_PATHS.jsrLicenseCache),
      ),
    ) as Record<string, string>;
  } catch {
    // no cache yet — every JSR text resolves via fetch (or fails offline)
  }

  let store: Promise<string> | undefined;
  const storeDir = (): Promise<string> => {
    store ??= globalNpmStoreDir(options.repoRoot);
    return store;
  };

  const jsr = await Promise.all(
    jsrPackagesOf(graph).map((pkg) =>
      resolveJsrComponent(pkg, cache, options.allowFetch)
    ),
  );
  const npm = await Promise.all(
    npmClosureOf(graph).map((pkg) => resolveNpmComponent(pkg, storeDir)),
  );

  const components = [...jsr, ...npm].sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  );

  const freshCache: Record<string, string> = {};
  for (const c of jsr.toSorted((a, b) => a.name.localeCompare(b.name))) {
    freshCache[`${c.name}@${c.version}`] = c.licenseText;
  }

  const publicList: ThirdPartyComponent[] = components.map((c) => ({
    name: c.name,
    version: c.version,
    registry: c.registry,
    license: c.license,
  }));

  return {
    notices: renderThirdPartyNotices(components),
    componentsJson: JSON.stringify(publicList, null, 2) + "\n",
    jsrLicenseCacheJson: JSON.stringify(freshCache, null, 2) + "\n",
  };
}
