/** Consumer checks for Discern's selected design-system runtime. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  packageManifest,
  RUNTIME_MANIFEST_SCHEMA_VERSION,
} from "discern-design-system";
import { z } from "@zod/zod";
import {
  COPIED_PAGE_ASSETS,
  GENERATED_SITE_OUTPUTS,
  RETIRED_SITE_OUTPUTS,
} from "../site/build.ts";
import {
  DESIGN_SYSTEM_BUNDLES,
  designSystemAssetPath,
  type DesignSystemBundleName,
} from "../site/design_system.ts";
import { SITE_APPEARANCE } from "../site/appearance.ts";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { formatGeneratedText } from "../site/page-src/format-generated.ts";
import { renderMarketingPage } from "../site/renderers.ts";
import { handler } from "../site/serve.ts";
import { runtimeAssetReferences } from "./runtime_asset_references.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { decodeWith } from "./decode_cli_result.ts";

import {
  DESIGN_SYSTEM_ORIGIN,
  DESIGN_SYSTEM_PACKAGE,
  DESIGN_SYSTEM_SPECIFIER,
  DESIGN_SYSTEM_VERSION,
  reactRuntimeModules,
} from "./design_system_dependency.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

interface DenoConfig {
  readonly links?: readonly string[] | undefined;
  readonly workspace?: readonly string[] | undefined;
  readonly imports: Readonly<Record<string, string>>;
  readonly minimumDependencyAge?: {
    readonly age: string;
    readonly exclude: readonly string[];
  } | undefined;
}

/** Report committed dependency containers that can replace registry packages locally. */
function committedLocalOverrideViolations(config: DenoConfig): string[] {
  return [
    ...(config.workspace === undefined ? [] : ["workspace"]),
    ...(config.links === undefined ? [] : ["links"]),
  ];
}

const DENO_CONFIG_SCHEMA = z.object({
  links: z.array(z.string()).optional(),
  workspace: z.array(z.string()).optional(),
  imports: z.record(z.string(), z.string()),
  minimumDependencyAge: z.object({
    age: z.string(),
    exclude: z.array(z.string()),
  }).optional(),
}).passthrough();

const DENO_LOCK_SCHEMA = z.object({
  specifiers: z.record(z.string(), z.string()),
  jsr: z.record(z.string(), z.json()),
  workspace: z.object({ links: z.record(z.string(), z.json()).optional() }),
}).passthrough();

