import { releaseUpdateSteps } from "./release_page_fixtures.ts";
/** Release records force every projection, publication plan, and compiled name to agree. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { z } from "@zod/zod";
import { JSDOM } from "jsdom";
import { join, toFileUrl } from "@std/path";
import { compareVersions, parseVersion } from "../src/shared/semver.ts";
import { DISCERN_VERSION, RELEASE_METADATA } from "../src/lib/version.ts";
import {
  INSTALL_COMMAND,
  RELEASE_ROUTES,
  releaseCheckUrls,
  UPDATE_SEQUENCE,
} from "../src/shared/product_identity.ts";
import {
  PUBLIC_SCHEMA_PUBLICATIONS,
  RELEASE_SCHEMA_ID,
} from "../src/shared/public_schemas.ts";
import {
  assertPublishedCodenames,
  type AuthoredRelease,
  currentRelease,
  loadReleaseRecords,
  parseReleaseRecords,
  type ReleaseSource,
} from "../site/releases/records.ts";
import {
  type CatalogueRecord,
  compareReleases,
  comparisonSchema,
  parseSince,
  type Publication,
  publicationSchema,
  releaseCatalogue,
  releaseErrorSchema,
  releaseJsonSchema,
} from "../site/releases/model.ts";
import {
  releaseSections,
  renderReleaseHtml,
  renderReleaseText,
} from "../site/releases/render.ts";
import {
  loadReleaseCatalogue,
  PUBLICATION_INPUT,
} from "../site/releases/catalogue.ts";
import {
  handler,
  handlerWithRouting,
  liveHtmlRoutes,
  type SiteRouting,
} from "../site/serve.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { buildSiteRedirectTable, STATIC_REDIRECTS } from "../site/seo.tsx";
import { sitePublicationPlan } from "../scripts/release_site.ts";
import { releasePlan } from "../scripts/release_plan.ts";
import { publicSchemaAjv } from "../scripts/public_schema_compatibility.ts";
import {
  loadReleaseContext,
  publishedReleases,
} from "../scripts/release_publication.ts";
import {
  RELEASE_METADATA_PATH,
  renderReleaseMetadata,
  verifyReleaseMetadata,
} from "../scripts/release_metadata.ts";

import {
  BUILD_TARGETS,
  releaseArtifactPaths,
} from "../scripts/build_targets.ts";
import { withTempDir } from "./helpers.ts";
import { runGit, runShell } from "../src/shared/subprocess.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Find strict-object keywords that would reject a future optional field. */
function closedObjectPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      closedObjectPaths(item, `${path}[${index}]`)
    );
  }
  if (typeof value !== "object" || value === null) return [];
  const entries = Object.entries(value);
  return [
    ...(entries.some(([key, child]) =>
        key === "additionalProperties" && child === false
      )
      ? [path]
      : []),
    ...entries.flatMap(([key, child]) =>
      closedObjectPaths(child, `${path}.${key}`)
    ),
  ];
}

/** Build a reviewable source fixture with its version only in the filename. */
function source(version: string, metadata = ""): ReleaseSource {
  return {
    path: `${version}.md`,
    markdown:
      `---\nsummary: Notes for ${version}\n${metadata}---\nBody for ${version}.\n\n## Details\n\n[Read details](#details).`,
  };
}

/** Select published fixture records without duplicating their notes. */
function publications(records: readonly AuthoredRelease[]): Publication[] {
  return records.map((record) => ({
    version: record.version,
    date: "2026-09-10",
  }));
}

