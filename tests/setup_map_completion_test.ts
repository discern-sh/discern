import { recommendSetupDocumentationScope } from "../src/shared/setup_guidance.ts";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { setupMapIssues } from "../src/shared/setup_map.ts";

Deno.test("setup requires explanation and reachability for every selected current page", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "map", "storage"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "map", "README.md"),
      "# Project\n\nKeeps a local record of work.\n\n[Storage](storage/)\n",
    );
    await Deno.writeTextFile(
      join(root, "map", "storage", "README.md"),
      "# Storage\n\nCommits complete records before exposing them.\n",
    );
    assertEquals(await setupMapIssues(root, "map"), []);
    await Deno.writeTextFile(
      join(root, "map", "storage", "recovery.md"),
      "# Recovery\n\n<!-- author this -->\n",
    );
    assertEquals((await setupMapIssues(root, "map")).length, 2);
    await Deno.writeTextFile(
      join(root, "map", "storage", "recovery.md"),
      "# Recovery\n\nPreserves the previous record if validation fails.\n",
    );
    assertEquals((await setupMapIssues(root, "map")).length, 1);
    await Deno.writeTextFile(
      join(root, "map", "storage", "README.md"),
      "# Storage\n\nCommits complete records before exposing them.\n\n[Recovery](recovery.md)\n",
    );
    assertEquals(await setupMapIssues(root, "map"), []);
  });
});

Deno.test("a new project may finish with a substantive root and no invented subsystem", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "map"));
    await Deno.writeTextFile(
      join(root, "map", "README.md"),
      "# Project\n\nThe owner has agreed the purpose. No implementation exists yet.\n",
    );
    assertEquals(await setupMapIssues(root, "map"), []);
  });
});

Deno.test("setup selects no invented subsystem for an empty project", () => {
  assertEquals(recommendSetupDocumentationScope([], []), {
    pages: [],
    ledgerItems: [],
  });
});
