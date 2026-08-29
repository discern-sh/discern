/**
 * Focused rejection coverage for the strict manual corpus projection.
 *
 * Each case builds one minimal synthetic manual in a temp directory, breaks
 * exactly one corpus contract, and proves {@link buildManualProjection}
 * refuses with the issue that names the defect. The valid baseline also pins
 * the publication collapse tests/manual_policy_test.ts builds on: a
 * publish:false page never reaches the projection's published maps.
 */

import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { discoverDocs } from "../src/lib/docs.ts";
import {
  buildManualProjection,
  MANUAL_FRONT_DOORS_END,
  MANUAL_FRONT_DOORS_START,
  type ManualProjection,
  ManualProjectionError,
} from "../src/lib/manual.ts";
import { MANUAL_SECTION_REGISTRY } from "../src/shared/manual.ts";
import { withTempDir } from "./helpers.ts";

/** Optional deviations from one fixture page's valid strict metadata. */
interface FixturePageOptions {
  /** Value written for the kind key; false omits the key entirely. */
  readonly kind?: string | false;
  readonly publish?: boolean;
  readonly order?: number;
  /** Overrides the id-derived search alias, e.g. to force a collision. */
  readonly alias?: string;
  /** Absolute canonical redirect_from routes. */
  readonly redirects?: readonly string[];
  /** Extra body lines appended after the fixture heading. */
  readonly body?: readonly string[];
}

/** Render one strict manual fixture page around a stable identity. */
function fixturePage(id: string, options: FixturePageOptions = {}): string {
  const kind = options.kind ?? "guide";
  return [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(`${id} title`)}`,
    `description: ${
      JSON.stringify(
        `A synthetic manual fixture page kept long enough for the strict metadata policy (${id}).`,
      )
    }`,
    `order: ${options.order ?? 10}`,
    `publish: ${options.publish ?? true}`,
    ...(kind === false ? [] : [`kind: ${kind}`]),
    "aliases:",
    `  - ${JSON.stringify(options.alias ?? `${id} alias`)}`,
    ...(options.redirects === undefined ? [] : [
      "redirect_from:",
      ...options.redirects.map((route) => `  - ${JSON.stringify(route)}`),
    ]),
    "---",
    "",
    `# ${id} fixture`,
    "",
    "Fixture body.",
    "",
    ...(options.body ?? []),
  ].join("\n");
}

/** Write one minimal valid manual corpus and return its root directory. */
async function writeBaselineManual(dir: string): Promise<string> {
  const manualDir = join(dir, "manual");
  for (const section of MANUAL_SECTION_REGISTRY) {
    await ensureDir(join(manualDir, section.dir));
    await Deno.writeTextFile(
      join(manualDir, section.dir, "README.md"),
      fixturePage(`${section.slug}-index`, { kind: "reference", order: 0 }),
    );
  }
  await Deno.writeTextFile(
    join(manualDir, "00-start", "hello.md"),
    fixturePage("start-hello", { kind: "tutorial" }),
  );
  await Deno.writeTextFile(
    join(manualDir, "README.md"),
    fixturePage("root-index", {
      kind: "tutorial",
      order: 0,
      body: [
        MANUAL_FRONT_DOORS_START,
        "",
        "- [Hello fixture](00-start/hello.md)",
        "",
        MANUAL_FRONT_DOORS_END,
        "",
      ],
    }),
  );
  return manualDir;
}

/** Discover one fixture corpus and apply the strict projection. */
async function projectFixture(
  dir: string,
  manualDir: string,
): Promise<ManualProjection> {
  const tree = await discoverDocs({ cwd: dir, dir: manualDir });
  assert(tree !== undefined);
  return await buildManualProjection(tree.entries);
}

/** Project one mutated corpus, expecting the strict boundary to refuse. */
async function rejectionIssues(
  dir: string,
  manualDir: string,
): Promise<readonly string[]> {
  const tree = await discoverDocs({ cwd: dir, dir: manualDir });
  assert(tree !== undefined);
  const error = await assertRejects(
    () => buildManualProjection(tree.entries),
    ManualProjectionError,
  );
  return error.issues;
}