Deno.test("SemVer precedence follows the standard across prereleases and metadata", () => {
  const order = [
    "2.3.0-alpha",
    "2.3.0-alpha.1",
    "2.3.0-alpha.beta",
    "2.3.0-beta",
    "2.3.0-beta.2",
    "2.3.0-beta.11",
    "2.3.0-rc.1",
    "2.3.0",
    "2.3.1",
    "2.10.0",
    "3.0.0",
  ];
  for (const [i, left] of order.entries()) {
    for (const [j, right] of order.entries()) {
      assertEquals(
        Math.sign(compareVersions(left, right)),
        Math.sign(i - j),
        `${left} / ${right}`,
      );
    }
  }
  assertEquals(compareVersions("2.3.0+build.5", "2.3.0+other"), 0);
  assert(compareVersions("2.3.0-rc.1+build", "2.3.0") < 0);
  for (
    const invalid of [
      "",
      "v2.3.0",
      "2.3",
      "02.3.0",
      "2.3.0-01",
      "2.3.0-",
      " 2.3.0",
      "2.3.0 ",
      "2.3.0+",
      "2.3.0+hello world",
    ]
  ) {
    assertThrows(() => parseVersion(invalid));
    assertThrows(() => releaseCheckUrls(invalid));
  }
});

Deno.test("record validation rejects the class with file diagnostics and deterministic sorting", async () => {
  const input = [
    source("2.4.0"),
    source("2.3.1"),
    source("2.3.0-rc.1", 'codename: "星の海"\n'),
    source("2.3.0"),
  ];
  const records = parseReleaseRecords(input);
  for (let offset = 0; offset < input.length; offset++) {
    assertEquals(
      parseReleaseRecords(
        [...input.slice(offset), ...input.slice(0, offset)].reverse(),
      ),
      records,
    );
  }
  for (const record of records) {
    assertEquals(
      record.codename,
      record.version.startsWith("2.3.") ? "星の海" : undefined,
    );
  }
  const cases: [ReleaseSource[], string][] = [
    [[source("2.3.0"), source("2.3.0")], "duplicate release precedence"],
    [[source("2.3.0+a"), source("2.3.0+b")], "duplicate release precedence"],
    [[source("2.3")], "2.3.md"],
    [[source("2.3.0", "version: 2.3.1\n")], "2.3.0.md"],
    [[source("2.3.0", "date: 2026-02-30\n")], "2.3.0.md"],
    [[source("2.3.0", 'codename: ""\n')], "2.3.0.md"],
    [[source("2.3.0", "theme: water\n")], "2.3.0.md"],
    [
      [source("2.3.0", "codename: A\n"), source("2.3.1", "codename: A\n")],
      "competing codename",
    ],
    [[source("2.3.0"), source("2.3.1", "codename: B\n")], "earliest retained"],
    [
      [{ path: "2.3.0.md", markdown: "---\nsummary: A\n---\n" }],
      "notes must not be empty",
    ],
    [[{ path: "2.3.0.md", markdown: "No metadata" }], "expected YAML"],
  ];
  for (const [fixture, diagnostic] of cases) {
    assertThrows(() => parseReleaseRecords(fixture), Error, diagnostic);
  }
  assertThrows(
    () => currentRelease(records, "8.9.0"),
    Error,
    "missing current-version",
  );
  await withTempDir(async (root) => {
    for (const file of input) {
      await Deno.writeTextFile(join(root, file.path), file.markdown);
    }
    const loaded = await loadReleaseRecords(toFileUrl(`${root}/`));
    assertEquals(
      loaded.map((record) => record.version),
      records.map((record) => record.version),
    );
    await Deno.writeTextFile(join(root, "unexpected.txt"), "stray");
    await assertRejects(
      () => loadReleaseRecords(toFileUrl(`${root}/`)),
      Error,
      "unexpected.txt",
    );
  });
});

Deno.test("published family declarations and unnamed families cannot change", () => {
  for (const name of [undefined, "Aurora", "星の海"]) {
    const metadata = name === undefined ? "" : `codename: ${name}\n`;
    const published = parseReleaseRecords([source("2.3.0-rc.1", metadata)]);
    const current = parseReleaseRecords([
      source("2.3.0-rc.1", metadata),
      source("2.3.0"),
      source("2.3.1"),
    ]);
    assertPublishedCodenames(current, published);
    assertThrows(
      () =>
        assertPublishedCodenames(
          parseReleaseRecords([source("2.3.0-rc.1", "codename: Changed\n")]),
          published,
        ),
      Error,
      "published codename",
    );
    assertThrows(
      () =>
        assertPublishedCodenames(
          parseReleaseRecords([source("2.3.0", metadata)]),
          published,
        ),
      Error,
      "missing current-version",
    );
  }
});

