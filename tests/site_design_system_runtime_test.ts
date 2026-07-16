/** Consumer checks for Discern's selected published design-system runtime. */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";
import { packageManifest, type RuntimeManifest } from "discern-design-system";
import { GENERATED_SITE_OUTPUTS } from "../site/build.ts";
import {
  DESIGN_SYSTEM_BUNDLES,
  designSystemAssetPath,
  type DesignSystemBundleName,
} from "../site/design_system.ts";
import { renderContentDesignDemo } from "../site/page-src/content-design-demo.tsx";
import { renderDesignSystemDemo } from "../site/page-src/design-system-demo.tsx";
import { formatGeneratedText } from "../site/page-src/format-generated.ts";
import { handler } from "../site/serve.ts";
import { runtimeAssetReferences } from "./runtime_asset_references.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SITE_ROOT = join(ROOT, "site");
const DESIGN_SYSTEM_SPECIFIER = "jsr:@discern-sh/design-system@0.1.1";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

interface DenoConfig {
  readonly workspace?: readonly string[];
  readonly imports: Readonly<Record<string, string>>;
  readonly minimumDependencyAge?: {
    readonly age: string;
    readonly exclude: readonly string[];
  };
}

interface DenoLock {
  readonly specifiers: Readonly<Record<string, string>>;
  readonly jsr: Readonly<Record<string, unknown>>;
}

async function git(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function bundleRoot(name: DesignSystemBundleName): string {
  return join(ROOT, "site", DESIGN_SYSTEM_BUNDLES[name].output);
}

async function bundleManifest(
  name: DesignSystemBundleName,
): Promise<RuntimeManifest> {
  return JSON.parse(
    await Deno.readTextFile(join(bundleRoot(name), "manifest.json")),
  ) as RuntimeManifest;
}

function resolvedSelection(name: DesignSystemBundleName): string[] {
  const selection = DESIGN_SYSTEM_BUNDLES[name];
  const selected = new Set<string>(selection.components);
  const selectedGroups = new Set<string>(selection.groups);
  for (const component of packageManifest.components) {
    if (selectedGroups.has(component.group)) selected.add(component.id);
  }
  const visit = (id: string): void => {
    const component = packageManifest.components.find((entry) =>
      entry.id === id
    );
    assert(component !== undefined, `${name} selects unknown component ${id}`);
    for (const dependency of component.dependencies) {
      if (selected.has(dependency)) continue;
      selected.add(dependency);
      visit(dependency);
    }
  };
  for (const id of [...selected]) visit(id);
  return packageManifest.components
    .filter((component) => selected.has(component.id))
    .map((component) => component.id);
}

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

Deno.test("Discern pins one exact public design-system dependency", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as DenoConfig;
  assertEquals(config.workspace, undefined);
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

  const lock = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  ) as DenoLock;
  assertEquals(lock.specifiers[DESIGN_SYSTEM_SPECIFIER], "0.1.1");
  assert("@discern-sh/design-system@0.1.1" in lock.jsr);

  const sourceFiles = (await walk(SITE_ROOT)).filter((path) =>
    /\.[cm]?[jt]sx?$/.test(path) && !path.includes("/site/design-system/")
  );
  const forbidden = [
    "site/design-system",
    "jsr:@discern-sh/design-system",
    "jsr.io/@discern-sh/design-system",
    "/.deno/",
    "/design-system/dist/",
  ];
  const violations: string[] = [];
  for (const path of sourceFiles) {
    const source = await Deno.readTextFile(path);
    for (const pattern of forbidden) {
      if (source.includes(pattern)) {
        violations.push(`${relative(ROOT, path)}: ${pattern}`);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("each emitted bundle is the dependency closure of the site selection", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const expected = DESIGN_SYSTEM_BUNDLES[name];
    const runtime = await bundleManifest(name);
    const resolved = resolvedSelection(name);
    assertEquals(runtime.package, packageManifest.package);
    assertEquals(runtime.groups, packageManifest.groups);
    assertEquals(
      runtime.components,
      packageManifest.components.filter((component) =>
        resolved.includes(component.id)
      ),
    );
    assertEquals(runtime.publicTokenNames, packageManifest.publicTokenNames);
    assertEquals(runtime.selection.all, false);
    assertEquals(runtime.selection.requestedComponents, expected.components);
    assertEquals(runtime.selection.requestedGroups, expected.groups);
    assertEquals(runtime.selection.resolvedComponents, resolved);
    assertEquals(runtime.selection.assets, expected.assets);
    assertEquals(runtime.selection.theme, expected.theme);
  }
});

Deno.test("the docs bundle excludes unrelated compositions and optional grain", async () => {
  const runtime = await bundleManifest("docs");
  const selected = new Set(runtime.selection.resolvedComponents);
  const unrelated = packageManifest.components.filter((component) =>
    component.group === "Marketing" || component.group === "Editorial"
  );
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

Deno.test("the retained compositions cover their package-manifest groups", async () => {
  const pages = new Map([
    [
      "Marketing",
      await Deno.readTextFile(join(ROOT, "site/pages/design-system-demo.html")),
    ],
    [
      "Editorial",
      await Deno.readTextFile(
        join(ROOT, "site/pages/content-design-demo.html"),
      ),
    ],
  ]);
  for (const [group, html] of pages) {
    const identity = packageManifest.groups.find((entry) =>
      entry.name === group
    );
    assert(identity !== undefined);
    for (const id of identity.components) {
      assertMatch(
        html,
        new RegExp(`class="[^"]*\\bdiscern-${id}\\b`),
        `${group} composition does not render ${id}`,
      );
    }
  }
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

  const runtime = await bundleManifest("compositions");
  const stats = {
    components: runtime.components.length,
    tokens: runtime.publicTokenNames.length,
  };
  assertEquals(
    await Deno.readTextFile(join(ROOT, "site/pages/design-system-demo.html")),
    await formatGeneratedText(renderDesignSystemDemo(stats), "html"),
  );
  assertEquals(
    await Deno.readTextFile(join(ROOT, "site/pages/content-design-demo.html")),
    await formatGeneratedText(renderContentDesignDemo(stats), "html"),
  );

  for (
    const [source, output] of [
      ["design-system-demo.css", "demo.css"],
      ["content-design-demo.css", "content-demo.css"],
      ["design-system-demo.js", "demo.js"],
    ] as const
  ) {
    assertEquals(
      await Deno.readTextFile(join(bundleRoot("compositions"), output)),
      `/* Generated by site/build.ts from site/page-src/${source}. Do not edit. */\n${await Deno
        .readTextFile(join(ROOT, "site/page-src", source))}`,
    );
  }
});

Deno.test("consumer CSS never targets a package-manifest-owned class", async () => {
  const owned = new Set(
    packageManifest.components.flatMap((component) => component.ownedClasses),
  );
  assert(owned.size > 0);
  const violations: string[] = [];
  for (const path of await walk(SITE_ROOT)) {
    const repoPath = relative(ROOT, path);
    if (
      !path.endsWith(".css") ||
      repoPath.startsWith("site/design-system/") ||
      repoPath.startsWith("site/pages/assets/design-system/")
    ) continue;
    for (
      const selector of componentOwnedSelectors(
        await Deno.readTextFile(path),
        owned,
      )
    ) {
      violations.push(`${repoPath}: ${selector}`);
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