const DENO_INFO_SCHEMA = z.object({
  modules: z.array(
    z.object({
      specifier: z.string().optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

const RUNTIME_MANIFEST_SCHEMA = z.object({
  schemaVersion: z.literal(RUNTIME_MANIFEST_SCHEMA_VERSION),
  package: z.string(),
  selection: z.object({
    all: z.boolean(),
    requestedComponents: z.array(z.string()),
    requestedGroups: z.array(z.string()),
    resolvedComponents: z.array(z.string()),
    assets: z.array(z.string()),
    appearanceScopes: z.boolean(),
  }),
  groups: z.array(z.object({
    name: z.string(),
    components: z.array(z.string()),
  })),
  components: z.array(z.object({
    id: z.string(),
    name: z.string(),
    group: z.string(),
    dependencies: z.array(z.string()),
    behaviors: z.array(z.string()),
    ownedClasses: z.array(z.string()),
    publicTokenNames: z.array(z.string()),
  })),
  publicTokenNames: z.array(z.string()),
  outputs: z.object({
    scripts: z.array(z.string()),
    assets: z.array(z.string()),
  }).passthrough(),
  integrity: z.object({
    files: z.array(
      z.object({
        path: z.string(),
        mediaType: z.string(),
        bytes: z.number(),
      }).passthrough(),
    ),
  }).passthrough(),
}).passthrough();

/** Read Deno's resolved module graph for one site entrypoint. */
async function moduleSpecifiers(entrypoint: string): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  const info = decodeWith(
    DENO_INFO_SCHEMA,
    new TextDecoder().decode(output.stdout),
  );
  return (info.modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
  );
}

/** Run a repository-scoped Git probe with captured output for design-system provenance checks. */
async function git(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

/** Resolve one declared design-system bundle's generated output directory. */
function bundleRoot(name: DesignSystemBundleName): string {
  return join(ROOT, "site", DESIGN_SYSTEM_BUNDLES[name].output);
}

/** Decode the runtime manifest emitted beside a selected design-system bundle. */
async function bundleManifest(
  name: DesignSystemBundleName,
): Promise<z.output<typeof RUNTIME_MANIFEST_SCHEMA>> {
  return decodeWith(
    RUNTIME_MANIFEST_SCHEMA,
    await Deno.readTextFile(join(bundleRoot(name), "manifest.json")),
  );
}

/** Expand configured component groups and transitive dependencies in canonical manifest order. */
function resolvedSelection(name: DesignSystemBundleName): string[] {
  const selection = DESIGN_SYSTEM_BUNDLES[name];
  const seeds = new Set<string>(selection.components);
  const selectedGroups = new Set<string>(selection.groups);
  for (const component of packageManifest.components) {
    if (selectedGroups.has(component.group)) seeds.add(component.id);
  }
  const canonicalIds = (ids: Iterable<string>): string[] => {
    const selected = new Set(ids);
    return packageManifest.components
      .filter((component) => selected.has(component.id))
      .map((component) => component.id);
  };
  const resolved: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const component = packageManifest.components.find((entry) =>
      entry.id === id
    );
    assert(component !== undefined, `${name} selects unknown component ${id}`);
    for (const dependency of canonicalIds(component.dependencies)) {
      visit(dependency);
    }
    visited.add(id);
    resolved.push(id);
  };
  for (const id of canonicalIds(seeds)) visit(id);
  return resolved;
}

/** Collect CSS rule preludes that mention classes owned by selected components. */
function componentOwnedSelectors(
  source: string,
  ownedClasses: ReadonlySet<string>,
): string[] {
  const selectors = new Set<string>();
  for (const rule of source.matchAll(/([^{}]+)\{/g)) {
    const prelude = (rule[1] ?? "").trim();
    for (const match of prelude.matchAll(/\.([_a-zA-Z0-9-]+)/g)) {
      if (ownedClasses.has(match[1] ?? "")) selectors.add(prelude);
    }
  }
  return [...selectors].toSorted();
}

Deno.test("committed dependency containers cannot replace the immutable package", () => {
  for (const key of ["links", "workspace"] as const) {
    for (const paths of [[], ["../future-component-system"]]) {
      assertEquals(
        committedLocalOverrideViolations({ imports: {}, [key]: paths }),
        [key],
      );
    }
  }
  assertEquals(committedLocalOverrideViolations({ imports: {} }), []);
});

Deno.test("Discern binds one exact immutable design-system release", async () => {
  const config = decodeWith(
    DENO_CONFIG_SCHEMA,
    await Deno.readTextFile(join(ROOT, "deno.json")),
  );
  assertEquals(committedLocalOverrideViolations(config), []);
  assertEquals(config.links, undefined);
  assertEquals(
    Object.entries(config.imports).filter(([key, value]) =>
      key.includes("design-system") || value.includes("design-system")
    ),
    [["discern-design-system", DESIGN_SYSTEM_SPECIFIER]],
  );
  assertEquals(config.minimumDependencyAge, {
    age: "P1D",
    exclude: ["jsr:@discern-sh/design-system"],
  });

  const lock = decodeWith(
    DENO_LOCK_SCHEMA,
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  );
  assertEquals(lock.specifiers[DESIGN_SYSTEM_SPECIFIER], DESIGN_SYSTEM_VERSION);
  assertEquals(lock.workspace.links, undefined);
  assert(DESIGN_SYSTEM_PACKAGE in lock.jsr);
  const packageModules = (await moduleSpecifiers(join(ROOT, "site/main.ts")))
    .filter((specifier) =>
      specifier.startsWith("https://jsr.io/@discern-sh/design-system/")
    );
  assert(packageModules.length > 0);
  assertEquals(
    packageModules.filter((specifier) =>
      !specifier.startsWith(DESIGN_SYSTEM_ORIGIN)
    ),
    [],
  );

  const sourceFiles = await structuralGuardScope({
    guard:
      "tests/site_design_system_runtime_test.ts#design-system-import-provenance",
    universe: "authored-deno",
    narrow: {
      reason:
        "Design-system import provenance governs authored site runtime modules.",
      include: (rel) => rel.startsWith("site/"),
    },
  });
  const forbidden = [
    "site/design-system",
    "jsr:@discern-sh/design-system",
    "jsr.io/@discern-sh/design-system",
    "/.deno/",
    "/design-system/dist/",
  ];
  const violations: string[] = [];
  for (const rel of sourceFiles) {
    const source = await Deno.readTextFile(join(ROOT, rel));
    for (const pattern of forbidden) {
      if (source.includes(pattern)) {
        violations.push(`${rel}: ${pattern}`);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("the production server renders React without importing its browser entrypoint", async () => {
  const modules = await moduleSpecifiers(join(ROOT, "site/main.ts"));
  assert(reactRuntimeModules(modules).length > 0);
  assertEquals(
    reactRuntimeModules(modules).filter((specifier) =>
      /react-dom[^\s]*\/client(?:[.@/]|$)/.test(specifier)
    ),
    [],
  );
});

Deno.test("each emitted bundle is the dependency closure of the site selection", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const expected = DESIGN_SYSTEM_BUNDLES[name];
    const runtime = await bundleManifest(name);
    const resolved = resolvedSelection(name);
    assertEquals(runtime.schemaVersion, packageManifest.schemaVersion);
    assertEquals(runtime.package, packageManifest.package);
    assertEquals(
      runtime.groups,
      packageManifest.groups.map((group) => ({
        name: group.name,
        components: [...group.components],
      })),
    );
    assertEquals(
      runtime.components,
      resolved.map((id) => {
        const component = packageManifest.components.find((entry) =>
          entry.id === id
        );
        assert(
          component !== undefined,
          `${name} resolved unknown component ${id}`,
        );
        return {
          id: component.id,
          name: component.name,
          group: component.group,
          dependencies: [...component.dependencies],
          behaviors: [...component.behaviors],
          ownedClasses: [...component.ownedClasses],
          publicTokenNames: [...component.publicTokenNames],
        };
      }),
    );
    assertEquals(runtime.publicTokenNames, packageManifest.publicTokenNames);
    assertEquals(runtime.selection.all, false);
    // Requested membership is independent of the emitter's component order.
    assertEquals(
      runtime.selection.requestedComponents.toSorted(),
      [...expected.components].toSorted(),
    );
    assertEquals(runtime.selection.requestedGroups, [...expected.groups]);
    assertEquals(runtime.selection.resolvedComponents, resolved);
    assertEquals(runtime.selection.assets, [...expected.assets]);
    assertEquals(
      runtime.selection.appearanceScopes,
      SITE_APPEARANCE.appearanceScopes,
    );
  }
});

Deno.test("the docs bundle excludes unrelated compositions and optional grain", async () => {
  const runtime = await bundleManifest("docs");
  const selected = new Set(runtime.selection.resolvedComponents);
  // The docs chrome legitimately selects the Editorial table of contents;
  // every OTHER Marketing/Editorial composition must stay out of the bundle.
  const requested = new Set(resolvedSelection("docs"));
  const unrelated = packageManifest.components.filter((component) =>
    (component.group === "Marketing" || component.group === "Editorial") &&
    !requested.has(component.id)
  );
  assert(unrelated.length > 0, "the exclusion set must stay non-empty");
  assert(unrelated.every((component) => !selected.has(component.id)));
  const css = await Deno.readTextFile(join(bundleRoot("docs"), "discern.css"));
  for (const component of unrelated) {
    for (const ownedClass of component.ownedClasses) {
      assert(
        !css.includes(`.${ownedClass}`),
        `docs CSS contains ${ownedClass}`,
      );
    }
  }
  assertEquals(runtime.selection.assets, ["fonts"]);
  assertEquals(
    await Array.fromAsync(Deno.readDir(bundleRoot("docs"))).then((entries) =>
      entries.some((entry) => entry.name === "grain.css")
    ),
    false,
  );
});

Deno.test("the docs bundle emits the glossary term and its hover-card dependency", async () => {
  const runtime = await bundleManifest("docs");
  assert(runtime.selection.resolvedComponents.includes("table"));
  assert(runtime.selection.resolvedComponents.includes("glossary-term"));
  assert(runtime.selection.resolvedComponents.includes("hover-card"));
  assertEquals(runtime.outputs.scripts, ["discern.js"]);
  const css = await Deno.readTextFile(join(bundleRoot("docs"), "discern.css"));
  assertStringIncludes(css, ".discern-table table");
  assertStringIncludes(css, ".discern-glossary-term");
  assertStringIncludes(css, ".discern-hover-card");
  assertStringIncludes(css, ".discern-dotted-underline");
});

Deno.test("generated output is ignored and reproducible from its selections", async () => {
  const repoPaths = GENERATED_SITE_OUTPUTS.map((output) =>
    join("site", output)
  );
  const tracked = await git(["ls-files", "--", ...repoPaths]);
  assertEquals(tracked.code, 0);
  assertEquals(new TextDecoder().decode(tracked.stdout).trim(), "");
  for (const path of repoPaths) {
    const ignored = await git(["check-ignore", "--quiet", "--no-index", path]);
    assertEquals(ignored.code, 0, `${path} must be ignored`);
  }

  for (const page of MARKETING_PAGES) {
    assertEquals(
      await Deno.readTextFile(join(ROOT, "site", page.page)),
      await formatGeneratedText(renderMarketingPage(page.route), "html"),
    );
  }
  for (const asset of COPIED_PAGE_ASSETS) {
    assertEquals(
      await Deno.readTextFile(join(bundleRoot("compositions"), asset)),
      `/* Generated by site/build.ts from site/page-src/${asset}. Do not edit. */\n${await Deno
        .readTextFile(join(ROOT, "site/page-src", asset))}`,
    );
  }

  for (const output of RETIRED_SITE_OUTPUTS) {
    await assertRejects(
      () => Deno.stat(join(ROOT, "site", output)),
      Deno.errors.NotFound,
      output,
    );
  }
});

Deno.test("consumer CSS never targets a package-manifest-owned class", async () => {
  const owned = new Set(
    packageManifest.components.flatMap((component) => component.ownedClasses),
  );
  assert(owned.size > 0);
  const violations: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/site_design_system_runtime_test.ts#owned-css-selectors",
    universe: "authored-text",
    narrow: {
      reason:
        "Package-owned selector isolation governs authored consumer CSS outside emitted bundles.",
      include: (rel) =>
        rel.startsWith("site/") && rel.endsWith(".css") &&
        !rel.startsWith("site/pages/assets/design-system/"),
    },
  });
  for (const rel of files) {
    for (
      const selector of componentOwnedSelectors(
        await Deno.readTextFile(join(ROOT, rel)),
        owned,
      )
    ) {
      violations.push(`${rel}: ${selector}`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("bundle routes use local static assets and ship no React runtime", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    for (const route of DESIGN_SYSTEM_BUNDLES[name].routes) {
      const response = await handler(
        new Request(`https://discern.sh${route}`, { headers: BROWSER }),
      );
      assertEquals(response.status, 200, route);
      const html = await response.text();
      assertStringIncludes(html, "data-discern-root");
      const runtimeRefs = runtimeAssetReferences(html);
      assert(runtimeRefs.length > 0, `${route} has no runtime assets`);
      const runtime = await bundleManifest(name);
      for (const script of runtime.outputs.scripts) {
        const expected = designSystemAssetPath(name, script);
        assert(
          runtimeRefs.includes(expected),
          `${route} omits emitted package script ${expected}`,
        );
      }
      assert(
        runtimeRefs.every((value) => value.startsWith("/")),
        `${route} remote runtime references: ${runtimeRefs.join(", ")}`,
      );
      const bundlePrefix = designSystemAssetPath(name, "");
      assert(
        runtimeRefs.filter((value) => value.includes("/design-system/"))
          .every((value) => value.startsWith(bundlePrefix)),
        `${route} uses the wrong bundle: ${runtimeRefs.join(", ")}`,
      );
      assertEquals(
        runtimeRefs.filter((value) => /(?:react|jsx-runtime)/i.test(value)),
        [],
      );
    }
  }
});

Deno.test("every bundle selects the canonical brand lockup", () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    assert(
      DESIGN_SYSTEM_BUNDLES[name].components.includes("brand"),
      `${name} must select the brand component`,
    );
  }
});

Deno.test("every emitted package asset is local, licensed, and served by type", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const runtime = await bundleManifest(name);
    const integrity = new Map(
      runtime.integrity.files.map((file) => [file.path, file]),
    );
    for (const file of runtime.integrity.files) {
      const path = designSystemAssetPath(name, file.path);
      const response = await handler(
        new Request(`https://discern.sh${path}`, { headers: BROWSER }),
      );
      assertEquals(response.status, 200, path);
      assertStringIncludes(
        response.headers.get("content-type") ?? "",
        file.mediaType,
        path,
      );
      assertEquals((await response.arrayBuffer()).byteLength, file.bytes, path);
    }

    const fontOutputs = runtime.outputs.assets.filter((path) =>
      path.startsWith("fonts/") || path.startsWith("licenses/") ||
      path === "fonts.css"
    );
    const grainOutputs = runtime.outputs.assets.filter((path) =>
      path.startsWith("textures/") || path === "grain.css"
    );
    assertEquals(
      fontOutputs.length > 0,
      runtime.selection.assets.includes("fonts"),
    );
    assertEquals(
      grainOutputs.length > 0,
      runtime.selection.assets.includes("grain"),
    );
    for (const path of runtime.outputs.assets) {
      assert(integrity.has(path), `${name} asset lacks integrity: ${path}`);
    }
    for (
      const licence of fontOutputs.filter((path) =>
        path.startsWith("licenses/")
      )
    ) {
      const body = await Deno.readTextFile(join(bundleRoot(name), licence));
      assertStringIncludes(body, "SIL OPEN FONT LICENSE");
    }
  }
});