Deno.test("comparison states share stable recommendation and complete classified retained history", () => {
  const records = parseReleaseRecords([
    source("2.3.0"),
    source("2.3.1"),
    source("2.4.0-rc.1"),
    source("2.4.0"),
  ]);
  const catalogue = releaseCatalogue(
    records,
    publications(records.filter((r) => r.version !== "2.4.0")),
  );
  const cases: [string | undefined, string, string[]][] = [
    [undefined, "index", ["2.3.1", "2.3.0"]],
    ["2.3.1", "current", []],
    ["2.3.1+build", "current", []],
    ["2.3.0", "update-available", ["2.3.1"]],
    ["2.3.1-rc.1", "update-available", ["2.3.1"]],
    ["2.4.0-rc.1", "ahead", []],
    ["3.0.0", "ahead", []],
    ["0.9.0", "update-available", ["2.3.1", "2.3.0"]],
  ];
  for (const [since, status, applicable] of cases) {
    const result = compareReleases(catalogue, since);
    assertEquals(comparisonSchema.parse(result), result);
    assertEquals(result.status, status);
    assertEquals(result.applicable.map((record) => record.version), applicable);
    assertEquals(result.latest_stable?.version, "2.3.1");
    assertEquals(result.history.prereleases.map((record) => record.version), [
      "2.4.0-rc.1",
    ]);
    assertEquals(result.history.candidates.map((record) => record.version), [
      "2.4.0",
    ]);
    assertEquals(
      result.recommendation?.version,
      status === "ahead" ? undefined : "2.3.1",
    );
    assertEquals(
      result.history_coverage.before_earliest_known,
      since === "0.9.0",
    );
  }
  for (
    const subset of [
      [],
      catalogue.filter((record) => record.publication !== "stable"),
    ]
  ) {
    const result = compareReleases(subset);
    assertEquals(result.status, "no-stable-release");
    assertEquals(result.recommendation, undefined);
  }
  assertThrows(
    () => releaseCatalogue(records, [{ version: "9.8.7", date: "2026-09-10" }]),
    Error,
    "missing retained",
  );
  const published = publications(records);
  assertThrows(
    () => releaseCatalogue(records, [...published, ...published]),
    Error,
    "duplicate publication",
  );
  assertThrows(
    () =>
      releaseCatalogue(
        parseReleaseRecords([source("2.3.0", "date: 2026-09-11\n")]),
        [{ version: "2.3.0", date: "2026-09-10" }],
      ),
    Error,
    "disagrees with publication",
  );
});

Deno.test("offline check links carry only an encoded numeric version", () => {
  for (const version of [undefined, DISCERN_VERSION, "7.8.0+build-1"]) {
    const urls = releaseCheckUrls(version);
    for (const value of Object.values(urls)) {
      const url = new URL(value);
      assertEquals(
        [...url.searchParams],
        version === undefined ? [] : [["since", version]],
      );
      assertEquals(url.origin, "https://discern.sh");
    }
  }
});

Deno.test("since rejects ambiguous inputs and preserves escaped build metadata", () => {
  assertEquals(parseSince(new URLSearchParams()), undefined);
  assertEquals(
    parseSince(new URLSearchParams("since=2.3.0%2Bbuild")),
    "2.3.0+build",
  );
  for (
    const query of [
      "since=",
      "since=v2.3.0",
      "since=2.3",
      "since=2.3.0&since=2.3.0",
      "since=2.3.0+build",
    ]
  ) assertThrows(() => parseSince(new URLSearchParams(query)));
});

/** A real routing snapshot with fixture release records still exercises outer security and SEO. */
async function routing(
  records: readonly CatalogueRecord[],
): Promise<SiteRouting> {
  const site = await loadDocsSite();
  const liveRoutes = liveHtmlRoutes(site);
  return {
    site,
    liveRoutes,
    releases: records,
    redirects: buildSiteRedirectTable(liveRoutes, [], STATIC_REDIRECTS),
  };
}