/** One labeled corpus defect and the issue naming it. */
interface RejectionCase {
  readonly name: string;
  readonly issue: string;
  readonly mutate: (manualDir: string) => Promise<void>;
}

const REJECTIONS: readonly RejectionCase[] = [
  {
    name: "a page with no kind",
    issue: "00-start/hello.md: frontmatter must declare one valid kind",
    mutate: (manualDir) =>
      Deno.writeTextFile(
        join(manualDir, "00-start", "hello.md"),
        fixturePage("start-hello", { kind: false }),
      ),
  },
  {
    name: "an invalid kind value",
    issue: "kind: must be one of: tutorial, guide, explanation, reference," +
      " troubleshooting",
    mutate: (manualDir) =>
      Deno.writeTextFile(
        join(manualDir, "00-start", "hello.md"),
        fixturePage("start-hello", { kind: "banana" }),
      ),
  },
  {
    name: "a duplicate page id",
    issue: "id start-hello is already declared by",
    mutate: (manualDir) =>
      Deno.writeTextFile(
        join(manualDir, "00-start", "dupe.md"),
        fixturePage("start-hello", { order: 30, alias: "start-dupe alias" }),
      ),
  },
  {
    name: "a duplicate route",
    issue: "route /docs/start/hello is already owned by",
    mutate: async (manualDir) => {
      await ensureDir(join(manualDir, "00-start", "deep"));
      await Deno.writeTextFile(
        join(manualDir, "00-start", "deep", "hello.md"),
        fixturePage("start-deep-hello"),
      );
    },
  },
  {
    name: "a withheld page owning redirects",
    issue: "00-start/withheld.md: a withheld page cannot own redirects",
    mutate: (manualDir) =>
      Deno.writeTextFile(
        join(manualDir, "00-start", "withheld.md"),
        fixturePage("start-withheld", {
          publish: false,
          order: 20,
          redirects: ["/docs/legacy-withheld"],
        }),
      ),
  },
  {
    name: "an alias collision with no recorded owner",
    issue: "record one owner in MANUAL_ALIAS_OWNER_OVERRIDES",
    mutate: (manualDir) =>
      Deno.writeTextFile(
        join(manualDir, "00-start", "collide.md"),
        fixturePage("start-collide", { order: 40, alias: "start-hello alias" }),
      ),
  },
  {
    name: "an unpublished front-door destination",
    issue: "README.md: promoted destination 00-start/hello.md is not a " +
      "published manual page",
    mutate: (manualDir) =>
      Deno.writeTextFile(
        join(manualDir, "00-start", "hello.md"),
        fixturePage("start-hello", { kind: "tutorial", publish: false }),
      ),
  },
];

Deno.test("the strict projection rejects each corpus defect with its named issue", async () => {
  for (const rejection of REJECTIONS) {
    await withTempDir(async (dir) => {
      const manualDir = await writeBaselineManual(dir);
      await rejection.mutate(manualDir);
      const issues = await rejectionIssues(dir, manualDir);
      assert(
        issues.some((issue) => issue.includes(rejection.issue)),
        `${rejection.name} must report ${
          JSON.stringify(rejection.issue)
        }; got:\n- ${issues.join("\n- ")}`,
      );
    });
  }
});

Deno.test("a minimal valid corpus projects and publish:false stays out of the published maps", async () => {
  await withTempDir(async (dir) => {
    const manualDir = await writeBaselineManual(dir);
    await Deno.writeTextFile(
      join(manualDir, "00-start", "withheld.md"),
      fixturePage("start-withheld", { publish: false, order: 20 }),
    );
    const projection = await projectFixture(dir, manualDir);
    assertEquals(
      projection.frontDoors.map((frontDoor) => frontDoor.id),
      ["start-hello"],
    );
    assertEquals(projection.pages.length, MANUAL_SECTION_REGISTRY.length + 2);
    assert(projection.byId.has("start-hello"));
    assertFalse(projection.byId.has("start-withheld"));
    assertFalse(projection.bySourcePath.has("00-start/withheld.md"));
  });
});
