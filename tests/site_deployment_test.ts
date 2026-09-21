/** Website snapshots preserve released product bytes despite unreleased main changes. */
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { dirname, join } from "@std/path";
import { withTempDir } from "./temp_dir.ts";
import { runReleaseCommand } from "../scripts/release_command.ts";
import {
  SITE_PRODUCT_PATHS,
  siteProductVersion,
  stageSiteSnapshot,
} from "../scripts/site_deployment.ts";
import { verifySiteDeploymentOrder } from "../scripts/site_deployment_order.ts";

Deno.test("website product selection requires the newest published stable release", () => {
  assertEquals(
    siteProductVersion([
      { version: "7.8.0", date: "2026-01-01" },
      { version: "8.0.0-rc.1", date: "2026-02-01" },
      { version: "7.9.0", date: "2026-02-01" },
    ]),
    "7.9.0",
  );
  assertThrows(() => siteProductVersion([]));
  assertThrows(() =>
    siteProductVersion([{ version: "8.0.0-rc.1", date: "2026-02-01" }])
  );
});

Deno.test("staging exports committed site sources and replaces complete product trees", async () => {
  await withTempDir(async (root) => {
    const repo = join(root, "repo");
    await Deno.mkdir(repo);
    const git = async (args: string[]): Promise<string> =>
      (await runReleaseCommand("git", args, repo)).stdout.trim();
    await git(["init", "-q"]);
    await git(["config", "user.name", "Fixture"]);
    await git(["config", "user.email", "fixture@example.test"]);
    const write = async (path: string, text: string): Promise<void> => {
      await Deno.mkdir(dirname(join(repo, path)), { recursive: true });
      await Deno.writeTextFile(join(repo, path), text);
    };
    const paths = SITE_PRODUCT_PATHS.map((path) =>
      path.includes(".") ? path : `${path}/fixture.txt`
    );
    for (const path of paths) await write(path, "released\n");
    await write(
      "deno.json",
      JSON.stringify({ version: "7.8.0", imports: { example: "old" } }),
    );
    await write("site/home.txt", "old homepage");
    await write(".gitignore", "/site/release-publication.json\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "Release fixture"]);
    const product = await git(["rev-parse", "HEAD"]);
    for (const path of paths) await write(path, "unreleased\n");
    await write("src/new.ts", "unreleased addition");
    await write("site/home.txt", "new homepage");
    await write("project/map/current.md", "current map");
    await write(
      "deno.json",
      JSON.stringify({ version: "8.0.0", imports: { example: "new" } }),
    );
    await git(["add", "."]);
    await git(["commit", "-qm", "Website and unreleased product work"]);
    const source = await git(["rev-parse", "HEAD"]);
    await write("site/home.txt", "dirty homepage");
    const target = join(root, "deployment");
    await stageSiteSnapshot(repo, target, source, product, "[]\n");
    assertEquals(
      await Deno.readTextFile(join(target, "site/home.txt")),
      "new homepage",
    );
    assertEquals(
      await Deno.readTextFile(join(target, "project/map/current.md")),
      "current map",
    );
    for (const path of paths) {
      assertEquals(await Deno.readTextFile(join(target, path)), "released\n");
    }
    await assertRejects(
      () => Deno.stat(join(target, "src/new.ts")),
      Deno.errors.NotFound,
    );
    assertEquals(
      decodeWith(
        z.object({
          version: z.string(),
          imports: z.record(z.string(), z.string()),
        }),
        await Deno.readTextFile(join(target, "deno.json")),
      ),
      { version: "7.8.0", imports: { example: "new" } },
    );
    assertEquals(
      decodeWith(
        z.object({
          source: z.string(),
          product: z.string(),
          version: z.string(),
        }),
        await Deno.readTextFile(join(target, "site-deployment.json")),
      ),
      { source, product, version: "7.8.0" },
    );
    const ignored = await new Deno.Command("git", {
      args: [
        "--git-dir=" + join(repo, ".git"),
        "--work-tree=" + target,
        "check-ignore",
        "--no-index",
        "site/release-publication.json",
      ],
      cwd: target,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      ignored.code,
      1,
      "staged publication evidence must survive Git ignore filtering",
    );
    assertEquals(
      await Deno.readTextFile(join(repo, ".gitignore")),
      "/site/release-publication.json\n",
    );
    assertEquals(
      await Deno.readTextFile(join(repo, "site/home.txt")),
      "dirty homepage",
    );
    await assertRejects(
      () => stageSiteSnapshot(repo, target, source, product, "[]"),
      Deno.errors.AlreadyExists,
    );
  });
});

Deno.test("production order checks successful ancestors even behind inactive or failed states", async () => {
  const source = "a".repeat(40);
  const prior = "b".repeat(40);
  const failed = "c".repeat(40);
  for (const rollback of [false, true]) {
    const checked: string[][] = [];
    const command = (
      program: string,
      args: string[],
    ): Promise<{ stdout: string }> => {
      if (program === "git") {
        checked.push(args);
        if (rollback) return Promise.reject(new Error("not an ancestor"));
        return Promise.resolve({ stdout: "" });
      }
      const path = args.at(-1) ?? "";
      const body = path.includes("deployments?")
        ? [[{ id: 3, sha: failed }, { id: 2, sha: prior }, {
          id: 1,
          sha: prior,
        }]]
        : path.includes("/3/statuses")
        ? [[{ state: "failure" }]]
        : [[{ state: "inactive" }, { state: "success" }]];
      return Promise.resolve({ stdout: JSON.stringify(body) });
    };
    if (rollback) {
      await assertRejects(
        () => verifySiteDeploymentOrder("owner/repo", source, command),
        Error,
        "not an ancestor",
      );
    } else await verifySiteDeploymentOrder("owner/repo", source, command);
    assertEquals(checked, [["merge-base", "--is-ancestor", prior, source]]);
    assert(!checked.some((args) => args.includes(failed)));
  }
});