Deno.test("every release projection and fixed route enrolls future records and statuses", async () => {
  const records = parseReleaseRecords([
    source("7.8.0", "codename: 星の海\n"),
    source("7.8.1"),
    source("7.9.0-rc.1"),
  ]);
  const catalogue = releaseCatalogue(records, publications(records));
  const routes = await routing(catalogue);
  for (
    const since of [undefined, "7.8.1", "7.8.0", "8.0.0", "7.8.1-rc.1", "0.9.0"]
  ) {
    const model = compareReleases(catalogue, since);
    const query = since === undefined
      ? ""
      : `?${new URLSearchParams({ since })}`;
    for (const [format, route] of Object.entries(RELEASE_ROUTES)) {
      const response = await handlerWithRouting(
        new Request(`https://discern.sh${route}${query}`, {
          headers: { accept: "text/html" },
        }),
        routes,
      );
      assertEquals(response.status, 200);
      const body = await response.text();
      assertStringIncludes(
        response.headers.get("content-type") ?? "",
        format === "json"
          ? "application/json"
          : format === "text"
          ? "text/plain"
          : "text/html",
      );
      assert(response.headers.has("content-security-policy"));
      assertEquals(
        response.headers.get("vary"),
        format === "html" ? "Accept, User-Agent" : null,
      );
      if (format === "json") {
        assertEquals(decodeWith(comparisonSchema, body), model);
      } else {
        assertStringIncludes(body, model.status);
        for (const record of catalogue) {
          assertStringIncludes(body, record.version);
        }
        assertStringIncludes(body, "星の海");
      }
    }
    const html = new JSDOM(renderReleaseHtml(model)).window.document;
    const ids = [...html.querySelectorAll("[id]")].map((element) => element.id);
    assertEquals(
      new Set(ids).size,
      ids.length,
      "release note anchors stay unique across sections",
    );
    const sections = releaseSections(model);
    const visibleStatus =
      html.querySelector("[data-release-status]")?.textContent ?? "";
    assert(
      !visibleStatus.includes("Status:"),
      "HTML explains the status in prose",
    );
    assertEquals(
      visibleStatus.includes("These notes start at"),
      model.history_coverage.before_earliest_known,
      "history gaps matter only when the comparison predates the available notes",
    );
    const disclosure = html.querySelector("[data-release-disclosure]");
    assert(disclosure, "the network explanation stays beside the result");
    assert(disclosure.closest("[data-release-status]"));
    assertEquals(disclosure.closest("details, [hidden]"), null);
    assertStringIncludes(disclosure.textContent ?? "", "project data");
    for (const section of sections) {
      assert(section.records.length > 0, "empty release sections are omitted");
      assertEquals(
        [...html.querySelectorAll(
          `[data-release-group="${section.key}"] [${
            section.key === "applicable"
              ? "data-release-ref"
              : "data-release-version"
          }]`,
        )].map((article) =>
          article.getAttribute(
            section.key === "applicable"
              ? "data-release-ref"
              : "data-release-version",
          )
        ),
        section.records.map((record) => record.version),
      );
    }
    assertEquals(html.querySelectorAll("h1").length, 1);
    assertEquals(html.querySelectorAll("main").length, 1);
    assert(html.querySelector("header nav[aria-label]"));
    assert(html.querySelector("footer nav[aria-label]"));
    assertEquals(
      html.querySelectorAll("[data-release-version]").length,
      catalogue.length,
    );
    assertEquals(
      html.querySelector("#update") !== null,
      model.status === "update-available",
    );
    assertEquals(
      html.querySelector("#update code")?.textContent ?? null,
      model.status === "update-available" ? INSTALL_COMMAND : null,
    );
    assertEquals(
      releaseUpdateSteps(html),
      model.status === "update-available" ? [...UPDATE_SEQUENCE] : [],
    );
    for (
      const link of html.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
    ) {
      assert(
        html.getElementById(decodeURIComponent(link.hash.slice(1))),
        link.href,
      );
    }
    assertStringIncludes(renderReleaseText(model), `Status: ${model.status}`);
    if (since === undefined) {
      assertEquals(
        [...html.querySelectorAll("[data-release-version]")].map((element) =>
          element.getAttribute("data-release-version")
        ),
        sections.flatMap((section) =>
          section.records.map((record) => record.version)
        ),
      );
      assertEquals(
        html.querySelectorAll("[data-release-version]").length,
        catalogue.length,
        "the index presents each release once",
      );
    }
  }
  const pending = compareReleases(releaseCatalogue(records, []));
  const pendingHtml = new JSDOM(renderReleaseHtml(pending)).window.document;
  assertEquals(
    [...pendingHtml.querySelectorAll("[data-release-group]")].map((element) =>
      element.getAttribute("data-release-group")
    ),
    ["candidates"],
    "an unpublished catalogue shows the upcoming notes without empty history sections",
  );
  assertStringIncludes(pendingHtml.body.textContent ?? "", "Not released yet.");
  assert(!pendingHtml.body.textContent?.includes(INSTALL_COMMAND));
  assertEquals(
    pendingHtml.querySelector(`a[href="${pending.urls.installer}"]`),
    null,
    "an unpublished catalogue offers notes without an install action",
  );
  assert(routes.liveRoutes.includes(RELEASE_ROUTES.html));
  for (const route of [RELEASE_ROUTES.text, RELEASE_ROUTES.json]) {
    assert(!routes.liveRoutes.includes(route));
  }
  for (
    const headers of [{ accept: "text/plain" }, { "user-agent": "curl/8" }]
  ) {
    const response = await handlerWithRouting(
      new Request(`https://discern.sh${RELEASE_ROUTES.html}`, { headers }),
      routes,
    );
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      "text/plain",
    );
    await response.body?.cancel();
  }
  for (const [format, route] of Object.entries(RELEASE_ROUTES)) {
    for (const query of ["since=invalid", "since=7.8.0&since=7.8.0"]) {
      const response = await handlerWithRouting(
        new Request(`https://discern.sh${route}?${query}`),
        routes,
      );
      assertEquals(response.status, 400);
      const body = await response.text();
      if (format === "json") {
        assertEquals(
          decodeWith(releaseErrorSchema, body).error,
          "invalid-since",
        );
      } else assertStringIncludes(body, "since");
    }
    const head = await handlerWithRouting(
      new Request(`https://discern.sh${route}`, { method: "HEAD" }),
      routes,
    );
    assertEquals(head.status, 200);
    assertEquals(await head.text(), "");
    const redirect = await handlerWithRouting(
      new Request(`http://www.discern.sh${route}/?since=7.8.0`),
      routes,
    );
    assertEquals(redirect.status, 308);
    assertEquals(
      redirect.headers.get("location"),
      `https://discern.sh${route}?since=7.8.0`,
    );
  }
});

