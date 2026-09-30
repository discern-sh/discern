/** Local design-system development keeps the published consumer pin untouched. */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { z } from "@zod/zod";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import {
  resolveLocalDesignSystemArgs,
  serverArgs,
  watchTaskCommand,
} from "../scripts/site_local_design_system.ts";
import { denoRunInvocation } from "../site/dev_invocation.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { moduleSpecifiers } from "./design_system_dependency.ts";
import { withTempDir } from "./helpers.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** The task table the Project Script's delegated task is read from. */
const DenoTasksSchema = z.object({ tasks: z.record(z.string(), z.string()) });

Deno.test("the linked server derives its sandbox from the watch task", () => {
  const args = serverArgs(
    "/tmp/link/deno.json",
    "/tmp/future-component-system",
    "deno run --watch --allow-read --allow-run --allow-env=PORT,EXAMPLE site/dev.ts --watch",
  );
  const entryIndex = args.findIndex((argument) =>
    argument.endsWith("site/dev.ts")
  );
  assertEquals(entryIndex > 0, true, args.join(" "));
  const sandbox = args.slice(0, entryIndex);
  assertEquals(sandbox.includes("--allow-env=PORT,EXAMPLE"), true);
  assertEquals(sandbox.includes("--allow-read"), true);
  assertEquals(sandbox.includes("--allow-run"), true);
  assertEquals(sandbox.includes("--allow-write"), true);
  assertEquals(
    args.slice(entryIndex + 1),
    [
      "--watch",
      "--build-config",
      "/tmp/link/deno.json",
      "--watch-input",
      join("/tmp/future-component-system", "src"),
      "--watch-input",
      join("/tmp/future-component-system", "deno.json"),
    ],
  );

  assertThrows(
    () => serverArgs("/tmp/link/deno.json", "/tmp/pkg", "deno fmt"),
    Error,
    "watch task",
  );
  assertThrows(
    () =>
      serverArgs(
        "/tmp/link/deno.json",
        "/tmp/pkg",
        "deno run --allow-read site/main.ts",
      ),
    Error,
    "site/dev.ts",
  );

  assertEquals(
    watchTaskCommand({ tasks: { watch: "deno run site/dev.ts" } }),
    "deno run site/dev.ts",
  );
  assertThrows(() => watchTaskCommand({}), Error, "watch task");
});

Deno.test("local design-system arguments resolve an explicit checkout before the conventional sibling", async () => {
  let mainCheckoutQueries = 0;
  const mainCheckout = (): Promise<string> => {
    mainCheckoutQueries += 1;
    return Promise.resolve("/srv/nebula-client");
  };

  assertEquals(
    await resolveLocalDesignSystemArgs(
      ["--", "--build-only", "/tmp/component-worktree"],
      mainCheckout,
    ),
    { buildOnly: true, packageRoot: "/tmp/component-worktree" },
  );
  assertEquals(
    await resolveLocalDesignSystemArgs([], mainCheckout),
    { buildOnly: false, packageRoot: "/srv/discern-design-system" },
  );
  assertEquals(mainCheckoutQueries, 1);

  await assertRejects(
    () =>
      resolveLocalDesignSystemArgs(
        [],
        () => Promise.resolve(undefined),
      ),
    Error,
    "could not locate discern's main checkout",
  );
  await assertRejects(
    () =>
      resolveLocalDesignSystemArgs(
        ["/tmp/one", "/tmp/two"],
        mainCheckout,
      ),
    Error,
    "one design-system checkout",
  );
});

Deno.test("the helper loads without the site's package graph, so it can serve an ahead checkout", async () => {
  // The helper runs under the committed pin. If its own graph reached the
  // site's package consumers, a local checkout exporting something the pinned
  // release lacks could never be previewed: the helper would fail to load
  // before writing the link. Only the parse it shares with the preview task
  // may come from `site/`.
  const modules = await moduleSpecifiers(
    join(ROOT, "scripts/site_local_design_system.ts"),
  );
  assertEquals(
    modules.filter((specifier) =>
      specifier.startsWith(toFileUrl(join(ROOT, "site")).href)
    ),
    [toFileUrl(join(ROOT, "site/dev_invocation.ts")).href],
  );
});

Deno.test("the preview task's sandbox admits the helper's repository lookup and supervised child", async () => {
  // The helper runs under its task's own permission flags, not the test
  // runner's, so an engine read those flags omit only fails when someone
  // previews. Run the helper's effectful dependencies under exactly those
  // flags, taken from the task the Project Script delegates to.
  const script = await Deno.readTextFile(
    join(ROOT, "project/scripts/site-design-system"),
  );
  const task = /deno task ([\w:-]+)/.exec(script)?.[1] ?? "";
  assertEquals(task, "site:design-system");
  const config = decodeWith(
    DenoTasksSchema,
    await Deno.readTextFile(join(ROOT, "deno.json")),
  );
  const invocation = denoRunInvocation(config.tasks[task] ?? "");
  assertEquals(invocation?.entry, "scripts/site_local_design_system.ts");
  const flags = invocation?.permissionFlags ?? [];
  await withTempDir(async (dir) => {
    const probe = join(dir, "probe.ts");
    await Deno.writeTextFile(
      probe,
      [
        `import { mainRepoPath } from ${
          JSON.stringify(
            toFileUrl(join(ROOT, "src/shared/main_repo.ts")).href,
          )
        };`,
        `import { runOwnedChild } from ${
          JSON.stringify(
            toFileUrl(join(ROOT, "src/engine/owned_child.ts")).href,
          )
        };`,
        `await mainRepoPath(${JSON.stringify(ROOT)});`,
        `const result = await runOwnedChild(Deno.execPath(), { args: ["eval", ""] });`,
        "Deno.exit(result.status.code);",
      ].join("\n"),
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--config", join(ROOT, "deno.json"), ...flags, probe],
      cwd: ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
  });
});
