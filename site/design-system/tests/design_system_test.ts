/**
 * The design-system demo's permanent boundary: authored sources generate the
 * ignored static artifact deterministically, component additions auto-enrol,
 * and the browser-facing page remains local-asset-only with no React runtime.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join, relative, toFileUrl } from "@std/path";
import { buildDesignSystemRuntime } from "../scripts/build.ts";
import { GENERATED_SITE_OUTPUTS } from "../../build.ts";
import { renderDesignSystemDemo } from "../../page-src/design-system-demo.tsx";
import { formatGeneratedText } from "../../page-src/format-generated.ts";
import { designTokens, themeTokens } from "../src/tokens/tokens.ts";

const ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const PUBLIC_ROOT = join(ROOT, "site", "pages", "assets", "design-system");
const AUTHORED_ASSET_ROOT = join(
  ROOT,
  "site",
  "page-src",
  "assets",
  "design-system",
);
const COMPONENT_ROOT = join(ROOT, "site", "design-system", "src", "components");

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function sha256(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  return encodeHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function git(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function themeIncoherentBackgrounds(
  source: string,
  fixedColorNames: ReadonlySet<string>,
): string[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => {
      const declarations = match[2] ?? "";
      const background = declarations.match(/background(?:-color)?\s*:[^;]+;/s)
        ?.[0] ?? "";
      const references = [...background.matchAll(/var\((--ds-color-[^)]+)\)/g)]
        .map((reference) => reference[1] ?? "");
      return /--ds-color-(?:canvas|surface(?:-sunken)?)/.test(background) &&
        references.some((reference) => fixedColorNames.has(reference));
    })
    .map((match) => (match[1] ?? "").trim());
}

interface RampToken {
  readonly name: string;
  readonly value?: string;
  readonly light?: string;
  readonly dark?: string;
}

function roleRampViolations(
  fixed: readonly RampToken[],
  themed: readonly RampToken[],
): string[] {
  const pattern = /^--ds-color-(.+)-(\d+)$/;
  const groups = new Map<string, RampToken[]>();
  for (const token of [...fixed, ...themed]) {
    const match = token.name.match(pattern);
    if (match === null) continue;
    const group = match[1] ?? "";
    groups.set(group, [...(groups.get(group) ?? []), token]);
  }

  const violations: string[] = [];
  const fixedNames = new Set(fixed.map((token) => token.name));
  for (const [group, tokens] of groups) {
    if (tokens.length < 2) continue;
    if (tokens.some((token) => fixedNames.has(token.name))) {
      violations.push(`${group}: ramp members must be theme tokens`);
      continue;
    }

    const ordered = tokens.toSorted((a, b) => {
      const aStep = Number(a.name.match(pattern)?.[2] ?? 0);
      const bStep = Number(b.name.match(pattern)?.[2] ?? 0);
      return aStep - bStep;
    });
    const lightness = (value: string | undefined): number =>
      Number(value?.match(/oklch\(([\d.]+)%/)?.[1] ?? Number.NaN);
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined) continue;
      if (
        lightness(previous.light) <= lightness(current.light) ||
        lightness(previous.dark) >= lightness(current.dark)
      ) {
        violations.push(`${group}: light and dark roles must invert`);
        break;
      }
    }
  }
  return violations;
}

Deno.test("generated public site outputs are ignored and absent from Git", async () => {
  const repoPaths = GENERATED_SITE_OUTPUTS.map((output) =>
    join("site", output)
  );
  const tracked = await git(["ls-files", "--", ...repoPaths]);
  assertEquals(tracked.code, 0);
  assertEquals(
    new TextDecoder().decode(tracked.stdout).trim(),
    "",
    "generated public site outputs must not be tracked",
  );

  for (const path of repoPaths) {
    const ignored = await git(["check-ignore", "--quiet", "--no-index", path]);
    assertEquals(ignored.code, 0, `${path} must be ignored`);
  }
});

Deno.test("design-system sources deterministically reproduce every generated runtime asset", async () => {
  const temp = await Deno.makeTempDir();
  try {
    const summary = await buildDesignSystemRuntime(toFileUrl(`${temp}/`));
    for (
      const relative of [
        "discern.css",
        "manifest.json",
        join("textures", "grain.png"),
      ]
    ) {
      assertEquals(
        await sha256(join(temp, relative)),
        await sha256(join(PUBLIC_ROOT, relative)),
        relative,
      );
    }

    const generatedPage = await Deno.readTextFile(
      join(ROOT, "site", "pages", "design-system-demo.html"),
    );
    assertEquals(
      generatedPage,
      await formatGeneratedText(renderDesignSystemDemo(summary), "html"),
    );
  } finally {
    await Deno.remove(temp, { recursive: true });
  }

  for (
    const [source, output] of [
      ["design-system-demo.css", "demo.css"],
      ["design-system-demo.js", "demo.js"],
      ["design-system-fonts.css", "fonts.css"],
    ] as const
  ) {
    const authored = await Deno.readTextFile(
      join(ROOT, "site", "page-src", source),
    );
    const generated = await Deno.readTextFile(join(PUBLIC_ROOT, output));
    assertEquals(
      generated,
      `/* Generated by site/build.ts from site/page-src/${source}. Do not edit. */\n${authored}`,
      output,
    );
  }
});

Deno.test("every design-system component auto-enrols its implementation surfaces", async () => {
  const files = await walk(COMPONENT_ROOT);
  const fileSet = new Set(files);
  const metaFiles = files.filter((path) => path.endsWith(".meta.ts"));
  assert(metaFiles.length > 0);

  const publicModule = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "src", "mod.ts"),
  );
  for (const meta of metaFiles) {
    const stem = meta.slice(0, -".meta.ts".length);
    const directory = stem.slice(0, stem.lastIndexOf("/"));
    for (
      const sibling of [`${stem}.tsx`, `${stem}.css`, `${stem}.examples.tsx`]
    ) {
      assert(fileSet.has(sibling), `${meta} is missing ${sibling}`);
    }
    assert(fileSet.has(join(directory, "mod.ts")), `${meta} is missing mod.ts`);

    const componentRelative = directory.slice(COMPONENT_ROOT.length + 1);
    assertStringIncludes(
      publicModule,
      `./components/${componentRelative}/mod.ts`,
      `${componentRelative} is missing from src/mod.ts`,
    );
  }

  for (const path of files.filter((file) => /\.(?:css|tsx?|js)$/.test(file))) {
    const source = await Deno.readTextFile(path);
    assert(!/https?:\/\//.test(source), `${path} contains a remote asset URL`);
  }
});

Deno.test("theme-aware design-system surfaces never mix semantic and fixed palette backgrounds", async () => {
  const futureSibling = `.unrelated-aurora {
    background: linear-gradient(
      var(--ds-color-static-glow),
      var(--ds-color-surface-sunken)
    );
  }`;
  assertEquals(
    themeIncoherentBackgrounds(
      futureSibling,
      new Set(["--ds-color-static-glow"]),
    ),
    [".unrelated-aurora"],
  );

  const violations: string[] = [];
  const fixedColorNames = new Set(
    designTokens.filter((token) => token.category === "Color")
      .map((token) => token.name),
  );
  for (
    const path of (await walk(join(ROOT, "site", "design-system", "src")))
      .filter((file) => file.endsWith(".css"))
  ) {
    for (
      const selector of themeIncoherentBackgrounds(
        await Deno.readTextFile(path),
        fixedColorNames,
      )
    ) {
      violations.push(`${path.slice(ROOT.length)}: ${selector}`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("numbered colour ramps preserve their roles across themes", () => {
  assertEquals(
    roleRampViolations(
      [
        { name: "--ds-color-orbit-100", value: "oklch(90% 0.1 250)" },
        { name: "--ds-color-orbit-200", value: "oklch(70% 0.1 250)" },
      ],
      [],
    ),
    ["orbit: ramp members must be theme tokens"],
  );
  assertEquals(roleRampViolations(designTokens, themeTokens), []);
});

Deno.test("typography roles use the selected families and UI buttons", async () => {
  const tokens = new Map(
    designTokens.map((token) => [token.name, token.value]),
  );
  assertEquals(
    tokens.get("--ds-font-display"),
    '"Crimson Pro", "Iowan Old Style", Georgia, serif',
  );
  assertEquals(
    tokens.get("--ds-font-mono"),
    '"Reddit Mono", ui-monospace, "SF Mono", Menlo, monospace',
  );

  const buttonCss = await Deno.readTextFile(
    join(COMPONENT_ROOT, "core", "button", "button.css"),
  );
  assertStringIncludes(buttonCss, "font-family: var(--ds-font-ui)");
  assert(!buttonCss.includes("font-family: var(--ds-font-display)"));
});

Deno.test("the one grain wash retains the reference motif", async () => {
  const css = await Deno.readTextFile(
    join(ROOT, "site", "design-system", "src", "styles", "utilities.css"),
  );
  assertStringIncludes(css, "radial-gradient(110% 72% at 50% -8%");
  assertStringIncludes(css, "var(--ds-color-accent-300) 85%, transparent");
  assertStringIncludes(css, "var(--ds-color-accent-200) 90%");
  assertStringIncludes(css, "var(--ds-color-canvas) 82%");
  assertMatch(css, /background-size:\s*200px 200px/);
  assertMatch(css, /mix-blend-mode:\s*overlay/);
  assertMatch(css, /opacity:\s*0\.38/);
});

Deno.test("the public demo ships static HTML and local runtime assets only", async () => {
  const html = await Deno.readTextFile(
    join(ROOT, "site", "pages", "design-system-demo.html"),
  );
  assertStringIncludes(html, "data-ds-root");
  assertStringIncludes(
    html,
    "typed React at build time · static HTML at runtime",
  );

  const runtimeRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((value) => !value.startsWith("#") && !value.startsWith("data:"));
  assert(
    runtimeRefs.every((value) => value.startsWith("/")),
    `remote runtime references: ${runtimeRefs.join(", ")}`,
  );
  assertEquals(
    runtimeRefs.filter((value) => value.endsWith(".js")),
    ["/assets/design-system/demo.js"],
  );

  for (const asset of ["discern.css", "demo.css", "fonts.css"]) {
    const css = await Deno.readTextFile(join(PUBLIC_ROOT, asset));
    assert(!/https?:\/\//.test(css), `${asset} contains a remote URL`);
  }

  const manifest = JSON.parse(
    await Deno.readTextFile(join(PUBLIC_ROOT, "manifest.json")),
  ) as Record<string, unknown>;
  assertEquals("generatedAt" in manifest, false);
});

Deno.test("self-hosted font binaries carry their open-font licences", async () => {
  for (const source of await walk(AUTHORED_ASSET_ROOT)) {
    const asset = relative(AUTHORED_ASSET_ROOT, source);
    assertEquals(
      await sha256(source),
      await sha256(join(PUBLIC_ROOT, asset)),
      `${asset} must be copied from the authored asset tree`,
    );
  }

  const fonts = await walk(join(PUBLIC_ROOT, "fonts"));
  assertEquals(fonts.length, 5);
  for (const font of fonts) {
    const bytes = await Deno.readFile(font);
    assertEquals(new TextDecoder().decode(bytes.slice(0, 4)), "wOF2", font);
  }

  const licences = await walk(join(PUBLIC_ROOT, "licenses"));
  assertEquals(licences.length, 4);
  for (const licence of licences) {
    assertStringIncludes(
      await Deno.readTextFile(licence),
      "SIL OPEN FONT LICENSE",
    );
  }
});