Deno.test("release plan preserves latest and catalogue through prereleases, maintenance, and reruns", () => {
  const records = parseReleaseRecords([
    source("2.3.0"),
    source("2.3.1"),
    source("2.4.0"),
    source("2.5.0-rc.1"),
  ]);
  const published = publications(
    records.filter((record) => record.version !== "2.3.1"),
  );
  const ancestors = published.map((release) => release.version);
  for (const record of records) {
    const plan = releasePlan(`v${record.version}`, {
      repositoryPrivate: false,
      version: record.version,
      records,
      published,
      ancestors,
    });
    assertEquals(plan.prerelease, record.version.includes("-"));
    assertEquals(plan.makeLatest, record.version === "2.4.0");
    assertEquals(plan.body, `${record.summary}\n\n${record.body}\n`);
    const model = compareReleases(
      releaseCatalogue(records, publications(records)),
    );
    if (plan.makeLatest) {
      assertEquals(model.latest_stable?.version, plan.version);
    }
    assertThrows(
      () =>
        releasePlan(`v${record.version}`, {
          repositoryPrivate: false,
          version: record.version,
          records,
          published,
          ancestors: [],
        }),
      Error,
      "regress the production catalogue",
    );
  }
  assertThrows(
    () =>
      releasePlan("v9.8.7", {
        repositoryPrivate: false,
        version: "9.8.7",
        records,
        published: [],
        ancestors: [],
      }),
    Error,
    "missing current-version",
  );
  const buildOnly = parseReleaseRecords([source("7.8.0+build-1")]);
  const stableBuild = releasePlan("v7.8.0+build-1", {
    repositoryPrivate: false,
    version: "7.8.0+build-1",
    records: buildOnly,
    published: [],
    ancestors: [],
  });
  assertEquals(stableBuild.prerelease, false);
  assertEquals(stableBuild.makeLatest, true);
  assert(UPDATE_SEQUENCE.some((step) => step.includes(INSTALL_COMMAND)));
  const installer = Deno.readTextFileSync(
    new URL("../install.sh", import.meta.url),
  );
  assertStringIncludes(installer, "releases/latest/download/");
});

Deno.test("publication evidence requires matching SemVer flags, dates, and native assets", () => {
  const assets = BUILD_TARGETS.flatMap(releaseArtifactPaths).map((path) => ({
    name: path.replace(/^dist\//, ""),
    state: "uploaded",
    size: 123,
  }));
  const release = {
    tag_name: "v2.3.0",
    prerelease: false,
    draft: false,
    published_at: "2026-09-10T12:00:00Z",
    assets,
  };
  assertEquals(publishedReleases([[release]], "2.3.0"), [{
    version: "2.3.0",
    date: "2026-09-10",
  }]);
  assertEquals(publishedReleases([[{ ...release, draft: true }]], "2.3.0"), []);
  for (
    const patch of [{ prerelease: true }, { published_at: null }, {
      assets: [],
    }, { assets: assets.slice(1) }]
  ) {
    assertThrows(() =>
      publishedReleases([[{ ...release, ...patch }]], "2.3.0")
    );
  }
});

Deno.test("live authority drives metadata, site build, JSON schema, and GitHub body", async () => {
  const records = await loadReleaseRecords();
  const current = currentRelease(records, DISCERN_VERSION);
  assertEquals(RELEASE_METADATA.version, DISCERN_VERSION);
  assertEquals(RELEASE_METADATA.codename, current.codename);
  assertEquals(
    await Deno.readTextFile(
      new URL(`../${RELEASE_METADATA_PATH}`, import.meta.url),
    ),
    renderReleaseMetadata(records, DISCERN_VERSION),
  );
  await verifyReleaseMetadata();
  const catalogue = await loadReleaseCatalogue();
  assertEquals(
    catalogue.map((record) => record.version),
    records.map((record) => record.version),
  );
  const response = await handler(
    new Request(`https://discern.sh${RELEASE_ROUTES.json}`),
  );
  assertEquals(
    comparisonSchema.parse(await response.json()),
    compareReleases(catalogue),
  );
  assert(
    PUBLIC_SCHEMA_PUBLICATIONS.some((publication) =>
      publication.id === RELEASE_SCHEMA_ID
    ),
  );
  assertEquals(releaseJsonSchema()["$id"], RELEASE_SCHEMA_ID);
  const tracked = await runGit(["ls-files", "--", PUBLICATION_INPUT.pathname], {
    cwd: REPO_ROOT,
  });
  assert(tracked.success);
  assertEquals(tracked.stdout.trim(), "");
});

Deno.test("the releases schema accepts additive fields and rejects unknown statuses", () => {
  const schema = releaseJsonSchema();
  assertEquals(closedObjectPaths(schema), []);
  const validate = publicSchemaAjv(false).compile(schema);
  const current = compareReleases([]);
  assertEquals(validate(current), true);
  assertEquals(
    validate({ ...current, future_optional_field: "future value" }),
    true,
  );
  assertEquals(validate({ ...current, status: "future-status" }), false);
});

Deno.test("compiled metadata resolves Unicode and unnamed families from an arbitrary directory", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "src/lib"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({ version: "7.8.1" }),
    );
    for (const codename of [undefined, "星の海"]) {
      const records = parseReleaseRecords([
        source(
          "7.8.0-rc.1",
          codename === undefined ? "" : `codename: ${codename}\n`,
        ),
        source("7.8.1"),
      ]);
      await Deno.writeTextFile(
        join(root, "src/lib/release_metadata.ts"),
        renderReleaseMetadata(records, "7.8.1"),
      );
      await Deno.writeTextFile(
        join(root, "entry.ts"),
        'import { RELEASE_METADATA } from "./src/lib/release_metadata.ts"; console.log(JSON.stringify(RELEASE_METADATA));',
      );
      const compiled = await runShell(
        "deno compile --no-check --output metadata entry.ts",
        { cwd: root },
      );
      assert(compiled.success, new TextDecoder().decode(compiled.stderr));
      await Deno.remove(join(root, "deno.json"));
      await Deno.remove(join(root, "src"), { recursive: true });
      const executed = await runShell(`'${join(root, "metadata")}'`, {
        cwd: "/tmp",
      });
      assert(executed.success, new TextDecoder().decode(executed.stderr));
      assertEquals(
        decodeWith(
          z.object({ version: z.string(), codename: z.string().optional() }),
          new TextDecoder().decode(executed.stdout),
        ),
        { version: "7.8.1", ...(codename === undefined ? {} : { codename }) },
      );
      await Deno.mkdir(join(root, "src/lib"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({ version: "7.8.1" }),
      );
    }
  });
});

const releaseWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
  jobs: z.record(
    z.string(),
    z.object({
      steps: z.array(
        z.object({
          name: z.string().optional(),
          id: z.string().optional(),
          run: z.string().optional(),
          uses: z.string().optional(),
          with: z.record(z.string(), z.unknown()).optional(),
        }).passthrough(),
      ),
    }).passthrough(),
  ),
});

/** Read the workflow once per test so permission and publication checks share its actual commands. */
async function readReleaseWorkflow(): Promise<
  z.infer<typeof releaseWorkflowSchema>
> {
  return releaseWorkflowSchema.parse(parseYaml(
    await Deno.readTextFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
    ),
  ));
}

Deno.test("release workflow can publish notes only from the authored record plan", async () => {
  const workflow = await readReleaseWorkflow();
  assertEquals(workflow.concurrency.group, "release-production");
  const release = workflow.jobs["release"];
  assert(release !== undefined);
  const publishing = release.steps.filter((step) =>
    step.uses?.startsWith("softprops/action-gh-release@")
  );
  assertEquals(publishing.length, 1);
  const publish = publishing[0];
  assert(publish !== undefined);
  assertEquals(
    publish.with?.["body_path"],
    "${{ runner.temp }}/release-body.md",
  );
  assertEquals(publish.with?.["generate_release_notes"], false);
  assertEquals(publish.with?.["body"], undefined);
  const derive = release.steps.findIndex((step) =>
    step.id === "publication-plan"
  );
  assert(derive >= 0 && derive < release.steps.indexOf(publish));
  assertStringIncludes(
    release.steps[derive]?.run ?? "",
    "scripts/release_plan.ts",
  );
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.run?.includes("release-body.md")) {
        assertStringIncludes(step.run, "scripts/release_plan.ts");
      }
    }
  }
  assertStringIncludes(
    workflow.jobs["deploy-site"]?.steps.map((step) => step.run ?? "").join(
      "\n",
    ) ?? "",
    "scripts/release_site.ts",
  );
});

Deno.test("publication context checks immutable tagged family names and real ancestry", async () => {
  await withTempDir(async (root) => {
    const recordDir = join(root, "site/releases/records");
    await Deno.mkdir(recordDir, { recursive: true });
    const first = source("2.3.0-rc.1", "codename: Aurora\n");
    const future = source("2.4.0");
    for (const record of [first, future]) {
      await Deno.writeTextFile(join(recordDir, record.path), record.markdown);
    }
    await gitInit(root);
    await git(root, "tag", "v2.3.0-rc.1");
    const assets = BUILD_TARGETS.flatMap(releaseArtifactPaths).map((path) => ({
      name: path.replace(/^dist\//, ""),
      state: "uploaded",
      size: 123,
    }));
    const observed = {
      tag_name: "v2.3.0-rc.1",
      prerelease: true,
      draft: false,
      published_at: "2026-09-10T12:00:00Z",
      assets,
    };
    const snapshot = join(root, "observed.json");
    await Deno.writeTextFile(snapshot, JSON.stringify([[observed]]));
    const runner = join(root, "publication-check.ts");
    await Deno.writeTextFile(
      runner,
      `import { loadReleaseContext } from ${
        JSON.stringify(
          new URL("../scripts/release_publication.ts", import.meta.url).href,
        )
      };\n` +
        `await loadReleaseContext(Deno.args[0], Deno.args[1], "2.4.0");\n`,
    );
    const workflow = await readReleaseWorkflow();
    const permissionSets = new Set(
      Object.values(workflow.jobs).flatMap((job) =>
        job.steps.flatMap((step) => {
          const prefix = step.run?.match(
            /^deno run (.*?)scripts\/release_(?:plan|site)\.ts/s,
          )?.[1];
          return prefix === undefined ? [] : [prefix.trim()];
        })
      ),
    );
    assert(permissionSets.size > 0);
    for (const permissions of permissionSets) {
      const checked = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          join(REPO_ROOT, "deno.json"),
          ...permissions.split(/\s+/),
          runner,
          snapshot,
          root,
        ],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(checked.success, new TextDecoder().decode(checked.stderr));
    }
    // An unpublished family's name remains editable even when its candidate appeared in an older tag.
    await Deno.writeTextFile(
      join(recordDir, future.path),
      source("2.4.0", "codename: Tides\n").markdown,
    );
    const context = await loadReleaseContext(snapshot, root, "2.4.0");
    assertEquals(context.ancestors, ["2.3.0-rc.1"]);
    assertEquals(currentRelease(context.records, "2.4.0").codename, "Tides");
    await Deno.writeTextFile(
      join(recordDir, first.path),
      source("2.3.0-rc.1", "codename: Changed\n").markdown,
    );
    await assertRejects(
      () => loadReleaseContext(snapshot, root, "2.4.0"),
      Error,
      "published codename",
    );
    await Deno.writeTextFile(join(recordDir, first.path), first.markdown);
    await git(root, "add", "site");
    await git(root, "commit", "-qm", "Record stable release");
    await git(root, "tag", "v2.4.0");
    await Deno.writeTextFile(
      snapshot,
      JSON.stringify([[observed, {
        ...observed,
        tag_name: "v2.4.0",
        prerelease: false,
      }]]),
    );
    assertEquals(
      (await loadReleaseContext(snapshot, root, "2.4.0")).ancestors.length,
      2,
    );
    await git(root, "checkout", "--detach", "v2.3.0-rc.1");
    await Deno.writeTextFile(
      join(recordDir, future.path),
      source("2.4.0", "codename: Tides\n").markdown,
    );
    const stale = await loadReleaseContext(snapshot, root, "2.3.0-rc.1");
    assertThrows(
      () =>
        releasePlan("v2.3.0-rc.1", {
          ...stale,
          version: "2.3.0-rc.1",
          repositoryPrivate: false,
        }),
      Error,
      "regress the production catalogue",
    );
  });
});

Deno.test("site publication plans validate availability before any write", () => {
  const records = parseReleaseRecords([source("7.8.0"), source("7.9.0-rc.1")]);
  const published = publications(records);
  const context = {
    records,
    published,
    ancestors: published.map((release) => release.version),
  };
  for (const record of records) {
    const plan = sitePublicationPlan(
      `v${record.version}`,
      context,
      record.version,
    );
    assertEquals(
      decodeWith(z.array(publicationSchema), plan.publicationInput),
      published,
    );
  }
  assertThrows(
    () => sitePublicationPlan("v7.8.0", { ...context, published: [] }, "7.8.0"),
    Error,
    "not published",
  );
});
